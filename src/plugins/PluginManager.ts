/**
 * Plugin Manager: manages plugin lifecycle, permissions, and API access.
 */

import { Plugin, PluginManifest, PluginAPI, PluginPermission } from './types';
import { EventBus } from '../core/EventBus';
import { Logger } from '../core/Logger';
import { Kernel } from '../core/Kernel';
import { createPluginAPI } from './PluginAPI';

export class PluginManager {
  private plugins: Map<string, Plugin> = new Map();
  private eventBus: EventBus;
  private kernel: Kernel;

  constructor(eventBus: EventBus, kernel: Kernel) {
    this.eventBus = eventBus;
    this.kernel = kernel;
  }

  /**
   * Register a plugin (after loading).
   */
  registerPlugin(plugin: Plugin): void {
    if (this.plugins.has(plugin.manifest.id)) {
      Logger.warn(`Plugin ${plugin.manifest.id} already registered, overwriting.`);
    }
    this.plugins.set(plugin.manifest.id, plugin);
    this.eventBus.emit('plugin:registered', plugin.manifest.id);
  }

  /**
   * Activate a plugin: grant permissions and call its activate function (if any).
   */
  async activatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    if (plugin.enabled) {
      Logger.warn(`Plugin ${pluginId} already active`);
      return;
    }
    // Grant permissions (if not already granted)
    if (!plugin.permissionsGranted) {
      // Check permissions; for now, we grant all requested permissions.
      // In production, we would ask user or check policy.
      plugin.permissionsGranted = true;
    }
    // Call plugin's activate function if it exists
    if (plugin.instance && typeof plugin.instance.activate === 'function') {
      const api = createPluginAPI(this.kernel, plugin.manifest.permissions || []);
      await plugin.instance.activate(api);
    }
    plugin.enabled = true;
    this.eventBus.emit('plugin:activated', pluginId);
    Logger.info(`Plugin ${pluginId} activated`);
  }

  /**
   * Deactivate a plugin: call its deactivate function and revoke permissions.
   */
  async deactivatePlugin(pluginId: string): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) {
      throw new Error(`Plugin ${pluginId} not found`);
    }
    if (!plugin.enabled) {
      Logger.warn(`Plugin ${pluginId} already inactive`);
      return;
    }
    if (plugin.instance && typeof plugin.instance.deactivate === 'function') {
      await plugin.instance.deactivate();
    }
    plugin.enabled = false;
    plugin.permissionsGranted = false;
    this.eventBus.emit('plugin:deactivated', pluginId);
    Logger.info(`Plugin ${pluginId} deactivated`);
  }

  /**
   * Get all plugins.
   */
  getPlugins(): Plugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get a plugin by id.
   */
  getPlugin(id: string): Plugin | undefined {
    return this.plugins.get(id);
  }

  /**
   * Load all plugins from the loader and register them.
   */
  async loadAndActivatePlugins(loader: PluginLoader): Promise<void> {
    const plugins = await loader.loadAllPlugins();
    for (const plugin of plugins) {
      this.registerPlugin(plugin);
      try {
        await this.activatePlugin(plugin.manifest.id);
      } catch (err) {
        Logger.error(`Failed to activate plugin ${plugin.manifest.id}:`, err);
      }
    }
  }
}
