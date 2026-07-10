/**
 * Provider type definitions for the MAGENAIS provider platform.
 * These are shared across registry, adapters, and router.
 */

export type ProviderType =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'       // STT
  | 'speech'      // TTS
  | 'music'
  | 'coding'
  | 'agents'
  | 'mcp'
  | 'research'
  | 'gamegen';

export type AuthType = 'bearer' | 'header' | 'query' | 'none';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  adapterId: string;
  apiKey?: string;
  baseUrl: string;
  authType: AuthType;
  authHeaderName?: string;      // for 'header'
  authQueryParam?: string;      // for 'query'
  headers?: Record<string, string> | string; // JSON string or object
  defaultModel?: string;
  timeoutMs: number;
  retries: number;
  priority: number;             // lower = higher priority
  enabled: boolean;
  noKeyNeeded?: boolean;        // if true, apiKey is not required
  notes?: string;
  isPreset?: boolean;
  isBuiltIn?: boolean;          // from the original index.html
  // Runtime fields (not persisted)
  health?: ProviderHealth;
  lastUsed?: number;
  successRate?: number;         // 0-1
  averageLatency?: number;      // ms
  capabilities?: string[];      // e.g. ['vision', 'audio']
  quotaRemaining?: number;
  costPerUnit?: number;         // arbitrary unit
}

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastCheck: number;
  lastError?: string;
  responseTime?: number;
}

export interface ProviderScore {
  providerId: string;
  score: number;
  details: {
    priority: number;
    health: number;
    latency: number;
    successRate: number;
    cost: number;
    quota: number;
  };
}

export interface AdapterCapabilities {
  browserSafe: boolean;
  supportsModelDiscovery: boolean;
}

export interface Adapter {
  label: string;
  browserSafe: boolean;
  supportsModelDiscovery: boolean;
  testConnection?(provider: ProviderConfig): Promise<{ ok: boolean; message: string }>;
  fetchModels?(provider: ProviderConfig): Promise<string[]>;
  call?(provider: ProviderConfig, input: any, options?: any): Promise<any>;
}

// Default provider settings
export const DEFAULT_PROVIDER_SETTINGS = {
  timeoutMs: 30000,
  retries: 1,
  priority: 50,
  enabled: false,
};
