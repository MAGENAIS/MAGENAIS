import { ProviderRegistry } from './Registry';
import { ProviderConfig, ProviderType, ProviderTestResult } from '../types';
import { SmartRouter } from '../Router';
import { Persistence } from '../../core/state/Persistence';
import { EventBus } from '../../core/EventBus';
import { Logger, ProviderCallEvent } from '../../core/Logger';
import { ProviderValidator } from '../../config/ProviderValidator';
import { ProviderAttempt, formatProviderReport, formatAllFailedMessage } from '../ProviderReport';
import { isInCooldown, cooldownRemainingLabel, cooldownReasonLabel, classifyFailure } from '../HealthCooldown';
import { LOCAL_ADAPTER_IDS, getRoutingMode } from '../RoutingMode';
import { computeProviderCapability } from './Capability';
import { Environment } from '../../core/Environment';

// ---------------------------------------------------------------------------
// PHASE 3a — Offline mode detection.
// ---------------------------------------------------------------------------
// `navigator.onLine` is a real (if imperfect — see caveat below) signal for
// whether the device currently has any network connectivity at all. When
// it's false, there is no point racing cloud providers that are certain to
// fail one by one (each burning up to its own timeoutMs first) before
// falling through to whatever local/offline-capable provider would have
// answered immediately anyway — this skips straight to those instead.
//
// The actual adapter-id set (which adapters count as "local"/"offline-
// capable") now lives in RoutingMode.ts as LOCAL_ADAPTER_IDS, shared with
// the routing-mode filter added in raceForFirstSuccess's candidate pipeline
// below — see that file's doc comment for why both use one definition.

/**
 * Structured mirror of TransformersAdapter's ModelNotInstalledError,
 * duck-typed via `.code` (rather than importing that adapter class
 * directly) so ProviderManager stays adapter-agnostic — the same
 * arm's-length relationship it already has with every other adapter,
 * which are registered by string id, not imported by class. Read via
 * ProviderManager.getLastLocalModelMissing() by the Local Models Manager
 * UI / Mode.renderError to offer a direct "Download it" action.
 */
export interface LocalModelMissingInfo {
  modelId: string;
  task: string;
  provider: string;
  at: number;
}

