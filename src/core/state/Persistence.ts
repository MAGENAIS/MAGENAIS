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
    localStorage.setItem(key, JSON.stringify(data));
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
