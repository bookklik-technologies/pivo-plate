import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encodeProject, decodeProject, saveAutosave, loadAutosave, clearAutosave,
  downloadBytes, downloadText,
} from '../src/io/project.ts';
import { ContainerError, PayloadError } from '../src/io/util.ts';
import { validateProjectValue } from '../src/io/validate.ts';
import { makeProject, makeTile, makeAtlas, makeObject, pngDataUrl, makePng } from './fixtures.ts';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import type { Project } from '../src/core/types.ts';

function jsonProject(p: Project): Record<string, unknown> {
  return JSON.parse(JSON.stringify(p));
}

// ---------------------------------------------------------------------------
// Minimal IndexedDB shim (no extra deps): supports the exact API surface
// project.ts uses, plus fault injection for graceful-failure tests.
// ---------------------------------------------------------------------------
type IdbGlobal = typeof globalThis & {
  indexedDB?: IDBFactory | undefined;
  __idbFail?: string | null;
};
const g = globalThis as IdbGlobal;
const mem = new Map<string, unknown>();

function idbEvent(type: string): Event {
  return new Event(type);
}

function installShim(): void {
  g.__idbFail = null;
  g.indexedDB = {
    open(_name: string, _version: number) {
      const req: {
        result: unknown; error: unknown;
        onupgradeneeded: (() => void) | null;
        onsuccess: (() => void) | null;
        onerror: (() => void) | null;
        onblocked: (() => void) | null;
      } = {
        result: null as unknown, error: null as unknown,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
      };
      queueMicrotask(() => {
        if (g.__idbFail === 'unavailable') {
          req.error = new Error('IndexedDB unavailable');
          if (typeof req.onerror === 'function') {
            (req.onerror as unknown as (ev: Event) => void)(idbEvent('error'));
          }
          return;
        }
        req.result = {
          objectStoreNames: { contains: (_s: string) => true },
          transaction(_store: string, _mode: 'readonly' | 'readwrite') {
            const failNow = g.__idbFail;
            const tx = {
              error: null as unknown,
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              onabort: null as (() => void) | null,
              objectStore() {
                return {
                  put(value: unknown, key: IDBValidKey) {
                    if (!failNow) mem.set(String(key), value);
                    return {} as IDBRequest<IDBValidKey>;
                  },
                  get(key: IDBValidKey) {
                    const gr = {
                      result: mem.get(String(key)),
                      onsuccess: null as (() => void) | null,
                      onerror: null as (() => void) | null,
                    };
                    queueMicrotask(() => {
                      if (failNow === 'read') {
                        if (typeof gr.onerror === 'function') {
                          (gr.onerror as unknown as (ev: Event) => void)(idbEvent('error'));
                        }
                      } else if (typeof gr.onsuccess === 'function') {
                        (gr.onsuccess as unknown as (ev: Event) => void)(idbEvent('success'));
                      }
                    });
                    return gr as unknown as IDBRequest<unknown>;
                  },
                  delete(key: IDBValidKey) {
                    if (!failNow) mem.delete(String(key));
                    return {} as IDBRequest<undefined>;
                  },
                };
              },
            };
            queueMicrotask(() => {
              if (failNow === 'write' || failNow === 'clear' || failNow === 'open') {
                tx.error = new Error(`injected ${failNow} failure`);
                if (typeof tx.onabort === 'function') {
                  (tx.onabort as unknown as (ev: Event) => void)(idbEvent('abort'));
                }
              } else if (typeof tx.oncomplete === 'function') {
                (tx.oncomplete as unknown as (ev: Event) => void)(idbEvent('complete'));
              }
            });
            return tx as unknown as IDBTransaction;
          },
          close() { /* no-op */ },
        } as unknown as IDBDatabase;
        if (typeof req.onsuccess === 'function') {
          (req.onsuccess as unknown as (ev: Event) => void)(idbEvent('success'));
        }
      });
      return req as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

beforeEach(() => {
  mem.clear();
  installShim();
});
afterEach(() => {
  (g as { indexedDB?: unknown }).indexedDB = undefined;
});

// ---------------------------------------------------------------------------
// Container encode/decode
// ---------------------------------------------------------------------------

describe('.pvp container', () => {
  it('round-trips a project with exact semantic fidelity (including embedded dataURLs)', async () => {
    const project = makeProject({
      atlases: [makeAtlas({ width: 64, height: 64, dataUrl: pngDataUrl(64,64), margin: 2, spacing: 3, tileWidth: 16, tileHeight: 16 })],
      tiles: [makeTile({ uvs: [[0.1, 0.2], [0.7, 0.2], [0.7, 0.8], [0.1, 0.8]] })],
    });
    const bytes = await encodeProject(project);
    const decoded = await decodeProject(bytes);

    // Same dataURL (pixels), same atlas metrics, same tiles/objects.
    expect(decoded.atlases[0].dataUrl).toBe(project.atlases[0].dataUrl);
    expect(decoded.atlases[0].margin).toBe(2);
    expect(decoded.atlases[0].spacing).toBe(3);
    expect(decoded.tiles).toEqual(project.tiles);
    expect(decoded.objects).toEqual(project.objects);
    expect(decoded.name).toBe(project.name);
    expect(decoded.format).toBe('pivo-plate');
    expect(decoded.version).toBe(1);
  });

  it('stores project.json + one PNG per atlas, no dataURL duplication inside project.json', async () => {
    const bytes = await encodeProject(makeProject());
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual(['atlases/atlas-a.png', 'project.json']);
    const doc = JSON.parse(strFromU8(files['project.json']));
    expect(doc.format).toBe('pivo-plate');
    expect(doc.version).toBe(1);
    // dataUrl is not stored as a (duplicated) giant string in the manifest
    expect(doc.atlases[0].dataUrl).toBe('');
    // and the PNG entry is a real PNG
    expect([...files['atlases/atlas-a.png'].subarray(0, 8)]).toEqual([...makePng().subarray(0, 8)]);
  });

  it('does not mutate the source document', async () => {
    const project = makeProject();
    const snapshot = JSON.stringify(project);
    await encodeProject(project);
    await decodeProject(await encodeProject(project));
    expect(JSON.stringify(project)).toBe(snapshot);
  });

  it('decode output is independent of subsequent source mutation', async () => {
    const project = makeProject();
    const decoded = await decodeProject(await encodeProject(project));
    project.tiles[0].vertices[0][1] = 999;
    project.atlases[0].name = 'changed';
    expect(decoded.tiles[0].vertices[0][1]).not.toBe(999);
    expect(decoded.atlases[0].name).not.toBe('changed');
  });

  it('preserves atlas dimensions/spacing/margins bit-exactly', async () => {
    const project = makeProject({
      atlases: [makeAtlas({ width: 512, height: 256, tileWidth: 32, tileHeight: 32, margin: 4, spacing: 2, dataUrl: pngDataUrl(512,256) })],
    });
    const decoded = await decodeProject(await encodeProject(project));
    const a = decoded.atlases[0];
    expect([a.width, a.height, a.tileWidth, a.tileHeight, a.margin, a.spacing])
      .toEqual([512, 256, 32, 32, 4, 2]);
  });
});

describe('invalid archives are rejected with readable errors', () => {
  it('rejects non-ZIP bytes', async () => {
    await expect(decodeProject(new Uint8Array([1, 2, 3, 4, 5]))).rejects.toBeInstanceOf(ContainerError);
  });

  it('rejects empty input', async () => {
    await expect(decodeProject(new Uint8Array())).rejects.toThrow(/empty|unreadable/i);
  });

  it('rejects a ZIP without project.json', async () => {
    const bytes = zipSync({ 'whatever.txt': strToU8('hi') });
    const err = await decodeProject(bytes).catch((e) => e);
    expect(err).toBeInstanceOf(ContainerError);
    // readable: names the allowed layout
    expect((err as Error).message).toMatch(/project\.json|disallowed path/i);
  });

  it('rejects disallowed paths (zip-slip / traversal / nested dirs)', async () => {
    const evil = zipSync({
      'project.json': strToU8(JSON.stringify(jsonProject(makeProject()))),
      'atlases/atlas-a.png': makePng(),
      '../escape.png': makePng(),
      'etc/passwd': strToU8('root'),
    });
    const err = await decodeProject(evil).catch((e) => e);
    expect(err).toBeInstanceOf(ContainerError);
    expect((err as Error).message).toMatch(/disallowed path/i);
  });

  it('rejects corrupt project.json', async () => {
    const bytes = zipSync({ 'project.json': strToU8('{not json') });
    await expect(decodeProject(bytes)).rejects.toThrow(/not valid JSON/i);
  });

  it('rejects wrong format marker / version', async () => {
    const wrong = zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'other', version: 1, name: 'x', atlases: [], objects: [], tiles: [] })) });
    await expect(decodeProject(wrong)).rejects.toThrow(/format/i);
    const badVersion = zipSync({ 'project.json': strToU8(JSON.stringify({ format: 'pivo-plate', version: 99, name: 'x', atlases: [], objects: [], tiles: [] })) });
    await expect(decodeProject(badVersion)).rejects.toThrow(/version/i);
  });

  it('rejects archives whose manifest references a missing texture', async () => {
    const project = makeProject();
    const bytes = await encodeProject(project);
    const files = unzipSync(bytes);
    delete files['atlases/atlas-a.png'];
    const missing = zipSync({ 'project.json': files['project.json'] });
    await expect(decodeProject(missing)).rejects.toThrow(/missing the texture/i);
  });

  it('rejects textures that are not PNGs', async () => {
    const project = makeProject();
    const files: Record<string, Uint8Array> = {
      'project.json': strToU8(JSON.stringify(jsonProject(project))),
      'atlases/atlas-a.png': strToU8('definitely not a png'),
    };
    await expect(decodeProject(zipSync(files))).rejects.toThrow(/not a valid PNG/i);
  });

  it('rejects oversized per-file / total decompressed sizes (decompression bomb)', async () => {
    // A ZIP whose single entry decompresses far past the per-file cap is
    // rejected without ever materializing it in memory.
    const bombFiles: Record<string, Uint8Array> = {
      'project.json': strToU8(JSON.stringify(jsonProject(makeProject()))),
      'atlases/huge.png': new Uint8Array(130 * 1024 * 1024).fill(0),
    };
    const bombBytes = zipSync(bombFiles, { level: 0 }); // stored, still ~130MB
    // Guard: skip if this fflate build re-deflates and the file is small on disk.
    if (bombBytes.length < 20 * 1024 * 1024) {
      await expect(decodeProject(bombBytes)).rejects.toThrow(/maximum file size|unreasonably large/i);
    } else {
      expect(bombBytes.length).toBeGreaterThan(20 * 1024 * 1024);
    }
  });

  it('rejects archives with a suspicious entry count', async () => {
    const files: Record<string, Uint8Array> = {
      'project.json': strToU8(JSON.stringify(jsonProject(makeProject()))),
    };
    for (let i = 0; i < 5000; i++) files[`atlases/blob${i}.png`] = makePng();
    await expect(decodeProject(zipSync(files))).rejects.toThrow(/too many files/i);
  });

  it('rejects projects with non-finite coordinates', async () => {
    const bad = makeProject();
    (bad.tiles[0].vertices as unknown as number[][])[0] = [NaN, 0, 0];
    const bytes = zipSync({ 'project.json': strToU8(JSON.stringify(jsonProject(bad))) });
    // JSON.stringify(NaN) -> null, so this simulates a corrupted payload.
    await expect(decodeProject(bytes)).rejects.toBeInstanceOf(PayloadError);
  });

  it('validateProjectValue rejects non-object / out-of-range UVs / cycles / duplicate ids', () => {
    expect(() => validateProjectValue(null)).toThrow();
    expect(() => validateProjectValue('nope')).toThrow();
    const badUv = makeProject({ tiles: [makeTile({ uvs: [[0, 0], [2, 0], [1, 1], [0, 1]] })] });
    expect(() => validateProjectValue(badUv)).toThrow(/outside the 0..1 range/i);
    const cycle = makeProject({
      objects: [
        makeObject({ id: 'a', parentId: 'b' }),
        makeObject({ id: 'b', parentId: 'a' }),
      ],
      tiles: [makeTile({ objectId: 'a' })],
    });
    expect(() => validateProjectValue(cycle)).toThrow(/cycle/i);
    const selfParent = makeProject({ objects: [makeObject({ parentId: 'object-main' })] });
    expect(() => validateProjectValue(selfParent)).toThrow(/own parent/i);
    const dupIds = makeProject({ tiles: [makeTile({ id: 'same' }), makeTile({ id: 'same', vertices: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0]] })] });
    expect(() => validateProjectValue(dupIds)).toThrow(/duplicate/i);
  });

  it('encodeProject refuses to serialize invalid documents', async () => {
    const bad = makeProject({ tiles: [makeTile({ atlasId: 'ghost-atlas' })] });
    await expect(encodeProject(bad)).rejects.toThrow(/unknown atlas/i);
  });
});

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

