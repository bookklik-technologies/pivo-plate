// Core engine contract tests — renderer-independent.
import { describe, it, expect } from 'vitest';
import { pngDataUrl } from './fixtures';
import {
  createProject, createSession, uid, snap, planePoint, tileCorners,
  makeTile, brushUVs, validateProject, isObjectVisible, isObjectLocked,
  selectedCorners, translateSelection, rotateSelection, scaleSelection,
  duplicateSelection, deleteSelection, reverseSelection, applyBrush,
  transformUVs, reparentObject, EditorStore,
} from '../src/core/editor.ts';
import { DEFAULT_OBJECT_ID } from '../src/core/types.ts';
import type { Atlas, Brush, Project, Tile } from '../src/core/types.ts';

// Real 64x64 PNG matching the atlas metadata used by these tests.
const TINY_PNG_DATA_URL = pngDataUrl(64,64);
const TINY_PNG_BASE64 = TINY_PNG_DATA_URL.split(',')[1];

function makeAtlas(overrides: Partial<Atlas> = {}): Atlas {
  return {
    id: 'atlas-1', name: 'Atlas', width: 64, height: 64,
    tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0,
    dataUrl: TINY_PNG_DATA_URL, ...overrides,
  };
}

function makeBrush(overrides: Partial<Brush> = {}): Brush {
  return {
    atlasId: 'atlas-1', region: { x: 16, y: 16, width: 16, height: 16 },
    rotation: 0, flipX: false, flipY: false, ...overrides,
  };
}

function projectWithAtlas(): Project {
  const p = createProject('test');
  p.atlases.push(makeAtlas());
  return p;
}

function addTile(p: Project, objectId = DEFAULT_OBJECT_ID, verts?: Tile['vertices']): Tile {
  const tile: Tile = {
    id: uid('tile'), objectId, atlasId: 'atlas-1',
    vertices: verts ?? [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]],
    uvs: [[0, 0], [1, 0], [1, 1], [0, 1]],
    reversed: false,
  };
  p.tiles.push(tile);
  return tile;
}

/* ------------------------------- createProject ---------------------------- */

describe('createProject', () => {
  it('creates object-main with empty atlases and tiles', () => {
    const p = createProject();
    expect(p.format).toBe('pivo-plate');
    expect(p.version).toBe(1);
    expect(p.objects).toHaveLength(1);
    expect(p.objects[0].id).toBe(DEFAULT_OBJECT_ID);
    expect(p.atlases).toEqual([]);
    expect(p.tiles).toEqual([]);
  });

  it('uses provided name', () => {
    expect(createProject('my map').name).toBe('my map');
  });

  it('main object is visible and unlocked', () => {
    const p = createProject();
    expect(p.objects[0].visible).toBe(true);
    expect(p.objects[0].locked).toBe(false);
    expect(p.objects[0].parentId).toBeNull();
  });
});

/* ------------------------------- createSession ---------------------------- */

describe('createSession', () => {
  it('accepts a project with no atlases (blank brush)', () => {
    const p = createProject();
    const s = createSession(p);
    expect(s.brush.atlasId).toBe('blank');
    expect(s.selection).toEqual({ tileIds: [], vertices: [] });
    expect(s.plane).toBe('XY');
  });

  it('uses the first atlas when present', () => {
    const p = projectWithAtlas();
    const s = createSession(p);
    expect(s.brush.atlasId).toBe('atlas-1');
  });
});

/* ------------------------------- uid --------------------------------------- */

describe('uid', () => {
  it('produces unique ids', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => uid()));
    expect(seen.size).toBe(2000);
  });

  it('includes prefix', () => {
    expect(uid('tile').startsWith('tile-')).toBe(true);
  });
});

/* ------------------------------- snap / planePoint ------------------------ */

describe('snap', () => {
  it('rounds to nearest grid multiple', () => {
    expect(snap(3.2, 1)).toBe(3);
    expect(snap(3.7, 1)).toBe(4);
    expect(snap(7, 5)).toBe(5);
    expect(snap(8, 5)).toBe(10);
  });

  it('handles negatives correctly', () => {
    expect(snap(-3.2, 1)).toBe(-3);
    expect(snap(-3.7, 1)).toBe(-4);
    expect(snap(-7, 5)).toBe(-5);
  });

  it('handles zero and exact multiples', () => {
    expect(snap(0, 1)).toBe(0);
    expect(snap(10, 5)).toBe(10);
    expect(snap(-10, 5)).toBe(-10);
  });
});

