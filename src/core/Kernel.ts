/**
 * MAGENAIS Kernel
 * Core orchestrator for the application.
 * Manages boot, shutdown, and provides access to all subsystems.
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

// AIOS
import { AIMemory } from '../aios/Memory';
import { PromptLibrary } from '../aios/PromptLibrary';
import { AgentOrchestrator } from '../aios/Orchestrator';
import { ModelMarketplace } from '../aios/ModelMarketplace';
import { PluginMarketplace } from '../aios/PluginMarketplace';
import { RemoteCompute } from '../aios/RemoteCompute';
import { TeamManager } from '../aios/Team';

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

  // --- AIOS ---
  private memory: AIMemory;
  private promptLibrary: PromptLibrary;
  private orchestrator: AgentOrchestrator;
  private modelMarketplace: ModelMarketplace;
  private pluginMarketplace: PluginMarketplace;
  private remoteCompute: RemoteCompute;
  private teamManager: TeamManager;

  constructor(options: KernelOptions) {
    // 1. Core services
    this.config = options.config;
    this.eventBus = options.eventBus;
    this.store = options.store;
    this.logger = options.logger;

    // 2. Provider Platform
    this.providerRegistry = new ProviderRegistry(this.eventBus);
    this.providerManager = new ProviderManager(
      this.providerRegistry,
      this.store.getPersistence(),
      this.eventBus
    );
    this.router = new SmartRouter(this.providerRegistry);
    this.healthMonitor = new HealthMonitor(this.providerRegistry, this.eventBus);
    this.registerAdapters();

    // 3. Workflow Engine
    this.workflowRegistry = new NodeRegistry();
    BUILTIN_EXECUTORS.forEach(exec => this.workflowRegistry.register(exec));
    this.workflowEngine = new WorkflowEngine({
      registry: this.workflowRegistry,
      defaultTimeout: 120000,
      defaultRetries: 1,
      cache: new Map(),
    });
    this.workflowStore = new WorkflowStore();

    // 4. Plugin Manager
    this.pluginManager = new PluginManager(this.eventBus, this);

    // 5. Enterprise
    this.assetManager = new AssetManager(this.eventBus, this.store.getPersistence());
    this.projectManager = new ProjectManager(
      this.eventBus,
      this.store.getPersistence(),
      this.assetManager
    );

    // 6. AIOS
    this.memory = new AIMemory(this.eventBus);
    this.promptLibrary = new PromptLibrary(this.eventBus);
    this.orchestrator = new AgentOrchestrator(this);
    this.modelMarketplace = new ModelMarketplace(this.eventBus);
    this.pluginMarketplace = new PluginMarketplace(this.eventBus);
    this.remoteCompute = new RemoteCompute(this.eventBus, this.config.remoteComputeEndpoint);
    this.teamManager = new TeamManager(this.eventBus);

    this.logger.debug(
      `Kernel initialised with provider platform, workflow engine, plugin system, enterprise, and AIOS.`
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
    // Additional adapters can be registered here
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

    // 1. Load state & providers
    await this.store.load();
    await this.providerManager.loadProviders(DEFAULT_PROVIDERS);

    // 2. Load enterprise data
    await this.assetManager.load();
    await this.projectManager.load();

    // 3. Start health monitor
    this.healthMonitor.start();

    // 4. Emit boot event
    await this.eventBus.emit('kernel:boot');

    // 5. Load plugins
    const pluginsPath = this.config.pluginsPath || '/plugins';
    const pluginLoader = new PluginLoader(pluginsPath);
    try {
      await this.pluginManager.loadAndActivatePlugins(pluginLoader);
      this.logger.info('Plugins loaded and activated.');
    } catch (err) {
      this.logger.warn('Plugin loading failed, continuing without plugins.', err);
    }
    await this.eventBus.emit('kernel:pluginsLoaded');

    // 6. Fetch marketplaces (optional, can be lazy-loaded)
    try {
      await this.modelMarketplace.fetchModels();
      await this.pluginMarketplace.fetchPlugins();
    } catch (err) {
      this.logger.warn('Marketplace fetch failed, continuing.', err);
    }

    this.isBooted = true;
    this.logger.info('Kernel booted successfully');
  }

  async shutdown(): Promise<void> {
    if (!this.isBooted) return;
    this.logger.info('Shutting down kernel...');

    // Deactivate plugins
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

    // Save memory and prompts (they auto-save, but we can force)
    // They save on each mutation, so no explicit save needed.

    this.healthMonitor.stop();
    await this.providerManager.saveProviders();
    await this.store.persist();

    await this.eventBus.emit('kernel:shutdown');
    this.isBooted = false;
    this.logger.info('Kernel shut down');
  }

  // ------------------------------------------------------------------
  // Getters – Core
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
  // Getters – AIOS
  // ------------------------------------------------------------------
  getMemory(): AIMemory {
    return this.memory;
  }
  getPromptLibrary(): PromptLibrary {
    return this.promptLibrary;
  }
  getOrchestrator(): AgentOrchestrator {
    return this.orchestrator;
  }
  getModelMarketplace(): ModelMarketplace {
    return this.modelMarketplace;
  }
  getPluginMarketplace(): PluginMarketplace {
    return this.pluginMarketplace;
  }
  getRemoteCompute(): RemoteCompute {
    return this.remoteCompute;
  }
  getTeamManager(): TeamManager {
    return this.teamManager;
  }

  // ------------------------------------------------------------------
  // Placeholders
  // ------------------------------------------------------------------
  registerPlugin(pluginId: string, plugin: any): void {
    this.logger.warn('Plugin registration via kernel is deprecated; use PluginManager directly.');
  }
  getService<T>(serviceId: string): T {
    throw new Error('Service injection not yet implemented');
  }
}