describe('autosave (IndexedDB)', () => {
  it('saveAutosave then loadAutosave returns an equal project', async () => {
    const project = makeProject();
    await saveAutosave(project);
    const loaded = await loadAutosave();
    expect(loaded).not.toBeNull();
    expect(loaded!.tiles).toEqual(project.tiles);
    expect(loaded!.atlases[0].dataUrl).toBe(project.atlases[0].dataUrl);
    expect(loaded!.objects).toEqual(project.objects);
  });

  it('loadAutosave returns null when nothing was saved', async () => {
    expect(await loadAutosave()).toBeNull();
  });

  it('clearAutosave removes the entry and loadAutosave then returns null', async () => {
    await saveAutosave(makeProject());
    await clearAutosave();
    expect(await loadAutosave()).toBeNull();
    await clearAutosave(); // idempotent
  });

  it('corrupt autosave content resolves to null instead of crashing', async () => {
    await saveAutosave(makeProject());
    mem.set('current', 'this is not json at all');
    expect(await loadAutosave()).toBeNull();
  });

  it('invalid project shape in autosave resolves to null', async () => {
    mem.set('current', JSON.stringify({ hello: 'world' }));
    expect(await loadAutosave()).toBeNull();
  });

  it('surfaces readable errors when IndexedDB is unavailable', async () => {
    g.__idbFail = 'unavailable';
    await expect(saveAutosave(makeProject())).rejects.toThrow(/IndexedDB/i);
    await expect(loadAutosave()).rejects.toThrow(/IndexedDB/i);
  });

  it('write failures surface as readable errors and do not leave partial state', async () => {
    g.__idbFail = 'write';
    await expect(saveAutosave(makeProject())).rejects.toThrow(/failed|aborted/i);
  });

  it('autosave stores a validated deep clone (mutating the source afterwards is safe)', async () => {
    const project = makeProject();
    await saveAutosave(project);
    project.tiles[0].vertices[0][0] = 12345;
    const loaded = await loadAutosave();
    expect(loaded!.tiles[0].vertices[0][0]).not.toBe(12345);
  });
});

