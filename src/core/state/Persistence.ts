export interface StorageAdapter {
  load(): Promise<any>;
  save(data: any): Promise<void>;
}

export class Persistence {
  private adapter: StorageAdapter;

  constructor(config: { type: 'localStorage' | 'indexedDB' | 'memory'; namespace: string }) {
    if (config.type === 'localStorage') {
      this.adapter = new LocalStorageAdapter(config.namespace);
    } else if (config.type === 'indexedDB') {
      this.adapter = new IndexedDBAdapter(config.namespace);
    } else {
      this.adapter = new MemoryAdapter();
    }
  }

  async load(): Promise<any> {
    return this.adapter.load();
  }

  async save(data: any): Promise<void> {
    return this.adapter.save(data);
  }
}

// ---------- Adapters ----------

class LocalStorageAdapter implements StorageAdapter {
  constructor(private namespace: string) {}

  async load(): Promise<any> {
    const key = `${this.namespace}:state`;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  async save(data: any): Promise<void> {
    const key = `${this.namespace}:state`;
    try {
      localStorage.setItem(key, JSON.stringify(data));
    } catch (err: any) {
      // QuotaExceededError is the realistic failure mode once history can
      // contain embedded media (see Actions.addHistoryEntry) — without
      // this, a single save() throwing here would silently drop whatever
      // else was being merged into this same shared blob (e.g. provider
      // API keys saved moments earlier), since Store's dispatch() calls
      // this fire-and-forget with no caller to surface the failure to.
      // Progressively trim the most storage-hungry, least-critical field
      // (history, which can hold embedded media) and retry before
      // giving up, so a large history doesn't take down everything else
      // sharing this key.
      if (err?.name === 'QuotaExceededError' && Array.isArray(data?.history) && data.history.length > 0) {
        for (const keep of [20, 5, 0]) {
          try {
            const trimmed = { ...data, history: data.history.slice(0, keep) };
            localStorage.setItem(key, JSON.stringify(trimmed));
            console.warn(`Persistence: localStorage quota exceeded — trimmed history to ${keep} entries to save the rest of the app state.`);
            return;
          } catch {
            // keep trimming
          }
        }
      }
      console.error('Persistence: failed to save to localStorage (quota exceeded and trimming did not help).', err);
    }
  }
}

class IndexedDBAdapter implements StorageAdapter {
  constructor(private namespace: string) {}

  private dbName(): string {
    return `${this.namespace}-db`;
  }

  private async openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName(), 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async load(): Promise<any> {
    try {
      const db = await this.openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get('state');
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async save(data: any): Promise<void> {
    try {
      const db = await this.openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(data, 'state');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      // IndexedDB unavailable — silently no-op, matches localStorage adapter's leniency.
    }
  }
}

class MemoryAdapter implements StorageAdapter {
  private data: any = null;
  async load(): Promise<any> { return this.data; }
  async save(data: any): Promise<void> { this.data = data; }
}
