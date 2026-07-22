/** Vision tab settings (item 7 of the Universal Vision Provider Manager upgrade) — all optional so older stored configs (pre-dating this feature) merge cleanly with the defaults below rather than ending up with missing fields. */
export interface VisionSettings {
  /** Longest edge, in pixels, a captured/uploaded image is resized down to before being sent to a provider — keeps payloads small for slower connections and providers with strict upload limits. */
  maxImageSizePx: number;
  /** JPEG encode quality (0-1) used by canvas.toDataURL for camera captures and any auto-resize pass. */
  jpegQuality: number;
  /** Whether PNG uploads are re-encoded as JPEG (via the resize pass) or passed through unchanged. PNG input is always accepted either way — this only controls what's actually sent upstream. */
  pngSupport: boolean;
  /** Whether images larger than maxImageSizePx are automatically downscaled before sending. */
  autoResize: boolean;
  /** Target frames-per-second for the live camera preview's MediaTrackConstraints — does not affect how often a frame is actually analyzed (see continuousIntervalMs). */
  cameraFps: number;
  /** Milliseconds between frames in Vision's "Live mode" continuous-analysis loop. */
  continuousIntervalMs: number;
  /** Soft ceiling, in MB, for a single uploaded/dropped/pasted image — larger files are rejected client-side with a clear message rather than silently sent upstream. */
  maxUploadSizeMB: number;
}

export interface AppConfig {
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  storage: {
    type: 'localStorage' | 'indexedDB' | 'memory';
    namespace: string;
  };
  pluginsPath?: string;           // e.g., '/plugins'
  remoteComputeEndpoint?: string; // optional backend URL
  vision: VisionSettings;
}

const DEFAULT_VISION_SETTINGS: VisionSettings = {
  maxImageSizePx: 1280,
  jpegQuality: 0.85,
  pngSupport: true,
  autoResize: true,
  cameraFps: 15,
  continuousIntervalMs: 20000, // matches VisionMode's previous hardcoded 20s live-mode interval
  maxUploadSizeMB: 20,
};

const DEFAULT_CONFIG: AppConfig = {
  logLevel: 'info',
  storage: {
    type: 'localStorage',
    namespace: 'magenais',
  },
  pluginsPath: '/plugins',
  remoteComputeEndpoint: '',
  vision: { ...DEFAULT_VISION_SETTINGS },
};

export class Config {
  private static instance: AppConfig | null = null;

  static async load(): Promise<AppConfig> {
    if (this.instance) return this.instance;

    const stored = localStorage.getItem('magenais:config');
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const merged: AppConfig = {
          ...DEFAULT_CONFIG,
          ...parsed,
          vision: { ...DEFAULT_VISION_SETTINGS, ...(parsed.vision || {}) },
        };
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