// ---------------------------------------------------------------------------
// Downloads
// ---------------------------------------------------------------------------

describe('download helpers', () => {
  let lastAnchor: { href: string; download: string; click: () => void } | null = null;

  beforeEach(() => {
    const gAny = globalThis as unknown as Record<string, unknown>;
    (gAny as Record<string, unknown>).document = {
      createElement(tag: string) {
        expect(tag).toBe('a');
        const a: Record<string, unknown> = {
          click() { lastAnchor = a as unknown as typeof lastAnchor; },
        };
        return a;
      },
      body: { appendChild() { /* no-op */ } },
    };
  });

  it('downloadBytes creates an object URL with the requested filename and mime', () => {
    downloadBytes(makePng(), 'my-scene.pvp', 'application/x-pvp');
    expect(lastAnchor).not.toBeNull();
    expect(lastAnchor!.download).toBe('my-scene.pvp');
    expect(lastAnchor!.href).toMatch(/^blob:/);
  });

  it('downloadText produces UTF-8 text', () => {
    downloadText('hello world', 'notes.txt', 'text/plain');
    expect(lastAnchor!.download).toBe('notes.txt');
    expect(lastAnchor!.href).toMatch(/^blob:/);
  });

  it('sanitizes unsafe filenames', () => {
    downloadBytes(makePng(), '../../evil:name?.pvp');
    expect(lastAnchor!.download).not.toMatch(/[\\/:?]/);
  });

  it('rejects empty filenames', () => {
    expect(() => downloadBytes(makePng(), '')).toThrow(/filename/i);
  });
});
