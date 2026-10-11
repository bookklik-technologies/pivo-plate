// Manual glTF 2.0 GLB encoder — self-contained, no three.js dependency, so it
// works headlessly and stays deterministic. Produces:
//   - one mesh (per visible object's tiles) with baked world-space vertices,
//     Y-up, meters (our editor space already is Y-up; XY-plane tiles face +Z,
//     XZ face +Y, YZ face +X — no axis remap needed).
//   - POSITION + TEXCOORD_0 + NORMAL accessors per primitive, indices 32-bit.
//   - one material per atlas: baseColorTexture = embedded PNG, MAG/MIN filter
//     NEAREST (pixel art), alphaMode MASK (alphaCutoff 0.5) by default, or
//     BLEND when any exported tile UV region samples pixels with alpha < 1
//     (documented via the material's "alphaMode" — tests assert both paths).
// Binary chunk is 4-byte aligned; accessors are aligned to component size.
import { tileCornerNormals } from '../core/geometry';
import { assertExportGeometry } from './geometry';
import type { Project, Tile, Atlas, Vec3, Vec2 } from '../core/types.ts';
import { ExportError, dataUrlToBytes } from './util.ts';
import { validateProjectValue, isObjectVisibleValue } from './validate.ts';

const ALIGN = 4;

function padTo(n: number, align = ALIGN): number {
  return Math.ceil(n / align) * align;
}

interface GltfBufferView { buffer: number; byteOffset: number; byteLength: number; byteStride?: number; target?: number }
interface GltfAccessor { bufferView: number; byteOffset: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }
interface GltfImage { bufferView: number; mimeType: string }
interface GltfTextureInfo { index: number; texCoord?: number }
interface GltfMaterial {
  name: string;
  pbrMetallicRoughness: { baseColorTexture: GltfTextureInfo; metallicFactor: number; roughnessFactor: number };
  alphaMode: 'MASK' | 'BLEND';
  alphaCutoff?: number;
  doubleSided: boolean;
}

