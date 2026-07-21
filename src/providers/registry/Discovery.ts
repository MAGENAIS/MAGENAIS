/**
 * Discovery module for auto-detecting available providers (e.g., from remote registry).
 * For now, we just load defaults. This can be extended later.
 *
 * PROVIDER ARCHITECTURE AUDIT NOTE (environment-aware provider management):
 * this class is currently NOT wired into the boot sequence at all —
 * Kernel.ts imports DEFAULT_PROVIDERS directly from ../defaultProviders.ts
 * and hands it straight to ProviderManager.loadProviders(); ProviderDiscovery
 * .discover() is never called anywhere in the app today. Static provider
 * metadata (adapterId, baseUrl, requiresServerProxy, etc.) lives entirely in
 * defaultProviders.ts, and that's the right home for it to stay in — this
 * class exists as the future extension point for a REMOTE source of
 * provider definitions (a marketplace, user-installed plugins), not as a
 * place to duplicate anything defaultProviders.ts already has.
 *
 * Deliberately NOT the place RUNTIME environment capability (which
 * providers can actually be called given the current RuntimeEnvironment —
 * see core/Environment.ts) gets computed or baked in, even once this class
 * is wired up: capability depends on WHERE the app happens to be running
 * right now, not on the provider's own definition, so it must be computed
 * fresh at call time (see ./Capability.ts's computeProviderCapability) —
 * never cached into a discovered/stored provider record, which would go
 * stale the moment the exact same provider list is loaded in a different
 * environment (e.g. the same defaultProviders.ts entry, once on GitHub
 * Pages, once on localhost).
 */
import { ProviderConfig } from '../types';

export class ProviderDiscovery {
  /**
   * Discover providers from a remote source or local defaults.
   * Returns an array of provider configs.
   */
  static async discover(): Promise<ProviderConfig[]> {
    // For now, we return empty; the Manager will load defaults.
    // In the future, we could fetch from a marketplace or local plugins.
    return [];
  }
}
