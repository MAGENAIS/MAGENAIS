export interface AppConfig {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  storage: {
    type: 'localStorage' | 'indexedDB' | 'memory';
    namespace: string;
  };
  pluginsPath?: string;           // e.g., '/plugins'
  remoteComputeEndpoint?: string; // optional backend URL
}

const DEFAULT_CONFIG: AppConfig = {
  logLevel: 'info',
  storage: {
    type: 'localStorage',
    namespace: 'magenais',
  },
  pluginsPath: '/plugins',
  remoteComputeEndpoint: '',
};

export class Config {
  private static instance: AppConfig | null = null;

  static async load(): Promise<AppConfig> {
    if (this.instance) return this.instance;

    const stored = localStorage.getItem('magenais:config');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const merged: AppConfig = { ...DEFAULT_CONFIG, ...parsed };
        this.instance = merged;
        return merged;
      } catch {
        // fall through
      }
    }
    const fresh: AppConfig = { ...DEFAULT_CONFIG };
    this.instance = fresh;
    return fresh;
  }

  static async save(config: AppConfig): Promise<void> {
    this.instance = config;
    localStorage.setItem('magenais:config', JSON.stringify(config));
  }
}
