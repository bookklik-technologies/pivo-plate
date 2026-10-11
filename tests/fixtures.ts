// Shared fixtures for IO tests: tiny real PNGs built with a raw PNG encoder
// (no canvas needed), plus a couple of canonical projects.
import { zlibSync } from 'fflate';
import type { Project, Atlas, Tile, SceneObject, Vec3, Vec2 } from '../src/core/types.ts';

// --- minimal PNG encoder (zlib stored blocks + crc32) ----------------------
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

function adler32(data: Uint8Array): number {
  let a = 1, b = 0;
  for (const byte of data) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Encode raw RGBA pixel data as a real PNG (2x2 default). */
export function makePng(width = 2, height = 2, rgba?: Uint8Array): Uint8Array {
  const px = rgba ?? new Uint8Array(width * height * 4).fill(200);
  const stride = width * 4;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter none
    raw.set(px.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  // Independent fixture encoder handles scanlines beyond a 64KiB stored block.
  const stored = zlibSync(raw);
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return concat([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', stored), chunk('IEND', new Uint8Array(0))]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

export function pngDataUrl(width = 2, height = 2, rgba?: Uint8Array): string {
  const bytes = makePng(width, height, rgba);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/png;base64,${btoa(bin)}`;
}

/** A valid 2x2 atlas with a 4-pixel texture (all same color, or custom). */
export function makeAtlas(overrides: Partial<Atlas> = {}, rgba?: Uint8Array): Atlas {
  return {
    id: 'atlas-a',
    name: 'Stone',
    width: 2, height: 2,
    tileWidth: 2, tileHeight: 2,
    margin: 0, spacing: 0,
    dataUrl: pngDataUrl(2, 2, rgba),
    ...overrides,
  };
}

export function makeTile(overrides: Partial<Tile> = {}): Tile {
  return {
    id: 'tile-1',
    objectId: 'object-main',
    atlasId: 'atlas-a',
    vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], // XZ, faces +Y
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    reversed: false,
    ...overrides,
  };
}

export function makeObject(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id: 'object-main',
    name: 'Main',
    parentId: null,
    visible: true,
    locked: false,
    ...overrides,
  };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    format: 'pivo-plate',
    version: 1,
    name: 'demo',
    atlases: [makeAtlas()],
    objects: [makeObject()],
    tiles: [makeTile()],
    ...overrides,
  };
}

/** A unit cube of 6 tiles (XY top, XZ sides, YZ sides) for winding tests. */
export function cubeProject(): Project {
  const t = (id: string, verts: Vec3[], reversed: boolean, objectId = 'object-main'): Tile =>
    makeTile({
      id,
      vertices: verts as Tile['vertices'],
      uvs: [[0, 0], [1, 0], [1, 1], [0, 1]] as Tile['uvs'],
      reversed,
      objectId,
    });
  return makeProject({
    name: 'cube',
    tiles: [
      t('top', [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], false), // +Y
      t('bottom', [[0, 0, 0], [0, 0, 1], [1, 0, 1], [1, 0, 0]], true), // -Y
      t('front', [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], false), // +Z
      t('back', [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], true), // -Z
      t('right', [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], false), // +X
      t('left', [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], true), // -X
    ],
  });
}

/** UV sample used by loaders/validators to walk tile->atlas pixel space. */
export function lerpUv(a: Vec2, b: Vec2, t: number): Vec2 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
