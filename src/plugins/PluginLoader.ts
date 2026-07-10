import { PluginManifest, Plugin } from './types';
import { Logger } from '../core/Logger';

export class PluginLoader {
  private pluginsPath: string;

  constructor(pluginsPath: string = '/plugins') {
    this.pluginsPath = pluginsPath;
  }

  async discoverManifests(): Promise<PluginManifest[]> {
    try {
      const response = await fetch(`${this.pluginsPath}/index.json`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      return data.plugins || [];
    } catch (err) {
      Logger.warn('No plugin registry found, skipping plugin loading.', err);
      return [];
    }
  }

  async loadPlugin(manifest: PluginManifest): Promise<Plugin> {
    try {
      const modulePath = `${this.pluginsPath}/${manifest.id}/${manifest.main}`;
      // Use dynamic import (Vite will handle this)
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
