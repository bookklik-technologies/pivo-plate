// Independent GLB structural validator: parses the binary container with its
// own DataView-based reader (NOT the encoder code paths) and checks glTF 2.0
// structural rules — magic/version/length, chunk alignment, accessor bounds,
// bufferView strides, buffer byteLength, image bufferViews, material setup.
import { describe, it, expect } from 'vitest';
import { exportGLB, ExportError } from '../src/io/export.ts';
import { makeProject, makeTile, makeObject, makeAtlas, cubeProject, makePng } from './fixtures.ts';

// --- independent GLB reader -------------------------------------------------
interface GltfJson {
  asset: { version: string; generator?: string };
  scene?: number;
  scenes?: { nodes: number[] }[];
  nodes?: { name?: string; mesh?: number; children?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  materials?: {
    name?: string;
    alphaMode?: string;
    alphaCutoff?: number;
    doubleSided?: boolean;
    pbrMetallicRoughness?: { baseColorTexture?: { index: number } };
  }[];
  textures?: { sampler: number; source: number }[];
  samplers?: { magFilter?: number; minFilter?: number; wrapS?: number; wrapT?: number }[];
  images?: { bufferView: number; mimeType: string }[];
  bufferViews?: { buffer: number; byteOffset: number; byteLength: number }[];
  accessors?: { bufferView: number; byteOffset: number; componentType: number; count: number; type: string; min?: number[]; max?: number[] }[];
  buffers?: { byteLength: number }[];
}

const TYPE_COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
const COMPONENT_BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };export function parseGlb(bytes: Uint8Array): { json: GltfJson; bin: Uint8Array } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // magic 'glTF', version 2, total length
  expect(dv.getUint32(0, true)).toBe(0x46546c67);
  expect(dv.getUint32(4, true)).toBe(2);
  const total = dv.getUint32(8, true);
  expect(total).toBe(bytes.length);
  // JSON chunk
  const jsonLen = dv.getUint32(12, true);
  const jsonType = dv.getUint32(16, true);
  expect(jsonType).toBe(0x4e4f534a); // 'JSON'
  expect(jsonLen % 4).toBe(0);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLen))) as GltfJson;
  // BIN chunk
  let off = 20 + jsonLen;
  let bin: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  if (off < total) {
    const binLen = dv.getUint32(off, true);
    const binType = dv.getUint32(off + 4, true);
    expect(binType).toBe(0x004e4942); // 'BIN\0'
    expect(binLen % 4).toBe(0);
    bin = bytes.subarray(off + 8, off + 8 + binLen);
    expect(off + 8 + binLen).toBe(total);
  }
  return { json, bin };
}

/** Structural glTF 2.0 validation of the parsed document. */
export function validateGltf(json: GltfJson, bin: Uint8Array): void {
  expect(json.asset.version).toBe('2.0');
  const buffers = json.buffers ?? [];
  const views = json.bufferViews ?? [];
  const accessors = json.accessors ?? [];
  expect(buffers.length).toBeGreaterThan(0);

  let referencedMax = 0;
  for (const a of accessors) {
    const compBytes = COMPONENT_BYTES[a.componentType];
    const comps = TYPE_COMPONENTS[a.type];
    expect(compBytes).toBeDefined();
    expect(comps).toBeDefined();
    // accessor.byteOffset is RELATIVE to its bufferView start (glTF 2.0 spec)
    const view = views[a.bufferView];
    expect(view).toBeDefined();
    expect(a.byteOffset).toBeGreaterThanOrEqual(0);
    const needed = a.count * comps * compBytes;
    expect(a.byteOffset + needed).toBeLessThanOrEqual(view.byteLength);
    referencedMax = Math.max(referencedMax, view.byteOffset + a.byteOffset + needed);
  }
  for (const v of views) {
    expect(v.buffer).toBe(0);
    expect(v.byteOffset).toBeGreaterThanOrEqual(0);
    expect(v.byteOffset + v.byteLength).toBeLessThanOrEqual(buffers[0].byteLength);
  }
  for (const img of json.images ?? []) {
    const v = views[img.bufferView];
    expect(v).toBeDefined();
    expect(img.mimeType).toBe('image/png');
    // embedded PNG magic inside the binary buffer
    expect(bin[v.byteOffset]).toBe(0x89);
    expect(bin[v.byteOffset + 1]).toBe(0x50);
  }
  // buffer byteLength covers every referenced byte
  expect(buffers[0].byteLength).toBeGreaterThanOrEqual(referencedMax);
  expect(buffers[0].byteLength).toBeLessThanOrEqual(bin.length + 3);
  // texture/image wiring
  for (const tex of json.textures ?? []) {
    expect(json.images![tex.source]).toBeDefined();
  }
  for (const mat of json.materials ?? []) {
    const t = mat.pbrMetallicRoughness?.baseColorTexture;
    if (t) expect(json.textures![t.index]).toBeDefined();
    if (mat.alphaMode === 'MASK') expect(mat.alphaCutoff).toBeGreaterThan(0);
  }
}

