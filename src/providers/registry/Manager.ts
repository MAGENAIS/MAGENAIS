import { ProviderRegistry } from './Registry';
import { ProviderConfig, ProviderType } from '../types';
import { SmartRouter } from '../Router';
import { Persistence } from '../../core/state/Persistence';
import { EventBus } from '../../core/EventBus';
import { Logger } from '../../core/Logger';

export class ProviderManager {
  private registry: ProviderRegistry;
  private persistence: Persistence;
  private storageKey: string = 'magenais:providers';

  constructor(registry: ProviderRegistry, persistence: Persistence, eventBus: EventBus) {
    this.registry = registry;
    this.persistence = persistence;
  }

  /**
   * Load providers from persistence (localStorage/IndexedDB) and merge with defaults.
   * This should be called during application bootstrap.
   */
  async loadProviders(defaultProviders: ProviderConfig[]): Promise<void> {
    let stored: ProviderConfig[] = [];
    try {
      const data = await this.persistence.load();
      if (data && data.providers) {
        stored = data.providers;
      }
    } catch (e) {
      Logger.warn('Failed to load providers from persistence, using defaults.', e);
    }

    // Merge: stored providers override defaults by id, but we also add any missing defaults.
    const mergedMap = new Map<string, ProviderConfig>();
    // First add defaults
    defaultProviders.forEach(p => mergedMap.set(p.id, { ...p }));
    // Then override with stored (keep stored API keys, enabled status, etc.)
    stored.forEach(p => {
      const existing = mergedMap.get(p.id);
      if (existing) {
        // Merge: stored values take precedence, but we keep the id and type from default if missing
        mergedMap.set(p.id, { ...existing, ...p });
      } else {
        // Custom provider (not in defaults)
        mergedMap.set(p.id, p);
      }
    });

    // Clear registry and load merged
    this.registry.clear();
    this.registry.loadProviders(Array.from(mergedMap.values()));
    Logger.info(`ProviderManager: loaded ${mergedMap.size} providers (${stored.length} from storage).`);
  }

  /**
   * Save current provider configurations to persistence.
   */
  async saveProviders(): Promise<void> {
    const providers = this.registry.getAllProviders();
    // Do not save built-in? We can still save them to preserve API keys and enabled state.
    // We'll save all, but we can filter out isBuiltIn if desired, but it's fine.
    const data = {
      version: 1,
      savedAt: new Date().toISOString(),
      providers: providers,
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
    await this.saveProviders();
    Logger.info('ProviderManager: reset to defaults.');
  }

  /**
   * Delete all provider data from persistence (clear device data).
   */
  async clearAllData(): Promise<void> {
    // Clear persistence and registry
    await this.persistence.save({ providers: [] });
    this.registry.clear();
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
      if (!adapter || !adapter.call) {
        log?.(`${provider.name}: no adapter implementation registered for '${provider.adapterId}', skipping.`, 'warn');
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
        const result = await adapter.call(provider, input, {
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
