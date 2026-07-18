/**
 * RoutingMode — the three-way "which providers are allowed to race" switch
 * requested for the Universal Provider Manager (item 7/13 of the local-AI-
 * studio brief).
 *
 * ROOT CAUSE this addresses: ProviderManager.callWithFallback/callVision
 * raced every enabled, valid candidate for a request type in parallel
 * (see Manager.ts's raceForFirstSuccess) — for someone who enabled a local
 * provider (Transformers.js/WebLLM/Ollama) purely as a free/offline/
 * privacy-preserving option, that meant every generation request also
 * silently spun up an HTTP call to every enabled cloud provider at the same
 * time, burning bandwidth and (for metered/paid cloud providers) money on
 * every single request, even when the local candidate alone would have
 * been perfectly fine. There was no way to say "only use local" or "only
 * use cloud" short of disabling every other provider by hand in Keys &
 * Providers one at a time.
 *
 * 'local'  — only LOCAL_ADAPTER_IDS candidates race. If none are
 *            enabled/valid for this request, the call fails with a clear
 *            message rather than silently falling back to cloud — that
 *            silent fallback is exactly what defeats the point of
 *            choosing Local Only (cost/offline/privacy guarantees).
 * 'cloud'  — the inverse: only non-local candidates race.
 * 'hybrid' — no filtering — every enabled, valid candidate races, exactly
 *            the pre-existing behavior. This is the default, so nobody's
 *            existing setup changes behavior until they explicitly pick
 *            Local Only or Cloud Only.
 */

export type RoutingMode = 'local' | 'cloud' | 'hybrid';

/**
 * Adapters that run without a network round-trip to a cloud API — i.e.
 * "local" in both the offline-connectivity sense (Manager.ts's
 * filterForConnectivity, which used to define this set itself under the
 * name OFFLINE_CAPABLE_ADAPTERS) and the routing-mode sense here. One
 * definition, two call sites, instead of two lists that could drift apart.
 */
export const LOCAL_ADAPTER_IDS = new Set(['transformers', 'webllm', 'ollama', 'browser-speech', 'internal-fallback']);

const STORAGE_KEY = 'magenais.routingMode.v1';

export function getRoutingMode(): RoutingMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === 'local' || raw === 'cloud' || raw === 'hybrid') return raw;
  } catch {
    // Storage unavailable — fall through to the default.
  }
  return 'hybrid';
}

export function setRoutingMode(mode: RoutingMode): void {
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Not fatal — the mode just won't persist across a reload this session.
  }
}
