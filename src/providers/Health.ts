import { ProviderRegistry } from './registry/Registry';
import { ProviderConfig, ProviderHealth } from './types';
import { Logger } from '../core/Logger';
import { EventBus } from '../core/EventBus';
import { isInCooldown, cooldownRemainingLabel } from './HealthCooldown';

export class HealthMonitor {
  private registry: ProviderRegistry;
  private eventBus: EventBus;
  private checkInterval: number = 60000; // 1 minute
  private intervalId: number | null = null;
  private onVisibilityChange: (() => void) | null = null;

  constructor(registry: ProviderRegistry, eventBus: EventBus) {
    this.registry = registry;
    this.eventBus = eventBus;
  }

  /**
   * Start periodic health checks.
   */
  start(intervalMs?: number): void {
    if (this.intervalId) {
      Logger.warn('HealthMonitor already running.');
      return;
    }
    this.checkInterval = intervalMs || this.checkInterval;
    this.intervalId = window.setInterval(() => {
      // PHASE 5: skip this tick entirely while the tab is hidden — see the
      // visibilitychange listener below for what happens when it becomes
      // visible again. document may not have the Page Visibility API in
      // very old environments; `?? false` just means "always check" there.
      if (document?.hidden) {
        Logger.debug('HealthMonitor: tab is hidden, skipping this check cycle.');
        return;
      }
      this.checkAll();
    }, this.checkInterval);
    Logger.info(`HealthMonitor started (interval ${this.checkInterval}ms).`);
    // Do an immediate check
    this.checkAll();

    if (typeof document !== 'undefined') {
      this.onVisibilityChange = () => {
        if (!document.hidden) {
          Logger.debug('HealthMonitor: tab became visible again, running an immediate check.');
          this.checkAll();
        }
      };
      document.addEventListener('visibilitychange', this.onVisibilityChange);
    }
  }

  /**
   * Stop health checks.
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      Logger.info('HealthMonitor stopped.');
    }
    if (this.onVisibilityChange) {
      document.removeEventListener('visibilitychange', this.onVisibilityChange);
      this.onVisibilityChange = null;
    }
  }

  /**
   * Check health of all enabled providers.
   */
  async checkAll(): Promise<void> {
    const providers = this.registry.getProviders(undefined, true);
    Logger.debug(`HealthMonitor: checking ${providers.length} providers.`);
    const toCheck = providers.filter((p) => {
      if (isInCooldown(p.health)) {
        Logger.debug(`HealthMonitor: skipping '${p.name}' — cooling down (${cooldownRemainingLabel(p.health)} left).`);
        return false;
      }
      return true;
    });
    await Promise.allSettled(toCheck.map((p) => this.checkProvider(p)));
  }

  /**
   * Check a single provider by performing a lightweight test.
   * This uses the adapter's testConnection if available, else marks as unknown.
   */
  async checkProvider(provider: ProviderConfig): Promise<void> {
    const adapter = this.registry.getAdapter(provider.adapterId);
    if (!adapter) {
      // No adapter, mark as unknown
      const health: ProviderHealth = { status: 'unknown', lastCheck: Date.now() };
      this.registry.updateHealth(provider.id, health);
      return;
    }

    if (!adapter.testConnection) {
      // Adapter doesn't support testing, assume healthy if it has a key and baseUrl
      const health: ProviderHealth = {
        status: provider.apiKey || provider.noKeyNeeded ? 'healthy' : 'unknown',
        lastCheck: Date.now(),
      };
      this.registry.updateHealth(provider.id, health);
      return;
    }

    try {
      const start = performance.now();
      const result = await adapter.testConnection(provider);
      const latency = performance.now() - start;
      const status = result.ok ? 'healthy' : 'degraded';
      const health: ProviderHealth = {
        status,
        lastCheck: Date.now(),
        lastError: result.ok ? undefined : result.message,
        responseTime: latency,
      };
      this.registry.updateHealth(provider.id, health);
      Logger.debug(`Health check for '${provider.name}': ${status} (${latency.toFixed(0)}ms)`);
    } catch (err: any) {
      const health: ProviderHealth = {
        status: 'unhealthy',
        lastCheck: Date.now(),
        lastError: err.message || 'Unknown error',
      };
      this.registry.updateHealth(provider.id, health);
      Logger.warn(`Health check for '${provider.name}' failed: ${err.message}`);
    }
  }
}
