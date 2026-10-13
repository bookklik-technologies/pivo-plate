/** Versioned, per-session recovery. Old copies are removed only by an explicit decision. */
export interface RecoveryEntry {
  id: string;
  version: 1;
  at: number;
  name: string;
  data: string | Uint8Array;
  legacyKey?: string;
}

export class RecoveryStore {
  readonly session = crypto.randomUUID();
  private queue: Promise<void> = Promise.resolve();
  constructor(private database: string) {}

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let cancelled=false;
      const request = indexedDB.open(this.database, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('copies', { keyPath: 'id' });
      request.onerror = () => reject(request.error ?? new Error('Recovery storage unavailable'));
      request.onblocked = () => { cancelled=true;reject(new Error('Recovery storage blocked by another tab')); };
      request.onsuccess = () => {
        const db = request.result;
        if(cancelled){db.close();return;}
        db.onversionchange = () => db.close();
        resolve(db);
      };
    });
  }

  private async transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore, result: (value: T) => void) => void): Promise<T> {
    const db = await this.open();
    try {
      return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction('copies', mode);
        let value!: T;
        tx.oncomplete = () => resolve(value);
        tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Recovery transaction failed'));
        try { run(tx.objectStore('copies'), next => { value = next; }); }
        catch (error) { tx.abort(); reject(error); }
      });
    } finally { db.close(); }
  }

  async list(): Promise<RecoveryEntry[]> {
    await this.queue.catch(()=>{});
    return this.transaction('readonly', (store, result) => {
      const request = store.getAll();
      request.onsuccess = () => result((request.result as RecoveryEntry[]).sort((a, b) => b.at - a.at));
    });
  }

  save(documentId: string, name: string, data: string | Uint8Array): Promise<void> {
    const entry: RecoveryEntry = { id: `${this.session}:${documentId}`, version: 1, at: Date.now(), name, data: typeof data === 'string' ? data : new Uint8Array(data) };
    const operation = this.queue.catch(() => {}).then(() => this.transaction<void>('readwrite', store => { store.put(entry); }));
    this.queue = operation;
    return operation;
  }

  /** Stable migration ID prevents repeated startup imports. Never overwrite an existing copy. */
  async importLegacy(key: string, name: string, data: string | Uint8Array, at = Date.now()): Promise<void> {
    const bytes=typeof data==='string'?new TextEncoder().encode(data):new Uint8Array(data);
    const digest=await crypto.subtle.digest('SHA-256',bytes);
    const fingerprint=[...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
    await this.transaction<void>('readwrite', store => {
      const id = `legacy:${key}:${fingerprint}`;
      const request = store.get(id);
      request.onsuccess = () => {
        try { if (!request.result) store.put({ id, version: 1, name, data, at, legacyKey: key } satisfies RecoveryEntry); }
        catch { request.transaction!.abort(); }
      };
    });
  }

  /** Compare inside the deletion transaction; never discard a newer copy. */
  async discard(entry: RecoveryEntry): Promise<void> {
    await this.queue.catch(() => {});
    await this.transaction<void>('readwrite', store => {
      const request = store.get(entry.id);
      request.onsuccess = () => {
        const current = request.result as RecoveryEntry | undefined;
        const same = current && current.at === entry.at && sameData(current.data, entry.data);
        if (!same) { request.transaction!.abort(); return; }
        store.delete(entry.id);
      };
    });
  }

  async flush(): Promise<void> { await this.queue; }
}

function sameData(a: string | Uint8Array, b: string | Uint8Array): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((value, index) => value === b[index]);
}
