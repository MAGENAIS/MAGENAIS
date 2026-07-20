import { ProviderConfig, ProviderType, Adapter, ProviderHealth } from '../types';
import { EventBus } from '../../core/EventBus';
import { Logger } from '../../core/Logger';
import { classifyFailure, computeCooldownMs } from '../HealthCooldown';

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
    // ROOT CAUSE FIX: a provider cooling down for a config-related reason
    // (bad key, missing model, malformed URL) would otherwise stay skipped
    // until its old cooldown timer ran out even AFTER the person fixed the
    // actual problem — since editing config here didn't touch `health` at
    // all, up to 15 minutes (MAX_COOLDOWN_MS) of "still cooling down"
    // could follow a correct fix. Editing exactly the fields that could
    // plausibly have caused the failure clears the cooldown/failure
    // streak, so a corrected key is eligible again on the very next
    // request instead of waiting out a timer that no longer means
    // anything. Editing unrelated fields (priority, notes, timeoutMs)
    // deliberately leaves health alone.
    const configFieldsChanged = (['apiKey', 'baseUrl', 'defaultModel'] as const).some(
      (key) => key in updates && updates[key] !== existing[key]
    );
    if (configFieldsChanged && existing.health) {
      existing.health = {
        ...existing.health,
        cooldownUntil: undefined,
        failureCount: 0,
        failureCategory: undefined,
      };
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
   *
   * PHASE 3b — failure cooldown/backoff (see HealthCooldown.ts): callers
   * still just report what happened (`status`, `lastError`, etc.) exactly
   * as before — this method is where that gets turned into an escalating
   * cooldown, so every call site (Manager.ts's real request outcomes,
   * Health.ts's periodic checks) gets consistent behavior for free instead
   * of each having to reimplement backoff math. 'unhealthy' increments the
   * consecutive-failure streak and (re)computes `cooldownUntil` from the
   * classified failure category; any other status ('healthy', but also
   * 'degraded'/'unknown' from a periodic check that didn't fail outright)
   * resets the streak and clears any existing cooldown.
   */
  updateHealth(id: string, health: ProviderHealth): void {
    const p = this.providers.get(id);
    if (p) {
      const previousFailureCount = p.health?.failureCount || 0;
      if (health.status === 'unhealthy') {
        const category = classifyFailure(health.lastError);
        const failureCount = previousFailureCount + 1;
        health.failureCount = failureCount;
        health.failureCategory = category;
        health.cooldownUntil = Date.now() + computeCooldownMs(category, failureCount);
      } else {
        health.failureCount = 0;
        health.cooldownUntil = undefined;
        health.failureCategory = undefined;
      }
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
        if (health.failureCategory === 'timeout') {
          p.timeoutCount = (p.timeoutCount || 0) + 1;
        }
      }
      this.eventBus.emit('provider:health-updated', id);
    }
  }
}
