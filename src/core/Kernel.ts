import { EventBus } from './EventBus';
import { Logger } from './Logger';
import { Config, AppConfig } from './Config';
import { Store } from './state/Store';

export interface KernelOptions {
  config: AppConfig;
  eventBus: EventBus;
  store: Store;
  logger: typeof Logger;
}

export class Kernel {
  private config: AppConfig;
  private eventBus: EventBus;
  private store: Store;
  private logger: typeof Logger;
  private isBooted: boolean = false;

  constructor(options: KernelOptions) {
    this.config = options.config;
    this.eventBus = options.eventBus;
    this.store = options.store;
    this.logger = options.logger;
  }

  async boot(): Promise<void> {
    if (this.isBooted) {
      this.logger.warn('Kernel already booted');
      return;
    }

    this.logger.info('Booting MAGENAIS kernel...');

    // 1. Load persisted state
    await this.store.load();

    // 2. Emit boot event
    await this.eventBus.emit('kernel:boot');

    this.isBooted = true;
    this.logger.info('Kernel booted successfully');
  }

  async shutdown(): Promise<void> {
    if (!this.isBooted) return;
    this.logger.info('Shutting down kernel...');

    // Save state
    await this.store.persist();

    await this.eventBus.emit('kernel:shutdown');
    this.isBooted = false;
    this.logger.info('Kernel shut down');
  }

  // Plugin registration placeholder (Phase 3)
  registerPlugin(pluginId: string, plugin: any): void {
    this.logger.warn('Plugin registration not yet implemented');
  }

  // Dependency injection placeholder
  getService<T>(serviceId: string): T {
    throw new Error('Service injection not yet implemented');
  }

  getEventBus(): EventBus {
    return this.eventBus;
  }

  getStore(): Store {
    return this.store;
  }

  getConfig(): AppConfig {
    return this.config;
  }
}
