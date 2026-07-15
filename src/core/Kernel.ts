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
import { AnthropicAdapter } from '../providers/adapters/AnthropicAdapter';
import { GeminiAdapter } from '../providers/adapters/GeminiAdapter';
import { ElevenLabsAdapter } from '../providers/adapters/ElevenLabsAdapter';
import { PuterAdapter } from '../providers/adapters/PuterAdapter';
import { BrowserSpeechAdapter } from '../providers/adapters/BrowserSpeechAdapter';
import { KenBurnsFallbackAdapter } from '../providers/adapters/KenBurnsFallbackAdapter';
// Zero-key local/browser/free-public adapters — see each file's header
// comment for what makes it a genuine no-signup, no-payment default.
import { OllamaAdapter } from '../providers/adapters/OllamaAdapter';
import { WebLLMAdapter } from '../providers/adapters/WebLLMAdapter';
import { TransformersAdapter } from '../providers/adapters/TransformersAdapter';
import { PollinationsFreeImageAdapter } from '../providers/adapters/PollinationsFreeImageAdapter';
import { WikipediaAdapter } from '../providers/adapters/WikipediaAdapter';

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
    // Providers get their OWN persistence namespace/localStorage key rather
    // than sharing Store's — belt-and-suspenders on top of the read-merge-
    // write fixes in Store/ProviderManager, and it matches what
    // ProviderManager's own (previously unused) `storageKey` field already
    // implied was the intended design.
    const providerPersistence = new Persistence({
      type: this.config.storage.type,
      namespace: `${this.config.storage.namespace}:providers`,
    });
    this.providerManager = new ProviderManager(
      this.providerRegistry,
      providerPersistence,
      this.eventBus,
      this.store.getPersistence()
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
      providerManager: this.providerManager,
      router: this.router,
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
    // Providers that speak a plain OpenAI-shaped REST API share one adapter instance —
    // matches the legacy monolith's generic per-modality callers (callTextProviderOpenAIStyle,
    // callImageProviderGeneric, callSpeechProviderGeneric, callMusicProviderGeneric,
    // callVideoProviderGeneric), which were never one-function-per-provider either.
    const openAICompatible = new OpenAICompatibleAdapter();
    [
      'openai-compatible',
      'openai',
      'groq',
      'together',
      'deepinfra',
      'openrouter',
      'falai',
      'replicate',
      'deepgram',
      'assemblyai',
      'playht',
    ].forEach(id => this.providerRegistry.registerAdapter(id, openAICompatible));

    this.providerRegistry.registerAdapter('huggingface', new HuggingFaceAdapter());
    this.providerRegistry.registerAdapter('pollinations', new PollinationsAdapter());
    this.providerRegistry.registerAdapter('anthropic', new AnthropicAdapter());
    this.providerRegistry.registerAdapter('gemini', new GeminiAdapter());
    this.providerRegistry.registerAdapter('elevenlabs', new ElevenLabsAdapter());
    this.providerRegistry.registerAdapter('puter', new PuterAdapter());
    this.providerRegistry.registerAdapter('browser-speech', new BrowserSpeechAdapter());
    this.providerRegistry.registerAdapter('internal-fallback', new KenBurnsFallbackAdapter(this.providerManager, this.router));

    // Zero-key local/browser/free-public adapters (see defaultProviders.ts'
    // "TRUE ZERO-SETUP DEFAULTS" section for the registry entries that use
    // these). Registered unconditionally — each adapter's own
    // testConnection()/call() detects at runtime whether its underlying
    // requirement (a running local Ollama server, a WebGPU-capable browser,
    // etc.) is actually met, and fails fast/cleanly if not, letting the
    // fallback chain move on. No feature-detection is needed here.
    this.providerRegistry.registerAdapter('ollama', new OllamaAdapter());
    this.providerRegistry.registerAdapter('webllm', new WebLLMAdapter());
    this.providerRegistry.registerAdapter('transformers', new TransformersAdapter());
    this.providerRegistry.registerAdapter('pollinations-free', new PollinationsFreeImageAdapter());
    this.providerRegistry.registerAdapter('wikipedia', new WikipediaAdapter());
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

    // 6. Fetch marketplaces in the background — NOT awaited. These are
    // optional (browse-only) registry listings, not required for any of
    // the 11 core tabs to function; blocking app-mount on a remote fetch
    // that isn't needed yet was the real cause of the app appearing to
    // hang on load whenever that registry was slow/unreachable — each
    // fetch already has its own 5s timeout (see ModelMarketplace.ts /
    // PluginMarketplace.ts) and falls back to a small local list on
    // failure, so this can safely run after the UI is already interactive.
    this.modelMarketplace.fetchModels().catch(err => this.logger.warn('Marketplace fetch failed, continuing.', err));
    this.pluginMarketplace.fetchPlugins().catch(err => this.logger.warn('Marketplace fetch failed, continuing.', err));

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
