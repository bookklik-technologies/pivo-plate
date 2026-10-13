// PiVo Plate — renderer-independent core engine.
// Public contract: docs/CONTRACTS.md. Types: ./types.ts (shared, fixed).
import type {
  Vec2, Vec3, Plane, Atlas, AtlasRegion, Tile, SceneObject, Project,
  Selection, Brush, EditorSession,
} from './types.ts';
import { preflightPngDataUrl, validatePngDataUrl, checkProjectPngBudget } from './png';
import { DEFAULT_OBJECT_ID } from './types.ts';
import { ancestorChain, MAX_HIERARCHY_DEPTH, objectDepths } from './hierarchy.ts';

export { MAX_HIERARCHY_DEPTH } from './hierarchy.ts';

/* ---------------------------------- utils --------------------------------- */

/** Generate a reasonably unique id, optionally prefixed. */
export function uid(prefix = ''): string {
  // Not cryptographic: ids are local identifiers only.
  const bytes = new Uint8Array(8);
  (globalThis.crypto as Crypto | undefined)?.getRandomValues?.(bytes);
  if (!bytes.some((b) => b !== 0)) {
    // Fallback for exotic runtimes without crypto.getRandomValues.
    const t = Date.now();
    for (let i = 0; i < 8; i++) bytes[i] = Math.floor((t / 2 ** (i * 8)) % 256) ^ ((i * 2654435761) >>> 0) & 0xff;
  }
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return prefix ? `${prefix}-${hex}` : hex;
}

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function v3(x: number, y: number, z: number): Vec3 {
  return [x, y, z];
}

function eq3(a: Vec3, b: Vec3): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

/* ------------------------------- project / session ------------------------ */

/** Create a new, empty project with the default object-main object. */
export function createProject(name = 'Untitled'): Project {
  const object: SceneObject = {
    id: DEFAULT_OBJECT_ID,
    name: DEFAULT_OBJECT_ID,
    parentId: null,
    visible: true,
    locked: false,
  };
  return { format: 'pivo-plate', version: 1, name, atlases: [], objects: [object], tiles: [] };
}

const blankSelection = (): Selection => ({ tileIds: [], vertices: [] });

/**
 * Create an editing session for a project. Projects may have no atlases yet;
 * in that case the session falls back to a blank brush referencing a
 * conventional blank atlas id, so drawing can still start from nothing.
 */
export function createSession(project: Project): EditorSession {
  const firstAtlas = project.atlases[0];
  const brush: Brush = firstAtlas
    ? { atlasId: firstAtlas.id, region: { x: firstAtlas.margin, y: firstAtlas.margin, width: firstAtlas.tileWidth, height: firstAtlas.tileHeight }, rotation: 0, flipX: false, flipY: false }
    : { atlasId: 'blank', region: { x: 0, y: 0, width: 0, height: 0 }, rotation: 0, flipX: false, flipY: false };
  return {
    mode: 'draw',
    crosshair: [0, 0, 0],
    plane: 'XY',
    planeLocked: false,
    grid: 1,
    tileSize: 1,
    activeObjectId: project.objects[0]?.id ?? DEFAULT_OBJECT_ID,
    brush,
    selection: blankSelection(),
  };
}

/* ------------------------------- geometry -------------------------------- */

/**
 * Snap a scalar to the nearest multiple of `grid`. Grid 0 or negative grid
 * falls back to identity (no snapping). Works correctly for negatives.
 */
export function snap(value: number, grid: number): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(grid) || grid <= 0) return value;
  const snapped = Math.round(value / grid) * grid;
  return snapped === 0 ? 0 : snapped; // normalize -0
}

/** Floor-snap to the grid cell origin (lower corner of the containing cell). */
function floorSnap(value: number, grid: number): number {
  if (!Number.isFinite(value)) return value;
  if (!Number.isFinite(grid) || grid <= 0) return value;
  const snapped = Math.floor(value / grid) * grid;
  return snapped === 0 ? 0 : snapped; // normalize -0
}

/**
 * Map a point onto the given construction plane: the two in-plane
 * coordinates are floor-snapped to the cell origin (lower corner of the
 * grid cell containing the point), and the perpendicular coordinate is
 * taken from the crosshair so drawing happens at the current elevation.
 * Right-handed Y-up: XZ is the ground plane, XY and YZ are wall planes.
 */
export function planePoint(point: Vec3, plane: Plane, crosshair: Vec3, grid: number): Vec3 {
  const [x, y, z] = point;
  const px = floorSnap(x, grid);
  const py = floorSnap(y, grid);
  const pz = floorSnap(z, grid);
  switch (plane) {
    case 'XY': return [px, py, crosshair[2]];
    case 'XZ': return [px, crosshair[1], pz];
    case 'YZ': return [crosshair[0], py, pz];
  }
}