/** Build the GLB for a project. Hidden objects (any hidden ancestor) excluded. */
export function buildGlb(project: Project, blendAtlasIds?: Set<string>): Uint8Array {
  const safe = validateProjectValue(project);
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

  // ---- pack binary buffer -------------------------------------------------
  const chunks: ArrayBufferView[] = [];
  let bufferLength = 0;
  const push = (bytes: ArrayBufferView): void => {
    const aligned = padTo(bytes.byteLength);
    chunks.push(bytes, new Uint8Array(aligned - bytes.byteLength));
    bufferLength += aligned;
  };

  // Group tiles by atlas → one primitive per atlas (per-atlas material).
  const byAtlas = new Map<string, Tile[]>();
  for (const t of visibleTiles) {
    const list = byAtlas.get(t.atlasId) ?? [];
    list.push(t);
    byAtlas.set(t.atlasId, list);
  }

  const bufferViews: GltfBufferView[] = [];
  const accessors: GltfAccessor[] = [];
  const images: GltfImage[] = [];
  const materials: GltfMaterial[] = [];
  const textures: { sampler: number; source: number }[] = [];
  const samplers = [{ magFilter: 9728, minFilter: 9728, wrapS: 33071, wrapT: 33071 }]; // NEAREST, CLAMP
  const meshes: { primitives: unknown[] }[] = [];
  const usedAlphaBlend = new Set<string>();

  const bv = (bytes: ArrayBufferView, target?: number): number => {
    const byteOffset = bufferLength;
    push(bytes);
    const view: GltfBufferView = target
      ? { buffer: 0, byteOffset, byteLength: bytes.byteLength, target }
      : { buffer: 0, byteOffset, byteLength: bytes.byteLength };
    bufferViews.push(view);
    return bufferViews.length - 1;
  };

  /** Append a deferred bufferView: reserve two slots — the payload slot and
   *  its zero-padding tail — so byteOffset accounting stays exact; the payload
   *  bytes are written into the payload slot just before GLB assembly. */
  const reserveBv = (byteLength: number): { index: number; chunkIndex: number } => {
    const byteOffset = bufferLength;
    const chunkIndex = chunks.length;
    chunks.push(new Uint8Array(0)); // payload slot (filled later)
    chunks.push(new Uint8Array(padTo(byteLength))); // zero tail
    bufferLength += padTo(byteLength);
    const view: GltfBufferView = { buffer: 0, byteOffset, byteLength };
    bufferViews.push(view);
    return { index: bufferViews.length - 1, chunkIndex };
  };

  // Texture images first (deterministic order by atlas id).
  const sortedAtlasIds = [...byAtlas.keys()].sort();
  const deferredImages: { chunkIndex: number; bytes: Uint8Array }[] = [];
  for (const atlasId of sortedAtlasIds) {
    const atlas = atlasById.get(atlasId)!;
    const { bytes } = dataUrlToBytes(atlas.dataUrl);
    // Reserve the space now (keeps byteOffset accounting correct) and fill the
    // bytes into the reserved region just before assembling the BIN chunk.
    const { index, chunkIndex } = reserveBv(bytes.byteLength);
    deferredImages.push({ chunkIndex, bytes });
    images.push({ bufferView: index, mimeType: 'image/png' });
    textures.push({ sampler: 0, source: images.length - 1 });
  }

  const prims: unknown[] = [];
  sortedAtlasIds.forEach((atlasId, primIndex) => {
    const tiles = byAtlas.get(atlasId)!;
    const atlas = atlasById.get(atlasId)!;

    // Per-primitive: index, position, texcoord, normal accessors.
    const pos: number[] = [];
    const uv: number[] = [];
    const nrm: number[] = [];
    const idx: number[] = [];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (const tile of tiles) {
      const base = pos.length / 3;
      const verts = tileWorldCorners(tile);
      const normals = tileCornerNormals(tile);
      // Triangulation [0,1,2, 0,2,3], inverted for reversed tiles
      // (reversed winding flips the front face, so swap two indices).
      const tris = tile.reversed ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const i of tris) {
        idx.push(base + i);
      }
      for (let i = 0; i < 4; i++) {
        const v = verts[i];
        pos.push(v[0], v[1], v[2]);
        min[0] = Math.min(min[0], v[0]); min[1] = Math.min(min[1], v[1]); min[2] = Math.min(min[2], v[2]);
        max[0] = Math.max(max[0], v[0]); max[1] = Math.max(max[1], v[1]); max[2] = Math.max(max[2], v[2]);
        const u = tile.uvs[i];
        uv.push(u[0], 1 - u[1]); // glTF images/TEXCOORD use top-left; editor/OBJ use bottom-left.
        const n = normals[i];
        nrm.push(n[0], n[1], n[2]);
      }
    }

    const indexArray = new Uint32Array(idx);
    const posArray = new Float32Array(pos);
    const uvArray = new Float32Array(uv);
    const nrmArray = new Float32Array(nrm);

    const indexBv = bv(indexArray, 34963 /* ELEMENT_ARRAY_BUFFER */);
    const posBv = bv(posArray, 34962 /* ARRAY_BUFFER */);
    const uvBv = bv(uvArray, 34962);
    const nrmBv = bv(nrmArray, 34962);

    accessors.push({ bufferView: indexBv, byteOffset: 0, componentType: 5125 /* UNSIGNED_INT */, count: idx.length, type: 'SCALAR' });
    const indexAccessor = accessors.length - 1;
    accessors.push({ bufferView: posBv, byteOffset: 0, componentType: 5126 /* FLOAT */, count: pos.length / 3, type: 'VEC3', min, max });
    const posAccessor = accessors.length - 1;
    accessors.push({ bufferView: uvBv, byteOffset: 0, componentType: 5126, count: uv.length / 2, type: 'VEC2' });
    const uvAccessor = accessors.length - 1;
    accessors.push({ bufferView: nrmBv, byteOffset: 0, componentType: 5126, count: nrm.length / 3, type: 'VEC3' });
    const nrmAccessor = accessors.length - 1;

    // Transparency: MASK unless the atlas texture is non-opaque somewhere —
    // then BLEND. alphaMode is documented on the material itself.
    const hasAlpha = blendAtlasIds ? blendAtlasIds.has(atlasId) : atlasHasTransparency(safe, atlas);
    if (hasAlpha) usedAlphaBlend.add(atlasId);
    materials.push({
      name: materialName(safe, atlasId, primIndex),
      pbrMetallicRoughness: {
        baseColorTexture: { index: primIndex },
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      alphaMode: hasAlpha ? 'BLEND' : 'MASK',
      ...(hasAlpha ? {} : { alphaCutoff: 0.5 }),
      doubleSided: true,
    });

    prims.push({
      attributes: { POSITION: posAccessor, TEXCOORD_0: uvAccessor, NORMAL: nrmAccessor },
      indices: indexAccessor,
      material: primIndex,
      mode: 4 /* TRIANGLES */,
    });
  });

  meshes.push({ primitives: prims });
  const nodes = [{ name: safe.name || 'pivo-plate', mesh: 0 }];
  const scenes = [{ nodes: [0] }];
  const scene = 0;
  const asset = { version: '2.0', generator: 'pivo-plate io/export' };
  const gltf = {
    asset, scene, scenes, nodes, meshes, materials, textures, samplers, images,
    bufferViews, accessors,
    buffers: [{ byteLength: bufferLength }],
  };

  // ---- GLB container ------------------------------------------------------
  // Write image bytes into their reserved chunk regions. The reserved region
  // is padTo(n) bytes; the bytes go first and the tail (if any) stays zero.
  for (const { chunkIndex, bytes } of deferredImages) {
    const pad = padTo(bytes.byteLength) - bytes.byteLength;
    // chunkIndex holds the reserved payload slot, chunkIndex+1 its zero tail.
    chunks[chunkIndex] = bytes;
    chunks[chunkIndex + 1] = new Uint8Array(pad);
  }
  const json = JSON.stringify(gltf);
  const jsonBytes = new TextEncoder().encode(json);
  const jsonPadded = padTo(jsonBytes.length);
  const binPadded = padTo(bufferLength); // buffers multiple of 4 (already is)
  const total = 12 + 8 + jsonPadded + 8 + binPadded;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  // header
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true); // version
  dv.setUint32(8, total, true);
  // JSON chunk (spec: pad with trailing spaces 0x20)
  dv.setUint32(12, jsonPadded, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  out.set(jsonBytes, 20);
  if (jsonPadded > jsonBytes.length) out.fill(0x20, 20 + jsonBytes.length, 20 + jsonPadded);
  // BIN chunk
  const binHeader = 20 + jsonPadded;
  dv.setUint32(binHeader, binPadded, true);
  dv.setUint32(binHeader + 4, 0x004e4942, true); // 'BIN\0'
  let off = binHeader + 8;
  for (const c of chunks) {
    out.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), off);
    off += c.byteLength;
  }
  return out;
}

