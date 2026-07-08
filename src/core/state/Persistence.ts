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
  // Placeholder – will be implemented when needed
  async load(): Promise<any> { return null; }
  async save(data: any): Promise<void> {}
}

class MemoryAdapter implements StorageAdapter {
  private data: any = null;
  async load(): Promise<any> { return this.data; }
  async save(data: any): Promise<void> { this.data = data; }
}
