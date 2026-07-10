/**
 * Model Marketplace – browse and install models from a registry.
 * For now, uses a local list; can fetch from remote URL.
 */

import { ModelListing } from './types';
import { Logger } from '../core/Logger';
import { EventBus } from '../core/EventBus';

export class ModelMarketplace {
  private models: ModelListing[] = [];
  private eventBus: EventBus;
  private registryUrl: string = 'https://magenais.github.io/models/index.json'; // placeholder

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  /**
   * Fetch models from remote registry or use local cache.
   */
  async fetchModels(): Promise<ModelListing[]> {
    try {
      const response = await fetch(this.registryUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      this.models = data.models || [];
      Logger.info(`ModelMarketplace: fetched ${this.models.length} models.`);
      this.eventBus.emit('modelMarketplace:updated', this.models);
      return this.models;
    } catch (err) {
      Logger.warn('Failed to fetch models from registry, using local list.', err);
      // Fallback to a small local list
      this.models = [
        {
          id: 'gpt-4o-mini',
          name: 'GPT-4o Mini',
          description: 'Fast, efficient OpenAI model.',
          provider: 'openai',
          modelId: 'gpt-4o-mini',
          type: 'text',
          capabilities: ['text', 'chat'],
          tags: ['popular', 'fast'],
          version: '1.0',
        },
        {
          id: 'claude-3-haiku',
          name: 'Claude 3 Haiku',
          description: 'Anthropic’s fast, affordable model.',
          provider: 'anthropic',
          modelId: 'claude-3-haiku-20240307',
          type: 'text',
          capabilities: ['text', 'chat'],
          tags: ['popular', 'fast'],
          version: '1.0',
        },
        {
          id: 'flux-1-dev',
          name: 'Flux 1 Dev',
          description: 'High-quality image generation.',
          provider: 'black-forest-labs',
          modelId: 'black-forest-labs/FLUX.1-dev',
          type: 'image',
          capabilities: ['image'],
          tags: ['popular', 'creative'],
          version: '1.0',
        },
      ];
      return this.models;
    }
  }

  /**
   * Get all models.
   */
  getModels(): ModelListing[] {
    return this.models;
  }

  /**
   * Get a model by id.
   */
  getModel(id: string): ModelListing | undefined {
    return this.models.find(m => m.id === id);
  }

  /**
   * Search models by name, description, or tags.
   */
  search(query: string): ModelListing[] {
    const q = query.toLowerCase();
    return this.models.filter(m =>
      m.name.toLowerCase().includes(q) ||
      m.description.toLowerCase().includes(q) ||
      m.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * Filter models by type and capabilities.
   */
  filter(type?: string, capabilities?: string[]): ModelListing[] {
    let result = this.models;
    if (type) result = result.filter(m => m.type === type);
    if (capabilities) result = result.filter(m => capabilities.every(c => m.capabilities.includes(c)));
    return result;
  }
}
