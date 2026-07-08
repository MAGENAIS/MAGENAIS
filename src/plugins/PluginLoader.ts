/**
 * Plugin Loader: discovers and loads plugins from a known location.
 * For browser, plugins can be placed in /public/plugins/ and loaded via dynamic import.
 * This implementation uses import.meta.glob in Vite for development, but can be adapted.
 */

import { PluginManifest, Plugin } from './types';
import { Logger } from '../core/Logger';

export class PluginLoader {
  private pluginsPath: string;

  constructor(pluginsPath: string = '/plugins') {
    this.pluginsPath = pluginsPath;
  }

  /**
   * Discover plugin manifests: look for plugin.json files in the plugins directory.
   * In production, we might fetch a list from a registry.
   */
  async discoverManifests(): Promise<PluginManifest[]> {
    // In a real implementation, we'd fetch a list from a known endpoint.
    // For simplicity, we'll use a static list or glob import.
    // With Vite, we can use import.meta.glob to load plugin.json files.
    // Since we're in a browser environment, we'll assume plugins are available via HTTP.
    // We'll implement a simple fetch from /plugins/index.json (a registry file).
    try {
      const response = await fetch(`${this.pluginsPath}/index.json`);
      if (!response.ok) {
        throw new Error('Plugin registry not found');
      }
      const data = await response.json();
      return data.plugins || [];
    } catch (err) {
      Logger.warn('No plugin registry found, skipping plugin loading', err);
      return [];
    }
  }

  /**
   * Load a plugin from its manifest.
   * The main entry point is dynamically imported.
   */
  async loadPlugin(manifest: PluginManifest): Promise<Plugin> {
    try {
      // Dynamically import the plugin's main module.
      // The path should be relative to the base URL.
      const modulePath = `${this.pluginsPath}/${manifest.id}/${manifest.main}`;
      const module = await import(/* @vite-ignore */ modulePath);
      return {
        manifest,
        instance: module,
        enabled: true,
        permissionsGranted: false,
      };
    } catch (err) {
      Logger.error(`Failed to load plugin ${manifest.id}:`, err);
      throw err;
    }
  }

  /**
   * Load all discovered plugins.
   */
  async loadAllPlugins(): Promise<Plugin[]> {
    const manifests = await this.discoverManifests();
    const plugins: Plugin[] = [];
    for (const manifest of manifests) {
      try {
        const plugin = await this.loadPlugin(manifest);
        plugins.push(plugin);
        Logger.info(`Loaded plugin: ${manifest.name} (${manifest.id})`);
      } catch (err) {
        Logger.error(`Skipping plugin ${manifest.id} due to error`, err);
      }
    }
    return plugins;
  }
}
