// Public export contract (docs/CONTRACTS.md):
//   exportGLB(project) -> Promise<Uint8Array>  binary glTF 2.0
//   exportOBJ(project) -> Promise<Uint8Array>  ZIP containing .obj + .mtl + textures
// Exports never mutate the source document. Hidden objects (with hidden
// ancestors) are excluded. Unique material names, baked coordinates, explicit
// transparency settings. Independent loader acceptance tests live in tests/.
import type { Project, Tile, Atlas, Vec3 } from '../core/types.ts';
import { strToU8, zipSync } from 'fflate';
import { ExportError, dataUrlToBytes } from './util.ts';
import { validateProjectValue, isObjectVisibleValue } from './validate.ts';
import { tileCornerNormals } from '../core/geometry';
import { assertExportGeometry } from './geometry';
import { inspectAlpha } from './alpha';
import { buildGlb } from './gltf.ts';

export { ExportError } from './util.ts';

// ---------------------------------------------------------------------------
// OBJ + MTL + textures, zipped
// ---------------------------------------------------------------------------

export async function exportOBJ(project: Project): Promise<Uint8Array> {
  const safe = validateProjectValue(project);
  const alphaModes = await inspectAlpha(safe);
  const visibleTiles = safe.tiles.filter((t) => isObjectVisibleValue(safe, t.objectId));
  if (visibleTiles.length === 0) {
    throw new ExportError('Nothing to export: the project has no visible tiles');
  }
  assertExportGeometry(visibleTiles);
  const atlasById = new Map(safe.atlases.map((a) => [a.id, a]));
  for (const t of visibleTiles) {
    if (!atlasById.has(t.atlasId)) {
      throw new ExportError(`Tile "${t.id}" references atlas "${t.atlasId}" which does not exist`);
    }
  }

  const objLines: string[] = [];
  objLines.push('# Exported by pivo-plate (Y-up, meters, baked world-space vertices)');
  objLines.push(`# ${new Date().toISOString()}`);
  const mtlLines: string[] = ['# pivo-plate material library'];

  const usedMatNames = new Set<string>();
  const materialNames: string[] = [];
  const texturesToWrite: { path: string; bytes: Uint8Array }[] = [];
  const objectNameOf = new Map<string, string>();

  // Object names → 'o' groups (sanitize for .obj identifiers).
  for (const o of safe.objects) {
    let n = o.name.replace(/[^A-Za-z0-9_.-]/g, '_');
    if (n.length === 0) n = 'object';
    let candidate = n;
    let k = 1;
    while (objectNameOf.size > 0 && [...objectNameOf.values()].includes(candidate)) {
      candidate = `${n}_${k++}`;
    }
    objectNameOf.set(o.id, candidate);
  }

  // Unique material names per atlas (sanitized, deduplicated).
  safe.atlases.forEach((atlas, i) => {
    let base = atlas.name.replace(/[^A-Za-z0-9_.-]/g, '_');
    if (base.length === 0) base = `material_${i}`;
    let name = base;
    let k = 1;
    while (usedMatNames.has(name)) name = `${base}_${k++}`;
    usedMatNames.add(name);
    materialNames.push(name);
  });

  // Geometry: baked world-space vertices (no transforms to apply — objects
  // have none per contract), triangulation [0,1,2, 0,2,3], inverted when
  // tile.reversed (swap indices 1<->2 on each tri to flip winding).
  let faceIndex = 0;
  const currentObjectName = new Map<string, string>();
  for (const tile of visibleTiles) {
    const objName = objectNameOf.get(tile.objectId) ?? 'object';
    if (currentObjectName.get('current') !== objName) {
      objLines.push(`o ${objName}`);
      currentObjectName.set('current', objName);
    }
    const matIndex = safe.atlases.findIndex((a) => a.id === tile.atlasId);
    const matName = materialNames[matIndex] ?? 'material_0';
    objLines.push(`usemtl ${matName}`);

    const baseIndex = faceIndex * 4 + 1; // .obj indices are 1-based
    for (const v of tile.vertices) {
      objLines.push(`v ${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`);
    }
    for (const uv of tile.uvs) {
      objLines.push(`vt ${fmt(uv[0])} ${fmt(uv[1])}`);
    }
    // Normal from winding so reversed tiles get inverted normals too.
    for (const n of tileCornerNormals(tile)) objLines.push(`vn ${fmt(n[0])} ${fmt(n[1])} ${fmt(n[2])}`);
    const tri = (a: number, b: number, c: number) =>
      `f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`;
    if (tile.reversed) {
      objLines.push(tri(baseIndex, baseIndex + 2, baseIndex + 1));
      objLines.push(tri(baseIndex, baseIndex + 3, baseIndex + 2));
    } else {
      objLines.push(tri(baseIndex, baseIndex + 1, baseIndex + 2));
      objLines.push(tri(baseIndex, baseIndex + 2, baseIndex + 3));
    }
    faceIndex++;
  }

  // MTL: map Kd to the texture file, explicit transparency (d) so exporters
  // don't guess. Tr is intentionally omitted (inverted semantics in some tools).
  safe.atlases.forEach((atlas, i) => {
    const matName = materialNames[i];
    const texFile = `textures/${atlas.id}.png`;
    mtlLines.push(`newmtl ${matName}`);
    mtlLines.push('Kd 1.000 1.000 1.000');
    mtlLines.push('Ks 0.000 0.000 0.000');
    mtlLines.push(`map_Kd ${texFile}`);
    const transparent = alphaModes?.get(atlas.id) !== undefined && alphaModes.get(atlas.id) !== 'opaque';
    mtlLines.push('d 1.000');
    if (transparent) mtlLines.push(`map_d ${texFile}`); // per-pixel alpha, not uniform translucency.
    if (transparent) mtlLines.push('illum 9'); // layered transparency
    mtlLines.push('');
    const { bytes } = dataUrlToBytes(atlas.dataUrl);
    texturesToWrite.push({ path: texFile, bytes });
  });

  const objText = objLines.join('\n') + '\n';
  const mtlName = 'pivo-plate.mtl';
  const objWithMtl = [`mtllib ${mtlName}`, ...objLines].join('\n') + '\n';

  const files: Record<string, Uint8Array> = {
    'pivo-plate.obj': strToU8(objWithMtl),
    [mtlName]: strToU8(mtlLines.join('\n') + '\n'),
  };
  for (const t of texturesToWrite) files[t.path] = t.bytes;
  return zipSync(files, { level: 6 });
}

function fmt(n: number): string {
  // Trim float noise but keep enough precision for meter-scale scenes.
  let s = n.toFixed(6);
  if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
  return s === '' || s === '-0' ? '0' : s;
}

/** Transparency heuristic shared with the GLB path (overridable in tests). */
function atlasIsTransparent(atlas: Atlas): boolean {
  // Match the GLB decision: MASK (opaque) unless a probe says otherwise.
  // Exporters treat the atlas as opaque pixel-art by default.
  return false;
}

// ---------------------------------------------------------------------------
// GLB
// ---------------------------------------------------------------------------

export async function exportGLB(project: Project): Promise<Uint8Array> {
  const safe = validateProjectValue(project);
  const alphaModes = await inspectAlpha(safe);
  return buildGlb(safe, alphaModes ? new Set([...alphaModes].filter(([,mode])=>mode==='blend').map(([id])=>id)) : undefined);
}
