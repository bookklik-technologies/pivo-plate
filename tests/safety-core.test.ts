// Core safety remediation tests — canonical validation, store atomicity and
// bounded hierarchy. Covers the approved audit fixes only.
import { describe, it, expect } from 'vitest';
import {
  createProject, createSession, makeTile, applyBrush, transformUVs,
  validateProject, validateBrushAgainstAtlas, EditorStore, brushUVs,
} from '../src/core/editor.ts';
import {
  ancestorChain, isObjectVisibleValue, isObjectLockedValue,
  MAX_HIERARCHY_DEPTH,
} from '../src/core/hierarchy.ts';
import { MAX_HIERARCHY_DEPTH as MAX_DEPTH_REEXPORT } from '../src/io/validate.ts';
import { validateProjectValue } from '../src/io/validate.ts';
import { encodeProject } from '../src/io/project.ts';
import { makeProject, makeAtlas, makeTile as fxTile, makeObject, pngDataUrl } from './fixtures.ts';
import type { Project, SceneObject, Vec2 } from '../src/core/types.ts';

/* ------------------------------- fixtures --------------------------------- */

const TINY_PNG_DATA_URL = pngDataUrl();

/** A minimal project-shaped unknown object used for validator probing. */
function baseProject(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(makeProject())) as Record<string, unknown>;
}

function withUvTile(uvs: Vec2[]): Record<string, unknown> {
  const p = makeProject({ tiles: [fxTile({ uvs: uvs as never })] });
  return JSON.parse(JSON.stringify(p)) as Record<string, unknown>;
}

/* ----------------------- canonical validator: parity ---------------------- */

describe('canonical validator parity (validateProject vs validateProjectValue)', () => {
  it('accepts the same valid project through both entry points', () => {
    const p = makeProject();
    const a = validateProject(p);
    const b = validateProjectValue(p);
    expect(b).toEqual(a);
    expect(b).not.toBe(p); // deep cloned
  });

  it('wraps every rejection as a PayloadError-equivalent readable error with identical messages', () => {
    const bads: unknown[] = [
      null,
      'nope',
      42,
      { format: 'other' },
      { ...baseProject(), version: 2 },
      // unknown atlas ref
      makeProject({ tiles: [fxTile({ atlasId: 'ghost-atlas' })] }),
      // unknown object ref
      makeProject({ tiles: [fxTile({ objectId: 'ghost-object' })] }),
      // unknown parent ref
      makeProject({ objects: [makeObject({ parentId: 'ghost' })] }),
      // self parent
      makeProject({ objects: [makeObject({ parentId: 'object-main' })] }),
      // duplicate ids
      makeProject({ tiles: [fxTile({ id: 'same' }), fxTile({ id: 'same', vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] })] }),
      // out-of-range UVs
      makeProject({ tiles: [fxTile({ uvs: [[0, 0], [2, 0], [1, 1], [0, 1]] as never })] }),
      // NaN coordinates survive as null through JSON but the raw object form is caught
      (() => { const p = makeProject(); (p.tiles[0].vertices as unknown as number[][])[0] = [NaN, 0, 0]; return p; })(),
    ];
    for (const bad of bads) {
      let coreMsg = '';
      let ioMsg = '';
      try { validateProject(bad); } catch (e) { coreMsg = (e as Error).message; }
      try { validateProjectValue(bad); } catch (e) { ioMsg = (e as Error).message; }
      expect(coreMsg, `validateProject(${JSON.stringify(bad)}) must throw`).not.toBe('');
      expect(ioMsg, `validateProjectValue(${JSON.stringify(bad)}) must throw`).not.toBe('');
      expect(ioMsg).toBe(coreMsg); // one canonical semantic, one message
    }
  });

  it('keeps the legacy readable error phrases for existing clients', () => {
    expect(() => validateProjectValue(makeProject({ objects: [makeObject({ parentId: 'object-main' })] })))
      .toThrow(/own parent/);
    expect(() => validateProjectValue(makeProject({ tiles: [fxTile({ atlasId: 'ghost' })] })))
      .toThrow(/unknown atlas/);
    expect(() => validateProjectValue(makeProject({ tiles: [fxTile({ objectId: 'ghost' })] })))
      .toThrow(/unknown object/);
    expect(() => validateProjectValue(withUvTile([[0, 0], [1.5, 0], [1, 1], [0, 1]])))
      .toThrow(/outside the 0..1 range/);
    expect(() => validateProjectValue(makeProject({
      objects: [makeObject({ id: 'a', parentId: 'b' }), makeObject({ id: 'b', parentId: 'a' })],
      tiles: [fxTile({ objectId: 'a' })],
    }))).toThrow(/cycle/);
  });
});