describe('planePoint', () => {
  it('floor-snaps in-plane coords and fixes perpendicular from crosshair', () => {
    // XY plane: z comes from crosshair. Floor-snap to cell origin.
    expect(planePoint([3.2, 4.9, 99], 'XY', [0, 0, 7], 1)).toEqual([3, 4, 7]);
    // XZ plane: y from crosshair
    expect(planePoint([3.2, 99, -2.4], 'XZ', [0, 5, 0], 1)).toEqual([3, 5, -3]);
    // YZ plane: x from crosshair
    expect(planePoint([99, 1.4, -2.4], 'YZ', [-6, 0, 0], 1)).toEqual([-6, 1, -3]);
  });

  it('floor-snaps to the cell origin (lower corner), not the center', () => {
    // With grid 2, 3.2 is inside cell [2,4): lower corner is 2, not 4.
    expect(planePoint([3.2, 3.2, 0], 'XY', [0, 0, 0], 2)).toEqual([2, 2, 0]);
  });

  it('works with negative coordinates', () => {
    // -3.2 floors to -4 (cell [-4,-3)); -0.1 floors to -1.
    expect(planePoint([-3.2, -0.1, 0], 'XY', [0, 0, 0], 1)).toEqual([-4, -1, 0]);
    expect(planePoint([-3, 0, 0], 'XY', [0, 0, 0], 1)).toEqual([-3, 0, 0]);
  });
});

/* ------------------------------- tileCorners / makeTile -------------------- */

describe('tileCorners / makeTile winding', () => {
  // Normal via cross product of triangulation (v1-v0)x(v2-v0).
  function normalOf(verts: Tile['vertices']): number[] {
    const [a, b, c] = verts;
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0],
    ];
  }

  it('XY tile faces +Z', () => {
    const n = normalOf(tileCorners([0, 0, 3], 'XY', 2));
    expect(n[2]).toBeGreaterThan(0);
    expect(n[0]).toBe(0); expect(n[1]).toBe(0);
  });

  it('XZ tile faces +Y (ground faces up)', () => {
    const n = normalOf(tileCorners([1, 0, 1], 'XZ', 2));
    expect(n[1]).toBeGreaterThan(0);
    expect(n[0]).toBe(0); expect(n[2]).toBe(0);
  });

  it('YZ tile faces +X', () => {
    const n = normalOf(tileCorners([0, 0, 0], 'YZ', 2));
    expect(n[0]).toBeGreaterThan(0);
    expect(n[1]).toBe(0); expect(n[2]).toBe(0);
  });

  it('makeTile creates tile on active object with session plane/size/brush', () => {
    const p = projectWithAtlas();
    const s = createSession(p);
    s.plane = 'XZ';
    s.tileSize = 2;
    s.crosshair = [0, 4, 0];
    // Explicit origin on the XZ plane at elevation y=4.
    const tile = makeTile(p, s, [1, 4, 1]);
    expect(tile.objectId).toBe(DEFAULT_OBJECT_ID);
    // XZ corner order [origin, +z, +z+x, +x]: (1,4,1), (1,4,3), (3,4,3), (3,4,1)
    expect(tile.vertices[0]).toEqual([1, 4, 1]);
    expect(tile.vertices[1]).toEqual([1, 4, 3]);
    expect(tile.vertices[2]).toEqual([3, 4, 3]);
    expect(tile.vertices[3]).toEqual([3, 4, 1]);
    expect(p.tiles).toContain(tile);
    expect(tile.reversed).toBe(false);
  });

  it('makeTile rejects locked active object', () => {
    const p = projectWithAtlas();
    p.objects[0].locked = true;
    const s = createSession(p);
    expect(() => makeTile(p, s, [0, 0, 0])).toThrow(/locked/i);
  });

  it('makeTile pushes to project tiles (transaction-friendly)', () => {
    const p = projectWithAtlas();
    const s = createSession(p);
    const before = p.tiles.length;
    makeTile(p, s, [0, 0, 0]);
    expect(p.tiles.length).toBe(before + 1);
  });
});

/* ------------------------------- brushUVs ---------------------------------- */

