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
  | 'embeddings'  // vector representations (Transformers.js all-MiniLM-L6-v2, etc.)
  | 'gamegen';

export type AuthType = 'bearer' | 'header' | 'query' | 'none';

// Deliberately imported with `import type` — RuntimeEnvironment is only
// ever used here as a type annotation on ProviderConfig, never evaluated,
// so this can't create a real (value-level) dependency cycle between
// core/Environment.ts and providers/types.ts.
import type { RuntimeEnvironment } from '../core/Environment';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  adapterId: string;
  apiKey?: string;
  baseUrl: string;
  authType: AuthType;
  authHeaderName?: string;      // for 'header'
  /** Prefix prepended to the header value for authType:'header', e.g. 'Key ' (fal.ai) or 'Token ' — NOT the same as authType:'bearer', which always hardcodes 'Bearer '. Defaults to '' (bare token) when unset, so this is purely additive and doesn't change any existing provider's behavior. */
  authHeaderPrefix?: string;
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
  // Registered under type:'text' solely so ProviderManager.callVision()
  // (which pulls its candidates from the 'text' pool, filtered by
  // VISION_CAPABLE_ADAPTERS — there's no separate 'vision' ProviderType)
  // can find it. Such an entry can never fulfil a genuine text-generation
  // request (its adapter only implements image-captioning/etc, not
  // general chat) — callWithFallback excludes anything flagged here from
  // the plain-text candidate list, while callVision still includes it.
  visionOnly?: boolean;
  // PHASE 4 CORS FIX: some provider APIs (Moonshot/Kimi being the
  // immediate case, see BaseAdapter.fetchWithRetry and server/proxyHandler.mjs)
  // never send Access-Control-Allow-Origin — they're built to be called
  // from a server, not a browser tab, so a direct browser fetch() is
  // blocked before it ever leaves the page. When true, requests to this
  // provider are routed through the local same-origin proxy
  // (server/proxyHandler.mjs, mounted in both vite.config.ts for dev and
  // server/proxy-server.mjs for production) instead of calling the
  // provider's baseUrl directly — CORS is a browser-only restriction, so a
  // server-to-server request from that proxy to the same provider is
  // unaffected by it. This is the one flag any current or future
  // OpenAI-compatible (or other) provider needs to work around a CORS
  // block; no adapter-specific code is required.
  requiresServerProxy?: boolean;
  // ENVIRONMENT-AWARE PROVIDER MANAGEMENT: an explicit allow-list of
  // RuntimeEnvironments this provider can ever work in — e.g. a future
  // adapter that only makes sense inside a packaged desktop shell (direct
  // filesystem access, a bundled local binary, etc.). Unset (the default,
  // and every current provider) means "no particular runtime restriction
  // beyond what's already implied by requiresServerProxy" — see
  // Capability.ts's computeProviderCapability, which is what actually
  // reads this. Deliberately NOT used for the GitHub-Pages-can't-reach-a-
  // proxy case: that's already fully described by requiresServerProxy +
  // Environment.hasServerProxy, and duplicating the same fact here would
  // just create two places it could drift apart. This field exists purely
  // as an extension point for restrictions requiresServerProxy can't
  // express.
  supportedEnvironments?: RuntimeEnvironment[];
  // PHASE 7 — Provider Testing: result of the last "Test" click in Keys &
  // Providers (see ProviderManager.testProvider / SettingsModal's Test
  // button). Persisted via the same saveProviders() path as every other
  // field here, so it survives a reload instead of resetting to "never
  // tested" every time Settings is reopened.
  lastTestResult?: ProviderTestResult;
  // Runtime fields (not persisted)
  health?: ProviderHealth;
  lastUsed?: number;
  successRate?: number;         // 0-1
  averageLatency?: number;      // ms
  /** Cumulative count of calls that failed specifically because they timed out (classifyFailure's 'timeout' category) — unlike ProviderHealth.failureCount, this never resets on a success, so it answers "has this been timing out a lot this session" even after one recovers. Runtime-only, like the two fields above. */
  timeoutCount?: number;
  capabilities?: string[];      // e.g. ['vision', 'audio']
  quotaRemaining?: number;
  costPerUnit?: number;         // arbitrary unit

  // ------------------------------------------------------------------
  // Image-generation request shape (type:'image' providers routed
  // through OpenAICompatibleAdapter only — see callImage()).
  //
  // Not every "OpenAI-compatible" provider's image endpoint actually
  // matches the OpenAI /images/generations contract: some put the model
  // in the URL path instead of the body (Cloudflare Workers AI), some
  // require multipart/form-data instead of JSON and return raw bytes
  // instead of a JSON envelope (Stability AI's v2beta endpoints). Rather
  // than hardcoding a per-provider branch in the adapter for each of
  // these, the differences are expressed here as plain data on the
  // provider config — same pattern already used for authType/
  // authHeaderPrefix/requiresServerProxy above. Every field is optional
  // and defaults to the plain OpenAI shape, so a brand new image preset
  // (or a user's own custom provider) works out of the box with zero
  // extra configuration unless its API genuinely differs.
  /**
   * Path appended to baseUrl for image generation. `{model}` is replaced
   * with the resolved model id if present, letting model-in-path APIs
   * (e.g. Cloudflare's ".../ai/run/{model}") work without a body field.
   * Default: '/images/generations' (OpenAI shape).
   */
  imageEndpoint?: string;
  /** Default: 'json'. 'multipart' sends prompt/width/height/seed as multipart/form-data instead of a JSON body — required by APIs like Stability AI's v2beta endpoints. */
  imageRequestFormat?: 'json' | 'multipart';
  /**
   * Default: 'auto' — trust the response Content-Type header (image/* =
   * raw bytes, otherwise JSON envelope). Set to 'binary' for an API that
   * only returns real bytes when a specific Accept header is sent (e.g.
   * Stability AI's `Accept: image/*`); the adapter sends that header
   * whenever this is 'binary'.
   */
  imageResponseFormat?: 'auto' | 'binary';
  /** Default: true. Set to false when the model is already selected via imageEndpoint's {model} substitution and the API rejects (or ignores but shouldn't receive) a redundant `model` body field. */
  imageIncludeModelInBody?: boolean;
}

export interface ProviderHealth {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  lastCheck: number;
  lastError?: string;
  responseTime?: number;
  /** Consecutive failures since the last success — reset to 0 on any success. See HealthCooldown.ts. */
  failureCount?: number;
  /** If set and in the future, ProviderManager/HealthMonitor skip this provider rather than retrying it. */
  cooldownUntil?: number;
  /** What kind of failure triggered the current cooldown, if any — see HealthCooldown.ts's FailureCategory. */
  failureCategory?: string;
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

export interface ProviderTestResult {
  ok: boolean;
  message: string;
  /** Round-trip time for the actual test request, in ms — only present when a real network request was made (not a config-only check). */
  latencyMs?: number;
  /** The model the test request actually used, if applicable. */
  checkedModel?: string;
  /** When this test ran (Date.now()) — used for the "last tested Xm ago" display and to persist results across sessions. */
  testedAt: number;
  /** Failure category from HealthCooldown.classifyFailure — present only when ok:false. */
  category?: string;
  /** 0-100 — see ProviderManager.testProvider's scoring: mostly pass/fail, with a latency bonus when it passes. */
  healthScore?: number;
}

export interface Adapter {
  label: string;
  browserSafe: boolean;
  supportsModelDiscovery: boolean;
  testConnection?(provider: ProviderConfig): Promise<ProviderTestResult>;
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
