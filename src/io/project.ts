// Public IO contract (docs/CONTRACTS.md):
//   encodeProject(project) -> Promise<Uint8Array>   .pvp ZIP container
//   decodeProject(bytes)   -> Promise<Project>
//   saveAutosave / loadAutosave / clearAutosave     IndexedDB autosave
//   downloadBytes / downloadText                    portable browser downloads
// IO may import core editor for validation and visibility; until core/editor.ts
// lands, contract-identical local helpers from ./validate.ts are used.
import type { Project } from '../core/types.ts';
import {
  buildContainer, openContainer, dataUrlToBytes, bytesToDataUrl,
  PayloadError, StorageError, deepJsonEqual,
} from './util.ts';
import { validateProjectValue } from './validate.ts';

export { ProjectIOError, ContainerError, PayloadError, StorageError } from './util.ts';

// ---------------------------------------------------------------------------
// .pvp container
// ---------------------------------------------------------------------------

/**
 * Encode a project into a versioned .pvp archive:
 *   project.json          — the Project document (format/version/name/…)
 *   atlases/<id>.png      — each atlas texture as a real PNG
 * Atlas.dataUrl is not stored redundantly; decodeProject restores it from the
 * extracted PNG bytes, preserving pixel-exact atlas data.
 */
export async function encodeProject(project: Project): Promise<Uint8Array> {
  // Validate + deep clone first: never serialize an invalid document, and the
  // clone is the only thing this function may touch (no source mutation).
  const safe = validateProjectValue(project);
  const textures = [];
  for (const atlas of safe.atlases) {
    const { bytes } = dataUrlToBytes(atlas.dataUrl);
    textures.push({ path: `atlases/${atlas.id}.png`, bytes });
  }
  // Build the stored document without embedded dataURLs (bytes live as entries).
  const stored = {
    ...safe,
    atlases: safe.atlases.map((a) => ({ ...a, dataUrl: '' })),
  };
  const json = JSON.stringify(stored, null, 2);
  return buildContainer(json, textures);
}

/**
 * Decode a .pvp archive into a validated Project. Throws
 * ContainerError / PayloadError with readable messages for invalid archives.
 * On success the returned Project is fully independent of the input bytes.
 */