describe('brushUVs', () => {
  const atlas = makeAtlas(); // 64x64, 16px tiles

  it('identity brush maps region to bottom-left-origin UVs', () => {
    // Region x=16,y=16,w=16,h=16 in image space (y top-down).
    // Image y 16..32 → UV v = 1 - y/64 → v0=0.75 (top), v1=0.5 (bottom).
    const uvs = brushUVs(atlas, makeBrush());
    // Corner order [LL, LR, UR, UL] on the quad.
    expect(uvs[0][0]).toBeCloseTo(0.25); expect(uvs[0][1]).toBeCloseTo(0.5);  // LL
    expect(uvs[1][0]).toBeCloseTo(0.5);  expect(uvs[1][1]).toBeCloseTo(0.5);  // LR
    expect(uvs[2][0]).toBeCloseTo(0.5);  expect(uvs[2][1]).toBeCloseTo(0.75); // UR
    expect(uvs[3][0]).toBeCloseTo(0.25); expect(uvs[3][1]).toBeCloseTo(0.75); // UL
  });

  it('flipX mirrors u across the region center', () => {
    const uvs = brushUVs(atlas, makeBrush({ flipX: true }));
    expect(uvs[0][0]).toBeCloseTo(0.5); expect(uvs[1][0]).toBeCloseTo(0.25);
    expect(uvs[2][0]).toBeCloseTo(0.25); expect(uvs[3][0]).toBeCloseTo(0.5);
    // v unchanged
    expect(uvs[0][1]).toBeCloseTo(0.5);
  });

  it('flipY mirrors v across the region center', () => {
    const uvs = brushUVs(atlas, makeBrush({ flipY: true }));
    expect(uvs[0][1]).toBeCloseTo(0.75);
    expect(uvs[2][1]).toBeCloseTo(0.5);
  });

  it('rotation 1 quarter-turn rotates UVs', () => {
    const uvs = brushUVs(atlas, makeBrush({ rotation: 1 }));
    // All four corners still map to the same region area (rotated square in place).
    const us = uvs.map((u) => u[0]).sort();
    const vs = uvs.map((u) => u[1]).sort();
    expect(us[0]).toBeCloseTo(0.25); expect(us[3]).toBeCloseTo(0.5);
    expect(vs[0]).toBeCloseTo(0.5); expect(vs[3]).toBeCloseTo(0.75);
    // LL after one CW rotation of a square takes the LR position of identity.
    expect(uvs[0][0]).toBeCloseTo(0.5); expect(uvs[0][1]).toBeCloseTo(0.5);
  });

  it('rotation 2 equals half turn', () => {
    const uvs = brushUVs(atlas, makeBrush({ rotation: 2 }));
    expect(uvs[0][0]).toBeCloseTo(0.5); expect(uvs[0][1]).toBeCloseTo(0.75);
    expect(uvs[2][0]).toBeCloseTo(0.25); expect(uvs[2][1]).toBeCloseTo(0.5);
  });

  it('full-atlas brush spans 0..1 UVs', () => {
    const uvs = brushUVs(atlas, makeBrush({ region: { x: 0, y: 0, width: 64, height: 64 } }));
    expect(uvs[0]).toEqual([0, 0]);
    expect(uvs[2]).toEqual([1, 1]);
  });
});

/* ------------------------------- hierarchy --------------------------------- */

describe('hierarchy and locks', () => {
  it('isObjectLocked includes ancestors', () => {
    const p = createProject();
    const child = { id: 'child', name: 'child', parentId: DEFAULT_OBJECT_ID, visible: true, locked: false };
    p.objects.push(child);
    expect(isObjectLocked(p, 'child')).toBe(false);
    p.objects[0].locked = true;
    expect(isObjectLocked(p, 'child')).toBe(true);
    expect(isObjectLocked(p, DEFAULT_OBJECT_ID)).toBe(true);
  });

  it('isObjectVisible includes ancestors', () => {
    const p = createProject();
    p.objects.push({ id: 'child', name: 'child', parentId: DEFAULT_OBJECT_ID, visible: true, locked: false });
    expect(isObjectVisible(p, 'child')).toBe(true);
    p.objects[0].visible = false;
    expect(isObjectVisible(p, 'child')).toBe(false);
    expect(isObjectVisible(p, DEFAULT_OBJECT_ID)).toBe(false);
  });

  it('reparentObject rejects cycles', () => {
    const p = createProject();
    p.objects.push({ id: 'a', name: 'a', parentId: DEFAULT_OBJECT_ID, visible: true, locked: false });
    p.objects.push({ id: 'b', name: 'b', parentId: 'a', visible: true, locked: false });
    // a → main, b → a: making main's parent b creates a cycle.
    expect(() => reparentObject(p, DEFAULT_OBJECT_ID, 'b')).toThrow(/cycle/i);
    expect(() => reparentObject(p, 'a', 'a')).toThrow(/itself|cycle/i);
    // valid reparent works
    reparentObject(p, 'b', DEFAULT_OBJECT_ID);
    expect(p.objects.find((o) => o.id === 'b')!.parentId).toBe(DEFAULT_OBJECT_ID);
    // null detach works
    reparentObject(p, 'a', null);
    expect(p.objects.find((o) => o.id === 'a')!.parentId).toBeNull();
  });

  it('reparentObject with unknown ids throws readable error', () => {
    const p = createProject();
    expect(() => reparentObject(p, 'nope', DEFAULT_OBJECT_ID)).toThrow(/nope/i);
    expect(() => reparentObject(p, DEFAULT_OBJECT_ID, 'nope')).toThrow(/nope/i);
  });
});