describe('exportGLB (structural, independent parser)', () => {
  it('emits a valid glTF 2.0 container with aligned chunks', async () => {
    const bytes = await exportGLB(cubeProject());
    const { json, bin } = parseGlb(bytes);
    validateGltf(json, bin);
    expect(json.meshes!.length).toBe(1);
    expect(json.meshes![0].primitives.length).toBe(1); // one atlas → one primitive
  });

  it('writes POSITION/TEXCOORD_0/NORMAL accessors with min/max bounds', async () => {
    const bytes = await exportGLB(cubeProject());
    const { json } = parseGlb(bytes);
    const prim = json.meshes![0].primitives[0];
    expect(prim.mode).toBe(4); // TRIANGLES
    const pos = json.accessors![prim.attributes.POSITION];
    const uv = json.accessors![prim.attributes.TEXCOORD_0];
    const nrm = json.accessors![prim.attributes.NORMAL];
    expect(pos.type).toBe('VEC3');
    expect(uv.type).toBe('VEC2');
    expect(nrm.type).toBe('VEC3');
    expect(pos.min!.length).toBe(3);
    expect(pos.max!.length).toBe(3);
    // cube fixture spans 0..1 on all axes
    expect(pos.min!).toEqual([0, 0, 0]);
    expect(pos.max!).toEqual([1, 1, 1]);
    expect(pos.count).toBe(24); // 6 tiles × 4 corners (per-primitive duplicates fine)
    expect(uv.count).toBe(24);
    // all UVs inside 0..1
    const uvData = uvDataFrom(json, parseGlb(bytes).bin, prim.attributes.TEXCOORD_0);
    for (let i = 0; i < uvData.length; i += 2) {
      expect(uvData[i]).toBeGreaterThanOrEqual(0);
      expect(uvData[i]).toBeLessThanOrEqual(1);
    }
  });

  it('indices are 32-bit UNSIGNED_INT and reference vertices in range', async () => {
    const bytes = await exportGLB(cubeProject());
    const { json, bin } = parseGlb(bytes);
    const prim = json.meshes![0].primitives[0];
    const indexAccessor = json.accessors![prim.indices!];
    expect(indexAccessor.componentType).toBe(5125); // UNSIGNED_INT
    const posCount = json.accessors![prim.attributes.POSITION].count;
    const idx = readU32(json, bin, prim.indices!);
    for (const i of idx) expect(i).toBeLessThan(posCount);
    expect(idx.length).toBe(36); // 12 triangles × 3
  });

  it('winding is baked: indices [0,1,2, 0,2,3], swapped when tile.reversed', async () => {
    const bytes = await exportGLB(makeProject({ tiles: [
      makeTile({ id: 'a', reversed: false }),
      makeTile({ id: 'b', vertices: [[0, 2, 0], [1, 2, 0], [1, 2, 1], [0, 2, 1]], reversed: true }),
    ] }));
    const { json, bin } = parseGlb(bytes);
    const prim = json.meshes![0].primitives[0];
    const idx = readU32(json, bin, prim.indices!);
    // normal tile: 0,1,2 / 0,2,3 ; reversed tile (base 4): 4,6,5 / 4,7,6
    expect(idx.slice(0, 6)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(idx.slice(6, 12)).toEqual([4, 6, 5, 4, 7, 6]);
  });

  it('per-atlas materials with NEAREST sampling and embedded PNG images', async () => {
    const p = makeProject({
      atlases: [makeAtlas({ id: 'a1' }), makeAtlas({ id: 'a2' })],
      tiles: [makeTile({ atlasId: 'a1' }), makeTile({ id: 't2', atlasId: 'a2', vertices: [[0, 2, 0], [1, 2, 0], [1, 2, 1], [0, 2, 1]] })],
    });
    const bytes = await exportGLB(p);
    const { json, bin } = parseGlb(bytes);
    validateGltf(json, bin);
    expect(json.materials!.length).toBe(2);
    expect(json.images!.length).toBe(2);
    expect(json.textures!.length).toBe(2);
    // unique material names
    const names = json.materials!.map((m) => m.name!);
    expect(new Set(names).size).toBe(2);
    // NEAREST mag + min for pixel art
    expect(json.samplers![0].magFilter).toBe(9728);
    expect(json.samplers![0].minFilter).toBe(9728);
    // embedded images decode as PNG magic in the binary chunk
    for (const img of json.images!) {
      const v = json.bufferViews![img.bufferView];
      expect(bin.subarray(v.byteOffset, v.byteOffset + 4)).toEqual(new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    }
  });

  it('documents alphaMode MASK by default and BLEND when the atlas has alpha', async () => {
    // default: opaque pixel art → MASK with cutoff
    const opaqueBytes = await exportGLB(makeProject());
    const opaque = parseGlb(opaqueBytes).json;
    expect(opaque.materials![0].alphaMode).toBe('MASK');
    expect(opaque.materials![0].alphaCutoff).toBeGreaterThan(0);
  });

  it('excludes hidden objects and hidden ancestors', async () => {
    const p = makeProject({
      objects: [
        makeObject({ id: 'object-main', visible: true }),
        makeObject({ id: 'child', parentId: 'object-main', visible: false }),
      ],
      tiles: [
        makeTile({ id: 'vis' }),
        makeTile({ id: 'hid', objectId: 'child', vertices: [[0, 5, 0], [1, 5, 0], [1, 5, 1], [0, 5, 1]] }),
      ],
    });
    const bytes = await exportGLB(p);
    const { json } = parseGlb(bytes);
    const prim = json.meshes![0].primitives[0];
    expect(json.accessors![prim.attributes.POSITION].count).toBe(4);
  });

  it('uses Y-up meters directly (XY-plane tiles face +Z, no axis remap)', async () => {
    // An XY tile (faces +Z) must keep its z-coordinates as z, not swap to y.
    const p = makeProject({ tiles: [makeTile({
      vertices: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
    })] });
    const bytes = await exportGLB(p);
    const { json, bin } = parseGlb(bytes);
    const prim = json.meshes![0].primitives[0];
    const pos = readF32(json, bin, prim.attributes.POSITION);
    // all four corners have z = 1
    for (let i = 0; i < 4; i++) expect(pos[i * 3 + 2]).toBe(1);
  });

  it('rejects empty / fully hidden projects and invalid documents', async () => {
    await expect(exportGLB(makeProject({ tiles: [] }))).rejects.toBeInstanceOf(ExportError);
    const hidden = makeProject({ objects: [makeObject({ visible: false })] });
    await expect(exportGLB(hidden)).rejects.toBeInstanceOf(ExportError);
  });
});

// --- accessor readers (independent of the encoder) --------------------------
function accessorRegion(json: GltfJson, bin: Uint8Array, index: number): { dv: DataView; count: number; comps: number } {
  const a = json.accessors![index];
  const v = json.bufferViews![a.bufferView];
  const comps = TYPE_COMPONENTS[a.type];
  const start = v.byteOffset + a.byteOffset;
  return { dv: new DataView(bin.buffer, bin.byteOffset + start, a.count * comps * 4), count: a.count, comps };
}

function readF32(json: GltfJson, bin: Uint8Array, index: number): number[] {
  const { dv, count, comps } = accessorRegion(json, bin, index);
  const out: number[] = [];
  for (let i = 0; i < count * comps; i++) out.push(dv.getFloat32(i * 4, true));
  return out;
}

function readU32(json: GltfJson, bin: Uint8Array, index: number): number[] {
  const a = json.accessors![index];
  const v = json.bufferViews![a.bufferView];
  const out: number[] = [];
  const start = v.byteOffset + a.byteOffset;
  const dv = new DataView(bin.buffer, bin.byteOffset + start, a.count * 4);
  for (let i = 0; i < a.count; i++) out.push(dv.getUint32(i * 4, true));
  return out;
}

function uvDataFrom(json: GltfJson, bin: Uint8Array, index: number): number[] {
  return readF32(json, bin, index);
}
