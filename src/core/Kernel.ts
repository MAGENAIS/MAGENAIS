/**
 * MAGENAIS Kernel
 * Core orchestrator for the application.
 * Manages boot, shutdown, plugins, configuration, and provides access to
 * core services: EventBus, Store, ProviderManager, SmartRouter, and WorkflowEngine.
 */

import { EventBus } from './EventBus';
import { Logger } from './Logger';
import { Config, AppConfig } from './Config';
import { Store } from './state/Store';
import { Persistence } from './state/Persistence';

// Provider Platform
import { ProviderRegistry } from '../providers/registry/Registry';
import { ProviderManager } from '../providers/registry/Manager';
import { SmartRouter } from '../providers/Router';
import { HealthMonitor } from '../providers/Health';
import { DEFAULT_PROVIDERS } from '../providers/defaultProviders';
import { OpenAICompatibleAdapter } from '../providers/adapters/OpenAICompatibleAdapter';
import { HuggingFaceAdapter } from '../providers/adapters/HuggingFaceAdapter';
import { PollinationsAdapter } from '../providers/adapters/PollinationsAdapter';

// Workflow Engine
import {
  NodeRegistry,
  WorkflowEngine,
  WorkflowStore,
  BUILTIN_EXECUTORS,
} from '../workflows';

export interface KernelOptions {
  config: AppConfig;
  eventBus: EventBus;
  store: Store;
  logger: typeof Logger;
}

export class Kernel {
  // --- Core services ---
  private config: AppConfig;
  private eventBus: EventBus;
  private store: Store;
  private logger: typeof Logger;
  private isBooted: boolean = false;

  // --- Provider Platform ---
  private providerRegistry: ProviderRegistry;
  private providerManager: ProviderManager;
  private router: SmartRouter;
  private healthMonitor: HealthMonitor;

  // --- Workflow Engine ---
  private workflowRegistry: NodeRegistry;
  private workflowEngine: WorkflowEngine;
  private workflowStore: WorkflowStore;

  constructor(options: KernelOptions) {
    // 1. Core services
    this.config = options.config;
    this.eventBus = options.eventBus;
    this.store = options.store;
    this.logger = options.logger;

    // 2. Initialise Provider Platform
    this.providerRegistry = new ProviderRegistry(this.eventBus);
    this.providerManager = new ProviderManager(
      this.providerRegistry,
      this.store.getPersistence(),
      this.eventBus
    );
    this.router = new SmartRouter(this.providerRegistry);
    this.healthMonitor = new HealthMonitor(this.providerRegistry, this.eventBus);
    this.registerAdapters();

    // 3. Initialise Workflow Engine
    this.workflowRegistry = new NodeRegistry();
    // Register all built‑in node executors
    BUILTIN_EXECUTORS.forEach(exec => this.workflowRegistry.register(exec));
    this.workflowEngine = new WorkflowEngine({
      registry: this.workflowRegistry,
      defaultTimeout: 120000,  // 2 minutes
      defaultRetries: 1,
      cache: new Map(),
    });
    this.workflowStore = new WorkflowStore();

    // Log initialization (optional)
    this.logger.debug(
      `Kernel initialised with ${this.providerRegistry.getAllProviders().length} providers and ${BUILTIN_EXECUTORS.length} built-in workflow node types.`
    );
  }

  // ------------------------------------------------------------------
  // Adapter Registration
  // ------------------------------------------------------------------
  private registerAdapters(): void {
    this.providerRegistry.registerAdapter('openai-compatible', new OpenAICompatibleAdapter());
    this.providerRegistry.registerAdapter('openai', new OpenAICompatibleAdapter());
    this.providerRegistry.registerAdapter('huggingface', new HuggingFaceAdapter());
    this.providerRegistry.registerAdapter('pollinations', new PollinationsAdapter());
    // ... register all other adapters here
  }

  // ------------------------------------------------------------------
  // Lifecycle
  // ------------------------------------------------------------------
  async boot(): Promise<void> {
    if (this.isBooted) {
      this.logger.warn('Kernel already booted');
      return;
    }
    this.logger.info('Booting MAGENAIS kernel...');

    // 1. Load persisted state (including providers)
    await this.store.load();
    await this.providerManager.loadProviders(DEFAULT_PROVIDERS);

    // 2. Start health monitor
    this.healthMonitor.start();

    // 3. Emit boot event
    await this.eventBus.emit('kernel:boot');

    this.isBooted = true;
    this.logger.info('Kernel booted successfully');
  }

  async shutdown(): Promise<void> {
    if (!this.isBooted) return;
    this.logger.info('Shutting down kernel...');

    this.healthMonitor.stop();
    await this.providerManager.saveProviders();
    await this.store.persist();

    await this.eventBus.emit('kernel:shutdown');
    this.isBooted = false;
    this.logger.info('Kernel shut down');
  }

  // ------------------------------------------------------------------
  // Getters – Core Services
  // ------------------------------------------------------------------
  getEventBus(): EventBus {
    return this.eventBus;
  }

  getStore(): Store {
    return this.store;
  }

  getConfig(): AppConfig {
    return this.config;
  }

  // ------------------------------------------------------------------
  // Getters – Provider Platform
  // ------------------------------------------------------------------
  getProviderManager(): ProviderManager {
    return this.providerManager;
  }

  getRouter(): SmartRouter {
    return this.router;
  }

  getProviderRegistry(): ProviderRegistry {
    return this.providerRegistry;
  }

  // ------------------------------------------------------------------
  // Getters – Workflow Engine
  // ------------------------------------------------------------------
  getWorkflowRegistry(): NodeRegistry {
    return this.workflowRegistry;
  }

  getWorkflowEngine(): WorkflowEngine {
    return this.workflowEngine;
  }

  getWorkflowStore(): WorkflowStore {
    return this.workflowStore;
  }

  // ------------------------------------------------------------------
  // Plugin & DI placeholders (future phases)
  // ------------------------------------------------------------------
  registerPlugin(pluginId: string, plugin: any): void {
    this.logger.warn('Plugin registration not yet implemented');
  }

  getService<T>(serviceId: string): T {
    throw new Error('Service injection not yet implemented');
  }
}