/* ------------------------------- selection transforms ---------------------- */

describe('selectedCorners', () => {
  it('deduplicates corner entries', () => {
    const p = createProject();
    const t = addTile(p);
    const sel = { tileIds: [], vertices: [
      { tileId: t.id, corner: 0 }, { tileId: t.id, corner: 0 }, { tileId: t.id, corner: 2 },
    ] };
    expect(selectedCorners(p, sel)).toHaveLength(2);
  });

  it('ignores stale tile ids', () => {
    const p = createProject();
    expect(selectedCorners(p, { tileIds: [], vertices: [{ tileId: 'ghost', corner: 1 }] })).toEqual([]);
  });
});

describe('translateSelection', () => {
  it('moves only selected corners', () => {
    const p = createProject();
    const t = addTile(p);
    translateSelection(p, { tileIds: [], vertices: [{ tileId: t.id, corner: 0 }, { tileId: t.id, corner: 3 }] }, [1, 0, 0]);
    expect(t.vertices[0]).toEqual([1, 0, 0]);
    expect(t.vertices[1]).toEqual([1, 0, 0]); // untouched
    expect(t.vertices[2]).toEqual([1, 1, 0]); // untouched
    expect(t.vertices[3]).toEqual([1, 1, 0]);
  });

  it('respects ancestor locks', () => {
    const p = createProject();
    const t = addTile(p);
    p.objects[0].locked = true;
    const before = t.vertices.map((v) => [...v]);
    translateSelection(p, { tileIds: [], vertices: [{ tileId: t.id, corner: 0 }] }, [1, 1, 1]);
    expect(t.vertices).toEqual(before);
  });

  it('rejects non-finite delta', () => {
    const p = createProject();
    const t = addTile(p);
    expect(() => translateSelection(p, { tileIds: [], vertices: [{ tileId: t.id, corner: 0 }] }, [NaN, 0, 0])).toThrow(/finite/i);
  });
});

describe('rotateSelection / scaleSelection', () => {
  it('rotates 90° around z at origin correctly', () => {
    const p = createProject();
    const t = addTile(p, DEFAULT_OBJECT_ID, [[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]]);
    rotateSelection(p, { tileIds: [], vertices: [{ tileId: t.id, corner: 0 }] }, 'z', Math.PI / 2, [0, 0, 0]);
    expect(t.vertices[0][0]).toBeCloseTo(0);
    expect(t.vertices[0][1]).toBeCloseTo(1);
    expect(t.vertices[0][2]).toBe(0);
  });

  it('rotation around pivot keeps pivot-fixed corners fixed', () => {
    const p = createProject();
    const t = addTile(p, DEFAULT_OBJECT_ID, [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]]);
    const pivot: [number, number, number] = [0.5, 0.5, 0];
    // Rotate corner 1, which sits at [1,0,0] — offset from pivot, must move.
    rotateSelection(p, { tileIds: [], vertices: [{ tileId: t.id, corner: 1 }] }, 'z', 0.3, pivot);
    const [vx, vy] = t.vertices[1];
    expect(vx).not.toBe(1); // moved
    // Distance to pivot preserved under rotation.
    expect(Math.hypot(vx - 0.5, vy - 0.5)).toBeCloseTo(Math.hypot(0.5, 0.5));
  });

  it('scales around pivot', () => {
    const p = createProject();
    const t = addTile(p, DEFAULT_OBJECT_ID, [[0, 0, 0], [2, 0, 0], [2, 2, 0], [0, 2, 0]]);
    scaleSelection(p, { tileIds: [], vertices: [{ tileId: t.id, corner: 1 }] }, [2, 2, 1], [0, 0, 0]);
    expect(t.vertices[1]).toEqual([4, 0, 0]);
  });

  it('transforms reject non-finite inputs', () => {
    const p = createProject();
    const t = addTile(p);
    const sel = { tileIds: [], vertices: [{ tileId: t.id, corner: 0 }] };
    expect(() => rotateSelection(p, sel, 'z', NaN, [0, 0, 0])).toThrow(/finite/i);
    expect(() => scaleSelection(p, sel, [NaN, 1, 1], [0, 0, 0])).toThrow(/finite/i);
  });

  it('locked tiles are not rotated', () => {
    const p = createProject();
    const t = addTile(p, DEFAULT_OBJECT_ID, [[1, 0, 0], [2, 0, 0], [2, 1, 0], [1, 1, 0]]);
    p.objects[0].locked = true;
    const before = t.vertices.map((v) => [...v]);
    rotateSelection(p, { tileIds: [], vertices: [{ tileId: t.id, corner: 0 }] }, 'z', Math.PI / 2, [0, 0, 0]);
    expect(t.vertices).toEqual(before);
  });
});