/**
 * World-space quad corners for a tile whose origin corner sits at `origin`
 * on the given plane, sized `tileSize`. Corner order is consistent across
 * planes: [origin, +a, +a+b, +b] where (a, b) are the plane's in-plane axes
 * chosen so the triangulation [0,1,2,0,2,3] faces the plane's positive
 * axis under right-handed Y-up coordinates:
 *   XY → +Z (a=x, b=y), XZ → +Y (a=z, b=x), YZ → +X (a=y, b=z).
 */
export function tileCorners(origin: Vec3, plane: Plane, tileSize: number): [Vec3, Vec3, Vec3, Vec3] {
  const [x, y, z] = origin;
  const s = tileSize;
  switch (plane) {
    // a=x, b=y; CCW seen from +Z
    case 'XY': return [[x, y, z], [x + s, y, z], [x + s, y + s, z], [x, y + s, z]];
    // a=z, b=x; CCW seen from +Y (faces up)
    case 'XZ': return [[x, y, z], [x, y, z + s], [x + s, y, z + s], [x + s, y, z]];
    // a=y, b=z; CCW seen from +X
    case 'YZ': return [[x, y, z], [x, y + s, z], [x, y + s, z + s], [x, y, z + s]];
  }
}

/**
 * Validate a brush against its atlas before any tile is created or mutated:
 * region must be a finite in-bounds pixel rectangle with positive size, and
 * rotation must be a whole number of quarter-turns (0..3). Called by
 * makeTile/applyBrush so invalid brushes are rejected before mutation.
 */
export function validateBrushAgainstAtlas(atlas: Atlas, brush: Brush): void {
  const { region } = brush;
  if (!region
    || !Number.isFinite(region.x) || !Number.isFinite(region.y)
    || !Number.isFinite(region.width) || !Number.isFinite(region.height)) {
    throw new Error('brush region must be finite');
  }
  if (!Number.isInteger(brush.rotation) || (brush.rotation as number) < 0 || (brush.rotation as number) > 3) {
    throw new Error('brush rotation must be an integer number of quarter-turns (0..3)');
  }
  if (typeof brush.flipX !== 'boolean' || typeof brush.flipY !== 'boolean') {
    throw new Error('brush flipX and flipY must be booleans');
  }
  if (region.width <= 0 || region.height <= 0) {
    throw new Error('brush region must have positive width and height');
  }
  if (region.x < 0 || region.y < 0
    || region.x + region.width > atlas.width || region.y + region.height > atlas.height) {
    throw new Error(`brush region ${region.x},${region.y} ${region.width}x${region.height} is outside the ${atlas.width}x${atlas.height} atlas`);
  }
}

/** Rotation flag check for brushes without an atlas context (still strict). */
function checkBrushRotation(rotation: Brush['rotation']): void {
  if (!Number.isInteger(rotation) || (rotation as number) < 0 || (rotation as number) > 3) {
    throw new Error('brush rotation must be an integer number of quarter-turns (0..3)');
  }
}

/**
 * Create a tile on the active object at `origin` on the session plane,
 * using the session brush for UVs. Mutates the project in place (intended
 * to be called inside a store transaction) and returns the new tile.
 * Rejects out-of-bounds brush regions and invalid rotation flags before
 * any tile is created.
 */
export function makeTile(project: Project, session: EditorSession, origin: Vec3): Tile {
  const objectId = session.activeObjectId;
  const object = project.objects.find((o) => o.id === objectId);
  if (!object) throw new Error(`makeTile: unknown active object "${objectId}"`);
  if (isObjectLocked(project, objectId)) {
    throw new Error('makeTile: active object is locked (ancestor lock inherited)');
  }
  const atlasId = session.brush.atlasId;
  if (!project.atlases.some(a => a.id === atlasId)) throw new Error('Import a PNG tileset before drawing');
  if (!origin.every(Number.isFinite) || !Number.isFinite(session.tileSize) || session.tileSize <= 0) throw new Error('Tile origin and size must be finite and size must be positive');
  checkBrushRotation(session.brush.rotation);
  // The session brush may reference the conventional blank atlas before any
  // PNG is imported; a real atlas must have an in-bounds brush region.
  const brushAtlas = project.atlases.find((a) => a.id === atlasId);
  if (brushAtlas) validateBrushAgainstAtlas(brushAtlas, session.brush);
  const tile: Tile = {
    id: uid('tile'),
    objectId,
    atlasId,
    vertices: tileCorners(origin, session.plane, session.tileSize),
    uvs: brushUVsFromSession(project, session),
    reversed: false,
  };
  project.tiles.push(tile);
  return tile;
}

function brushUVsFromSession(project: Project, session: EditorSession): [Vec2, Vec2, Vec2, Vec2] {
  const atlas = project.atlases.find((a) => a.id === session.brush.atlasId);
  if (!atlas) {
    // No atlas (blank brush): degenerate 0..1 UVs so geometry still works.
    return [[0, 0], [1, 0], [1, 1], [0, 1]];
  }
  return brushUVs(atlas, session.brush);
}

