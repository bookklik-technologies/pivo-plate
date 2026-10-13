import { RecoveryStore, type RecoveryEntry } from '../ui/suite-recovery';
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
    let blocked = false;
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (blocked) { db.close(); return; }
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(new StorageError(`Could not open autosave storage: ${String(req.error?.message ?? req.error)}`));
    req.onblocked = () => { blocked = true; reject(new StorageError('Autosave storage is blocked by another open tab')); };
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

const recoveryStore=new RecoveryStore('pivo-plate-recovery-v2');
let initialization:Promise<void>|null=null;
let pendingEntry:RecoveryEntry|null=null;
async function migrateRecovery():Promise<void>{
 if(initialization)return initialization;
 initialization=(async()=>{
  const db=await openDb();
  try {
   const tx=db.transaction(STORE,'readonly'),done=transactionDone(tx,'migration read');
   const read=(key:string)=>new Promise<unknown>((resolve,reject)=>{const request=tx.objectStore(STORE).get(key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
   const [current,pending]=await Promise.all([read(KEY),read('pending-recovery'),done]);
   if(pending!==undefined&&pending!==null)await recoveryStore.importLegacy('pending-recovery','Previous Plate recovery',rawRecovery(pending));
   if(current!==undefined&&current!==null&&rawRecovery(current)!==rawRecovery(pending))await recoveryStore.importLegacy(KEY,'Previous Plate session',rawRecovery(current));
  }finally{db.close();}
 })().catch(error=>{initialization=null;throw error;});
 return initialization;
}
function rawRecovery(value:unknown):string {
 if(typeof value==='string')return value;
 try{return JSON.stringify(value)??String(value);}catch{return String(value);}
}
export async function saveAutosave(project:Project):Promise<void>{
 const safe=validateProjectValue(project);
 try {
  await migrateRecovery();
  await recoveryStore.save('document',safe.name,JSON.stringify(safe));
 } catch(error) { throw new StorageError(`Recovery write failed: ${error instanceof Error?error.message:String(error)}`); }
}
export type RecoveryRecord=
 | {status:'empty';raw:null}
 | {status:'valid';raw:string;project:Project;entry:RecoveryEntry}
 | {status:'invalid';raw:string;error:string;entry:RecoveryEntry};
export async function listRecoveryCopies(includeCurrent=true):Promise<RecoveryEntry[]>{
 try {
  await migrateRecovery();const entries=await recoveryStore.list();
  return includeCurrent?entries:entries.filter(entry=>entry.id!==`${recoveryStore.session}:document`);
 } catch(error) { throw new StorageError(`Recovery read failed: ${error instanceof Error?error.message:String(error)}`); }
}
export function recoveryRecord(entry:RecoveryEntry):RecoveryRecord {
 const raw=typeof entry.data==='string'?entry.data:rawRecovery(entry.data);
 try{if(raw.length>128*1024*1024)throw new PayloadError('Recovery exceeds input budget');return {status:'valid',raw,project:validateProjectValue(JSON.parse(raw)),entry};}
 catch(error){return {status:'invalid',raw,error:String(error),entry};}
}
export async function inspectAutosave(includeCurrent=false):Promise<RecoveryRecord>{
 const entries=await listRecoveryCopies(includeCurrent);pendingEntry=entries[0]??null;
 return pendingEntry?recoveryRecord(pendingEntry):{status:'empty',raw:null};
}
export function selectRecovery(entry:RecoveryEntry):RecoveryRecord{pendingEntry=entry;return recoveryRecord(entry);}
export async function resolveRecovery(expectedRaw:string,discard=false):Promise<void>{
 const entry=pendingEntry;
 if(!entry||rawRecovery(entry.data)!==expectedRaw)throw new StorageError('Recovery selection changed; reopen Recovery.');
 if(!discard){const record=recoveryRecord(entry);if(record.status!=='valid')throw new PayloadError('Invalid recovery cannot be restored');await saveAutosave(record.project);}
 if(entry.legacyKey){const db=await openDb();try{
  const tx=db.transaction(STORE,'readwrite'),done=transactionDone(tx,'resolve legacy');const os=tx.objectStore(STORE),request=os.get(entry.legacyKey);
  request.onsuccess=()=>{
   if(request.result!==undefined&&rawRecovery(request.result)===expectedRaw)os.delete(entry.legacyKey!);
   if(entry.legacyKey==='pending-recovery'){
    const current=os.get(KEY);current.onsuccess=()=>{if(current.result!==undefined&&rawRecovery(current.result)===expectedRaw)os.delete(KEY);};
   }
  };
  await done;
 }finally{db.close();}}
 await recoveryStore.discard(entry);pendingEntry=null;
}
export async function loadAutosave():Promise<Project|null>{
 const entries=await listRecoveryCopies();const current=entries.find(entry=>entry.id===`${recoveryStore.session}:document`)??entries[0];
 if(!current)return null;const record=recoveryRecord(current);return record.status==='valid'?record.project:null;
}
/** Explicitly clear only this session's current copy; other sessions survive. */
export async function clearAutosave():Promise<void>{
 const entry=(await listRecoveryCopies()).find(entry=>entry.id===`${recoveryStore.session}:document`);if(entry)await recoveryStore.discard(entry);
}
export async function flushRecoveryStorage():Promise<void>{await recoveryStore.flush();}

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
