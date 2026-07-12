import { ProviderRegistry } from './Registry';
import { ProviderConfig, ProviderType } from '../types';
import { SmartRouter } from '../Router';
import { Persistence } from '../../core/state/Persistence';
import { EventBus } from '../../core/EventBus';
import { Logger } from '../../core/Logger';
import { ProviderValidator } from '../../config/ProviderValidator';

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
  async callWithFallback(
    type: ProviderType,
    router: SmartRouter,
    input: any,
    options: Record<string, any> = {},
    log?: (message: string, level?: 'info' | 'warn' | 'error') => void
  ): Promise<any> {
    const candidates = router
      .getSortedProviders(type)
      .filter(p => p.noKeyNeeded || !!p.apiKey);

    if (candidates.length === 0) {
      throw new Error(
        `No configured/enabled provider is available for '${type}' — add an API key for at least one provider of this type in Keys & Providers.`
      );
    }

    const errors: string[] = [];
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
        const result = await adapter!.call!(provider, input, {
          ...options,
          model: modelForThisProvider,
          mode: provider.type,
        });
        log?.(`${provider.name} succeeded.`, 'info');
        return result;
      } catch (err: any) {
        const message = err?.message || String(err);
        errors.push(`${provider.name}: ${message}`);
        log?.(`${provider.name} failed — ${message}`, 'error');
      }
    }

    throw new Error(
      `All ${candidates.length} provider(s) for '${type}' failed:\n` + errors.join('\n')
    );
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
    // multimodal format. Beyond those two, OpenAICompatibleAdapter now
    // also builds the standard image_url content block (see that file),
    // so any provider routed through it (OpenRouter, GitHub Models, Groq,
    // etc.) is a valid vision candidate too — whether it actually works
    // depends on whether the *model* the user picked for that provider
    // supports image input, which the fallback chain below surfaces as a
    // clear per-provider error rather than pretending only two providers
    // could ever work.
    const VISION_CAPABLE_ADAPTERS = ['anthropic', 'gemini', 'openai-compatible'];
    const candidates = router
      .getSortedProviders('text')
      .filter(p => VISION_CAPABLE_ADAPTERS.includes(p.adapterId) && (p.noKeyNeeded || !!p.apiKey));

    if (candidates.length === 0) {
      throw new Error(
        "No vision-capable provider is configured — add an API key for a provider whose model supports image " +
        "understanding (Anthropic Claude, Google Gemini, OpenAI, or another OpenAI-compatible provider such as " +
        "OpenRouter/GitHub Models using a vision-capable model, e.g. gpt-4o) in Keys & Providers. " +
        "This uses the same key/provider you'd use for text generation."
      );
    }

    const errors: string[] = [];
    for (const provider of candidates) {
      const adapter = this.registry.getAdapter(provider.adapterId);
      const validation = ProviderValidator.validateForCall(provider, !!(adapter && adapter.call));
      if (!validation.valid) {
        const reason = validation.errors.join(' ');
        log?.(`${provider.name}: skipped — ${reason}`, 'warn');
        errors.push(`${provider.name}: ${reason}`);
        continue;
      }
      log?.(`Analyzing image with ${provider.name}…`);
      try {
        const result = await adapter!.call!(
          provider,
          { prompt, imageBase64 },
          { model: provider.defaultModel, mode: 'vision' }
        );
        log?.(`${provider.name} succeeded.`, 'info');
        return result;
      } catch (err: any) {
        const message = err?.message || String(err);
        errors.push(`${provider.name}: ${message}`);
        log?.(`${provider.name} failed — ${message}`, 'error');
      }
    }
    throw new Error(`All vision provider(s) failed:\n` + errors.join('\n'));
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