/**
 * Convert a brush pixel-region (top-down y, like image space) plus
 * rotation/flips into four bottom-left-origin UVs matching the quad corner
 * order [LL, LR, UR, UL]. Rotation is in quarter-turns, clockwise in image
 * space. Margins/spacing describe *selectable cells* and do not shrink the
 * requested region itself.
 */
export function brushUVs(atlas: Atlas, brush: Brush): [Vec2, Vec2, Vec2, Vec2] {
  const { region, rotation, flipX, flipY } = brush;
  const w = atlas.width || 1;
  const h = atlas.height || 1;
  // Normalized region edges in image space (y down), before rotation.
  const x0 = region.x / w, x1 = (region.x + region.width) / w;
  const y0 = region.y / h, y1 = (region.y + region.height) / h;
  // Image-space corners of the region in quad-corner semantics:
  // [LL, LR, UR, UL] — LL/LR sit at the image-space bottom edge (y1).
  const imgCorners: Vec2[] = [
    [x0, y1], [x1, y1], [x1, y0], [x0, y0],
  ];
  // Rotate sampling positions around the region center. `rotation` is the
  // visual brush rotation, clockwise in image space; the sampling position
  // for each quad corner moves the opposite way (CCW in image coords).
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  const rotated = imgCorners.map((_,i): Vec2 => [...imgCorners[(i + rotation) % 4]] as Vec2);
  // Flip across region center in image space.
  const flipped = rotated.map(([px, py]): Vec2 => [
    flipX ? 2 * cx - px : px,
    flipY ? 2 * cy - py : py,
  ]);
  // Convert image-space y (top-down) to bottom-left-origin UV.
  const uvs = flipped.map(([px, py]): Vec2 => [px, 1 - py]);
  // uvs[] currently corresponds to [LL, LR, UR, UL] of the *unrotated*
  // region mapping; after rotation/flips the same index still maps to the
  // same quad corner because we rotated corner positions, not indices.
  return uvs as [Vec2, Vec2, Vec2, Vec2];
}

/* ------------------------------- hierarchy -------------------------------- */

function findObject(project: Project, id: string): SceneObject {
  const object = project.objects.find((o) => o.id === id);
  if (!object) throw new Error(`Unknown object id "${id}"`);
  return object;
}

/** True when the object or any of its ancestors is locked. */
export function isObjectLocked(project: Project, id: string): boolean {
  const self = project.objects.find(o => o.id === id);
  if (!self) return false;
  return [self,...ancestorChain(project.objects,id)].some(o=>o.locked);
}

/** Ancestor visibility with a defensive cycle/depth guard. */
export function isObjectVisible(project: Project, id: string): boolean {
  const self = project.objects.find(o => o.id === id);
  if (!self) return false;
  return [self,...ancestorChain(project.objects,id)].every(o=>o.visible);
}

function collectDescendants(project: Project, id: string): Set<string> {
  const out = new Set<string>([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const o of project.objects) {
      if (o.parentId && out.has(o.parentId) && !out.has(o.id)) {
        out.add(o.id);
        changed = true;
      }
    }
  }
  return out;
}

/** Reparent an object. Rejects cycles (including self-parenting). */
export function reparentObject(project: Project, id: string, parentId: string | null): void {
  const object = findObject(project, id);
  if (parentId === null) {
    object.parentId = null;
    return;
  }
  if (parentId === id) throw new Error('reparentObject: cannot parent an object to itself');
  const parent = findObject(project, parentId);
  if (collectDescendants(project, id).has(parent.id)) {
    throw new Error('reparentObject: cycle detected (parent is a descendant of the object)');
  }
  object.parentId = parent.id;
}

/* ------------------------------- selection -------------------------------- */