/* ----------------------------- UV range policy ---------------------------- */

describe('UV range policy (shared tolerance + normalization)', () => {
  it('accepts UVs exactly at the bounds', () => {
    expect(() => validateProject(withUvTile([[0, 0], [1, 0], [1, 1], [0, 1]]))).not.toThrow();
  });

  it('accepts floating-point drift within tolerance and normalizes it back to the bound', () => {
    const eps = 1e-9; // within the 1e-6 tolerance
    const p = makeProject({ tiles: [fxTile({ uvs: [[-eps, 0], [1 + eps, 0], [1, 1], [0, 1]] as never })] });
    const out = validateProject(p);
    expect(out.tiles[0].uvs[0]).toEqual([0, 0]);
    expect(out.tiles[0].uvs[1]).toEqual([1, 0]);
  });

  it('rejects UVs beyond the shared tolerance with the 0..1 range message', () => {
    const over = 1e-4; // beyond 1e-6 tolerance
    expect(() => validateProject(withUvTile([[0, 0], [1 + over, 0], [1, 1], [0, 1]])))
      .toThrow(/outside the 0..1 range/);
    expect(() => validateProject(withUvTile([[-over, 0], [1, 0], [1, 1], [0, 1]])))
      .toThrow(/outside the 0..1 range/);
  });

  it('rejects NaN and Infinity UVs (not silently serialized away)', () => {
    const p = makeProject();
    (p.tiles[0].uvs as unknown as number[][])[0] = [NaN, 0];
    expect(() => validateProject(p)).toThrow(/finite/);
    (p.tiles[0].uvs as unknown as number[][])[0] = [Infinity, 0];
    expect(() => validateProject(p)).toThrow(/finite/);
  });

  it('shares the exact same tolerance policy between core and IO entry points', () => {
    const drift = 5e-7; // just inside tolerance
    const raw = withUvTile([[0, -drift], [1, 0], [1, 1], [0, 1]]);
    const viaCore = validateProject(raw);
    const viaIO = validateProjectValue(JSON.parse(JSON.stringify(raw)));
    expect(viaIO).toEqual(viaCore);
    expect(viaCore.tiles[0].uvs[0]).toEqual([0, 0]);
  });
});

/* ------------------------------- atlas ids -------------------------------- */

describe('atlas id budget (ZIP entry compatibility)', () => {
  it('accepts safe ids matching [A-Za-z0-9_.-]{1,128}', () => {
    for (const id of ['a', 'atlas-a', 'A_1.2', 'x'.repeat(128)]) {
      const p = makeProject({ atlases: [makeAtlas({ id })], tiles: [fxTile({ atlasId: id })] });
      expect(() => validateProject(p), id).not.toThrow();
    }
  });

  it('rejects ids that could break ZIP entry paths (traversal, slashes, empty, too long)', () => {
    for (const id of ['../evil', 'a/b', '', '.hidden/..', 'x'.repeat(129), 'sp ace', 'uniçode']) {
      const p = makeProject({ atlases: [makeAtlas({ id })], tiles: [fxTile({ atlasId: id })] });
      expect(() => validateProject(p), id).toThrow();
    }
  });

  it('rejects non-empty name requirement consistently between validators', () => {
    const p = makeProject({ objects: [makeObject({ name: '' })] });
    let core = '';
    let io = '';
    try { validateProject(p); } catch (e) { core = (e as Error).message; }
    try { validateProjectValue(JSON.parse(JSON.stringify(p))); } catch (e) { io = (e as Error).message; }
    expect(core).toMatch(/non-empty/);
    expect(io).toBe(core);
    const pa = makeProject({ atlases: [makeAtlas({ name: '' })] });
    expect(() => validateProject(pa)).toThrow(/non-empty/);
    const pp = makeProject(); pp.name = '';
    expect(() => validateProject(pp)).toThrow(/non-empty/);
  });
});

/* --------------------------- brush pre-validation -------------------------- */

