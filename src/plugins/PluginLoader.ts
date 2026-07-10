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
      // Plugins live under /public and are plain static files — Vite's dev server
      // refuses a direct `import(modulePath)` for anything under the public dir
      // ("should not be imported from source code... can only be referenced via
      // HTML tags"). Fetching the source as text and importing it from a Blob URL
      // sidesteps that restriction entirely and works identically in dev and in
      // a production build, since both simply serve /plugins/** as static files.
      const response = await fetch(modulePath);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} fetching ${modulePath}`);
      }
      const source = await response.text();
      const blob = new Blob([source], { type: 'text/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      try {
        const module = await import(/* @vite-ignore */ blobUrl);
        return {
          manifest,
          instance: module,
          enabled: true,
          permissionsGranted: false,
        };
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
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
