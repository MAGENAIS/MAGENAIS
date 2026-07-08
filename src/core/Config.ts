export interface AppConfig {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  storage: {
    type: 'localStorage' | 'indexedDB' | 'memory';
    namespace: string;
  };
  // More config will be added later (plugins, themes, etc.)
}

const DEFAULT_CONFIG: AppConfig = {
  logLevel: 'info',
  storage: {
    type: 'localStorage',
    namespace: 'magenais',
  },
};

export class Config {
  private static instance: AppConfig | null = null;

  static async load(): Promise<AppConfig> {
    if (this.instance) return this.instance;

    // Try to load from localStorage (or IndexedDB later)
    const stored = localStorage.getItem('magenais:config');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        this.instance = { ...DEFAULT_CONFIG, ...parsed };
        return this.instance;
      } catch {
        // fall through
      }
    }
    this.instance = { ...DEFAULT_CONFIG };
    return this.instance;
  }

  static async save(config: AppConfig): Promise<void> {
    this.instance = config;
    localStorage.setItem('magenais:config', JSON.stringify(config));
  }
}
