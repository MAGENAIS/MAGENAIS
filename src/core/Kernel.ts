/**
 * MAGENAIS Kernel
 * Core orchestrator for the application.
 * Manages boot, shutdown, plugins, configuration, and provides access to
 * all subsystems: EventBus, Store, ProviderManager, SmartRouter, WorkflowEngine,
 * PluginManager, AssetManager, and ProjectManager.
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

// Plugin SDK
import { PluginManager } from '../plugins/PluginManager';
import { PluginLoader } from '../plugins/PluginLoader';

// Enterprise
import { AssetManager } from '../enterprise/AssetManager';
import { ProjectManager } from '../enterprise/ProjectManager';

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

  // --- Plugin System ---
  private pluginManager: PluginManager;

  // --- Enterprise ---
  private assetManager: AssetManager;
  private projectManager: ProjectManager;

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
    BUILTIN_EXECUTORS.forEach(exec => this.workflowRegistry.register(exec));
    this.workflowEngine = new WorkflowEngine({
      registry: this.workflowRegistry,
      defaultTimeout: 120000,
      defaultRetries: 1,
      cache: new Map(),
    });
    this.workflowStore = new WorkflowStore();

    // 4. Initialise Plugin Manager
    this.pluginManager = new PluginManager(this.eventBus, this);

    // 5. Initialise Enterprise
    this.assetManager = new AssetManager(this.eventBus, this.store.getPersistence());
    this.projectManager = new ProjectManager(
      this.eventBus,
      this.store.getPersistence(),
      this.assetManager
    );

    this.logger.debug(
      `Kernel initialised with ${this.providerRegistry.getAllProviders().length} providers, ` +
      `${BUILTIN_EXECUTORS.length} built‑in workflow nodes, plugin system, and enterprise features.`
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
    // All other adapters can be registered here
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

    // 2. Load enterprise data
    await this.assetManager.load();
    await this.projectManager.load();

    // 3. Start health monitor
    this.healthMonitor.start();

    // 4. Emit boot event
    await this.eventBus.emit('kernel:boot');

    // 5. Load and activate plugins (if configured)
    const pluginsPath = this.config.pluginsPath || '/plugins';
    const pluginLoader = new PluginLoader(pluginsPath);
    try {
      await this.pluginManager.loadAndActivatePlugins(pluginLoader);
      this.logger.info('Plugins loaded and activated.');
    } catch (err) {
      this.logger.warn('Plugin loading failed, continuing without plugins.', err);
    }
    await this.eventBus.emit('kernel:pluginsLoaded');

    this.isBooted = true;
    this.logger.info('Kernel booted successfully');
  }

  async shutdown(): Promise<void> {
    if (!this.isBooted) return;
    this.logger.info('Shutting down kernel...');

    // Deactivate all plugins
    for (const plugin of this.pluginManager.getPlugins()) {
      try {
        await this.pluginManager.deactivatePlugin(plugin.manifest.id);
      } catch (err) {
        this.logger.warn(`Error deactivating plugin ${plugin.manifest.id}:`, err);
      }
    }

    // Save enterprise data
    await this.assetManager.save();
    await this.projectManager.save();

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
  // Getters – Plugin System
  // ------------------------------------------------------------------
  getPluginManager(): PluginManager {
    return this.pluginManager;
  }

  // ------------------------------------------------------------------
  // Getters – Enterprise
  // ------------------------------------------------------------------
  getAssetManager(): AssetManager {
    return this.assetManager;
  }

  getProjectManager(): ProjectManager {
    return this.projectManager;
  }

  // ------------------------------------------------------------------
  // Plugin & DI placeholders (future phases)
  // ------------------------------------------------------------------
  registerPlugin(pluginId: string, plugin: any): void {
    this.logger.warn('Plugin registration via kernel is deprecated; use PluginManager directly.');
  }

  getService<T>(serviceId: string): T {
    throw new Error('Service injection not yet implemented');
  }
}
