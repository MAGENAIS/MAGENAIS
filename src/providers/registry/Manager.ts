import { ProviderRegistry } from './Registry';
import { ProviderConfig, ProviderType } from '../types';
import { SmartRouter } from '../Router';
import { Persistence } from '../../core/state/Persistence';
import { EventBus } from '../../core/EventBus';
import { Logger } from '../../core/Logger';
import { ProviderValidator } from '../../config/ProviderValidator';
import { ProviderAttempt, formatProviderReport, formatAllFailedMessage } from '../ProviderReport';

export class ProviderManager {
  private registry: ProviderRegistry;
  private persistence: Persistence;
  private legacyPersistence?: Persistence;
  private storageKey: string = 'magenais:providers';
  // Bumping this invalidates nothing by itself — it's stamped into saved
  // data so a future migration can detect "this was written by an older
  // shape of ProviderManager" and adapt instead of guessing.
  private static readonly SCHEMA_VERSION = 2;

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
        'llama-3.3-70b': 'llama-4-scout', // Cerebras — retired from their free-tier catalog
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
      // tuning values. These shipped with much longer timeouts and (for
      // WebLLM) a heavier default model in an earlier version, before a
      // responsiveness fix reduced them — but an install that already
      // seeded these built-ins keeps the old, stale numbers forever under
      // the normal "stored always wins" rule, silently reintroducing the
      // exact multi-minute hangs that fix addressed. `timeoutMs` has no
      // settings-UI field a user could have intentionally changed, so it's
      // always safe to resync for these two specific, always-free
      // adapters; `defaultModel` is only swapped when it still exactly
      // equals the old known-stale value, so a genuinely user-picked
      // "Preferred model" is left untouched.
      if (trueDefault && p.isBuiltIn && p.noKeyNeeded && (p.adapterId === 'webllm' || p.adapterId === 'transformers')) {
        const patch: Partial<ProviderConfig> = {};
        if (p.timeoutMs !== trueDefault.timeoutMs) patch.timeoutMs = trueDefault.timeoutMs;
        if (p.defaultModel === 'Llama-3.2-3B-Instruct-q4f16_1-MLC' && trueDefault.defaultModel !== p.defaultModel) {
          patch.defaultModel = trueDefault.defaultModel;
        }
        if (Object.keys(patch).length > 0) {
          p = { ...p, ...patch };
          Logger.info(`ProviderManager: refreshed "${p.name}"'s tuning defaults (timeout/model) to the latest, faster-failing values.`);
        }
      }
      if (existing) {
        // Merge: stored values take precedence, but we keep the id and type from default if missing
        mergedMap.set(p.id, { ...existing, ...p });
      } else {
        // Custom provider (not in defaults), or a previously-deleted default
        // the user re-added by hand — either way, trust the stored copy.
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
    const candidates = router
      .getSortedProviders(type)
      .filter(p => p.noKeyNeeded || !!p.apiKey)
      // A provider can be registered under type:'text' purely so
      // callVision() can find it (see the `visionOnly` doc comment in
      // types.ts) — it has no ability to answer a genuine text-generation
      // request, so exclude it here to avoid a guaranteed, noisy failure
      // eating a slot (and a real timeout window) in the fallback chain.
      .filter(p => !p.visionOnly);

    if (candidates.length === 0) {
      throw new Error(
        `No configured/enabled provider is available for '${type}' — add an API key for at least one provider of this type in Keys & Providers.`
      );
    }

    const errors: string[] = [];
    // ProviderReport (see ../ProviderReport.ts): mirrors `errors` above but
    // keeps enough structure (name + status) to render the ✓ / ⚠ checklist
    // the app's Provider Report requirement calls for, without changing
    // this method's return type or any caller.
    const attempts: ProviderAttempt[] = [];
    for (const provider of candidates) {
      const adapter = this.registry.getAdapter(provider.adapterId);
      // Priority 4: validate endpoint, model/adapter, auth/API key, and
      // timeout BEFORE attempting the call, with a clear reason recorded
      // per-provider instead of only ever seeing a raw fetch error (or a
      // provider being silently skipped with no explanation at all).
      const validation = ProviderValidator.validateForCall(provider, !!(adapter && adapter.call));
      if (!validation.valid) {
        const reason = validation.errors.join(' ');
        log?.(`${provider.name}: skipped — ${reason}`, 'warn');
        errors.push(`${provider.name}: ${reason}`);
        attempts.push({ name: provider.name, status: 'skipped', detail: reason });
        continue;
      }
      log?.(`Trying ${provider.name}…`);
      try {
        // The UI's "Preferred model" field offers provider-specific aliases
        // (e.g. Pollinations' own "openai"/"mistral"/"claude" routing names) —
        // applying that override to every other provider in the fallback chain
        // would force an invalid model id on them the moment the intended
        // provider fails. Only honor it for the adapter it was written for;
        // every other candidate falls back to its own configured defaultModel.
        const modelForThisProvider =
          options.model && provider.adapterId === options.modelAdapterHint
            ? options.model
            : provider.defaultModel;
        const result = await this.withTimeout(
          adapter!.call!(provider, input, {
            ...options,
            model: modelForThisProvider,
            mode: provider.type,
          }),
          provider.timeoutMs,
          provider.name
        );
        log?.(`${provider.name} succeeded.`, 'info');
        attempts.push({ name: provider.name, status: 'ok' });
        // Surface the full checklist (winner + everyone skipped/failed
        // before it) as one summary log line, so a user who only glances
        // at the last log entry still sees the full picture, not just
        // "succeeded" with no context on what else was tried.
        if (attempts.length > 1) {
          log?.(`Provider report:\n${formatProviderReport(attempts)}`, 'info');
        }
        return result;
      } catch (err: any) {
        const message = err?.message || String(err);
        errors.push(`${provider.name}: ${message}`);
        attempts.push({ name: provider.name, status: 'error', detail: message });
        log?.(`${provider.name} failed — ${message}`, 'error');
      }
    }

    throw new Error(formatAllFailedMessage(type, attempts));
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
    log?: (message: string, level?: 'info' | 'warn' | 'error') => void
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
    const candidates = router
      .getSortedProviders('text')
      .filter(p => VISION_CAPABLE_ADAPTERS.includes(p.adapterId) && (p.noKeyNeeded || !!p.apiKey));

    if (candidates.length === 0) {
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

    const errors: string[] = [];
    const attempts: ProviderAttempt[] = [];
    for (const provider of candidates) {
      const adapter = this.registry.getAdapter(provider.adapterId);
      const validation = ProviderValidator.validateForCall(provider, !!(adapter && adapter.call));
      if (!validation.valid) {
        const reason = validation.errors.join(' ');
        log?.(`${provider.name}: skipped — ${reason}`, 'warn');
        errors.push(`${provider.name}: ${reason}`);
        attempts.push({ name: provider.name, status: 'skipped', detail: reason });
        continue;
      }
      log?.(`Analyzing image with ${provider.name}…`);
      try {
        const result = await this.withTimeout(
          adapter!.call!(
            provider,
            { prompt, imageBase64 },
            { model: provider.defaultModel, mode: 'vision' }
          ),
          provider.timeoutMs,
          provider.name
        );
        log?.(`${provider.name} succeeded.`, 'info');
        attempts.push({ name: provider.name, status: 'ok' });
        if (attempts.length > 1) {
          log?.(`Provider report:\n${formatProviderReport(attempts)}`, 'info');
        }
        return result;
      } catch (err: any) {
        const message = err?.message || String(err);
        errors.push(`${provider.name}: ${message}`);
        attempts.push({ name: provider.name, status: 'error', detail: message });
        log?.(`${provider.name} failed — ${message}`, 'error');
      }
    }
    throw new Error(formatAllFailedMessage('vision', attempts));
  }

  // Delegate some methods to registry for convenience
  getProviders(type?: string, enabledOnly?: boolean) {
    return this.registry.getProviders(type as any, enabledOnly);
  }
  getProvider(id: string) {
    return this.registry.getProvider(id);
  }
  updateProvider(id: string, updates: Partial<ProviderConfig>) {
    this.registry.updateProvider(id, updates);
    // Auto-save? Could be debounced.
    this.saveProviders();
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
