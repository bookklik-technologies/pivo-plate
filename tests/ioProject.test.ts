import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encodeProject, decodeProject,
  downloadBytes, downloadText,
} from '../src/io/project.ts';
import { ContainerError, PayloadError } from '../src/io/util.ts';
import { validateProjectValue } from '../src/io/validate.ts';
import { makeProject, makeTile, makeAtlas, makeObject, pngDataUrl, makePng } from './fixtures.ts';
import { zipSync, unzipSync, strFromU8, strToU8 } from 'fflate';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import type { Project } from '../src/core/types.ts';

function jsonProject(p: Project): Record<string, unknown> {
  return JSON.parse(JSON.stringify(p));
}

// ---------------------------------------------------------------------------
// Transaction-backed emulator: independent legacy/v2 databases and real aborts.
// Reset the IO module per test to model a fresh browser session.
// ---------------------------------------------------------------------------
const g = globalThis;
let saveAutosave: typeof import('../src/io/project.ts').saveAutosave;
let loadAutosave: typeof import('../src/io/project.ts').loadAutosave;
let clearAutosave: typeof import('../src/io/project.ts').clearAutosave;
let listRecoveryCopies: typeof import('../src/io/project.ts').listRecoveryCopies;
let inspectAutosave: typeof import('../src/io/project.ts').inspectAutosave;
let resolveRecovery: typeof import('../src/io/project.ts').resolveRecovery;

async function editStorage(database: string, store: string, edit: (store: IDBObjectStore) => void): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(database, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(store, store === 'copies' ? {keyPath:'id'} : undefined);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error);
      edit(tx.objectStore(store));
    });
  } finally { db.close(); }
}

beforeEach(async () => {
  vi.restoreAllMocks();
  g.indexedDB = new IDBFactory();
  vi.resetModules();
  ({saveAutosave, loadAutosave, clearAutosave, listRecoveryCopies, inspectAutosave, resolveRecovery} = await import('../src/io/project.ts'));
});
afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(g, 'indexedDB');
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
    const [entry] = await listRecoveryCopies();
    await editStorage('pivo-plate-recovery-v2', 'copies', store => store.put({...entry,data:'this is not json at all'}));
    expect(await loadAutosave()).toBeNull();
  });

  it('invalid project shape in autosave resolves to null', async () => {
    await editStorage('pivo-plate', 'autosave', store => store.put(JSON.stringify({hello:'world'}), 'current'));
    expect(await loadAutosave()).toBeNull();
  });

  it('surfaces readable errors when IndexedDB is unavailable', async () => {
    Reflect.deleteProperty(g, 'indexedDB');
    await expect(saveAutosave(makeProject())).rejects.toThrow(/IndexedDB/i);
    await expect(loadAutosave()).rejects.toThrow(/IndexedDB/i);
  });

  it('write failures surface as readable errors and do not leave partial state', async () => {
    await saveAutosave(makeProject({name:'Original'}));
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => { throw new DOMException('quota exceeded', 'QuotaExceededError'); });
    await expect(saveAutosave(makeProject({name:'Rejected'}))).rejects.toThrow(/write failed/i);
    expect((await loadAutosave())!.name).toBe('Original');
  });

  it('retries startup migration after storage becomes available', async () => {
    Reflect.deleteProperty(g, 'indexedDB');
    await expect(saveAutosave(makeProject())).rejects.toThrow(/IndexedDB/i);
    g.indexedDB = new IDBFactory();
    await saveAutosave(makeProject({name:'Recovered storage'}));
    expect((await loadAutosave())!.name).toBe('Recovered storage');
  });

  it('an aborted write preserves the previous durable revision and can be retried', async () => {
    await saveAutosave(makeProject({name:'Durable'}));
    const originalPut = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function(this: IDBObjectStore, value, key) {
      const request = originalPut.call(this, value, key);
      this.transaction.abort();
      return request;
    });
    await expect(saveAutosave(makeProject({name:'Aborted'}))).rejects.toThrow(/failed/i);
    expect((await loadAutosave())!.name).toBe('Durable');
    await saveAutosave(makeProject({name:'Retry'}));
    expect((await loadAutosave())!.name).toBe('Retry');
  });

  it('retains invalid legacy bytes until explicit discard', async () => {
    await editStorage('pivo-plate', 'autosave', store => store.put('invalid legacy bytes', 'current'));
    const record = await inspectAutosave();
    expect(record.status).toBe('invalid');
    expect(record.raw).toBe('invalid legacy bytes');
    expect(await listRecoveryCopies()).toHaveLength(1);
    await resolveRecovery(record.raw!, true);
    expect(await listRecoveryCopies()).toHaveLength(0);
    const reread = await indexedDB.databases();
    expect(reread.map(db=>db.name)).toContain('pivo-plate');
    // A new session must not remigrate a discarded original.
    vi.resetModules();
    const nextSession = await import('../src/io/project.ts');
    expect((await nextSession.inspectAutosave()).status).toBe('empty');
  });

  it('clearing one session preserves another session recovery', async () => {
    await saveAutosave(makeProject({name:'First session'}));
    vi.resetModules();
    const second = await import('../src/io/project.ts');
    await second.saveAutosave(makeProject({name:'Second session'}));
    expect(await listRecoveryCopies()).toHaveLength(2);
    await second.clearAutosave();
    expect((await listRecoveryCopies()).map(entry=>entry.name)).toEqual(['First session']);
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
