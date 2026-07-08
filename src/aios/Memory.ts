/**
 * AI Memory – persistent key-value store with TTL and tags.
 * Uses localStorage with IndexedDB fallback (stub).
 */

import { MemoryEntry, MemoryStore } from './types';
import { Logger } from '../core/Logger';
import { EventBus } from '../core/EventBus';

export class AIMemory {
  private memory: MemoryStore = {};
  private eventBus: EventBus;
  private storageKey: string = 'magenais:memory';

  constructor(eventBus: EventBus) {
    this.eventBus = eventBus;
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if (raw) {
        const data = JSON.parse(raw);
        // Filter expired entries
        const now = Date.now();
        this.memory = {};
        for (const [key, entry] of Object.entries(data)) {
          if (entry.ttl && (now - entry.timestamp) > entry.ttl) {
            continue; // expired
          }
          this.memory[key] = entry as MemoryEntry;
        }
        Logger.debug(`AI Memory loaded ${Object.keys(this.memory).length} entries.`);
      }
    } catch (e) {
      Logger.warn('Failed to load AI Memory, using empty store.', e);
    }
  }

  private save(): void {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.memory));
    } catch (e) {
      Logger.warn('Failed to save AI Memory.', e);
    }
  }

  /**
   * Store a value in memory.
   */
  set(key: string, value: any, ttl?: number, tags?: string[]): void {
    const entry: MemoryEntry = {
      key,
      value,
      timestamp: Date.now(),
      ttl,
      tags,
    };
    this.memory[key] = entry;
    this.save();
    this.eventBus.emit('memory:set', { key, value, ttl, tags });
  }

  /**
   * Retrieve a value from memory.
   */
  get(key: string): any {
    const entry = this.memory[key];
    if (!entry) return undefined;
    // Check expiration
    if (entry.ttl && (Date.now() - entry.timestamp) > entry.ttl) {
      delete this.memory[key];
      this.save();
      return undefined;
    }
    return entry.value;
  }

  /**
   * Delete a key from memory.
   */
  delete(key: string): void {
    delete this.memory[key];
    this.save();
    this.eventBus.emit('memory:delete', key);
  }

  /**
   * Clear all memory.
   */
  clear(): void {
    this.memory = {};
    this.save();
    this.eventBus.emit('memory:clear');
  }

  /**
   * Get all entries matching a tag.
   */
  getByTag(tag: string): MemoryEntry[] {
    return Object.values(this.memory).filter(entry => entry.tags?.includes(tag));
  }

  /**
   * Get all entries.
   */
  getAll(): MemoryEntry[] {
    return Object.values(this.memory);
  }

  /**
   * Increment usage count (for learning/heuristics).
   */
  touch(key: string): void {
    const entry = this.memory[key];
    if (entry) {
      entry.timestamp = Date.now(); // refresh timestamp to keep alive
      this.save();
    }
  }

  /**
   * Export memory as JSON.
   */
  export(): string {
    return JSON.stringify(this.memory);
  }

  /**
   * Import memory from JSON.
   */
  import(data: string): void {
    try {
      const parsed = JSON.parse(data);
      this.memory = parsed;
      this.save();
      this.eventBus.emit('memory:import');
    } catch (e) {
      Logger.warn('Failed to import memory data.', e);
    }
  }
}