/** Deduplicated list of selected corners with their owning tiles. */
export function selectedCorners(project: Project, selection: Selection): { tile: Tile; corner: number }[] {
  const out: { tile: Tile; corner: number }[] = [];
  const seen = new Set<string>();
  const entries = [...selection.vertices, ...selection.tileIds.flatMap(tileId => [0,1,2,3].map(corner => ({tileId,corner})))];
  for (const v of entries) {
    const key = `${v.tileId}#${v.corner}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const tile = project.tiles.find((t) => t.id === v.tileId);
    if (!tile) continue; // stale selection entry
    if (v.corner < 0 || v.corner > 3 || !Number.isInteger(v.corner)) continue;
    out.push({ tile, corner: v.corner });
  }
  return out;
}

function objectOfTile(project: Project, tile: Tile): SceneObject | undefined {
  return project.objects.find((o) => o.id === tile.objectId);
}

/** Tiles referenced by the selection that are editable (not ancestor-locked). */
function editableSelectedTiles(project: Project, selection: Selection): Tile[] {
  const out: Tile[] = [];
  const seen = new Set<string>();
  for (const id of selection.tileIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const tile = project.tiles.find((t) => t.id === id);
    if (!tile) continue;
    if (isObjectLocked(project, tile.objectId)) continue;
    out.push(tile);
  }
  return out;
}

function editableSelectedCorners(project: Project, selection: Selection): { tile: Tile; corner: number }[] {
  return selectedCorners(project, selection).filter(
    ({ tile }) => !isObjectLocked(project, tile.objectId),
  );
}

/* ------------------------------- transforms ------------------------------- */

export function translateSelection(project: Project, selection: Selection, delta: Vec3): void {
  if (!Number.isFinite(delta[0]) || !Number.isFinite(delta[1]) || !Number.isFinite(delta[2])) {
    throw new Error('translateSelection: delta must be finite');
  }
  for (const { tile, corner } of editableSelectedCorners(project, selection)) {
    const v = tile.vertices[corner];
    tile.vertices[corner] = [v[0] + delta[0], v[1] + delta[1], v[2] + delta[2]];
  }
}

export function rotateSelection(
  project: Project,
  selection: Selection,
  axis: 'x' | 'y' | 'z',
  radians: number,
  pivot: Vec3,
): void {
  if (!Number.isFinite(radians)) throw new Error('rotateSelection: radians must be finite');
  if (!pivot.every(Number.isFinite)) throw new Error('rotateSelection: pivot must be finite');
  const cos = Math.cos(radians), sin = Math.sin(radians);
  for (const { tile, corner } of editableSelectedCorners(project, selection)) {
    const [px, py, pz] = tile.vertices[corner];
    const dx = px - pivot[0], dy = py - pivot[1], dz = pz - pivot[2];
    let nx: number, ny: number, nz: number;
    switch (axis) {
      case 'x': // rotation in YZ plane
        nx = px; ny = pivot[1] + dy * cos - dz * sin; nz = pivot[2] + dy * sin + dz * cos; break;
      case 'y': // rotation in ZX plane
        ny = py; nz = pivot[2] + dz * cos - dx * sin; nx = pivot[0] + dz * sin + dx * cos; break;
      case 'z': // rotation in XY plane
        nz = pz; nx = pivot[0] + dx * cos - dy * sin; ny = pivot[1] + dx * sin + dy * cos; break;
    }
    tile.vertices[corner] = [nx, ny, nz];
  }
}

export function scaleSelection(project: Project, selection: Selection, factor: Vec3, pivot: Vec3): void {
  if (!factor.every(Number.isFinite) || !pivot.every(Number.isFinite)) {
    throw new Error('scaleSelection: factor and pivot must be finite');
  }
  for (const { tile, corner } of editableSelectedCorners(project, selection)) {
    const [px, py, pz] = tile.vertices[corner];
    tile.vertices[corner] = [
      pivot[0] + (px - pivot[0]) * factor[0],
      pivot[1] + (py - pivot[1]) * factor[1],
      pivot[2] + (pz - pivot[2]) * factor[2],
    ];
  }
}

/* ------------------------------- tile ops --------------------------------- */

/** Duplicate selected tiles, offset by `delta`. Returns new tile ids. */
export function duplicateSelection(project: Project, selection: Selection, delta: Vec3): string[] {
  if (!delta.every(Number.isFinite)) throw new Error('duplicateSelection: delta must be finite');
  const newIds: string[] = [];
  for (const tile of editableSelectedTiles(project, selection)) {
    const copy: Tile = {
      ...clone(tile),
      id: uid('tile'),
      vertices: tile.vertices.map(([x, y, z]): Vec3 => [x + delta[0], y + delta[1], z + delta[2]]) as [Vec3, Vec3, Vec3, Vec3],
      uvs: clone(tile.uvs),
    };
    project.tiles.push(copy);
    newIds.push(copy.id);
  }
  return newIds;
}

/** Delete the selected tiles. Corner-only selections are rejected. */
export function deleteSelection(project: Project, selection: Selection): void {
  const requested = new Set(selection.tileIds);
  if (requested.size === 0) {
    if (selection.vertices.length > 0) {
      throw new Error('deleteSelection: corner-only selection cannot delete tiles');
    }
    return; // nothing selected: no-op
  }
  const deletable = new Set(
    editableSelectedTiles(project, selection).map((t) => t.id),
  );
  if (deletable.size === 0 && requested.size > 0) {
    // All requested tiles are either locked or missing; only reject when they
    // asked to delete something but nothing is editable.
    const anyReal = selection.tileIds.some((id) => project.tiles.some((t) => t.id === id));
    if (anyReal) throw new Error('deleteSelection: selected tiles are locked');
  }
  project.tiles = project.tiles.filter((t) => !deletable.has(t.id));
}

/** Reverse winding of selected tiles. */
export function reverseSelection(project: Project, selection: Selection): void {
  for (const tile of editableSelectedTiles(project, selection)) {
    tile.reversed = !tile.reversed;
  }
}

/** Apply the session brush's UVs (via given brush) to selected tiles.
 * The whole brush is validated (region bounds, rotation flags) before any
 * tile is mutated, so a rejected brush leaves every tile untouched. */
export function applyBrush(project: Project, selection: Selection, brush: Brush): void {
  const atlas = project.atlases.find((a) => a.id === brush.atlasId);
  if (!atlas) throw new Error(`applyBrush: unknown atlas "${brush.atlasId}"`);
  validateBrushAgainstAtlas(atlas, brush);
  const uvs = brushUVs(atlas, brush);
  for (const tile of editableSelectedTiles(project, selection)) {
    tile.atlasId = brush.atlasId;
    tile.uvs = clone(uvs);
  }
}

/**
 * Shared UV range policy: UVs must lie in the closed 0..1 range, with this
 * explicit tolerance for floating-point drift. Values within tolerance are
 * normalized (clamped) back to the exact bound; beyond tolerance is invalid.
 */
export const UV_TOLERANCE = 1e-6;

/** Validate one UV pair against the shared 0..1 policy; readable message. */
export function checkUvInRange(tileId: string, uv: Vec2): void {
  const [u, v] = uv;
  if (u < -UV_TOLERANCE || u > 1 + UV_TOLERANCE || v < -UV_TOLERANCE || v > 1 + UV_TOLERANCE) {
    throw new Error(`Tile "${tileId}" has UVs outside the 0..1 range`);
  }
}

/** Normalize (clamp) UV components that drifted within tolerance back into 0..1. */
export function normalizeUv(uv: Vec2): Vec2 {
  return [
    Math.min(1, Math.max(0, uv[0])),
    Math.min(1, Math.max(0, uv[1])),
  ];
}

/**
 * Transform UVs of selected tiles. `rotate` turns UVs 90° clockwise around
 * the tile's UV center; flips mirror across the center; `offset` (when
 * provided) translates all four UVs afterwards. All per-tile results are
 * computed up front and the offset is validated BEFORE any tile is mutated,
 * so a rejected operation (e.g. a non-finite offset) leaves every tile
 * untouched. Range enforcement of the RESULT happens at the document
 * boundary: validateProject / EditorStore.transact reject UVs outside the
 * shared 0..1 policy, so an offset that would leave the range can never be
 * committed through a transaction.
 */
export function transformUVs(
  project: Project,
  selection: Selection,
  operation: 'rotate' | 'flipX' | 'flipY',
  offset?: Vec2,
): void {
  if (offset !== undefined && (!Number.isFinite(offset[0]) || !Number.isFinite(offset[1]))) {
    throw new Error('transformUVs: offset must be finite');
  }
  const editable = editableSelectedTiles(project, selection);
  // Compute all new UVs first (atomicity: no mutation until every tile computed).
  const computed: { tile: Tile; uvs: [Vec2, Vec2, Vec2, Vec2] }[] = [];
  for (const tile of editable) {
    const uvs = tile.uvs;
    const cu = (uvs[0][0] + uvs[1][0] + uvs[2][0] + uvs[3][0]) / 4;
    const cv = (uvs[0][1] + uvs[1][1] + uvs[2][1] + uvs[3][1]) / 4;
    const moved: Vec2[] = operation === 'rotate'
      ? uvs.map((_, i): Vec2 => [...uvs[(i + 1) % 4]] as Vec2)
      : uvs.map(([u, v]): Vec2 => {
      let nu = u, nv = v;
      switch (operation) {
        case 'flipX': nu = 2 * cu - u; break;
        case 'flipY': nv = 2 * cv - v; break;
      }
      return [nu, nv];
    });
    const withOffset = offset
      ? moved.map(([u, v]): Vec2 => [u + offset[0], v + offset[1]])
      : moved;
    computed.push({ tile, uvs: withOffset as [Vec2, Vec2, Vec2, Vec2] });
  }
  // All tiles computed — commit.
  for (const { tile, uvs: next } of computed) {
    tile.uvs = next;
  }
}

/* ------------------------------- validation ------------------------------- */

const MAX_ATLASES = 4095; // ZIP entry budget includes project.json.
const MAX_OBJECTS = 100000;
const MAX_TILES = 1000000;
const MAX_NAME = 4096;
const MAX_DATAURL = 64 * 1024 * 1024; // 64 MiB — generous for embedded PNGs
const MAX_INT = Number.MAX_SAFE_INTEGER;

/**
 * Atlas ids become ZIP entry names (atlases/<id>.png) inside .pvp
 * containers, so they must match the same character budget the container
 * writer enforces. No path traversal is possible under this pattern.
 */
const ATLAS_ID_PATTERN = /^[A-Za-z0-9_.-]{1,128}$/;

class ValidationError extends Error {}

function fail(msg: string): never {
  throw new ValidationError(msg);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function checkFinite(name: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${name} must be a finite number`);
  return v;
}

