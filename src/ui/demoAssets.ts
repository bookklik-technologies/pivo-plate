/**
 * Original built-in demo content for PiVo Plate.
 * Everything here is generated procedurally with canvas pixels —
 * no external assets, no third-party art.
 */
import type { Atlas, AtlasRegion, Project, Tile, Vec2, Vec3 } from '../core/types';
import { DEFAULT_OBJECT_ID } from '../core/types';
import { uid } from '../core/editor';

const TILE_PX = 16;
const COLS = 6;
const ROWS = 3;
const MARGIN = 2;
const SPACING = 2;

export const DEMO_ATLAS_META = {
  width: MARGIN * 2 + COLS * TILE_PX + (COLS - 1) * SPACING,
  height: MARGIN * 2 + ROWS * TILE_PX + (ROWS - 1) * SPACING,
  tileWidth: TILE_PX,
  tileHeight: TILE_PX,
  margin: MARGIN,
  spacing: SPACING,
};

/** Pixel rectangle of cell (col,row) — same math the atlas panel uses. */
export function demoCellRegion(col: number, row: number): AtlasRegion {
  return {
    x: MARGIN + col * (TILE_PX + SPACING),
    y: MARGIN + row * (TILE_PX + SPACING),
    width: TILE_PX,
    height: TILE_PX,
  };
}

