/**
 * Capability.ts — computes a provider's RUNTIME capability for the current
 * Environment, without ever mutating the provider definition itself.
 *
 * ARCHITECTURE NOTE: this is deliberately a standalone pure-function module,
 * not a method on ProviderRegistry or ProviderManager, so there is exactly
 * ONE implementation shared by:
 *   - Manager.ts's filterForEnvironment (runtime: decides what's allowed to
 *     actually be called)
 *   - SettingsModal.ts (UI: decides what badge/status a Provider Card shows)
 * A provider row that LOOKS available in Keys & Providers but silently
 * fails at call time (or vice versa) is exactly the kind of drift this
 * avoids — both call sites ask the same question the same way.
 *
 * WHY NOT MUTATE `provider.requiresServerProxy` OR ADD A CACHED
 * `provider.available` FIELD DIRECTLY ON ProviderConfig: the environment
 * this app runs in cannot change mid-session (see Environment.ts's own doc
 * comment), but the WHOLE POINT of computing this dynamically rather than
 * baking it into the stored provider object is that `requiresServerProxy`
 * keeps meaning exactly one thing — "this call needs the local CORS proxy"
 * — regardless of whether a proxy happens to be reachable right now. Two
 * installs of the exact same provider list (one on GitHub Pages, one on
 * localhost) must produce two different capability results from the one
 * unchanged provider definition; that's only possible if capability is
 * computed fresh, not stored.
 */
import { ProviderConfig } from '../types';
import { Environment, RuntimeEnvironment } from '../../core/Environment';
import { LOCAL_ADAPTER_IDS } from '../RoutingMode';

export interface ProviderRuntimeCapability {
  /** Can this provider actually be called right now, given the current Environment? Manager.ts's filterForEnvironment excludes anything with available:false from every fallback race. */
  available: boolean;
  /** Should this provider still show up at all in Keys & Providers? Always true today — an unavailable provider is shown disabled with disabledReason rather than hidden, matching every other "why can't I use this" state in SettingsModal.ts (Missing API Key, Configuration Missing, Download Required, ...). Kept as its own field so a future caller COULD hide instead, without changing the meaning of `available`. */
  visible: boolean;
  /** Human-readable reason shown in place of the normal health/status badge when available:false. */
  disabledReason?: string;
  /** Which runtime category this provider's DECLARED requirements best fit — purely derived from existing metadata (never a new hardcoded provider-name list). Undefined for a provider with no particular runtime affinity (a plain cloud API with proper CORS — portable everywhere). Used by SettingsModal.ts for the Browser/Server/Desktop badge. */
  environmentBadge?: 'Browser' | 'Server' | 'Desktop';
}

/**
 * Computes runtime capability for one provider against Environment.current.
 * Pure function of (provider, Environment) — no side effects, nothing
 * cached, safe to call on every render/every candidate-filter pass.
 */
export function computeProviderCapability(provider: ProviderConfig): ProviderRuntimeCapability {
  // 1. The one real, already-existing capability restriction in this
  //    codebase today: a provider that needs the local CORS proxy
  //    (server/proxyHandler.mjs) has nothing to route through on a static
  //    host with no backend of its own (GitHub Pages, or any other plain
  //    Browser deployment — see Environment.hasServerProxy). Desktop and
  //    Localhost are unaffected — see that field's own doc comment for why
  //    — so this can never change behavior for either, satisfying "Desktop
  //    must behave exactly the same, Localhost must behave exactly the
  //    same."
  if (provider.requiresServerProxy && !Environment.hasServerProxy) {
    return {
      available: false,
      visible: true,
      disabledReason: 'Requires backend server',
      environmentBadge: 'Server',
    };
  }

  // 2. Extension point: an explicit environment allow-list (see
  //    ProviderConfig.supportedEnvironments's doc comment in types.ts) for
  //    a future restriction requiresServerProxy can't express. No shipped
  //    provider sets this today, so this branch is currently a no-op for
  //    every existing install — purely forward-looking.
  if (provider.supportedEnvironments && provider.supportedEnvironments.length > 0) {
    if (!provider.supportedEnvironments.includes(Environment.current)) {
      return {
        available: false,
        visible: true,
        disabledReason: `Only available on ${provider.supportedEnvironments.join(', ')}`,
        environmentBadge: providerEnvironmentBadge(provider),
      };
    }
  }

  return { available: true, visible: true, environmentBadge: providerEnvironmentBadge(provider) };
}

/**
 * Purely informational "what kind of provider is this" badge for Provider
 * Cards — never used to gate availability (computeProviderCapability above
 * already did that). Derived from the same metadata everything else here
 * uses:
 *   - requiresServerProxy:true            -> 'Server' (needs a backend)
 *   - LOCAL_ADAPTER_IDS.has(adapterId)    -> 'Browser' (runs fully in-tab, no network at all)
 *   - supportedEnvironments === [Desktop] -> 'Desktop'
 *   - anything else (a plain cloud API with proper CORS)  -> undefined, i.e. portable everywhere, no badge
 */
function providerEnvironmentBadge(provider: ProviderConfig): 'Browser' | 'Server' | 'Desktop' | undefined {
  if (provider.requiresServerProxy) return 'Server';
  if (LOCAL_ADAPTER_IDS.has(provider.adapterId)) return 'Browser';
  if (
    provider.supportedEnvironments &&
    provider.supportedEnvironments.length === 1 &&
    provider.supportedEnvironments[0] === RuntimeEnvironment.Desktop
  ) {
    return 'Desktop';
  }
  return undefined;
}
