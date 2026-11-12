/**
 * MediaBlobStore — binary asset persistence for the editor.
 *
 * Large media files are stored as Blobs in IndexedDB (structured cloning), never as
 * base64 strings inside project JSON. If IndexedDB is unavailable (private mode,
 * disabled storage, test sandboxes) the store transparently degrades to an in-memory
 * map so the session still works, and callers are told via `isPersistent`.
 */

const DB_NAME = 'cinecorte-media-store';
const DB_VERSION = 1;
const BLOB_STORE = 'blobs';

export interface MediaStoreStats {
  count: number;
  totalBytes: number;
  persistent: boolean;
}

export class MediaBlobStore {
  private memory = new Map<string, Blob>();
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private persistent = true;

  /** Whether blobs survive a page reload in this environment. */
  get isPersistent(): boolean {
    return this.persistent;
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;
    this.dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') {
          this.persistent = false;
          resolve(null);
          return;
        }
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(BLOB_STORE)) {
            db.createObjectStore(BLOB_STORE);
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => {
          this.persistent = false;
          resolve(null);
        };
        request.onblocked = () => {
          this.persistent = false;
          resolve(null);
        };
      } catch {
        this.persistent = false;
        resolve(null);
      }
    });
    return this.dbPromise;
  }

  async put(key: string, blob: Blob): Promise<void> {
    if (!key) return;
    this.memory.set(key, blob);
    const db = await this.openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(BLOB_STORE, 'readwrite');
        tx.objectStore(BLOB_STORE).put(blob, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async get(key: string): Promise<Blob | null> {
    const cached = this.memory.get(key);
    if (cached) return cached;
    const db = await this.openDb();
    if (!db) return null;
    const blob = await new Promise<Blob | null>((resolve) => {
      try {
        const tx = db.transaction(BLOB_STORE, 'readonly');
        const req = tx.objectStore(BLOB_STORE).get(key);
        req.onsuccess = () => resolve((req.result as Blob) || null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (blob) this.memory.set(key, blob);
    return blob;
  }

  async has(key: string): Promise<boolean> {
    if (this.memory.has(key)) return true;
    return (await this.get(key)) !== null;
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
    const db = await this.openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(BLOB_STORE, 'readwrite');
        tx.objectStore(BLOB_STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async listKeys(): Promise<string[]> {
    const db = await this.openDb();
    const keys = new Set<string>(this.memory.keys());
    if (db) {
      const stored = await new Promise<string[]>((resolve) => {
        try {
          const tx = db.transaction(BLOB_STORE, 'readonly');
          const req = tx.objectStore(BLOB_STORE).getAllKeys();
          req.onsuccess = () => resolve((req.result as IDBValidKey[]).map(String));
          req.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      });
      stored.forEach((k) => keys.add(k));
    }
    return [...keys];
  }

  async stats(): Promise<MediaStoreStats> {
    let totalBytes = 0;
    for (const blob of this.memory.values()) totalBytes += blob.size;
    const keys = await this.listKeys();
    return { count: keys.length, totalBytes, persistent: this.persistent };
  }

  async clear(): Promise<void> {
    this.memory.clear();
    const db = await this.openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(BLOB_STORE, 'readwrite');
        tx.objectStore(BLOB_STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }
}

export const mediaStore = new MediaBlobStore();

/** Persists the binary of an ingested asset under its stable id (used at import time). */
export async function registerAssetBlob(
  assetId: string,
  blob: Blob,
  storageKey?: string
): Promise<string> {
  const key = storageKey || assetId;
  await mediaStore.put(key, blob);
  return key;
}
