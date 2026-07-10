import { ProviderConfig, ProviderType, Adapter, ProviderHealth } from '../types';
import { EventBus } from '../../core/EventBus';
import { Logger } from '../../core/Logger';

export class ProviderRegistry {
  private providers: Map<string, ProviderConfig> = new Map();
  private adapters: Map<string, Adapter> = new Map();
  private eventBus: EventBus;

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Register an adapter for a given adapterId.
   */
  registerAdapter(adapterId: string, adapter: Adapter): void {
    if (this.adapters.has(adapterId)) {
      Logger.warn(`Adapter '${adapterId}' already registered, overwriting.`);
    }
    this.adapters.set(adapterId, adapter);
    Logger.debug(`Adapter '${adapterId}' registered.`);
  }

  /**
   * Get an adapter by id.
   */
  getAdapter(adapterId: string): Adapter | undefined {
    return this.adapters.get(adapterId);
  }

  /**
   * Register a provider configuration.
   */
  registerProvider(provider: ProviderConfig): void {
    if (this.providers.has(provider.id)) {
      Logger.warn(`Provider '${provider.id}' already registered, overwriting.`);
    }
    this.providers.set(provider.id, provider);
    this.eventBus.emit('provider:registered', provider.id);
    Logger.debug(`Provider '${provider.name}' (${provider.id}) registered.`);
  }

  /**
   * Get a provider by id.
   */
  getProvider(id: string): ProviderConfig | undefined {
    return this.providers.get(id);
  }

  /**
   * Get all providers, optionally filtered by type and enabled state.
   */
  getProviders(type?: ProviderType, enabledOnly: boolean = false): ProviderConfig[] {
    const list = Array.from(this.providers.values());
    return list.filter(p => {
      if (type && p.type !== type) return false;
      if (enabledOnly && !p.enabled) return false;
      return true;
    });
  }

  /**
   * Update an existing provider.
   */
  updateProvider(id: string, updates: Partial<ProviderConfig>): void {
    const existing = this.providers.get(id);
    if (!existing) {
      throw new Error(`Provider '${id}' not found.`);
    }
    Object.assign(existing, updates);
    this.eventBus.emit('provider:updated', id);
    Logger.debug(`Provider '${id}' updated.`);
  }

  /**
   * Enable or disable a provider.
   */
  setEnabled(id: string, enabled: boolean): void {
    this.updateProvider(id, { enabled });
  }

  /**
   * Remove a provider (only if not built-in/preset? We allow deletion for custom ones).
   */
  removeProvider(id: string): void {
    if (!this.providers.has(id)) return;
    this.providers.delete(id);
    this.eventBus.emit('provider:removed', id);
    Logger.debug(`Provider '${id}' removed.`);
  }

  /**
   * Clear all providers (for reset).
   */
  clear(): void {
    this.providers.clear();
  }

  /**
   * Bulk load providers (e.g., from storage).
   */
  loadProviders(providers: ProviderConfig[]): void {
    providers.forEach(p => this.registerProvider(p));
    Logger.info(`Loaded ${providers.length} providers.`);
  }

  /**
   * Get all provider configurations for persistence.
   */
  getAllProviders(): ProviderConfig[] {
    return Array.from(this.providers.values());
  }

  /**
   * Update health information for a provider.
   */
  updateHealth(id: string, health: ProviderHealth): void {
    const p = this.providers.get(id);
    if (p) {
      p.health = health;
      // Also update success rate and latency from health check
      if (health.status === 'healthy') {
        p.successRate = (p.successRate || 0) * 0.9 + 0.1; // simplistic smoothing
        if (health.responseTime) {
          p.averageLatency = p.averageLatency
            ? p.averageLatency * 0.8 + health.responseTime * 0.2
            : health.responseTime;
        }
      } else if (health.status === 'unhealthy') {
        p.successRate = (p.successRate || 0) * 0.9;
      }
      this.eventBus.emit('provider:health-updated', id);
    }
  }
}