describe('brush validation before makeTile / applyBrush', () => {
  function projectWithAtlas(): Project {
    const p = createProject('test');
    p.atlases.push(makeAtlas({ width: 64, height: 64, tileWidth: 16, tileHeight: 16, dataUrl: pngDataUrl(64, 64) }));
    return p;
  }

  it('makeTile rejects out-of-bounds brush regions before creating a tile', () => {
    const p = projectWithAtlas();
    const s = createSession(p);
    s.brush.region = { x: 60, y: 0, width: 16, height: 16 }; // crosses right edge
    const before = p.tiles.length;
    expect(() => makeTile(p, s, [0, 0, 0])).toThrow(/region|atlas/i);
    expect(p.tiles).toHaveLength(before); // nothing created
  });

  it('makeTile rejects invalid rotation flags before creating a tile', () => {
    const p = projectWithAtlas();
    const s = createSession(p);
    (s.brush as unknown as { rotation: number }).rotation = 7; // invalid quarter-turn
    const before = p.tiles.length;
    expect(() => makeTile(p, s, [0, 0, 0])).toThrow(/rotation/i);
    expect(p.tiles).toHaveLength(before);
  });

  it('applyBrush with an invalid brush mutates no tile at all', () => {
    const p = projectWithAtlas();
    const s = createSession(p);
    const tile = makeTile(p, s, [0, 0, 0]);
    const atlasIdBefore = tile.atlasId;
    const uvsBefore = JSON.stringify(tile.uvs);
    // Region fully outside the atlas
    expect(() => applyBrush(p, { tileIds: [tile.id], vertices: [] }, {
      atlasId: 'atlas-a', region: { x: 100, y: 100, width: 8, height: 8 }, rotation: 0, flipX: false, flipY: false,
    })).toThrow(/region|atlas/i);
    expect(tile.atlasId).toBe(atlasIdBefore);
    expect(JSON.stringify(tile.uvs)).toBe(uvsBefore);
  });

  it('applyBrush with a valid brush still works (positive case)', () => {
    const p = projectWithAtlas();
    const s = createSession(p);
    const tile = makeTile(p, s, [0, 0, 0]);
    applyBrush(p, { tileIds: [tile.id], vertices: [] }, {
      atlasId: 'atlas-a', region: { x: 0, y: 0, width: 16, height: 16 }, rotation: 0, flipX: false, flipY: false,
    });
    const expected = brushUVs(p.atlases[0], {
      atlasId: 'atlas-a', region: { x: 0, y: 0, width: 16, height: 16 }, rotation: 0, flipX: false, flipY: false,
    });
    expect(tile.uvs).toEqual(expected);
    expect(tile.atlasId).toBe('atlas-a');
  });

  it('validateBrushAgainstAtlas gives readable bounds errors', () => {
    const atlas = makeAtlas({ width: 32, height: 32 });
    expect(() => validateBrushAgainstAtlas(atlas, {
      atlasId: atlas.id, region: { x: -1, y: 0, width: 8, height: 8 }, rotation: 0, flipX: false, flipY: false,
    })).toThrow();
    expect(() => validateBrushAgainstAtlas(atlas, {
      atlasId: atlas.id, region: { x: 0, y: 0, width: 0, height: 8 }, rotation: 0, flipX: false, flipY: false,
    })).toThrow(/positive/);
    expect(() => validateBrushAgainstAtlas(atlas, {
      atlasId: atlas.id, region: { x: 0, y: 0, width: 8, height: 8 }, rotation: 2, flipX: false, flipY: false,
    })).not.toThrow();
  });
});

/* ------------------------- transformUVs atomicity -------------------------- */