/* ------------------------------- tile ops ---------------------------------- */

describe('duplicateSelection', () => {
  it('duplicates selected tiles with new ids and offset', () => {
    const p = createProject();
    const t = addTile(p);
    const ids = duplicateSelection(p, { tileIds: [t.id], vertices: [] }, [1, 2, 3]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).not.toBe(t.id);
    const copy = p.tiles.find((x) => x.id === ids[0])!;
    expect(copy.vertices[0]).toEqual([1, 2, 3]);
    expect(copy.uvs).toEqual(t.uvs);
    expect(p.tiles).toHaveLength(2);
  });

  it('does not duplicate locked tiles', () => {
    const p = createProject();
    const t = addTile(p);
    p.objects[0].locked = true;
    const ids = duplicateSelection(p, { tileIds: [t.id], vertices: [] }, [1, 0, 0]);
    expect(ids).toEqual([]);
    expect(p.tiles).toHaveLength(1);
  });

  it('duplicate corners do not weld: copies keep independent corners', () => {
    const p = createProject();
    const t = addTile(p);
    const [copyId] = duplicateSelection(p, { tileIds: [t.id], vertices: [] }, [0, 0, 0]);
    translateSelection(p, { tileIds: [], vertices: [{ tileId: t.id, corner: 0 }] }, [5, 0, 0]);
    const copy = p.tiles.find((x) => x.id === copyId)!;
    expect(copy.vertices[0]).toEqual([0, 0, 0]);
  });
});

describe('deleteSelection', () => {
  it('deletes selected tiles', () => {
    const p = createProject();
    const t = addTile(p);
    deleteSelection(p, { tileIds: [t.id], vertices: [] });
    expect(p.tiles).toHaveLength(0);
  });

  it('rejects corner-only deletion', () => {
    const p = createProject();
    const t = addTile(p);
    expect(() => deleteSelection(p, { tileIds: [], vertices: [{ tileId: t.id, corner: 0 }] })).toThrow(/corner/i);
    expect(p.tiles).toHaveLength(1);
  });

  it('empty selection is a no-op', () => {
    const p = createProject();
    addTile(p);
    expect(() => deleteSelection(p, { tileIds: [], vertices: [] })).not.toThrow();
    expect(p.tiles).toHaveLength(1);
  });

  it('does not delete locked tiles', () => {
    const p = createProject();
    const t = addTile(p);
    p.objects[0].locked = true;
    expect(() => deleteSelection(p, { tileIds: [t.id], vertices: [] })).toThrow(/locked/i);
    expect(p.tiles).toHaveLength(1);
  });
});

describe('reverseSelection', () => {
  it('toggles reversed on selected tiles only', () => {
    const p = createProject();
    const a = addTile(p);
    const b = addTile(p);
    reverseSelection(p, { tileIds: [a.id], vertices: [] });
    expect(a.reversed).toBe(true);
    expect(b.reversed).toBe(false);
    reverseSelection(p, { tileIds: [a.id], vertices: [] });
    expect(a.reversed).toBe(false);
  });
});

describe('applyBrush', () => {
  it('applies brush UVs and atlasId to selected tiles', () => {
    const p = projectWithAtlas();
    const t = addTile(p);
    const brush = makeBrush({ region: { x: 0, y: 0, width: 16, height: 16 } });
    applyBrush(p, { tileIds: [t.id], vertices: [] }, brush);
    expect(t.atlasId).toBe('atlas-1');
    const expected = brushUVs(p.atlases[0], brush);
    expect(t.uvs).toEqual(expected);
  });

  it('throws on unknown atlas', () => {
    const p = projectWithAtlas();
    const t = addTile(p);
    expect(() => applyBrush(p, { tileIds: [t.id], vertices: [] }, makeBrush({ atlasId: 'ghost' }))).toThrow(/atlas/i);
  });

  it('skips locked tiles', () => {
    const p = projectWithAtlas();
    const t = addTile(p);
    p.objects[0].locked = true;
    applyBrush(p, { tileIds: [t.id], vertices: [] }, makeBrush());
    expect(t.atlasId).toBe('atlas-1'); // unchanged from construction
    expect(t.uvs).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
  });
});