type Rng = () => number;
function mulberry(seed: number): Rng {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type RGB = [number, number, number];
const rgb = (c: RGB, a = 255): string => `rgba(${c[0]},${c[1]},${c[2]},${a / 255})`;
function shade(c: RGB, f: number): RGB {
  return [
    Math.max(0, Math.min(255, Math.round(c[0] * f))),
    Math.max(0, Math.min(255, Math.round(c[1] * f))),
    Math.max(0, Math.min(255, Math.round(c[2] * f))),
  ];
}

type Painter = (px: (x: number, y: number, color: RGB | null) => void, rnd: Rng) => void;

/** 16×16 procedural tile painters — hand-authored original patterns. */
const PAINTERS: Painter[] = [
  // 0 stone floor
  (px, rnd) => {
    const base: RGB = [122, 126, 132];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const v = 0.86 + rnd() * 0.24;
      px(x, y, shade(base, v));
    }
    px(0, 0, shade(base, 0.6)); px(15, 0, shade(base, 0.6));
    px(0, 15, shade(base, 0.6)); px(15, 15, shade(base, 0.6));
  },
  // 1 stone floor cracked
  (px, rnd) => {
    const base: RGB = [114, 118, 124];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.85 + rnd() * 0.25));
    for (let i = 0; i < 16; i++) {
      px(i, 7 + (i % 3), shade(base, 0.55));
      px(6, i, shade(base, 0.62));
    }
  },
  // 2 mossy stone
  (px, rnd) => {
    const base: RGB = [112, 118, 112];
    const moss: RGB = [88, 132, 60];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      px(x, y, shade(base, 0.85 + rnd() * 0.25));
      if (rnd() < 0.22) px(x, y, shade(moss, 0.8 + rnd() * 0.35));
    }
  },
  // 3 grass
  (px, rnd) => {
    const base: RGB = [96, 148, 66];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.82 + rnd() * 0.3));
    for (let i = 0; i < 14; i++) {
      const x = Math.floor(rnd() * 16), y = Math.floor(rnd() * 16);
      px(x, y, [70, 116, 48]);
      px(x, Math.max(0, y - 1), [126, 172, 84]);
    }
  },
  // 4 wood planks
  (px, rnd) => {
    const base: RGB = [142, 102, 62];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.88 + rnd() * 0.2));
    for (const b of [0, 5, 10, 15]) for (let x = 0; x < 16; x++) px(x, b, shade(base, 0.62));
    for (let i = 0; i < 6; i++) {
      const y = Math.floor(rnd() * 16), x = Math.floor(rnd() * 16);
      px(x, y, shade(base, 0.72)); px(x + 1 < 16 ? x + 1 : x, y, shade(base, 0.7));
    }
  },
  // 5 dirt
  (px, rnd) => {
    const base: RGB = [124, 92, 60];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.8 + rnd() * 0.35));
    for (let i = 0; i < 10; i++) px(Math.floor(rnd() * 16), Math.floor(rnd() * 16), [88, 62, 40]);
  },
  // 6 sand
  (px, rnd) => {
    const base: RGB = [198, 172, 110];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.9 + rnd() * 0.16));
  },
  // 7 water
  (px, rnd) => {
    const base: RGB = [52, 96, 168];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.86 + rnd() * 0.24));
    for (const y of [3, 9, 13]) for (let x = 2; x < 13; x += 4) px(x + (y % 2), y, [120, 170, 224]);
  },
  // 8 lava
  (px, rnd) => {
    const base: RGB = [196, 68, 28];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.85 + rnd() * 0.3));
    for (let i = 0; i < 26; i++) {
      const x = Math.floor(rnd() * 16), y = Math.floor(rnd() * 16);
      px(x, y, [248, 196, 72]); if (rnd() < 0.5) px(x, Math.max(0, y - 1), [240, 150, 48]);
    }
  },
  // 9 stone wall bricks
  (px, rnd) => {
    const base: RGB = [128, 126, 120];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.86 + rnd() * 0.22));
    for (const b of [0, 8]) for (let x = 0; x < 16; x++) px(x, b, shade(base, 0.6));
    for (let y = 0; y < 8; y++) px(8, y, shade(base, 0.6));
    for (let y = 8; y < 16; y++) { px(3, y, shade(base, 0.6)); px(12, y, shade(base, 0.6)); }
  },
  // 10 brick wall
  (px, rnd) => {
    const base: RGB = [158, 82, 62];
    const mortar: RGB = [176, 168, 156];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.88 + rnd() * 0.2));
    for (const b of [3, 7, 11, 15]) for (let x = 0; x < 16; x++) px(x, b, mortar);
    for (let row = 0; row < 4; row++) {
      const off = row % 2 === 0 ? 0 : 8;
      for (let y = row * 4; y < row * 4 + 3; y++) px(off, y, mortar);
    }
    for (let y = 0; y < 3; y++) px(0, y, mortar);
  },
  // 11 metal panel
  (px, rnd) => {
    const base: RGB = [108, 118, 130];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.9 + rnd() * 0.14));
    for (let x = 0; x < 16; x++) { px(x, 0, shade(base, 1.25)); px(x, 15, shade(base, 0.6)); }
    for (const [cx, cy] of [[3, 3], [12, 3], [3, 12], [12, 12]] as const) {
      px(cx, cy, shade(base, 0.55)); px(cx + 1, cy + 1, shade(base, 1.3));
    }
  },
  // 12 hazard stripe
  (px, rnd) => {
    const a: RGB = [204, 164, 40];
    const b: RGB = [44, 46, 50];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      px(x, y, shade(Math.floor((x + y) / 4) % 2 === 0 ? a : b, 0.94 + rnd() * 0.12));
    }
  },
  // 13 tech circuit
  (px, rnd) => {
    const base: RGB = [38, 48, 60];
    const trace: RGB = [80, 200, 130];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.94 + rnd() * 0.12));
    for (let i = 2; i < 14; i += 4) for (let x = 2; x < 14; x++) px(x, i, shade(trace, 0.9));
    for (let i = 4; i < 14; i += 4) for (let y = 2; y < 14; y++) px(i, y, shade(trace, 0.9));
    for (let i = 2; i < 14; i += 4) px(4, i, [160, 244, 190]);
  },
  // 14 crate
  (px, rnd) => {
    const base: RGB = [150, 112, 64];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.9 + rnd() * 0.16));
    for (let i = 0; i < 16; i++) { px(i, i, shade(base, 0.7)); px(15 - i, i, shade(base, 0.7)); }
    for (let i = 0; i < 16; i++) { px(i, 0, shade(base, 0.55)); px(i, 15, shade(base, 0.55)); px(0, i, shade(base, 0.55)); px(15, i, shade(base, 0.55)); }
  },
  // 15 dark tile (accent / void)
  (px, rnd) => {
    const base: RGB = [56, 60, 68];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.9 + rnd() * 0.2));
    for (let i = 0; i < 16; i++) { px(i, 0, shade(base, 1.3)); px(0, i, shade(base, 1.3)); }
  },
  // 16 snow
  (px, rnd) => {
    const base: RGB = [214, 222, 232];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.94 + rnd() * 0.08));
    for (let i = 0; i < 6; i++) px(Math.floor(rnd() * 16), Math.floor(rnd() * 16), [172, 186, 204]);
  },
  // 17 gravel
  (px, rnd) => {
    const base: RGB = [104, 100, 96];
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) px(x, y, shade(base, 0.8 + rnd() * 0.4));
    for (let i = 0; i < 12; i++) {
      const x = Math.floor(rnd() * 15), y = Math.floor(rnd() * 15);
      px(x, y, shade(base, 1.35)); px(x + 1, y, shade(base, 0.6));
    }
  },
];

/** Renders the original demo tileset to a PNG data URL. */
export function makeDemoAtlasDataUrl(): string {
  const c = document.createElement('canvas');
  c.width = DEMO_ATLAS_META.width;
  c.height = DEMO_ATLAS_META.height;
  const g = c.getContext('2d');
  if (!g) throw new Error('Canvas 2D unavailable');
  g.fillStyle = '#0d1013';
  g.fillRect(0, 0, c.width, c.height);
  let seed = 0x9e3779b9;
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const region = demoCellRegion(col, row);
      const painter = PAINTERS[row * COLS + col];
      if (!painter) continue;
      const rnd = mulberry((seed += 0x1234));
      painter((x, y, color) => {
        if (!color) return;
        g.fillStyle = rgb(color);
        g.fillRect(region.x + x, region.y + y, 1, 1);
      }, rnd);
      // subtle cell outline so cells read on the sheet
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.strokeRect(region.x + 0.5, region.y + 0.5, region.width - 1, region.height - 1);
    }
  }
  return c.toDataURL('image/png');
}