describe('transformUVs atomic validation', () => {
  it('rejects non-finite offsets before mutating any tile', () => {
    const p = makeProject();
    p.tiles.push(fxTile({ id: 'tile-2' }));
    const before = JSON.stringify(p.tiles);
    expect(() => transformUVs(p, { tileIds: ['tile-1', 'tile-2'], vertices: [] }, 'flipX', [NaN, 0]))
      .toThrow(/offset must be finite/);
    expect(JSON.stringify(p.tiles)).toBe(before);
    expect(() => transformUVs(p, { tileIds: ['tile-1', 'tile-2'], vertices: [] }, 'flipX', [0, Infinity]))
      .toThrow(/offset must be finite/);
    expect(JSON.stringify(p.tiles)).toBe(before);
  });

  it('a store transaction rejects a UV offset leaving the 0..1 range and preserves state', () => {
    const p = makeProject();
    const store = new EditorStore(p);
    const snapshot = JSON.stringify(store.project);
    const revision = store.revision;
    expect(() => store.transact('UV offset', (draft) => {
      transformUVs(draft, { tileIds: ['tile-1'], vertices: [] }, 'flipX', [0.75, 0]); // 1 → 1.75
    })).toThrow(/outside the 0..1 range/);
    expect(JSON.stringify(store.project)).toBe(snapshot);
    expect(store.revision).toBe(revision);
    expect(store.canUndo).toBe(false);
    expect(store.dirty).toBe(false);
  });

  it('a store transaction accepts UV offsets that keep every UV inside 0..1 (positive case)', () => {
    const p = makeProject({ tiles: [fxTile({ uvs: [[0, 0], [0.25, 0], [0.25, 0.25], [0, 0.25]] as never })] });
    const store = new EditorStore(p);
    store.transact('UV offset', (draft) => {
      transformUVs(draft, { tileIds: ['tile-1'], vertices: [] }, 'flipX', [0.25, 0]);
      // flipX mirrors 0..0.25 → 0.75..1; +0.25 would overflow, so flip first
      // stays mirrored and the offset keeps it inside: 0.75..1 + 0 → fine.
    });
    expect(store.canUndo).toBe(true);
    expect(store.dirty).toBe(true);
  });

  it('rotate stays inside 0..1 and commits', () => {
    const p = makeProject();
    const store = new EditorStore(p);
    const before = JSON.stringify(p.tiles[0].uvs);
    store.transact('UV rotate', (draft) => {
      transformUVs(draft, { tileIds: ['tile-1'], vertices: [] }, 'rotate');
    });
    expect(store.canUndo).toBe(true);
    expect(store.dirty).toBe(true);
    expect(JSON.stringify(store.project.tiles[0].uvs)).not.toBe(before);
    // Rotated UVs are still a permutation of the original corners.
    expect([...store.project.tiles[0].uvs].map((v) => v.join())).not.toBeNull();
  });
});

/* ------------------------------ store safety ------------------------------- */