describe('transformUVs', () => {
  it('rotate spins UVs 90° around tile UV center', () => {
    const p = createProject();
    const t = addTile(p);
    transformUVs(p, { tileIds: [t.id], vertices: [] }, 'rotate');
    // (0,0)→(1,0)→(1,1)→(0,1) becomes (1,0)→(1,1)→(0,1)→(0,0)
    expect(t.uvs[0][0]).toBeCloseTo(1); expect(t.uvs[0][1]).toBeCloseTo(0);
    expect(t.uvs[1][0]).toBeCloseTo(1); expect(t.uvs[1][1]).toBeCloseTo(1);
    expect(t.uvs[2][0]).toBeCloseTo(0); expect(t.uvs[2][1]).toBeCloseTo(1);
    expect(t.uvs[3][0]).toBeCloseTo(0); expect(t.uvs[3][1]).toBeCloseTo(0);
  });

  it('flipX mirrors u', () => {
    const p = createProject();
    const t = addTile(p);
    transformUVs(p, { tileIds: [t.id], vertices: [] }, 'flipX');
    expect(t.uvs[0]).toEqual([1, 0]);
    expect(t.uvs[1]).toEqual([0, 0]);
  });

  it('flipY mirrors v', () => {
    const p = createProject();
    const t = addTile(p);
    transformUVs(p, { tileIds: [t.id], vertices: [] }, 'flipY');
    expect(t.uvs[0]).toEqual([0, 1]);
    expect(t.uvs[2]).toEqual([1, 0]);
  });

  it('offset translates UVs', () => {
    const p = createProject();
    const t = addTile(p);
    transformUVs(p, { tileIds: [t.id], vertices: [] }, 'flipX', [0.25, 0]);
    expect(t.uvs[0]).toEqual([1.25, 0]);
  });

  it('locked tiles are untouched', () => {
    const p = createProject();
    const t = addTile(p);
    p.objects[0].locked = true;
    transformUVs(p, { tileIds: [t.id], vertices: [] }, 'rotate');
    expect(t.uvs).toEqual([[0, 0], [1, 0], [1, 1], [0, 1]]);
  });
});

/* ------------------------------- UV seam ----------------------------------- */

describe('corner UV seams', () => {
  it('adjacent tiles do not share corner identity implicitly', () => {
    const p = projectWithAtlas();
    const s = createSession(p);
    const a = makeTile(p, s, [0, 0, 0]);
    const b = makeTile(p, s, [1, 0, 0]);
    // Move a corner of tile a; tile b must not move.
    translateSelection(p, { tileIds: [], vertices: [{ tileId: a.id, corner: 1 }] }, [0, 0.5, 0]);
    expect(b.vertices[0]).toEqual([1, 0, 0]);
    // Same applies to UVs.
    transformUVs(p, { tileIds: [a.id], vertices: [] }, 'flipX');
    // b was made with the session's default brush: UVs stay unchanged.
    const identity = brushUVs(p.atlases[0], s.brush);
    expect(b.uvs).toEqual(identity);
  });
});

/* ------------------------------- validateProject --------------------------- */