function checkNonNegInt(name: string, v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) fail(`${name} must be a non-negative integer`);
  return v;
}

function checkString(name: string, v: unknown, maxLen = MAX_NAME): string {
  if (typeof v !== 'string') fail(`${name} must be a string`);
  if (v.length > maxLen) fail(`${name} exceeds maximum length`);
  return v;
}

/** Names (atlases, objects, project) must be non-empty readable strings. */
function checkName(name: string, v: unknown, maxLen = MAX_NAME): string {
  const s = checkString(name, v, maxLen);
  if (s.length === 0) fail(`${name} must be a non-empty string`);
  return s;
}

function checkId(name: string, v: unknown): string {
  const s = checkString(name, v, 512);
  if (s.length === 0) fail(`${name} must be non-empty`);
  return s;
}

/** Header-only preflight; full CRC/zlib/pixel validation follows the
 * aggregate-budget check in validateProject before adoption/publication. */
function checkPngDataUrl(name:string,v:string):string {
  try {preflightPngDataUrl(v);}catch(error){fail(`${name}: ${error instanceof Error?error.message:String(error)}`);}
  return v;
}

/**
 * Validate an unknown value as a Project. Returns a deep clone on success.
 * Throws a readable Error on any structural problem. Never mutates input.
 */
export function validateProject(value: unknown): Project {
  if (!isPlainObject(value)) fail('project must be an object');
  if (value['format'] !== 'pivo-plate') fail('project.format must be "pivo-plate"');
  if (value['version'] !== 1) fail('project.version must be 1');
  const name = checkName('project.name', value['name']);

  if (!Array.isArray(value['atlases'])) fail('project.atlases must be an array');
  if (!Array.isArray(value['objects'])) fail('project.objects must be an array');
  if (!Array.isArray(value['tiles'])) fail('project.tiles must be an array');
  const atlasesRaw = value['atlases'] as unknown[];
  const objectsRaw = value['objects'] as unknown[];
  const tilesRaw = value['tiles'] as unknown[];
  if (atlasesRaw.length > MAX_ATLASES) fail('too many atlases');
  if (objectsRaw.length > MAX_OBJECTS) fail('too many objects');
  if (tilesRaw.length > MAX_TILES) fail('too many tiles');

  const atlases: Atlas[] = atlasesRaw.map((a, i) => {
    if (!isPlainObject(a)) fail(`atlases[${i}] must be an object`);
    const atlasId = checkId(`atlases[${i}].id`, a['id']);
    if (!ATLAS_ID_PATTERN.test(atlasId)) {
      fail(`atlases[${i}].id "${atlasId}" may only contain letters, digits, dot, underscore and dash (1..128 chars)`);
    }
    return {
      id: atlasId,
      name: checkName(`atlases[${i}].name`, a['name']),
      width: checkNonNegInt(`atlases[${i}].width`, a['width']),
      height: checkNonNegInt(`atlases[${i}].height`, a['height']),
      tileWidth: checkNonNegInt(`atlases[${i}].tileWidth`, a['tileWidth']),
      tileHeight: checkNonNegInt(`atlases[${i}].tileHeight`, a['tileHeight']),
      margin: checkNonNegInt(`atlases[${i}].margin`, a['margin']),
      spacing: checkNonNegInt(`atlases[${i}].spacing`, a['spacing']),
      dataUrl: checkPngDataUrl(`atlases[${i}].dataUrl`, checkString(`atlases[${i}].dataUrl`, a['dataUrl'], MAX_DATAURL)),
    };
  });

  const pngHeaders=atlases.map(a=>preflightPngDataUrl(a.dataUrl,{width:a.width,height:a.height}));
  checkProjectPngBudget(pngHeaders,0);

  for (const a of atlases) {
    if (a.width < 1 || a.height < 1 || a.width > 16384 || a.height > 16384 || a.width * a.height > 16777216) fail('Atlas dimensions must be between 1 and 16384');
    if (a.tileWidth < 1 || a.tileHeight < 1 || a.tileWidth > a.width || a.tileHeight > a.height) fail('Atlas tile dimensions must be positive and fit the image');
    if (a.margin * 2 + a.tileWidth > a.width || a.margin * 2 + a.tileHeight > a.height) fail('Atlas margin leaves no complete cell');
  }

  const objects: SceneObject[] = objectsRaw.map((o, i) => {
    if (!isPlainObject(o)) fail(`objects[${i}] must be an object`);
    const visible = o['visible'], locked = o['locked'];
    if (typeof visible !== 'boolean') fail(`objects[${i}].visible must be a boolean`);
    if (typeof locked !== 'boolean') fail(`objects[${i}].locked must be a boolean`);
    const parentRaw = o['parentId'];
    if (parentRaw !== null && typeof parentRaw !== 'string') fail(`objects[${i}].parentId must be a string or null`);
    return {
      id: checkId(`objects[${i}].id`, o['id']),
      name: checkName(`objects[${i}].name`, o['name']),
      parentId: parentRaw === null ? null : checkId(`objects[${i}].parentId`, parentRaw),
      visible: visible as boolean,
      locked: locked as boolean,
    };
  });
  const objectIds = new Set(objects.map((o) => o.id));
  const objectById = new Map(objects.map((o) => [o.id, o]));
  for (const o of objects) {
    if (o.parentId === o.id) fail(`object "${o.id}" cannot be its own parent`);
    if (o.parentId !== null && !objectIds.has(o.parentId)) fail(`object "${o.id}" has unknown parentId "${o.parentId}"`);
  }
  // Cycle + depth detection in linear time: one cached-depth pass over the
  // parent forest. Depth beyond MAX_HIERARCHY_DEPTH is rejected outright
  // (never silently truncated).
  const depthCache = objectDepths(objects);
  for (const o of objects) {
    const d = depthCache.get(o.id);
    if (d === undefined) fail(`object "${o.id}" could not be placed in the hierarchy`);
    if (d > MAX_HIERARCHY_DEPTH) fail(`object "${o.id}" is in a parenting cycle or exceeds the maximum hierarchy depth of ${MAX_HIERARCHY_DEPTH}`);
  }

  const objectHasAtlas = new Map<string, Set<string>>();
  const tiles: Tile[] = tilesRaw.map((t, i) => {
    if (!isPlainObject(t)) fail(`tiles[${i}] must be an object`);
    const tileId = checkId(`tiles[${i}].id`, t['id']);
    const objectId = checkId(`tiles[${i}].objectId`, t['objectId']);
    if (!objectIds.has(objectId)) fail(`tiles[${i}] references unknown objectId "${objectId}"`);
    const atlasId = checkId(`tiles[${i}].atlasId`, t['atlasId']);
    const vertsRaw = t['vertices'];
    if (!Array.isArray(vertsRaw) || vertsRaw.length !== 4) fail(`tiles[${i}].vertices must be an array of 4 corners`);
    const vertices = vertsRaw.map((v, j) => {
      if (!Array.isArray(v) || v.length !== 3) fail(`tiles[${i}].vertices[${j}] must be [x,y,z]`);
      return [
        checkFinite(`tiles[${i}].vertices[${j}].x`, v[0]),
        checkFinite(`tiles[${i}].vertices[${j}].y`, v[1]),
        checkFinite(`tiles[${i}].vertices[${j}].z`, v[2]),
      ] as Vec3;
    }) as [Vec3, Vec3, Vec3, Vec3];
    for (const [vx, vy, vz] of vertices) {
      if (Math.abs(vx) > MAX_INT || Math.abs(vy) > MAX_INT || Math.abs(vz) > MAX_INT) {
        fail(`tiles[${i}] has coordinates beyond safe integer range`);
      }
    }
    const uvsRaw = t['uvs'];
    if (!Array.isArray(uvsRaw) || uvsRaw.length !== 4) fail(`tiles[${i}].uvs must be an array of 4 pairs`);
    const uvs = uvsRaw.map((u, j) => {
      if (!Array.isArray(u) || u.length !== 2) fail(`tiles[${i}].uvs[${j}] must be [u,v]`);
      const uv: Vec2 = [
        checkFinite(`tiles[${i}].uvs[${j}].u`, u[0]),
        checkFinite(`tiles[${i}].uvs[${j}].v`, u[1]),
      ];
      // Shared 0..1 policy: reject beyond tolerance, normalize within it.
      checkUvInRange(tileId, uv);
      return normalizeUv(uv);
    }) as [Vec2, Vec2, Vec2, Vec2];
    if (typeof t['reversed'] !== 'boolean') fail(`tiles[${i}].reversed must be a boolean`);
    if (!objectHasAtlas.has(objectId)) objectHasAtlas.set(objectId, new Set());
    return {
      id: tileId,
      objectId, atlasId, vertices, uvs,
      reversed: t['reversed'] as boolean,
    };
  });

  const tileIds = new Set<string>();
  for (const t of tiles) {
    if (tileIds.has(t.id)) fail(`duplicate tile id "${t.id}"`);
    tileIds.add(t.id);
  }
  const atlasIds = new Set<string>();
  for (const a of atlases) {
    if (atlasIds.has(a.id)) fail(`duplicate atlas id "${a.id}"`);
    atlasIds.add(a.id);
  }
  const objIdSet = new Set<string>();
  for (const o of objects) {
    if (objIdSet.has(o.id)) fail(`duplicate object id "${o.id}"`);
    objIdSet.add(o.id);
  }

  // Track which atlas ids tiles reference so session-level logic can be
  // conservative, but tiles referencing missing atlases are permitted at
  // validation time? No — contract says valid references. Reject.
  for (const t of tiles) {
    if (!atlasIds.has(t.atlasId)) fail(`tile "${t.id}" references unknown atlasId "${t.atlasId}"`);
  }

  const project:Project={format:'pivo-plate',version:1,name,atlases,objects,tiles};
  const manifest={...project,atlases:atlases.map(a=>({...a,dataUrl:''}))};
  const manifestBytes=new TextEncoder().encode(JSON.stringify(manifest,null,2)).length;
  checkProjectPngBudget(pngHeaders,manifestBytes);
  atlases.forEach(a=>validatePngDataUrl(a.dataUrl,{width:a.width,height:a.height}));
  return project;
}

