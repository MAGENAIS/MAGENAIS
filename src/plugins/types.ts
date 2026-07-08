/**
 * Plugin System Types
 * Defines the manifest, permissions, and API interfaces.
 */

export type PluginPermission =
  | 'storage:read'
  | 'storage:write'
  | 'network:fetch'
  | 'provider:register'
  | 'workflow:register'
  | 'ui:menu'
  | 'ui:panel'
  | 'ui:command'
  | 'agent:register'
  | 'model:register';

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  author?: string;
  description?: string;
  main: string;               // entry point (relative path to the plugin's main file)
  permissions?: PluginPermission[];
  // Optional: dependencies on other plugins
  dependencies?: string[];
  // Optional: providers this plugin provides
  providers?: {
    type: string;
    adapter: string;
    config?: any;
  }[];
  // Optional: UI extensions
  menus?: {
    id: string;
    label: string;
    command: string;
  }[];
  commands?: {
    id: string;
    handler: string; // function name to invoke
  }[];
  // Optional: register workflow nodes
  workflowNodes?: {
    type: string;
    executor: string;
  }[];
  // Optional: register agents
  agents?: {
    id: string;
    name: string;
    description?: string;
  }[];
}

export interface Plugin {
  manifest: PluginManifest;
  instance: any; // The plugin module exports
  enabled: boolean;
  permissionsGranted: boolean;
}

export interface PluginAPI {
  // Provider registration
  registerProvider(config: any): void;
  // Workflow node registration
  registerWorkflowNode(type: string, executor: any): void;
  // UI extensions
  registerMenu(menu: { id: string; label: string; command: string }): void;
  registerCommand(command: { id: string; handler: (...args: any[]) => void }): void;
  registerPanel(panel: { id: string; render: () => HTMLElement }): void;
  // Agent registration
  registerAgent(agent: { id: string; name: string; description?: string; execute: (input: any) => Promise<any> }): void;
  // Model registration (future)
  registerModel(model: any): void;
  // Storage (limited)
  storage: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<void>;
  };
  // Logging
  log: {
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
  // Access to kernel (limited)
  kernel: {
    getProviderManager(): any;
    getWorkflowEngine(): any;
    getStore(): any;
    getEventBus(): any;
  };
}