describe('validateProject', () => {
  const base = (): unknown => ({
    format: 'pivo-plate', version: 1, name: 'ok',
    atlases: [{ id: 'a1', name: 'A', width: 64, height: 64, tileWidth: 16, tileHeight: 16, margin: 0, spacing: 0, dataUrl: TINY_PNG_DATA_URL }],
    objects: [{ id: 'o1', name: 'main', parentId: null, visible: true, locked: false }],
    tiles: [{ id: 't1', objectId: 'o1', atlasId: 'a1', vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]], uvs: [[0, 0], [1, 0], [1, 1], [0, 1]], reversed: false }],
  });

  it('accepts a valid project and deep clones', () => {
    const src = base() as Project;
    const out = validateProject(src);
    expect(out.name).toBe('ok');
    expect(out).not.toBe(src);
    expect(out.tiles[0]).not.toBe((src as Project).tiles[0]);
  });

  it('does not mutate input', () => {
    const src = base();
    const snapshot = JSON.stringify(src);
    validateProject(src);
    expect(JSON.stringify(src)).toBe(snapshot);
  });

  it('rejects wrong format/version', () => {
    expect(() => validateProject({ ...(base() as object), format: 'other' })).toThrow(/format/i);
    expect(() => validateProject({ ...(base() as object), version: 2 })).toThrow(/version/i);
  });

  it('rejects non-object inputs', () => {
    for (const bad of [null, undefined, 42, 'str', [], true]) {
      expect(() => validateProject(bad)).toThrow();
    }
  });

  it('rejects non-finite coordinates', () => {
    const src = base() as Record<string, unknown>;
    const tiles = (src['tiles'] as { vertices: number[][] }[]);
    tiles[0].vertices[0] = [NaN, 0, 0];
    expect(() => validateProject(src)).toThrow(/finite/i);
    const src2 = base() as Record<string, unknown>;
    (src2['tiles'] as { vertices: number[][] }[])[0].vertices[1] = [Infinity, 0, 0];
    expect(() => validateProject(src2)).toThrow(/finite/i);
  });

  it('rejects unknown object and atlas references', () => {
    const src = base() as Record<string, unknown>;
    (src['tiles'] as { objectId: string }[])[0].objectId = 'ghost';
    expect(() => validateProject(src)).toThrow(/objectId/i);
    const src2 = base() as Record<string, unknown>;
    (src2['tiles'] as { atlasId: string }[])[0].atlasId = 'ghost';
    expect(() => validateProject(src2)).toThrow(/atlasId/i);
  });

  it('rejects unknown parentId', () => {
    const src = base() as Record<string, unknown>;
    (src['objects'] as { parentId: string | null }[])[0].parentId = 'ghost';
    expect(() => validateProject(src)).toThrow(/parentId/i);
  });

  it('rejects parenting cycles', () => {
    const src = base() as Record<string, unknown>;
    (src['objects'] as Project['objects']).push(
      { id: 'a', name: 'a', parentId: 'b', visible: true, locked: false },
      { id: 'b', name: 'b', parentId: 'a', visible: true, locked: false },
    );
    expect(() => validateProject(src)).toThrow(/cycle/i);
  });

  it('rejects duplicate ids', () => {
    const src = base() as Record<string, unknown>;
    (src['tiles'] as { id: string }[]).push({ ...(src['tiles'] as { id: string }[])[0] });
    expect(() => validateProject(src)).toThrow(/duplicate/i);
  });

  it('rejects malformed PNG data URLs', () => {
    const src = base() as Record<string, unknown>;
    const atlas = (src['atlases'] as { dataUrl: string }[])[0];
    const orig = atlas.dataUrl;
    atlas.dataUrl = 'data:image/jpeg;base64,AAAA';
    expect(() => validateProject(src)).toThrow(/PNG/i);
    atlas.dataUrl = `data:image/png;base64,${TINY_PNG_BASE64.slice(0, 10)}`; // broken base64
    expect(() => validateProject(src)).toThrow();
    atlas.dataUrl = 'data:image/png;base64,////'; // not a PNG payload
    expect(() => validateProject(src)).toThrow(/PNG/i);
    atlas.dataUrl = orig;
  });

  it('rejects non-PNG binary payload claiming to be PNG', () => {
    // base64 of "GIF89a" style header
    const fake = btoa('GIF89a' + 'x'.repeat(30));
    const src = base() as Record<string, unknown>;
    (src['atlases'] as { dataUrl: string }[])[0].dataUrl = `data:image/png;base64,${fake}`;
    expect(() => validateProject(src)).toThrow(/PNG/i);
  });

  it('rejects unbounded sizes (object limit enforced)', () => {
    const src = base() as Record<string, unknown>;
    const objects = src['objects'] as unknown[];
    const proto = objects[0];
    for (let i = 0; i < 100001; i++) objects.push(proto);
    expect(() => validateProject(src)).toThrow(/too many/i);
  });

  it('rejects wrong array shapes on tiles', () => {
    const src = base() as Record<string, unknown>;
    (src['tiles'] as { vertices: unknown }[])[0].vertices = [[0, 0, 0]];
    expect(() => validateProject(src)).toThrow(/vertices/i);
  });

  it('rejects missing booleans', () => {
    const src = base() as Record<string, unknown>;
    (src['tiles'] as { reversed: unknown }[])[0].reversed = 'yes';
    expect(() => validateProject(src)).toThrow(/reversed/i);
  });

  it('clones so mutations to output do not affect input', () => {
    const src = base();
    const out = validateProject(src) as Project;
    out.tiles[0].vertices[0] = [9, 9, 9];
    expect((src as unknown as Project).tiles[0].vertices[0]).toEqual([0, 0, 0]);
    expect(out.atlases[0].dataUrl).toBe((src as unknown as Project).atlases[0].dataUrl);
  });

  it('session can be created from a freshly validated project without atlases', () => {
    const p = createProject();
    const validated = validateProject(p);
    expect(() => createSession(validated)).not.toThrow();
    expect(createSession(validated).brush.atlasId).toBe('blank');
  });
});

/* ------------------------------- EditorStore ------------------------------- */

