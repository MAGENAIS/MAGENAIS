/**
 * Asset Manager – handles storage, retrieval, and metadata of assets.
 * Assets can be images, videos, audio, documents, research results, etc.
 */

import { Asset, AssetType, AssetMetadata } from './types';
import { Logger } from '../core/Logger';
import { EventBus } from '../core/EventBus';
import { Persistence } from '../core/state/Persistence';

export class AssetManager {
  private assets: Map<string, Asset> = new Map();
  private eventBus: EventBus;
  private persistence: Persistence;
  private storageKey: string = 'magenais:assets';

  constructor(eventBus: EventBus, persistence: Persistence) {
    this.eventBus = eventBus;
    this.persistence = persistence;
  }

  /**
   * Load assets from persistence.
   */
  async load(): Promise<void> {
    const data = await this.persistence.load();
    if (data && data.assets) {
      data.assets.forEach((a: Asset) => this.assets.set(a.id, a));
      Logger.info(`AssetManager: loaded ${this.assets.size} assets.`);
    }
  }

  /**
   * Save assets to persistence.
   */
  async save(): Promise<void> {
    const data = await this.persistence.load() || {};
    data.assets = Array.from(this.assets.values());
    await this.persistence.save(data);
  }

  /**
   * Create a new asset.
   */
  createAsset(
    name: string,
    type: AssetType,
    data: any,
    metadata: AssetMetadata = {},
    projectId?: string
  ): Asset {
    const id = `asset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const asset: Asset = {
      id,
      name,
      type,
      data,
      metadata,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      version: 1,
      projectId,
    };
    this.assets.set(id, asset);
    this.eventBus.emit('asset:created', asset);
    Logger.info(`Asset created: ${name} (${id})`);
    this.save(); // auto-save
    return asset;
  }

  /**
   * Get an asset by id.
   */
  getAsset(id: string): Asset | undefined {
    return this.assets.get(id);
  }

  /**
   * Get all assets, optionally filtered by type.
   */
  getAssets(type?: AssetType): Asset[] {
    const list = Array.from(this.assets.values());
    if (type) return list.filter(a => a.type === type);
    return list;
  }

  /**
   * Get assets belonging to a project.
   */
  getProjectAssets(projectId: string): Asset[] {
    return Array.from(this.assets.values()).filter(a => a.projectId === projectId);
  }

  /**
   * Update an asset's metadata or data.
   */
  updateAsset(id: string, updates: Partial<Asset>): Asset | undefined {
    const asset = this.assets.get(id);
    if (!asset) return undefined;
    Object.assign(asset, updates);
    asset.updatedAt = Date.now();
    asset.version += 1;
    this.eventBus.emit('asset:updated', asset);
    this.save();
    return asset;
  }

  /**
   * Delete an asset.
   */
  deleteAsset(id: string): boolean {
    const asset = this.assets.get(id);
    if (!asset) return false;
    this.assets.delete(id);
    this.eventBus.emit('asset:deleted', id);
    this.save();
    // Optionally revoke blob URL if data is a blob URL
    if (typeof asset.data === 'string' && asset.data.startsWith('blob:')) {
      try { URL.revokeObjectURL(asset.data); } catch (e) {}
    }
    return true;
  }

  /**
   * Export assets to a portable JSON format.
   */
  exportAssets(ids?: string[]): any {
    const list = ids ? ids.map(id => this.assets.get(id)).filter(Boolean) : Array.from(this.assets.values());
    return list.map(a => ({
      ...a,
      // Exclude large binary data from JSON export
      data: typeof a.data === 'string' && a.data.startsWith('blob:') ? null : a.data,
    }));
  }

  /**
   * Import assets from JSON.
   */
  importAssets(data: any[]): void {
    data.forEach((item: any) => {
      const asset = {
        ...item,
        id: item.id || `asset_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        createdAt: item.createdAt || Date.now(),
        updatedAt: item.updatedAt || Date.now(),
        version: item.version || 1,
      };
      this.assets.set(asset.id, asset);
    });
    this.save();
    Logger.info(`Imported ${data.length} assets.`);
  }

  /**
   * Search assets by name or metadata.
   */
  search(query: string): Asset[] {
    const q = query.toLowerCase();
    return Array.from(this.assets.values()).filter(a =>
      a.name.toLowerCase().includes(q) ||
      JSON.stringify(a.metadata).toLowerCase().includes(q)
    );
  }
}