/* ------------------------------- store ------------------------------------ */

const MAX_HISTORY = 64;

/**
 * Snapshot-based transactional store. Every successful transaction pushes an
 * immutable structural snapshot onto the undo stack; failed (throwing)
 * transactions leave state untouched; no-op transactions (deep-equal result)
 * are omitted from history. Undo/redo history is bounded.
 */
export class EditorStore {
  private _project: Project;
  private _undoStack: Project[] = [];
  private _redoStack: Project[] = [];
  private _label = '';
  private _revision = 0;
  private _savedSnapshot = '';
  private _listeners = new Set<() => void>();
  private historyCosts = new WeakMap<Project,number>();

  constructor(project: Project, private readonly historyBudget = 128 * 1024 * 1024) {
    if(!Number.isFinite(historyBudget)||historyBudget<1)throw new Error('History byte budget must be positive');
    // Canonical validation BEFORE replacing the current project: an invalid
    // seed must never become editor state.
    const validated = validateProject(project);
    this._project = clone(validated);
    this._savedSnapshot = JSON.stringify(this._project);
  }

  get project(): Project {
    return this._project;
  }

  get canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  /** Label of the most recent committed transaction ('' if none yet). */
  get historyLabel(): string {
    return this._label;
  }

  /** Monotonically increasing counter bumped on every state change. */
  get revision(): number {
    return this._revision;
  }

