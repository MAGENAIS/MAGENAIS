/**
 * Prompt Library – store, tag, and reuse prompts.
 */

import { PromptEntry } from './types';
import { Logger } from '../core/Logger';
import { EventBus } from '../core/EventBus';

export class PromptLibrary {
  private prompts: Map<string, PromptEntry> = new Map();
  private eventBus: EventBus;
  private storageKey: string = 'magenais:prompts';

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        data.forEach((p: PromptEntry) => this.prompts.set(p.id, p));
        Logger.debug(`PromptLibrary loaded ${this.prompts.size} prompts.`);
      }
    } catch (e) {
      Logger.warn('Failed to load PromptLibrary, using empty.', e);
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(Array.from(this.prompts.values())));
    } catch (e) {
      Logger.warn('Failed to save PromptLibrary.', e);
    }
  }

  /**
   * Create a new prompt entry.
   */
  create(
    name: string,
    text: string,
    tags: string[] = [],
    category?: string,
    description?: string
  ): PromptEntry {
    const id = `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const entry: PromptEntry = {
      id,
      name,
      text,
      description,
      tags,
      category,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      usageCount: 0,
      favorite: false,
    };
    this.prompts.set(id, entry);
    this.save();
    this.eventBus.emit('prompt:created', entry);
    return entry;
  }

  /**
   * Get a prompt by id.
   */
  get(id: string): PromptEntry | undefined {
    return this.prompts.get(id);
  }

  /**
   * Get all prompts, optionally filtered by tag or category.
   */
  getAll(tag?: string, category?: string): PromptEntry[] {
    let result = Array.from(this.prompts.values());
    if (tag) result = result.filter(p => p.tags.includes(tag));
    if (category) result = result.filter(p => p.category === category);
    return result;
  }

  /**
   * Update a prompt.
   */
  update(id: string, updates: Partial<PromptEntry>): PromptEntry | undefined {
    const entry = this.prompts.get(id);
    if (!entry) return undefined;
    Object.assign(entry, updates);
    entry.updatedAt = Date.now();
    this.save();
    this.eventBus.emit('prompt:updated', entry);
    return entry;
  }

  /**
   * Delete a prompt.
   */
  delete(id: string): boolean {
    const deleted = this.prompts.delete(id);
    if (deleted) {
      this.save();
      this.eventBus.emit('prompt:deleted', id);
    }
    return deleted;
  }

  /**
   * Increment usage count.
   */
  use(id: string): void {
    const entry = this.prompts.get(id);
    if (entry) {
      entry.usageCount += 1;
      this.save();
    }
  }

  /**
   * Toggle favorite status.
   */
  toggleFavorite(id: string): void {
    const entry = this.prompts.get(id);
    if (entry) {
      entry.favorite = !entry.favorite;
      this.save();
      this.eventBus.emit('prompt:favoriteToggled', entry);
    }
  }

  /**
   * Search prompts by name or text.
   */
  search(query: string): PromptEntry[] {
    const q = query.toLowerCase();
    return Array.from(this.prompts.values()).filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.text.toLowerCase().includes(q) ||
      p.tags.some(t => t.toLowerCase().includes(q))
    );
  }

  /**
   * Export prompts as JSON.
   */
  export(): string {
    return JSON.stringify(Array.from(this.prompts.values()));
  }

  /**
   * Import prompts from JSON.
   */
  import(data: string): void {
    try {
      const parsed = JSON.parse(data);
      parsed.forEach((p: PromptEntry) => {
        // Generate new id to avoid conflicts
        p.id = `prompt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        p.createdAt = Date.now();
        p.updatedAt = Date.now();
        this.prompts.set(p.id, p);
      });
      this.save();
      this.eventBus.emit('prompt:import');
    } catch (e) {
      Logger.warn('Failed to import prompts.', e);
    }
  }
}