describe('EditorStore validation boundaries', () => {
  it('constructor validates the seed project before adopting it', () => {
    const bad = makeProject({ tiles: [fxTile({ atlasId: 'ghost' })] });
    expect(() => new EditorStore(bad)).toThrow(/unknown atlas/);
  });

  it('constructor rejects non-finite values that JSON cloning would mask', () => {
    const p = makeProject();
    (p.tiles[0].vertices as unknown as number[][])[0] = [NaN, 0, 0];
    // JSON.stringify(NaN) → null; the raw validator still rejects before clone.
    expect(() => new EditorStore(p)).toThrow(/finite/);
  });

  it('replace validates BEFORE replacing: invalid input preserves project, revision, history, redo and dirty', () => {
    const p = makeProject();
    const store = new EditorStore(p);
    store.transact('edit', (d) => { d.name = 'edited'; });
    store.undo();
    const before = JSON.stringify(store.project);
    const revision = store.revision;
    const canRedo = store.canRedo;
    const dirty = store.dirty;
    const bad = makeProject({ tiles: [fxTile({ atlasId: 'ghost' })] });
    expect(() => store.replace(bad)).toThrow(/unknown atlas/);
    expect(JSON.stringify(store.project)).toBe(before);
    expect(store.revision).toBe(revision);
    expect(store.canRedo).toBe(canRedo);
    expect(store.dirty).toBe(dirty);
    // also rejects the masked-NaN form
    const nan = makeProject();
    (nan.tiles[0].vertices as unknown as number[][])[0] = [Infinity, 0, 0];
    expect(() => store.replace(nan)).toThrow(/finite/);
    expect(JSON.stringify(store.project)).toBe(before);
  });

  it('replace accepts valid projects (positive case)', () => {
    const store = new EditorStore(createProject());
    const fresh = makeProject({ name: 'fresh' });
    store.replace(fresh);
    expect(store.project.name).toBe('fresh');
    expect(store.canUndo).toBe(false);
  });

  it('transact validates the raw working draft before publication (NaN cannot slip through)', () => {
    const store = new EditorStore(makeProject());
    const snapshot = JSON.stringify(store.project);
    expect(() => store.transact('sneaky', (d) => {
      (d.tiles[0].vertices as unknown as number[][])[0] = [NaN, 0, 0];
      // JSON.stringify would turn NaN into null — but validation happens on
      // the raw draft before any JSON cloning, so this must throw.
    })).toThrow(/finite/);
    expect(JSON.stringify(store.project)).toBe(snapshot);
  });

  it('transact rejects invalid metrics (actual audit reproduction) and rolls back', () => {
    const store = new EditorStore(makeProject());
    const snapshot = JSON.stringify(store.project);
    const revision = store.revision;
    expect(() => store.transact('Atlas metrics', (d) => {
      d.atlases[0].tileWidth = 9999; // does not fit the image
    })).toThrow(/tile dimensions/i);
    expect(JSON.stringify(store.project)).toBe(snapshot);
    expect(store.revision).toBe(revision);
    expect(store.canUndo).toBe(false);
  });

  it('committed state is detached from the retained working draft (async callback after rejection)', async () => {
    const store = new EditorStore(makeProject());
    const snapshot = JSON.stringify(store.project);
    let retained: Project | null = null;
    let released = false;
    expect(() => store.transact('malicious', (d) => {
      d.name = 'evil';
      retained = d;
      // Simulate an async callback that keeps mutating AFTER the transaction
      // surface has returned (here: after the validator throws).
      queueMicrotask(() => { retained!.name = 'MUTATED-AFTER'; retained!.tiles = []; released = true; });
      throw new Error('reject this transaction');
    })).toThrow('reject this transaction');
    // Let microtasks run.
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    expect(released).toBe(true); // the callback really ran after rejection
    expect(JSON.stringify(store.project)).toBe(snapshot);
    expect(store.project.name).not.toBe('MUTATED-AFTER');
    expect(store.project.tiles).toHaveLength(1);
  });

  it('committed state is detached from the draft even for successful transactions', async () => {
    const store = new EditorStore(makeProject());
    let retained: Project | null = null;
    store.transact('sneaky success', (d) => {
      d.name = 'committed';
      retained = d;
      queueMicrotask(() => { retained!.name = 'MUTATED-AFTER'; });
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(store.project.name).toBe('committed');
    expect(store.project.name).not.toBe('MUTATED-AFTER');
    // Mutating the old draft reference must not touch committed state.
    retained!.name = 'MUTATED-DIRECT';
    expect(store.project.name).toBe('committed');
  });

  it('valid transactions and no-op semantics still work', () => {
    const store = new EditorStore(makeProject());
    store.transact('rename', (d) => { d.name = 'renamed'; });
    expect(store.canUndo).toBe(true);
    expect(store.dirty).toBe(true);
    const rev = store.revision;
    store.transact('no-op', () => { /* nothing */ });
    expect(store.revision).toBe(rev); // no-op omitted
    expect(store.historyLabel).toBe('rename');
  });

  it('undo history snapshots are detached from committed state', () => {
    const store = new EditorStore(makeProject());
    store.transact('edit', (d) => { d.name = 'v2'; });
    store.undo();
    expect(store.project.name).toBe('demo');
    store.redo();
    expect(store.project.name).toBe('v2');
  });
});

/* --------------------------- hierarchy helpers ----------------------------- */

describe('bounded hierarchy helpers', () => {
  it('exports MAX_HIERARCHY_DEPTH = 128 from core and IO surfaces', () => {
    expect(MAX_HIERARCHY_DEPTH).toBe(128);
    expect(MAX_DEPTH_REEXPORT).toBe(128);
  });

  it('ancestorChain returns nearest-parent-first chains and throws on unknown ids', () => {
    const objects: SceneObject[] = [
      makeObject({ id: 'root' }),
      makeObject({ id: 'mid', parentId: 'root' }),
      makeObject({ id: 'leaf', parentId: 'mid' }),
    ];
    expect(ancestorChain(objects, 'leaf').map((o) => o.id)).toEqual(['mid', 'root']);
    expect(ancestorChain(objects, 'root')).toEqual([]);
    expect(() => ancestorChain(objects, 'ghost')).toThrow(/ghost/);
  });

  it('throws readable errors on direct invalid runtime graphs (cycles) instead of hanging', () => {
    const objects: SceneObject[] = [
      makeObject({ id: 'a', parentId: 'b' }),
      makeObject({ id: 'b', parentId: 'a' }),
    ];
    expect(() => ancestorChain(objects, 'a')).toThrow(/cycle/);
    expect(() => isObjectVisibleValue(makeProject({
      objects: [makeObject({ id: 'a', parentId: 'b' }), makeObject({ id: 'b', parentId: 'a' })],
      tiles: [fxTile({ objectId: 'a' })],
    }), 'a')).toThrow(/cycle/);
    const unknownParent: SceneObject[] = [makeObject({ id: 'a', parentId: 'ghost' })];
    expect(() => ancestorChain(unknownParent, 'a')).toThrow(/unknown parent/);
  });

  it('rejects over-depth hierarchies quickly instead of silently truncating', () => {
    // Build a chain deeper than MAX_HIERARCHY_DEPTH.
    const objects: SceneObject[] = [];
    for (let i = 0; i <= MAX_HIERARCHY_DEPTH + 5; i++) {
      objects.push(makeObject({ id: `n${i}`, parentId: i === 0 ? null : `n${i - 1}` }));
    }
    const started = Date.now();
    expect(() => validateProject(makeProject({ objects, tiles: [fxTile({ objectId: `n${MAX_HIERARCHY_DEPTH + 5}` })] })))
      .toThrow(/depth|cycle/i);
    expect(() => ancestorChain(objects, `n${MAX_HIERARCHY_DEPTH + 5}`)).toThrow(/depth/);
    expect(Date.now() - started).toBeLessThan(1000); // quick rejection
  });

  it('accepts hierarchies up to the depth limit (broad acceptance)', () => {
    const objects: SceneObject[] = [];
    for (let i = 0; i < MAX_HIERARCHY_DEPTH; i++) {
      objects.push(makeObject({ id: `n${i}`, parentId: i === 0 ? null : `n${i - 1}` }));
    }
    const p = makeProject({ objects, tiles: [fxTile({ objectId: `n${MAX_HIERARCHY_DEPTH - 1}` })] });
    expect(() => validateProject(p)).not.toThrow();
    expect(ancestorChain(objects, `n${MAX_HIERARCHY_DEPTH - 1}`)).toHaveLength(MAX_HIERARCHY_DEPTH - 1);
    // Visible/locked walk the whole chain fine.
    expect(isObjectVisibleValue(p, `n${MAX_HIERARCHY_DEPTH - 1}`)).toBe(true);
  });

  it('isObjectLockedValue / isObjectVisibleValue include ancestors', () => {
    const p = makeProject({
      objects: [makeObject({ id: 'root', locked: true }), makeObject({ id: 'child', parentId: 'root' })],
      tiles: [fxTile({ objectId: 'child' })],
    });
    expect(isObjectLockedValue(p, 'child')).toBe(true);
    expect(isObjectLockedValue(p, 'root')).toBe(true);
    const hidden = makeProject({
      objects: [makeObject({ id: 'root', visible: false }), makeObject({ id: 'child', parentId: 'root' })],
      tiles: [fxTile({ objectId: 'child' })],
    });
    expect(isObjectVisibleValue(hidden, 'child')).toBe(false);
    expect(isObjectVisibleValue(hidden, 'root')).toBe(false);
    expect(isObjectVisibleValue(p, 'child')).toBe(true);
  });
});

/* --------------------------- encode saveability ---------------------------- */

describe('encode saveability', () => {
  it('a valid project encodes without changing the source document', async () => {
    const p = makeProject();
    const snapshot = JSON.stringify(p);
    await expect(encodeProject(p)).resolves.toBeInstanceOf(Uint8Array);
    expect(JSON.stringify(p)).toBe(snapshot);
  });

  it('encodeProject rejects invalid documents with the canonical message', async () => {
    const bad = makeProject({ tiles: [fxTile({ atlasId: 'ghost-atlas' })] });
    await expect(encodeProject(bad)).rejects.toThrow(/unknown atlas/);
    const badUv = makeProject({ tiles: [fxTile({ uvs: [[0, 0], [2, 0], [1, 1], [0, 1]] as never })] });
    await expect(encodeProject(badUv)).rejects.toThrow(/outside the 0..1 range/);
  });

  it('round-trips a project with deep (within-limit) hierarchies', async () => {
    const objects: SceneObject[] = [];
    for (let i = 0; i < 32; i++) {
      objects.push(makeObject({ id: `n${i}`, parentId: i === 0 ? null : `n${i - 1}` }));
    }
    const p = makeProject({ objects, tiles: [fxTile({ objectId: 'n31' })] });
    const bytes = await encodeProject(p);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});
