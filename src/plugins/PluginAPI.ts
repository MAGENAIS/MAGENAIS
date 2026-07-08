/**
 * Plugin API: provides a restricted set of kernel services to plugins.
 * Permissions are checked before granting access.
 */

import { PluginAPI, PluginPermission } from './types';
import { Kernel } from '../core/Kernel';
import { Logger } from '../core/Logger';

export function createPluginAPI(kernel: Kernel, permissions: PluginPermission[]): PluginAPI {
  const checkPermission = (permission: PluginPermission) => {
    if (!permissions.includes(permission)) {
      throw new Error(`Plugin does not have permission: ${permission}`);
    }
  };

  return {
    // Provider registration
    registerProvider(config: any): void {
      checkPermission('provider:register');
      kernel.getProviderManager().addProvider(config);
    },
    // Workflow node registration
    registerWorkflowNode(type: string, executor: any): void {
      checkPermission('workflow:register');
      const registry = kernel.getWorkflowRegistry();
      registry.register({ type, execute: executor });
    },
    // UI extensions
    registerMenu(menu: { id: string; label: string; command: string }): void {
      checkPermission('ui:menu');
      kernel.getEventBus().emit('plugin:registerMenu', menu);
    },
    registerCommand(command: { id: string; handler: (...args: any[]) => void }): void {
      checkPermission('ui:command');
      kernel.getEventBus().emit('plugin:registerCommand', command);
    },
    registerPanel(panel: { id: string; render: () => HTMLElement }): void {
      checkPermission('ui:panel');
      kernel.getEventBus().emit('plugin:registerPanel', panel);
    },
    // Agent registration
    registerAgent(agent: { id: string; name: string; description?: string; execute: (input: any) => Promise<any> }): void {
      checkPermission('agent:register');
      // Store agent in a registry (to be implemented later)
      kernel.getEventBus().emit('plugin:registerAgent', agent);
    },
    registerModel(model: any): void {
      checkPermission('model:register');
      kernel.getEventBus().emit('plugin:registerModel', model);
    },
    // Storage
    storage: {
      async get(key: string): Promise<any> {
        checkPermission('storage:read');
        // Use persistence layer from kernel
        const persistence = kernel.getStore().getPersistence();
        const data = await persistence.load();
        return data?.[key];
      },
      async set(key: string, value: any): Promise<void> {
        checkPermission('storage:write');
        const persistence = kernel.getStore().getPersistence();
        const data = (await persistence.load()) || {};
        data[key] = value;
        await persistence.save(data);
      },
      async delete(key: string): Promise<void> {
        checkPermission('storage:write');
        const persistence = kernel.getStore().getPersistence();
        const data = (await persistence.load()) || {};
        delete data[key];
        await persistence.save(data);
      },
    },
    // Logging
    log: {
      info(message: string) {
        Logger.info(`[Plugin] ${message}`);
      },
      warn(message: string) {
        Logger.warn(`[Plugin] ${message}`);
      },
      error(message: string) {
        Logger.error(`[Plugin] ${message}`);
      },
    },
    // Kernel access (limited)
    kernel: {
      getProviderManager() {
        checkPermission('provider:register'); // same permission for now
        return kernel.getProviderManager();
      },
      getWorkflowEngine() {
        checkPermission('workflow:register');
        return kernel.getWorkflowEngine();
      },
      getStore() {
        // Storage permission already covers this
        checkPermission('storage:read');
        return kernel.getStore();
      },
      getEventBus() {
        // Allow event subscription? We'll limit to emitting events.
        // We'll provide a separate method for emitting events if needed.
        return kernel.getEventBus();
      },
    },
  };
}
