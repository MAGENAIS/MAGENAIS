/**
 * Discovery module for auto-detecting available providers (e.g., from remote registry).
 * For now, we just load defaults. This can be extended later.
 */
import { ProviderConfig } from '../types';

export class ProviderDiscovery {
  /**
   * Discover providers from a remote source or local defaults.
   * Returns an array of provider configs.
   */
  static async discover(): Promise<ProviderConfig[]> {
    // For now, we return empty; the Manager will load defaults.
    // In the future, we could fetch from a marketplace or local plugins.
    return [];
  }
}