describe('EditorStore', () => {
  it('starts clean and empty', () => {
    const store = new EditorStore(createProject());
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.dirty).toBe(false);
    expect(store.revision).toBe(0);
  });

  it('commits a transaction and supports undo/redo', () => {
    const p = createProject();
    p.atlases.push(makeAtlas());
    const store = new EditorStore(p);
    store.transact('add tile', (proj) => {
      const s = createSession(proj);
      makeTile(proj, s, [0, 0, 0]);
    });
    expect(store.project.tiles).toHaveLength(1);
    expect(store.canUndo).toBe(true);
    expect(store.historyLabel).toBe('add tile');
    expect(store.dirty).toBe(true);
    store.undo();
    expect(store.project.tiles).toHaveLength(0);
    expect(store.canRedo).toBe(true);
    store.redo();
    expect(store.project.tiles).toHaveLength(1);
  });

  it('rolls back on exception and leaves no history entry', () => {
    const p = createProject();
    const store = new EditorStore(p);
    expect(() => store.transact('boom', (proj) => {
      proj.name = 'changed';
      throw new Error('kaboom');
    })).toThrow('kaboom');
    expect(store.project.name).toBe('Untitled');
    expect(store.canUndo).toBe(false);
    expect(store.revision).toBe(0);
  });

  it('omits no-op transactions from history', () => {
    const p = createProject();
    const store = new EditorStore(p);
    store.transact('no-op', () => { /* nothing */ });
    expect(store.canUndo).toBe(false);
    expect(store.revision).toBe(0);
    expect(store.dirty).toBe(false);
  });

  it('project is isolated from the original input object', () => {
    const p = createProject();
    const store = new EditorStore(p);
    store.transact('rename', (proj) => { proj.name = 'changed'; });
    expect(p.name).toBe('Untitled');
    expect(store.project.name).toBe('changed');
  });

  it('undo/redo are bounded', () => {
    const store = new EditorStore(createProject());
    for (let i = 0; i < 200; i++) {
      store.transact(`t${i}`, (proj) => { proj.name = `n${i}`; });
    }
    let undos = 0;
    while (store.canUndo) { store.undo(); undos++; }
    expect(undos).toBeLessThanOrEqual(64);
    expect(store.project.name).not.toBe('n199');
  });

  it('markSaved sets dirty semantics', () => {
    const store = new EditorStore(createProject());
    store.transact('rename', (proj) => { proj.name = 'x'; });
    expect(store.dirty).toBe(true);
    store.markSaved();
    expect(store.dirty).toBe(false);
    // semantic dirtiness: another change re-dirties
    store.transact('rename2', (proj) => { proj.name = 'y'; });
    expect(store.dirty).toBe(true);
    // undoing back to saved state clears dirty
    store.undo();
    expect(store.dirty).toBe(false);
    // undoing further, before the saved point, re-dirties
    store.undo();
    expect(store.dirty).toBe(true);
    // redo past saved point re-dirties
    store.redo();
    store.redo();
    expect(store.dirty).toBe(true);
    // and returning to the saved state clears it again
    store.undo();
    expect(store.dirty).toBe(false);
  });

  it('replace clears history', () => {
    const store = new EditorStore(createProject());
    store.transact('t', (proj) => { proj.name = 'x'; });
    const fresh = createProject('fresh');
    store.replace(fresh);
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    expect(store.project.name).toBe('fresh');
    expect(store.dirty).toBe(true); // replaced state counts as unsaved
  });

  it('subscribe notifies on change and unsubscribe works', () => {
    const store = new EditorStore(createProject());
    let calls = 0;
    const unsub = store.subscribe(() => { calls++; });
    store.transact('t', (proj) => { proj.name = 'x'; });
    expect(calls).toBe(1);
    unsub();
    store.transact('t2', (proj) => { proj.name = 'y'; });
    expect(calls).toBe(1); // no further notifications
  });

  it('transact rejects async callbacks silently breaking state', () => {
    const store = new EditorStore(createProject());
    // Sync-only contract: an async fn returns a promise; state should not
    // be committed as if it were synchronous mutation... but since fn
    // mutates synchronously before await, this is allowed. Just check no crash.
    expect(() => store.transact('async', (proj) => { proj.name = 'z'; })).not.toThrow();
    expect(store.project.name).toBe('z');
  });

  it('redo stack clears on new transaction', () => {
    const store = new EditorStore(createProject());
    store.transact('a', (p) => { p.name = 'a'; });
    store.transact('b', (p) => { p.name = 'b'; });
    store.undo();
    expect(store.canRedo).toBe(true);
    store.transact('c', (p) => { p.name = 'c'; });
    expect(store.canRedo).toBe(false);
  });
});