  /** Semantic dirty flag: current state differs from last saved state. */
  get dirty(): boolean {
    return JSON.stringify(this._project) !== this._savedSnapshot;
  }

  subscribe(fn: () => void): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this._listeners) {
      try { fn(); } catch { /* listener errors must not break the store */ }
    }
  }

  private pushHistory(label: string, before: Project): void {
    this._undoStack.push(before);
    this._redoStack = [];
    while (this._undoStack.length > MAX_HISTORY || (this.retainedHistoryBytes > this.historyBudget && this._undoStack.length > 1)) this._undoStack.shift();
    this._label = label;
  }

  get retainedHistoryBytes(): number {
    return [...this._undoStack,...this._redoStack].reduce((bytes,p)=>{
      let cost=this.historyCosts.get(p);if(cost===undefined){cost=JSON.stringify(p).length*2;this.historyCosts.set(p,cost);}return bytes+cost;
    },0);
  }

  /**
   * Run a synchronous mutation. The callback receives a working draft; the
   * raw draft is validated with the canonical validator BEFORE publication
   * and before JSON cloning could mask NaN/Infinity (which stringify to
   * null). On validation failure or throw, state, revision, history, redo
   * and dirty state are untouched. The committed project is re-cloned so no
   * retained reference to the draft (including a callback that keeps mutating
   * asynchronously after rejection or resolution) can alias committed state.
   */
  transact(label: string, fn: (project: Project) => void): void {
    const before = clone(this._project);
    const working = clone(this._project);
    try {
      const result: unknown = fn(working);
      if (result !== null && (typeof result === 'object' || typeof result === 'function') && typeof (result as {then?:unknown}).then === 'function') {
        void Promise.resolve(result).catch(() => {});
        throw new Error('EditorStore transactions must be synchronous');
      }
    } catch (err) {
      // rollback is implicit: working copy discarded, this._project untouched.
      void err;
      throw err;
    }
    // Validate the raw working draft first: the canonical validator sees
    // NaN/Infinity/undefined that JSON cloning would silently mask.
    let validated: Project;
    try {
      validated = validateProject(working);
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }
    const beforeJson = JSON.stringify(before);
    const workingJson = JSON.stringify(validated);
    if (beforeJson === workingJson) {
      // no-op transaction: omitted from history
      return;
    }
    // Detach committed state from the draft and from `before`/history
    // snapshots: a malicious or buggy callback that retains the draft and
    // keeps mutating it after this call must not corrupt committed state.
    this._project = validated;
    this.pushHistory(label, before);
    this._revision++;
    this.emit();
  }

  undo(): void {
    const prev = this._undoStack.pop();
    if (!prev) return;
    this._redoStack.push(this._project);
    this._project = prev;
    this._revision++;
    this.emit();
  }

  redo(): void {
    const next = this._redoStack.pop();
    if (!next) return;
    this._undoStack.push(this._project);
    this._project = next;
    this._revision++;
    this.emit();
  }

  /** Replace the whole project (e.g. load). Validates BEFORE replacing the
   * current project: on invalid input the existing state, history, revision
   * and dirty flags are untouched. Clears undo/redo history on success. */
  replace(project: Project): void {
    const validated = validateProject(project); // throws before any mutation
    this._project = clone(validated);
    this._undoStack = [];
    this._redoStack = [];
    this._revision++;
    this.emit();
  }

  /** Mark the snapshot actually downloaded; edits during a save stay dirty. */
  markSaved(snapshot: Project = this._project): void {
    this._savedSnapshot = JSON.stringify(validateProject(snapshot));
    this.emit();
  }
}