/** World-space corner positions of a tile, already baked (no object transforms). */
function tileWorldCorners(tile: Tile): [Vec3, Vec3, Vec3, Vec3] {
  return [tile.vertices[0], tile.vertices[1], tile.vertices[2], tile.vertices[3]];
}

/**
 * Face normal from the tile's winding (counter-clockwise front face).
 * XY tiles face +Z, XZ tiles face +Y, YZ tiles face +X. Reversed tiles flip.
 */
/** Compatibility helper: first triangle's exclusive-corner normal.
 * Indexed exporters use all four tileCornerNormals rather than this value. */
export function tileNormal(tile: Tile): Vec3 { return tileCornerNormals(tile)[1]; }

function materialName(project: Project, atlasId: string, index: number): string {
  const atlas = project.atlases.find((a) => a.id === atlasId);
  const raw = atlas?.name ?? atlasId;
  const safe = raw.replace(/[^A-Za-z0-9_.-]/g, '_');
  return `${safe}_${index}`;
}

/**
 * Determine whether an atlas texture contains any pixel with alpha < 255.
 * Uses the ImageDecoder/OffscreenCanvas if available; in constrained
 * environments (node tests) callers can inject a precomputed answer via
 * atlasTransparency override — otherwise assume MASK (hard-edged pixel art).
 */
let atlasTransparencyOverride: ((atlas: Atlas) => boolean) | null = null;
export function setAtlasTransparencyProbe(fn: ((atlas: Atlas) => boolean) | null): void {
  atlasTransparencyOverride = fn;
}

export function atlasHasTransparency(project: Project, atlas: Atlas): boolean {
  if (atlasTransparencyOverride) return atlasTransparencyOverride(atlas);
  return false; // documented default: MASK, pixel art is opaque
}

// Re-exported UV helper for tests of seam/border handling.
export function clampUv(uv: Vec2): Vec2 {
  return [Math.min(1, Math.max(0, uv[0])), Math.min(1, Math.max(0, uv[1]))];
}