/**
 * CAVEAT: `navigator.onLine` is a coarse, sometimes-wrong signal (it can
 * read `true` on a captive portal with no real internet, or occasionally
 * `false` behind unusual network configurations with working connectivity)
 * — treated here as a fast, zero-cost hint to skip a doomed race, never as
 * the sole gate on whether a call is attempted at all. See
 * filterForConnectivity below: if this ever produces an empty candidate
 * list, the unfiltered list is used instead, so a false "offline" reading
 * degrades to "try everything, same as before" rather than a hard failure.
 */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Subscribes to the browser's online/offline events for UI components that
 * want to reflect current connectivity live (e.g. an "Offline — using local
 * models" status indicator). Returns an unsubscribe function.
 */
export function onConnectivityChange(handler: (offline: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onOnline = () => handler(false);
  const onOffline = () => handler(true);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}

export class ProviderManager {
  private registry: ProviderRegistry;
  private persistence: Persistence;
  private legacyPersistence?: Persistence;
  private storageKey: string = 'magenais:providers';
  // Bumping this invalidates nothing by itself — it's stamped into saved
  // data so a future migration can detect "this was written by an older
  // shape of ProviderManager" and adapt instead of guessing.
  private static readonly SCHEMA_VERSION = 2;
  private lastLocalModelMissing: LocalModelMissingInfo | null = null;

  constructor(registry: ProviderRegistry, persistence: Persistence, eventBus: EventBus, legacyPersistence?: Persistence) {
    this.registry = registry;
    this.persistence = persistence;
    // Providers used to be saved under the same shared key as Store/
    // AssetManager/ProjectManager. Now that they have their own dedicated
    // namespace (see Kernel), pass the OLD shared Persistence here so any
    // provider data already on a user's machine gets migrated forward
    // instead of appearing to have vanished.
    this.legacyPersistence = legacyPersistence;
  }

  /**
   * Load providers from persistence (localStorage/IndexedDB) and merge with defaults.
   * This should be called during application bootstrap.
   *
   * Version-safe / first-launch-only default seeding (Priority 3):
   * Previously, EVERY boot re-merged the full `defaultProviders` list
   * underneath whatever was stored, keyed by provider id. That looks safe
   * (stored values "override" defaults) but it silently *resurrects* any
   * built-in provider the user had explicitly deleted, because a deleted
   * provider simply has no entry in `stored` — so the default reappears
   * every time. We now persist the set of default ids we've ever seeded
   * (`seededDefaultIds`) alongside the providers themselves: on later boots,
   * a default id is only (re)added if it's a *new* one the user has never
   * seen before (e.g. a built-in provider added in a later app version) —
   * never one that was seeded before and is now simply absent from `stored`.
   */
  async loadProviders(defaultProviders: ProviderConfig[]): Promise<void> {
    let stored: ProviderConfig[] = [];
    let seededDefaultIds: string[] = [];
    try {
      const data = await this.persistence.load();
      if (data && Array.isArray(data.providers)) {
        stored = data.providers;
        seededDefaultIds = Array.isArray(data.seededDefaultIds) ? data.seededDefaultIds : [];
      } else if (this.legacyPersistence) {
        // Nothing under the new dedicated key yet — check the old shared
        // key for provider data saved by a previous version of the app
        // before providers had their own namespace, and migrate it in.
        const legacyData = await this.legacyPersistence.load();
        if (legacyData && Array.isArray(legacyData.providers) && legacyData.providers.length > 0) {
          stored = legacyData.providers;
          seededDefaultIds = Array.isArray(legacyData.seededDefaultIds) ? legacyData.seededDefaultIds : [];
          Logger.info(`ProviderManager: migrated ${stored.length} provider(s) from legacy storage key.`);
        }
      }
    } catch (e) {
      Logger.warn('Failed to load providers from persistence, using defaults.', e);
    }

    const isFirstLaunch = stored.length === 0 && seededDefaultIds.length === 0;
    const seededSet = new Set(seededDefaultIds);
    // Every entry the user's browser already has a persisted record for —
    // used below to distinguish "brand new built-in the user has never
    // seen" (safe to force on) from "the user has explicitly toggled this
    // before" (their choice, including turning it off, must stick).
    const storedIds = new Set(stored.map(p => p.id));
    const defaultsById = new Map<string, ProviderConfig>(defaultProviders.map(p => [p.id, p]));

    // Merge: stored providers override defaults by id, but we also add any
    // DEFAULT provider that has never been seeded before (first launch, or
    // a newly-introduced built-in in a later app version). A default whose
    // id was seeded previously but is now missing from `stored` was
    // intentionally deleted by the user and must NOT be resurrected.
    const mergedMap = new Map<string, ProviderConfig>();
    defaultProviders.forEach(p => {
      if (isFirstLaunch || !seededSet.has(p.id)) {
        mergedMap.set(p.id, { ...p });
        seededSet.add(p.id);
      }
    });
    // Then override with stored (keep stored API keys, enabled status, etc.)
    stored.forEach(p => {
      const existing = mergedMap.get(p.id);
      // One-time, narrowly-scoped migration: models.inference.ai.azure.com
      // (the old GitHub Models endpoint) was deprecated 2025-07-17 and
      // fully decommissioned 2025-10-17 — every request to it now fails
      // auth (401 "Bad credentials") regardless of key validity. A stored
      // provider pointing at that *exact* URL is unambiguously a stale
      // built-in default seeded before this fix, not a deliberate user
      // customization (nobody hand-types a decommissioned Microsoft
      // endpoint), so it's safe to auto-correct here — unlike the general
      // "never overwrite user settings" rule this loop otherwise follows.
      // Looked up from `defaultsById` (the raw default list) rather than
      // `mergedMap`, because on a normal "already seeded, second boot"
      // this id was deliberately left OUT of mergedMap above (to avoid
      // resurrecting user-deleted defaults) — `existing` here would always
      // be undefined otherwise, silently skipping the migration in the
      // exact case it needs to run.
      const trueDefault = defaultsById.get(p.id);
      if (p.baseUrl === 'https://models.inference.ai.azure.com' && trueDefault) {
        p = { ...p, baseUrl: trueDefault.baseUrl, defaultModel: trueDefault.defaultModel };
        Logger.info(`ProviderManager: migrated "${p.name}" off the decommissioned GitHub Models endpoint.`);
      }
      // One-time migration: two default model ids were confirmed to have
      // been retired by their providers (both surfaced as a 400/404
      // "model_not_found" in practice) — swap them for a current default,
      // same narrow "only touch an exact known-stale value" approach as
      // the GitHub Models migration above, so a deliberately custom
      // "Preferred model" the user typed in themselves is never touched.
      const STALE_MODEL_MIGRATIONS: Record<string, string> = {
        'Qwen/Qwen3-32B-Instruct': 'meta-llama/Llama-3.3-70B-Instruct', // Hugging Face — stopped resolving
        'llama-3.3-70b': 'llama-4-scout-17b-16e-instruct', // Cerebras — retired from their free-tier catalog
        'llama-4-scout': 'llama-4-scout-17b-16e-instruct', // Cerebras — bare id 404s, catalog uses the full slug
      };
      if (p.defaultModel && STALE_MODEL_MIGRATIONS[p.defaultModel] && trueDefault) {
        const oldModel = p.defaultModel;
        const newModel = STALE_MODEL_MIGRATIONS[oldModel];
        p = { ...p, defaultModel: newModel };
        Logger.info(`ProviderManager: "${p.name}"'s default model "${oldModel}" was retired by the provider — switched to "${newModel}".`);
      }
      // One-time migration for requirement #3/#9 ("paid/keyed providers must
      // never be selected by default"): earlier app versions shipped every
      // keyed preset with `enabled: true` out of the box. That's exactly
      // the "selected by default" behavior this refactor removes (see
      // defaultProviders.ts, where every keyed entry is now
      // `enabled: false`) — but an existing install's *stored* copy still
      // has the old `enabled: true`, and the general "stored always wins"
      // rule above would otherwise preserve that stale default forever.
      // Auto-correct it — but ONLY when it's unambiguously an untouched
      // leftover default: still enabled, still has no API key saved. The
      // moment a user has actually configured a key, or hand-toggled the
      // provider (in a version where that also meant "with a key"), this
      // condition no longer holds and their choice is left completely
      // alone, same spirit as the GitHub Models migration just above.
      if (p.isPreset && !p.noKeyNeeded && p.enabled === true && !p.apiKey && trueDefault && trueDefault.enabled === false) {
        p = { ...p, enabled: false };
        Logger.info(`ProviderManager: "${p.name}" requires an API key and was never configured with one — moved to disabled-by-default (enable it any time in Keys & Providers).`);
      }
      // One-time migration: keep the zero-key, in-browser model adapters
      // (WebLLM, Transformers.js) in sync on their internal reliability
      // tuning values, whichever direction those defaults move in a given
      // app version — this field has no settings-UI a user could have
      // intentionally changed, so it's always safe to resync for these two
      // specific, always-free adapters. Concretely: an earlier version
      // shipped a longer timeout + heavier model that caused multi-minute
      // hangs and was tightened down; then real-world reports showed the
      // tightened value (25000/20000ms) was too short to ever let the
      // one-time ~700MB-1GB model download finish at all, so it was raised
      // again (see defaultProviders.ts). Without this sync, an install that
      // already seeded these built-ins before either change would keep
      // whatever stale number it first saw forever, under the normal
      // "stored always wins" rule. `defaultModel` is only swapped when it
      // still exactly equals the old known-stale value, so a genuinely
      // user-picked "Preferred model" is left untouched.
      if (trueDefault && p.isBuiltIn && p.noKeyNeeded && (p.adapterId === 'webllm' || p.adapterId === 'transformers')) {
        const patch: Partial<ProviderConfig> = {};
        if (p.timeoutMs !== trueDefault.timeoutMs) patch.timeoutMs = trueDefault.timeoutMs;
        if (p.defaultModel === 'Llama-3.2-3B-Instruct-q4f16_1-MLC' && trueDefault.defaultModel !== p.defaultModel) {
          patch.defaultModel = trueDefault.defaultModel;
        }
        if (Object.keys(patch).length > 0) {
          p = { ...p, ...patch };
          Logger.info(`ProviderManager: refreshed "${p.name}"'s tuning defaults (timeout/model) to the latest known-good values.`);
        }
      }
      // One-time migration: `visionOnly` (added after this provider first
      // shipped) has no settings-UI toggle at all — see SettingsModal.ts's
      // provider editor field list — so there is no legitimate way a user
      // could have set it themselves, unlike every other field guarded
      // above. Any install whose stored copy predates this flag is
      // permanently missing it under the normal "stored always wins" rule,
      // which is the ROOT CAUSE of a user-reported bug: Transformers.js
      // Vision (registered as type:'text' purely so callVision() can find
      // it — see the comment on the `.filter(p => !p.visionOnly)` line
      // below) kept showing up as a real TEXT candidate and failing with
      // "Transformers.js adapter doesn't support mode 'text'", burning a
      // slot and its full timeout window in every plain text-generation
      // fallback chain. Always safe to force on for a built-in whose true
      // default has it, unconditionally.
      if (trueDefault?.visionOnly && p.isBuiltIn && !p.visionOnly) {
        p = { ...p, visionOnly: true };
        Logger.info(`ProviderManager: marked "${p.name}" as vision-only (was missing this flag from an older install) so it's excluded from plain text requests.`);
      }
      if (existing) {
        // Merge: stored values take precedence, but we keep the id and type from default if missing
        mergedMap.set(p.id, { ...existing, ...p });
      } else if (trueDefault) {
        // Still a valid current default (normal "already seeded before,
        // second boot" case — see the comment on `trueDefault` above for
        // why it's deliberately absent from `mergedMap` here). Not
        // orphaned: trust the stored copy, same as the plain custom-
        // provider case below.
        mergedMap.set(p.id, p);
      } else if (p.isPreset || p.isBuiltIn) {
        // ROOT CAUSE FIX (user report: "WebLLM"/"Transformers.js Vision"
        // showing wrong priorities and failing every test with a nonsense
        // CORS-proxy SSRF error despite their current adapters making zero
        // network calls at all; "LLAMA" and a second "Mistral AI" entry
        // that don't exist ANYWHERE in the current defaultProviders list).
        // Reaching this branch means: no default exists under this id
        // AT ALL anymore (trueDefault is undefined, checked above) — but
        // `isPreset`/`isBuiltIn` being true means this row was SEEDED as a
        // shipped default by an earlier app version, one whose id (or
        // whole entry) has since been renamed, consolidated, or removed —
        // see this file's own `'preset-mistral'` duplicate-key bugfix
        // history for exactly how that happens. A real user-added custom
        // provider is never isPreset/isBuiltIn, so this can't misfire on
        // one, and a still-valid default (the overwhelmingly common case)
        // is caught by the `trueDefault` branch above, never reaching
        // here. Carrying an orphaned ex-default forward unchanged forever
        // (the old behavior) means it keeps getting tested with whatever
        // adapterId/baseUrl/requiresServerProxy it had YEARS ago — which is
        // exactly how a WebLLM-labeled row ends up making an HTTP proxy
        // call. Dropping it here is safe: if it's still a real capability,
        // the CURRENT default under its CURRENT id gets seeded normally by
        // the "add any never-seeded default" step above; if it was
        // genuinely retired, the app is simply, correctly, no longer
        // carrying dead weight.
        Logger.info(`ProviderManager: dropped "${p.name}" (id "${p.id}") — it was seeded as a built-in/preset by an older app version but no longer matches any current default, so it's stale rather than a real user customization.`);
      } else {
        // Genuine custom provider (not in defaults, not ever a preset/
        // built-in) — trust the stored copy, this really is the user's own.
        mergedMap.set(p.id, p);
      }
    });

    // Clear registry and load merged
    // Force-enable genuinely free, zero-setup built-ins (noKeyNeeded AND
    // isBuiltIn) — but ONLY when the user's browser has never seen this
    // provider id before (isFirstLaunch, or a built-in introduced in a
    // later app version than what they last loaded). This guarantees a
    // fresh install — or an upgrade that adds a new free built-in — always
    // starts with every no-cost option switched on, without ever
    // resurrecting a provider the user has since, deliberately, turned
    // off themselves (evidenced by its id already being present in
    // `stored`): someone who wants only their own keyed providers to
    // compete, with Ollama/WebLLM/Puter/etc. fully excluded rather than
    // just deprioritized, can now flip them off in Keys & Providers and
    // have that choice actually stick across reloads.
    for (const p of mergedMap.values()) {
      if (p.noKeyNeeded && p.isBuiltIn && !p.enabled && !storedIds.has(p.id)) {
        p.enabled = true;
        Logger.info(`ProviderManager: enabled free built-in provider "${p.name}" for the first time (it costs nothing and needs no key).`);
      }
    }

    this.registry.clear();
    this.registry.loadProviders(Array.from(mergedMap.values()));
    this.seededDefaultIds = Array.from(seededSet);
    Logger.info(
      `ProviderManager: loaded ${mergedMap.size} providers (${stored.length} from storage, first launch: ${isFirstLaunch}).`
    );
    // Persist the (possibly updated) seeded-id set immediately so a crash
    // before the next explicit save doesn't lose first-launch tracking.
    await this.saveProviders();
  }

  private seededDefaultIds: string[] = [];

  /**
   * Save current provider configurations to persistence.
   *
   * ROOT CAUSE (Priority 3 — API keys lost on restart): Store,
   * ProviderManager, AssetManager, and ProjectManager all shared one
   * Persistence instance / localStorage key. AssetManager/ProjectManager
   * correctly read-merge-write; this method used to build a brand-new
   * `data` object from scratch and call `persistence.save(data)`, blowing
   * away app state / assets / projects that were sharing the same key.
   * Now it merges into whatever is already stored, same as its siblings.
   */
  async saveProviders(): Promise<void> {
    const providers = this.registry.getAllProviders();
    const existing = (await this.persistence.load()) || {};
    const data = {
      ...existing,
      version: ProviderManager.SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      providers,
      seededDefaultIds: this.seededDefaultIds,
    };
    await this.persistence.save(data);
    Logger.debug('ProviderManager: providers saved.');
  }

  /**
   * Reset to defaults: clear and reload defaults.
   */
  async resetToDefaults(defaultProviders: ProviderConfig[]): Promise<void> {
    this.registry.clear();
    this.registry.loadProviders(defaultProviders);
    this.seededDefaultIds = defaultProviders.map(p => p.id);
    await this.saveProviders();
    Logger.info('ProviderManager: reset to defaults.');
  }

  /**
   * Delete all provider data from persistence (clear device data).
   */
  async clearAllData(): Promise<void> {
    // Clear only this subsystem's slice of the shared blob — never blindly
    // overwrite the whole thing (see saveProviders() above for why).
    const existing = (await this.persistence.load()) || {};
    await this.persistence.save({ ...existing, providers: [], seededDefaultIds: [] });
    this.registry.clear();
    this.seededDefaultIds = [];
    Logger.info('ProviderManager: all provider data cleared.');
  }

  /**
   * Access the underlying registry directly (needed by callers that must resolve
   * an adapter instance for a provider, e.g. workflow node executors).
   */
  getRegistry(): ProviderRegistry {
    return this.registry;
  }

  /**
   * Call the best-scored provider for a type, and on failure fall through to the
   * next-best one, and so on, mirroring the legacy monolith's runChain/unifiedStepsForType
   * fallback-chain behaviour (this is the core reliability mechanism of the app —
   * a single provider being down, rate-limited, or missing a key should not surface
   * as a hard failure while any other candidate could still succeed).
   */
  /**
   * ROOT CAUSE FIX (reported: every tab hangs/lags indefinitely with no
   * response, even with Puter disabled/broken): callWithFallback and
   * callVision previously did `await adapter.call(...)` with NO ceiling of
   * their own. Adapters built on `fetchWithRetry` (Ollama, the free
   * Pollinations image, Wikipedia) are self-bounded via AbortController —
   * but PuterAdapter's `window.puter.ai.chat(...)` is a third-party SDK
   * call with no timeout of its own, and WebLLMAdapter/TransformersAdapter
   * load their models via a raw `import('https://esm.run/...')` that has
   * no timeout either. If any of those genuinely hangs (a stuck Puter
   * session, an unreachable CDN, a stalled model download), the ENTIRE
   * fallback chain froze right there — every provider queued behind it,
   * and every tab whose pipeline touched that provider type, never got a
   * chance to run, let alone fail over.
   *
   * `withTimeout` wraps any adapter call in a race against
   * `provider.timeoutMs` (already a required, validated field — see
   * ProviderValidator — so every provider already declares how long it's
   * willing to be waited on). Whichever settles first wins; a timeout
   * rejects with a clear message that fallback treats exactly like any
   * other provider error, so the chain always keeps moving no matter what
   * an individual adapter does internally.
   */
  /**
   * Narrows a candidate list to providers actually usable in the current
   * RuntimeEnvironment (see core/Environment.ts and ./Capability.ts) — e.g.
   * excludes `requiresServerProxy` providers when running on GitHub Pages
   * or any other static host with no backend proxy behind it. Unlike
   * filterForConnectivity below, this is NOT a soft/imperfect signal that
   * falls back to "try everything" when it would empty the list —
   * Environment.hasServerProxy is a deterministic fact about the current
   * deployment (not a coarse runtime reading like navigator.onLine), so a
   * `requiresServerProxy` provider on a static host is GUARANTEED to fail
   * (its fetch to /api/magenais-proxy has nothing to answer it), never
   * just "maybe". Racing it anyway would only ever burn a slot and its
   * full timeoutMs on a doomed request — exactly the "instead of failing"
   * outcome the environment-aware provider management requirement calls
   * out. Same hard-filter philosophy as applyRoutingMode's 'local'/'cloud'
   * modes, and for the same reason.
   */
  private filterForEnvironment(
    candidates: ProviderConfig[],
    log?: (message: string, level?: 'info' | 'warn' | 'error') => void
  ): ProviderConfig[] {
    const filtered = candidates.filter(p => computeProviderCapability(p).available);
    if (filtered.length !== candidates.length) {
      const excluded = candidates.filter(p => !filtered.includes(p));
      log?.(
        `Running on ${Environment.current} with no backend server available — ` +
        `${excluded.length} provider(s) that require one were excluded: ${excluded.map(p => p.name).join(', ')}.`,
        'info'
      );
    }
    return filtered;
  }

  /**
   * Narrows a candidate list to offline-capable providers when the device
   * currently has no network connectivity — see the isOffline()/
   * LOCAL_ADAPTER_IDS doc comments above for what "offline-capable"
   * means and why `navigator.onLine` is only ever a hint, not a hard gate:
   * if narrowing would leave zero candidates, the original list is
   * returned unfiltered instead (try everything, same as being online,
   * rather than a guaranteed failure from a possibly-wrong reading).
   */
  private filterForConnectivity(
    candidates: ProviderConfig[],
    log?: (message: string, level?: 'info' | 'warn' | 'error') => void
  ): ProviderConfig[] {
    if (!isOffline()) return candidates;
    const offlineOnly = candidates.filter(p => LOCAL_ADAPTER_IDS.has(p.adapterId));
    if (offlineOnly.length === 0) return candidates;
    log?.('No internet connection detected — running in Offline Mode using local providers only (Local Transformers/WebLLM/Ollama/on-device speech).', 'info');
    return offlineOnly;
  }

  /**
   * Narrows a candidate list per the person's chosen RoutingMode (item 7/13
   * — see RoutingMode.ts's doc comment for the full root-cause writeup).
   * Unlike filterForConnectivity above, this deliberately does NOT fall
   * back to the unfiltered list when narrowing would leave zero candidates
   * — 'local' silently falling back to racing cloud providers anyway would
   * defeat the entire point of choosing it (guaranteed no-cost/offline/
   * private execution). An empty result here is meant to surface as a
   * clear "nothing available in this mode" error, not a silent bypass.
   */
  private applyRoutingMode(
    candidates: ProviderConfig[],
    log?: (message: string, level?: 'info' | 'warn' | 'error') => void
  ): ProviderConfig[] {
    const mode = getRoutingMode();
    if (mode === 'hybrid') return candidates;
    const filtered = mode === 'local'
      ? candidates.filter(p => LOCAL_ADAPTER_IDS.has(p.adapterId))
      : candidates.filter(p => !LOCAL_ADAPTER_IDS.has(p.adapterId));
    if (filtered.length !== candidates.length) {
      log?.(
        `Routing mode is "${mode === 'local' ? 'Local Only' : 'Cloud Only'}" — ` +
        `${candidates.length - filtered.length} otherwise-eligible provider(s) excluded ` +
        `(change this in Keys & Providers if you want them included).`,
        'info'
      );
    }
    return filtered;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, providerName: string): Promise<T> {
    const bounded = Math.max(1000, timeoutMs || 30000); // never allow an effectively-zero/undefined timeout to fire instantly
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`${providerName} did not respond within ${Math.round(bounded / 1000)}s (timed out) — moving to the next available provider.`));
      }, bounded);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (err) => { clearTimeout(timer); reject(err); }
      );
    });
  }

  async callWithFallback(
    type: ProviderType,
    router: SmartRouter,
    input: any,
    options: Record<string, any> = {},
    log?: (message: string, level?: 'info' | 'warn' | 'error') => void
  ): Promise<any> {
    const candidates = this.filterForConnectivity(
      this.applyRoutingMode(
        this.filterForEnvironment(
          router
            .getSortedProviders(type)
            .filter(p => p.noKeyNeeded || !!p.apiKey)
            // A provider can be registered under type:'text' purely so
            // callVision() can find it (see the `visionOnly` doc comment in
            // types.ts) — it has no ability to answer a genuine text-generation
            // request, so exclude it here to avoid a guaranteed, noisy failure
            // eating a slot (and a real timeout window) in the fallback chain.
            .filter(p => !p.visionOnly),
          log
        ),
        log
      ),
      log
    );

    if (candidates.length === 0) {
      const mode = getRoutingMode();
      const envBlocked = router.getSortedProviders(type)
        .filter(p => (p.noKeyNeeded || !!p.apiKey) && !p.visionOnly)
        .some(p => !computeProviderCapability(p).available);
      throw new Error(
        mode !== 'hybrid'
          ? `No enabled '${type}' provider matches routing mode "${mode === 'local' ? 'Local Only' : 'Cloud Only'}" — ` +
            `switch modes or add/enable a matching provider in Keys & Providers.`
          : envBlocked
            ? `No '${type}' provider is available on ${Environment.current} — the configured option(s) require a backend server ` +
              `that isn't reachable here. Add a browser-native provider (Transformers.js/WebLLM/Puter) or self-host with server/proxy-server.mjs.`
            : `No configured/enabled provider is available for '${type}' — add an API key for at least one provider of this type in Keys & Providers.`
      );
    }

    // ProviderReport (see ../ProviderReport.ts): mirrors `errors` above but
    // keeps enough structure (name + status) to render the ✓ / ⚠ checklist
    // the app's Provider Report requirement calls for, without changing
    // this method's return type or any caller.
    const attempts: ProviderAttempt[] = [];

    // Priority 4: validate endpoint, model/adapter, auth/API key, and
    // timeout BEFORE attempting the call, with a clear reason recorded
    // per-provider instead of only ever seeing a raw fetch error (or a
    // provider being silently skipped with no explanation at all). This
    // pass is synchronous and cheap — it must finish before anything races,
    // so an obviously-unusable provider (no key, no adapter, etc.) never
    // occupies a race slot or delays the ones that actually can run.
    const runnable: { provider: ProviderConfig; adapter: import('../types').Adapter }[] = [];
    const coolingDown: { provider: ProviderConfig; adapter: import('../types').Adapter }[] = [];
    for (const provider of candidates) {
      const adapter = this.registry.getAdapter(provider.adapterId);
      const validation = ProviderValidator.validateForCall(provider, !!(adapter && adapter.call));
      if (!validation.valid) {
        const reason = validation.errors.join(' ');
        log?.(`${provider.name}: skipped — ${reason}`, 'warn');
        attempts.push({ name: provider.name, status: 'skipped', detail: reason });
        continue;
      }
      // PHASE 3b: a provider that just failed from an auth/not-found/etc.
      // error is certain to fail the exact same way again right now — skip
      // it rather than burning a race slot (and up to its full timeoutMs)
      // on a guaranteed repeat failure. See HealthCooldown.ts.
      if (isInCooldown(provider.health)) {
        const remaining = cooldownRemainingLabel(provider.health);
        const reason = `cooling down (${remaining} left) after ${cooldownReasonLabel(provider.health!.failureCategory as any)}`;
        log?.(`${provider.name}: skipped — ${reason}`, 'warn');
        attempts.push({ name: provider.name, status: 'skipped', detail: reason });
        coolingDown.push({ provider, adapter: adapter! });
        continue;
      }
      runnable.push({ provider, adapter: adapter! });
    }
    if (runnable.length === 0 && coolingDown.length > 0) {
      log?.('Every otherwise-valid provider is cooling down from recent failures — trying them anyway since nothing else is available.', 'warn');
      runnable.push(...coolingDown);
    }

    if (runnable.length === 0) {
      throw new Error(formatAllFailedMessage(type, attempts));
    }

    // Surface the race up front so it never looks like a silent hang —
    // worst case is now the SLOWEST single candidate's timeout, not the sum
    // of all of them, because they run in parallel (see raceForFirstSuccess
    // below), and in practice it resolves as soon as the fastest succeeds.
    if (runnable.length > 1) {
      const worstCaseMs = Math.max(...runnable.map(r => r.provider.timeoutMs || 30000));
      log?.(
        `Racing ${runnable.length} provider(s) in parallel — first valid response wins, the rest are ` +
        `cancelled: ${runnable.map(r => r.provider.name).join(', ')} ` +
        `(worst case, if only the slowest succeeds: up to ~${Math.round(worstCaseMs / 1000)}s).`
      );
    } else {
      log?.(`Trying ${runnable[0].provider.name}…`);
    }

    return this.raceForFirstSuccess(runnable, type, input, options, attempts, log, Logger.newRequestId());
  }

  /**
   * "Fastest Successful Provider Wins" — the core reliability/latency fix
   * (Phase 2 of the runtime audit). The previous implementation `await`ed
   * each candidate in strict priority order, one at a time — a slow-but-
   * eventually-successful first candidate (or several that each burn their
   * full `timeoutMs` failing before the next is even started) meant total
   * wait time was the SUM of every attempt ahead of the one that finally
   * answered, occasionally over two minutes for a request that a healthy
   * provider answers in 1-2 seconds.
   *
   * Here every runnable candidate is started at the same time. Whichever
   * settles successfully FIRST resolves the whole call immediately — the
   * user sees output as fast as the single fastest provider, not the sum of
   * every one tried before it. The remaining in-flight attempts are told to
   * abort via `options.signal` (adapters built on `fetchWithRetry` — the
   * majority — honor this and cancel their network request immediately;
   * see BaseAdapter.fetchWithRetry). Third-party SDK calls with no
   * cancellation hook of their own (Puter, WebLLM, Transformers.js model
   * loading) can't be forcibly stopped — exactly as the requirement allows
   * ("ignored after a winner exists") — so those are simply left to finish
   * in the background and their eventual result is discarded; they don't
   * block the response that already rendered.
   *
   * Every attempt (winner, cancelled loser, or genuine failure) still
   * updates provider health and feeds the Pipeline Report — diagnostics
   * keep collecting in the background exactly as Phase 2 requires, they
   * just no longer gate the response.
   */
  private raceForFirstSuccess(
    runnable: { provider: ProviderConfig; adapter: import('../types').Adapter }[],
    type: ProviderType,
    input: any,
    options: Record<string, any>,
    attempts: ProviderAttempt[],
    log?: (message: string, level?: 'info' | 'warn' | 'error') => void,
    requestId: string = Logger.newRequestId()
  ): Promise<any> {
    return new Promise((resolve, reject) => {
      const total = runnable.length;
      const controllers = runnable.map(() => new AbortController());
      let settled = 0;
      let winnerFound = false;

      // Nothing prevents two ProviderConfig entries from sharing a display
      // name (only `id` has to be unique) — a built-in "Groq" with a bad
      // key racing alongside a custom "Groq" entry with a working one is a
      // real, easy-to-hit setup, and without this, the log would show the
      // confusing-looking (but not actually contradictory) sequence
      // "Groq failed — 401" immediately followed by "Groq succeeded
      // first", two different entries that just happen to share a name.
      // This disambiguates only when a collision actually exists in THIS
      // race, so the common case (no collision) logs exactly as before.
      const nameCounts = new Map<string, number>();
      runnable.forEach(({ provider }) => nameCounts.set(provider.name, (nameCounts.get(provider.name) || 0) + 1));
      const displayName = (provider: ProviderConfig): string =>
        (nameCounts.get(provider.name) || 0) > 1 ? `${provider.name} (priority ${provider.priority})` : provider.name;

      const maybeLogBackgroundReport = () => {
        if (settled === total && winnerFound && attempts.length > 1) {
          log?.(`Provider report (background diagnostics):\n${formatProviderReport(attempts)}`, 'info');
        }
      };

      runnable.forEach(({ provider, adapter }, index) => {
        const attemptStartedAt = Date.now();
        // Same per-provider model-alias rule as before: the UI's
        // "Preferred model" override only applies to the adapter it was
        // written for, never forced onto every other racing candidate.
        const modelForThisProvider =
          options.model && provider.adapterId === options.modelAdapterHint
            ? options.model
            : provider.defaultModel;

        // PHASE 6 — optional side-channel callbacks an adapter can report
        // through without changing its return type (adapters return a
        // plain string/URL/etc by design — see BaseAdapter's doc comment —
        // so this, not a richer return shape, is how token usage/retry
        // count reach the structured log below). Neither is required;
        // an adapter that never calls them just logs as "n/a" for that field.
        let capturedTokens: ProviderCallEvent['tokens'];
        let capturedRetryCount: number | undefined;

        this.withTimeout(
          adapter.call!(provider, input, {
            ...options,
            model: options.mode ? (options.model ?? provider.defaultModel) : modelForThisProvider,
            mode: options.mode || provider.type,
            signal: controllers[index].signal,
            onUsage: (usage: { prompt?: number; completion?: number; total?: number }) => { capturedTokens = usage; },
            onRetry: (count: number) => { capturedRetryCount = count; },
          }),
          provider.timeoutMs,
          displayName(provider)
        ).then((result) => {
          settled++;
          const latencyMs = Date.now() - attemptStartedAt;
          this.registry.updateHealth(provider.id, {
            status: 'healthy',
            lastCheck: Date.now(),
            responseTime: latencyMs,
          });
          attempts.push({ name: displayName(provider), status: 'ok' });
          this.lastLocalModelMissing = null;
          const isWinner = !winnerFound;
          Logger.event({
            requestId, provider: provider.name, model: modelForThisProvider, latencyMs,
            tokens: capturedTokens, retryCount: capturedRetryCount, winner: isWinner,
          });
          if (!winnerFound) {
            winnerFound = true;
            log?.(`${displayName(provider)} succeeded first — rendering result now.`, 'info');
            // Cancel every other still-pending attempt. Abortable ones
            // (fetch-based adapters) stop immediately; non-abortable ones
            // are simply ignored once they eventually settle below.
            controllers.forEach((c, i) => { if (i !== index) c.abort(); });
            resolve(result);
          }
          maybeLogBackgroundReport();
        }).catch((err: any) => {
          settled++;
          const latencyMs = Date.now() - attemptStartedAt;
          const message = err?.message || String(err);
          const isModelMissing = err?.code === 'LOCAL_MODEL_NOT_INSTALLED';
          if (isModelMissing) {
            // Not a broken provider — it just needs an explicit download
            // (see LocalModelDownloadManager.ts). Marking it 'unhealthy'
            // here would eventually trigger HealthCooldown and start
            // skipping a perfectly good local provider purely because
            // nobody has clicked Download yet, which is misleading.
            this.lastLocalModelMissing = { modelId: err.modelId, task: err.task, provider: provider.name, at: Date.now() };
          } else {
            this.registry.updateHealth(provider.id, {
              status: 'unhealthy',
              lastCheck: Date.now(),
              responseTime: latencyMs,
              lastError: message,
            });
          }
          attempts.push({ name: displayName(provider), status: 'error', detail: message });
          Logger.event({
            requestId, provider: provider.name, model: modelForThisProvider, latencyMs,
            retryCount: capturedRetryCount, failureReason: `${classifyFailure(message)}: ${message}`,
          });
          if (!winnerFound) {
            log?.(`${displayName(provider)} failed — ${message}`, 'error');
          }
          if (settled === total && !winnerFound) {
            reject(new Error(formatAllFailedMessage(type, attempts)));
          }
          maybeLogBackgroundReport();
        });
      });
    });
  }

  /**
   * Vision (image understanding) reuses the existing 'text' provider entries
   * rather than needing separate vision-specific registry entries — so a key
   * you already entered for, say, Anthropic text generation works for vision
   * too, with no extra setup. Only adapters that actually support multimodal
   * image input (Anthropic, Gemini) are attempted.
   */
  async callVision(
    imageBase64: string,
    prompt: string,
    router: SmartRouter,
    log?: (message: string, level?: 'info' | 'warn' | 'error') => void,
    // User-controllable per-call flags (see VisionMode.ts's "Also read text
    // in the image (OCR)" checkbox) — kept as a small passthrough bag
    // rather than new callVision params for each future flag, and merged
    // into the options every adapter receives so nothing here is decided
    // for the user with no way to turn it off (see
    // TransformersAdapter.caption's use of includeOcr).
    extraOptions?: { includeOcr?: boolean }
  ): Promise<string> {
    // Anthropic and Gemini's own adapters always speak their native
    // multimodal format. 'puter' is included because Puter.js genuinely
    // supports image analysis with zero API key (puter.ai.chat(prompt,
    // imageUrl, opts) — see PuterAdapter.vision) — this is what gives
    // Vision mode a real no-setup path instead of requiring a paid
    // provider key. Beyond those, OpenAICompatibleAdapter also builds the
    // standard image_url content block (see that file), so any provider
    // routed through it (OpenRouter, GitHub Models, Groq, etc.) is a valid
    // vision candidate too — whether it actually works depends on whether
    // the *model* the user picked for that provider supports image input,
    // which the fallback chain below surfaces as a clear per-provider
    // error rather than pretending only a fixed list could ever work.
    // 'transformers' (Transformers.js image captioning, fully local/no-key)
    // and 'ollama' (only useful if the user has pulled a vision-capable
    // model like "llava" and set it as that provider's Preferred model) are
    // included so Vision has a genuine zero-setup path — see
    // builtin-transformers-vision in defaultProviders.ts, which is what
    // guarantees this list is never empty on a fresh install.
    const VISION_CAPABLE_ADAPTERS = ['anthropic', 'gemini', 'puter', 'openai-compatible', 'transformers', 'ollama'];
    const candidates = this.filterForConnectivity(
      this.applyRoutingMode(
        this.filterForEnvironment(
          router
            .getSortedProviders('text')
            .filter(p => VISION_CAPABLE_ADAPTERS.includes(p.adapterId) && (p.noKeyNeeded || !!p.apiKey))
            // 'transformers' now backs two distinct provider entries sharing
            // this one adapterId — a genuine text-generation one (see
            // builtin-transformers-text) and an image-captioning one (see
            // builtin-transformers-vision, visionOnly:true). Only the latter
            // belongs here; including the text entry would try to run its
            // chat model through an image-to-text pipeline and guarantee a
            // failure on every single Vision request.
            .filter(p => p.adapterId !== 'transformers' || p.visionOnly === true),
          log
        ),
        log
      ),
      log
    );

    if (candidates.length === 0) {
      const routingMode = getRoutingMode();
      if (routingMode !== 'hybrid') {
        throw new Error(
          `No vision-capable provider matches routing mode "${routingMode === 'local' ? 'Local Only' : 'Cloud Only'}" — ` +
          `switch modes in Keys & Providers, or enable a matching vision provider.`
        );
      }
      // Diagnose the actual cause instead of one generic message — in
      // particular, distinguish "Puter exists but its checkbox is off"
      // (a one-click fix) from "Puter isn't in the provider list at all"
      // (needs Reset to Defaults) from "no free option and no key
      // anywhere" (needs a key). All text providers are checked here
      // (not just enabled ones) specifically to catch the disabled case.
      const puterProvider = this.registry.getAllProviders().find(p => p.adapterId === 'puter' && p.type === 'text');
      let reason: string;
      if (puterProvider && !puterProvider.enabled) {
        reason = 'The built-in "Puter.js (optional, no key)" provider is installed but currently disabled — ' +
          'turn its checkbox on in Keys & Providers (Text category) to use it for Vision at no cost, no API key needed.';
      } else if (!puterProvider) {
        reason = 'The built-in "Puter.js (optional, no key)" provider is missing from your provider list — ' +
          'click "Reset to Defaults" in Keys & Providers to restore it, or add an API key for Anthropic, Gemini, ' +
          'OpenAI, or another OpenAI-compatible provider with a vision-capable model (e.g. gpt-4o).';
      } else {
        reason = 'Add an API key for a provider whose model supports image understanding (Anthropic Claude, ' +
          'Google Gemini, OpenAI, or another OpenAI-compatible provider such as OpenRouter/GitHub Models using ' +
          'a vision-capable model, e.g. gpt-4o) in Keys & Providers.';
      }
      throw new Error(`No vision-capable provider is configured or enabled. ${reason}`);
    }

    const attempts: ProviderAttempt[] = [];
    const runnable: { provider: ProviderConfig; adapter: import('../types').Adapter }[] = [];
    const coolingDown: { provider: ProviderConfig; adapter: import('../types').Adapter }[] = [];
    for (const provider of candidates) {
      const adapter = this.registry.getAdapter(provider.adapterId);
      const validation = ProviderValidator.validateForCall(provider, !!(adapter && adapter.call));
      if (!validation.valid) {
        const reason = validation.errors.join(' ');
        log?.(`${provider.name}: skipped — ${reason}`, 'warn');
        attempts.push({ name: provider.name, status: 'skipped', detail: reason });
        continue;
      }
      if (isInCooldown(provider.health)) {
        const remaining = cooldownRemainingLabel(provider.health);
        const reason = `cooling down (${remaining} left) after ${cooldownReasonLabel(provider.health!.failureCategory as any)}`;
        log?.(`${provider.name}: skipped — ${reason}`, 'warn');
        attempts.push({ name: provider.name, status: 'skipped', detail: reason });
        coolingDown.push({ provider, adapter: adapter! });
        continue;
      }
      runnable.push({ provider, adapter: adapter! });
    }
    if (runnable.length === 0 && coolingDown.length > 0) {
      log?.('Every otherwise-valid vision provider is cooling down from recent failures — trying them anyway since nothing else is available.', 'warn');
      runnable.push(...coolingDown);
    }

    if (runnable.length === 0) {
      throw new Error(formatAllFailedMessage('vision', attempts));
    }

    if (runnable.length > 1) {
      log?.(`Racing ${runnable.length} vision-capable provider(s) in parallel — first valid response wins: ` +
        `${runnable.map(r => r.provider.name).join(', ')}.`);
    } else {
      log?.(`Analyzing image with ${runnable[0].provider.name}…`);
    }

    // Same "fastest successful provider wins" race as callWithFallback (see
    // raceForFirstSuccess's doc comment) — Vision requests no longer wait
    // for slower multimodal providers once a faster one has already
    // produced a valid description.
    return this.raceForFirstSuccess(
      runnable,
      'vision' as ProviderType,
      { prompt, imageBase64 },
      { mode: 'vision', log, ...extraOptions },
      attempts,
      log,
      Logger.newRequestId()
    );
  }

  // Delegate some methods to registry for convenience
  getProviders(type?: string, enabledOnly?: boolean) {
    return this.registry.getProviders(type as any, enabledOnly);
  }

  /**
   * The most recent "local model isn't downloaded yet" failure (see
   * ModelNotInstalledError in TransformersAdapter.ts and raceForFirstSuccess's
   * catch handler below), if the very last call hit one — cleared as soon
   * as any call succeeds. Lets a Mode offer a direct "Download it" button
   * instead of just a text message.
   */
  getLastLocalModelMissing(): LocalModelMissingInfo | null {
    return this.lastLocalModelMissing;
  }
  getProvider(id: string) {
    return this.registry.getProvider(id);
  }
  /** Runtime environment capability for one provider — see ./Capability.ts. Exposed here so UI callers (SettingsModal's Provider Cards) go through the same ProviderManager surface as everything else, rather than importing Capability.ts directly. */
  getCapability(id: string) {
    const provider = this.registry.getProvider(id);
    return provider ? computeProviderCapability(provider) : undefined;
  }
  updateProvider(id: string, updates: Partial<ProviderConfig>) {
    this.registry.updateProvider(id, updates);
    // Auto-save? Could be debounced.
    this.saveProviders();
  }

  /** Whether this adapter can list a person's actually-installed models (Ollama today) — used to decide whether to show a "Discover" button. */
  adapterSupportsModelDiscovery(adapterId: string): boolean {
    return !!this.registry.getAdapter(adapterId)?.supportsModelDiscovery;
  }

  /**
   * Item 10's "auto-discover installed models" — OllamaAdapter.fetchModels()
   * (and Adapter.supportsModelDiscovery generally) already existed on the
   * interface but nothing in the UI ever called it; this is the missing
   * wiring, mirroring testProvider()'s exact provider/adapter lookup so
   * the Local Models Manager UI (or any future caller) has one clean entry
   * point instead of reaching into the registry/adapter internals itself.
   */
  async fetchModelsFor(id: string): Promise<string[]> {
    const provider = this.registry.getProvider(id);
    const adapter = provider ? this.registry.getAdapter(provider.adapterId) : undefined;
    if (!provider || !adapter?.supportsModelDiscovery || !adapter.fetchModels) {
      throw new Error('This provider doesn\'t support model discovery.');
    }
    return adapter.fetchModels(provider);
  }

  /**
   * PHASE 7 — Provider Testing. Runs the adapter's testConnection (a real
   * minimal request for OpenAICompatibleAdapter — see that file — or the
   * config-only check other adapter kinds use), scores it, feeds the
   * outcome into the SAME health/cooldown tracking a real call's
   * success/failure would (so a manual test that catches a bad key
   * protects real requests too, not just a separate display-only result —
   * see Registry.updateHealth / HealthCooldown.ts from Phase 3b), and
   * persists the result onto the provider (ProviderConfig.lastTestResult)
   * so it survives closing and reopening Keys & Providers.
   */
  async testProvider(id: string): Promise<ProviderTestResult> {
    const provider = this.registry.getProvider(id);
    const adapter = provider ? this.registry.getAdapter(provider.adapterId) : undefined;
    if (!provider || !adapter?.testConnection) {
      const result: ProviderTestResult = { ok: false, message: 'This provider has no test implementation.', testedAt: Date.now() };
      return result;
    }

    // ROOT CAUSE FIX: this used to go straight to adapter.testConnection(),
    // which meant the Test button never ran the same general validation
    // callWithFallback already runs before a real request (see
    // ProviderValidator.validateForCall, and its filterForConnectivity
    // call site above). Each adapter's testConnection had to re-implement
    // its own ad-hoc pre-checks instead — OpenAICompatibleAdapter's own
    // version checked `authType !== 'none'` before requiring a Base URL,
    // which is wrong for a provider like Piper (self-hosted TTS): it has
    // authType:'none' (no API key needed) but still genuinely needs a
    // real Base URL pointing at wherever it's actually running. An empty
    // default baseUrl plus that wrong condition meant the check never
    // fired, and the "test" silently became a same-origin relative fetch
    // (e.g. hitting this app's OWN dev server at "/chat/completions"),
    // producing a fast, contextless 404 with no clue what was actually
    // wrong. validateForCall's check is keyed on whether the ADAPTER is
    // genuinely local/browser-native, a different and correct question
    // from whether an API key is needed.
    const validation = ProviderValidator.validateForCall(provider, !!(adapter && adapter.call));
    if (!validation.valid) {
      const result: ProviderTestResult = {
        ok: false,
        message: validation.errors.join(' '),
        testedAt: Date.now(),
        category: 'other',
      };
      this.registry.updateProvider(id, { lastTestResult: result });
      return result;
    }

    // Same reasoning as filterForEnvironment above: on a static host with
    // no backend proxy, this provider is GUARANTEED to fail — testing it
    // anyway would just produce a confusing "404" from GitHub Pages' own
    // 404 page (not even a real proxy error) instead of the clear,
    // actionable message computeProviderCapability already has ready.
    const capability = computeProviderCapability(provider);
    if (!capability.available) {
      const result: ProviderTestResult = {
        ok: false,
        message: `${provider.name}: ${capability.disabledReason} (running on ${Environment.current}).`,
        testedAt: Date.now(),
        category: 'other',
      };
      this.registry.updateProvider(id, { lastTestResult: result });
      return result;
    }

    const result = await adapter.testConnection(provider);
    // Score: mostly pass/fail (70 for a bare pass), with a latency bonus —
    // fast and correct scores higher than technically-correct-but-slow,
    // which matters for a fallback chain where speed is part of the point.
    if (result.ok) {
      const latency = result.latencyMs ?? Infinity;
      const latencyBonus = latency < 500 ? 30 : latency < 1500 ? 20 : latency < 3000 ? 10 : 0;
      result.healthScore = 70 + latencyBonus;
    } else {
      result.healthScore = 0;
    }

    this.registry.updateHealth(id, {
      status: result.ok ? 'healthy' : 'unhealthy',
      lastCheck: result.testedAt,
      responseTime: result.latencyMs,
      lastError: result.ok ? undefined : result.message,
    });
    this.registry.updateProvider(id, { lastTestResult: result });
    await this.saveProviders();
    return result;
  }

  setEnabled(id: string, enabled: boolean) {
    this.registry.setEnabled(id, enabled);
    this.saveProviders();
  }
  removeProvider(id: string) {
    this.registry.removeProvider(id);
    this.saveProviders();
  }
  addProvider(provider: ProviderConfig) {
    this.registry.registerProvider(provider);
    this.saveProviders();
  }
}