export async function decodeProject(bytes: Uint8Array): Promise<Project> {
  const { projectJson, textures } = openContainer(bytes);
  let parsed: unknown;
  try {
    parsed = JSON.parse(projectJson);
  } catch (err) {
    throw new PayloadError(
      `project.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new PayloadError('project.json must contain a JSON object');
  }
  const doc = parsed as Record<string, unknown>;
  if (!Array.isArray(doc.atlases)) {
    throw new PayloadError('project.json must contain an atlases array');
  }
  // Restore each atlas's embedded dataURL from its PNG entry in the archive.
  const withTextures = {
    ...doc,
    atlases: doc.atlases.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object') return raw;
      const a = raw as Record<string, unknown>;
      if (typeof a.id !== 'string') return raw;
      const png = textures.get(a.id);
      if (!png) {
        throw new PayloadError(`Project archive is missing the texture for atlas "${a.id}"`);
      }
      return { ...a, dataUrl: bytesToDataUrl(png, 'image/png') };
    }),
  };
  // validateProjectValue deep clones, so nothing aliases the parsed JSON.
  return validateProjectValue(withTextures);
}

// ---------------------------------------------------------------------------
// Autosave (IndexedDB)
// ---------------------------------------------------------------------------

const DB_NAME = 'pivo-plate';
const DB_VERSION = 1;
const STORE = 'autosave';
const KEY = 'current';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new StorageError('IndexedDB is not available in this environment'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new StorageError(`Could not open autosave storage: ${String(req.error?.message ?? req.error)}`));
    req.onblocked = () => reject(new StorageError('Autosave storage is blocked by another open tab'));
  });
}

/** Resolve when a transaction completes; reject on its error/abort. */
function transactionDone(tx: IDBTransaction, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new StorageError(`Autosave ${what} failed: ${String(tx.error?.message ?? tx.error)}`));
    tx.onabort = () => reject(new StorageError(`Autosave ${what} was aborted: ${String(tx.error?.message ?? tx.error)}`));
  });
}

/** Persist the project into IndexedDB (validated, deep-cloned, JSON-encoded). */
export async function saveAutosave(project: Project): Promise<void> {
  const safe = validateProjectValue(project);
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (err) {
    // Autosave is best-effort: surface a readable error, never corrupt state.
    throw err instanceof StorageError ? err : new StorageError(String(err));
  }
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(JSON.stringify(safe), KEY);
    await transactionDone(tx, 'write');
  } finally {
    db.close();
  }
}

export type RecoveryRecord =
  | {status:'empty';raw:null}
  | {status:'valid';raw:string;project:Project}
  | {status:'invalid';raw:string;error:string};
const PROTECTED_KEY = 'pending-recovery';

function rawRecovery(value:unknown):string {
  if(typeof value==='string') return value;
  try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
}

/** Atomically reserve the startup recovery copy in its own durable slot.
 * Other current-slot writes cannot overwrite an unresolved recovery prompt. */
export async function inspectAutosave():Promise<RecoveryRecord> {
  const db=await openDb();
  try {
    const tx=db.transaction(STORE,'readwrite'), done=transactionDone(tx,'protect');
    const os=tx.objectStore(STORE);
    const valuePromise=new Promise<unknown>((resolve,reject)=>{
      const pending=os.get(PROTECTED_KEY);
      pending.onerror=()=>reject(new StorageError('Recovery read failed'));
      pending.onsuccess=()=>{
        if(pending.result!==undefined && pending.result!==null) {resolve(pending.result);return;}
        const current=os.get(KEY);
        current.onerror=()=>reject(new StorageError('Recovery read failed'));
        current.onsuccess=()=>{
          const value=current.result;
          if(value!==undefined && value!==null) os.put(value,PROTECTED_KEY);
          resolve(value);
        };
      };
    });
    const [value]=await Promise.all([valuePromise,done]);
    if(value===undefined||value===null) return {status:'empty',raw:null};
    const raw=rawRecovery(value);
    try { if(raw.length>128*1024*1024)throw new PayloadError('Recovery JSON exceeds input budget');return {status:'valid',raw,project:validateProjectValue(typeof value==='string'?JSON.parse(value):value)}; }
    catch(error) {return {status:'invalid',raw,error:error instanceof Error?error.message:String(error)};}
  } finally {db.close();}
}

/** Resolve ONLY the protected copy the user saw. Do not delete a newer
 * current-slot snapshot written by another tab. A stale decision rejects. */
export async function resolveRecovery(expectedRaw:string,discard=false):Promise<void> {
  const db=await openDb();
  try {
    const tx=db.transaction(STORE,'readwrite'),done=transactionDone(tx,'resolve');
    const os=tx.objectStore(STORE);
    let reason:StorageError|null=null;
    const decision=new Promise<void>((resolve,reject)=>{
      const pending=os.get(PROTECTED_KEY);
      pending.onerror=()=>reject(new StorageError('Recovery read failed'));
      pending.onsuccess=()=>{
        if(pending.result===undefined||rawRecovery(pending.result)!==expectedRaw) {
          reason=new StorageError('Recovery copy changed in another tab; reload before resolving it');
          tx.abort(); reject(reason); return;
        }
        const current=os.get(KEY);
        current.onerror=()=>reject(new StorageError('Recovery read failed'));
        current.onsuccess=()=>{
          os.delete(PROTECTED_KEY);
          if(discard && current.result!==undefined && rawRecovery(current.result)===expectedRaw) os.delete(KEY);
          resolve();
        };
      };
    });
    try {await Promise.all([decision,done]);} catch(error) {throw reason??error;}
  } finally {db.close();}
}

/**
 * Load the autosaved project, or null when none exists. Graceful: a missing
 * entry resolves to null; corrupt/invalid autosaves also resolve to null
 * (callers can clearAutosave after) rather than crashing the editor.
 */
export async function loadAutosave(): Promise<Project | null> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (err) {
    throw err instanceof StorageError ? err : new StorageError(String(err));
  }
  try {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    const value = await new Promise<unknown>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(new StorageError(`Autosave read failed: ${String(req.error?.message ?? req.error)}`));
    });
    if (value === undefined || value === null) return null;
    try {
      if(typeof value==='string'&&value.length>128*1024*1024)throw new PayloadError('Recovery JSON exceeds input budget');
      return validateProjectValue(typeof value === 'string' ? JSON.parse(value) : value);
    } catch {
      // Corrupt or stale autosave: treat as absent so the editor can recover.
      return null;
    }
  } finally {
    db.close();
  }
}

/** Remove the autosave entry. Safe to call when none exists. */
export async function clearAutosave(): Promise<void> {
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (err) {
    throw err instanceof StorageError ? err : new StorageError(String(err));
  }
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    await transactionDone(tx, 'clear');
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Portable downloads
// ---------------------------------------------------------------------------

/** Trigger a browser download of raw bytes. Works in DOM environments. */
export function downloadBytes(bytes: Uint8Array, filename: string, mime = 'application/octet-stream'): void {
  if (!filename || typeof filename !== 'string') {
    throw new PayloadError('A filename is required to download a file');
  }
  const safeName = filename.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  const blob = new Blob([ab], { type: mime });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove?.();
  } finally {
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

/** Trigger a browser download of UTF-8 text. */
export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  downloadBytes(new TextEncoder().encode(text), filename, `${mime};charset=utf-8`);
}

// Re-exported for convenience in tests / UI.
export { deepJsonEqual };