export function makeDemoAtlas(): Atlas {
  return {
    id: uid('atlas'),
    name: 'Demo Tileset',
    ...DEMO_ATLAS_META,
    dataUrl: makeDemoAtlasDataUrl(),
  };
}

/* ------------------------------------------------------------------ */
/* Sample room starter document                                        */
/* ------------------------------------------------------------------ */

const FLOOR_CELLS: Array<[number, number]> = [[0, 0], [1, 0], [3, 0], [2, 2]];
const WALL_CELLS: Array<[number, number]> = [[0, 1], [1, 1], [2, 1]];
const T = 1;

function uvQuad(atlas: Atlas, region: AtlasRegion): [Vec2, Vec2, Vec2, Vec2] {
  const W = atlas.width, H = atlas.height;
  const u0 = region.x / W, u1 = (region.x + region.width) / W;
  // image y is top-down; UV origin is bottom-left
  const v1 = 1 - region.y / H;
  const v0 = 1 - (region.y + region.height) / H;
  return [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
}

function addTile(
  project: Project, atlas: Atlas, objectId: string,
  verts: [Vec3, Vec3, Vec3, Vec3], region: AtlasRegion, reversed = false,
): void {
  const tile: Tile = {
    id: uid('tile'),
    objectId,
    atlasId: atlas.id,
    vertices: verts,
    uvs: uvQuad(atlas, region),
    reversed,
  };
  project.tiles.push(tile);
}

/** Small starter room: 9×9 floor, two walls, a crate column, a water pool. */
export function buildSampleScene(atlas: Atlas): Project {
  const project: Project = {
    format: 'pivo-plate', version: 1, name: 'Sample Room',
    atlases: [atlas], objects: [], tiles: [],
  };
  const floorObj = { id: DEFAULT_OBJECT_ID, name: 'Room', parentId: null, visible: true, locked: false };
  const propsObj = { id: uid('object'), name: 'Props', parentId: null, visible: true, locked: false };
  project.objects.push(floorObj, propsObj);

  const cell = (i: number, j: number) => {
    const list = FLOOR_CELLS;
    const n = ((i * 7 + j * 3) % list.length + list.length) % list.length;
    return list[n];
  };
  const R = 4; // room from -4..4
  // floor (XZ, facing +Y)
  for (let i = -R; i < R; i++) {
    for (let j = -R; j < R; j++) {
      const inPool = i >= -1 && i <= 0 && j >= 1 && j <= 2;
      const cc: [number, number] = inPool ? [5, 1] : (i + j) % 5 === 0 ? FLOOR_CELLS[1] : cell(i, j);
      const region = demoCellRegion(cc[0], cc[1]);
      const x = i * T, z = j * T, y = inPool ? -0.25 : 0;
      addTile(project, atlas, floorObj.id, [
        [x, y, z], [x, y, z + T], [x + T, y, z + T], [x + T, y, z],
      ], region);
    }
  }
  // north wall: XY tiles at z = -R, facing +Z
  for (let i = -R; i < R; i++) {
    for (let h = 0; h < 3; h++) {
      const cc = WALL_CELLS[h % WALL_CELLS.length];
      const region = demoCellRegion(cc[0], cc[1]);
      const x = i * T, y = h * T, z = -R * T;
      addTile(project, atlas, floorObj.id, [
        [x, y, z], [x + T, y, z], [x + T, y + T, z], [x, y + T, z],
      ], region);
    }
  }
  // west wall: YZ tiles at x = -R, facing +X
  for (let j = -R; j < R; j++) {
    for (let h = 0; h < 3; h++) {
      const cc = WALL_CELLS[(h + 1) % WALL_CELLS.length];
      const region = demoCellRegion(cc[0], cc[1]);
      const x = -R * T, y = h * T, z = j * T;
      addTile(project, atlas, floorObj.id, [
        [x, y, z], [x, y + T, z], [x, y + T, z + T], [x, y, z + T],
      ], region);
    }
  }
  // crate stack + hazard pad in props object
  const crate = demoCellRegion(1, 2);
  for (let h = 0; h < 2; h++) {
    const y = h * T;
    addTile(project, atlas, propsObj.id, [[2 * T, y, -2 * T], [2 * T, y, -T], [3 * T, y, -T], [3 * T, y, -2 * T]], crate, h === 1);
    addTile(project, atlas, propsObj.id, [[2 * T, y, -2 * T], [3 * T, y, -2 * T], [3 * T, y + T, -2 * T], [2 * T, y + T, -2 * T]], crate);
  }
  const hazard = demoCellRegion(4, 1);
  addTile(project, atlas, propsObj.id, [[-2 * T, 0.02, 2 * T], [-2 * T, 0.02, 3 * T], [-T, 0.02, 3 * T], [-T, 0.02, 2 * T]], hazard);
  return project;
}
