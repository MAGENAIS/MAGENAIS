/**
 * Plugin Marketplace – browse and install plugins.
 */

import { PluginListing } from './types';
import { Logger } from '../core/Logger';
import { EventBus } from '../core/EventBus';

export class PluginMarketplace {
  private plugins: PluginListing[] = [];
  private eventBus: EventBus;
  private registryUrl: string = 'https://magenais.github.io/plugins/index.json'; // placeholder

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  async fetchPlugins(): Promise<PluginListing[]> {
    try {
      // ROOT CAUSE FIX — see the matching comment in ModelMarketplace.ts:
      // this fetch is on the app-boot critical path with no timeout of its
      // own, so an unreachable registry could stall UI mount entirely.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(this.registryUrl, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.plugins = data.plugins || [];
      Logger.info(`PluginMarketplace: fetched ${this.plugins.length} plugins.`);
      this.eventBus.emit('pluginMarketplace:updated', this.plugins);
      return this.plugins;
    } catch (err) {
      Logger.warn('Failed to fetch plugins from registry, using local list.', err);
      this.plugins = [
        {
          id: 'sample-plugin',
          name: 'Sample Plugin',
          description: 'A demo plugin for MAGENAIS.',
          author: 'MAGENAIS Team',
          version: '1.0.0',
          permissions: ['storage:read', 'ui:menu'],
          downloadUrl: '/plugins/sample-plugin.zip',
          tags: ['demo', 'example'],
        },
      ];
      return this.plugins;
    }
  }

  getPlugins(): PluginListing[] {
    return this.plugins;
  }

  getPlugin(id: string): PluginListing | undefined {
    return this.plugins.find(p => p.id === id);
  }

  search(query: string): PluginListing[] {
    const q = query.toLowerCase();
    return this.plugins.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * Install a plugin – downloads and extracts to the plugins directory.
   * For now, just log and emit event.
   */
  async installPlugin(id: string): Promise<void> {
    const plugin = this.getPlugin(id);
    if (!plugin) throw new Error(`Plugin ${id} not found.`);
    // In a real implementation, we would download and extract.
    Logger.info(`Installing plugin ${plugin.name} (${plugin.id})...`);
    this.eventBus.emit('pluginMarketplace:install', plugin);
    // Emulate installation delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    // Notify that plugin is installed (will be loaded on next boot)
    this.eventBus.emit('pluginMarketplace:installed', plugin);
  }
}
