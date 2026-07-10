import { ProviderConfig, Adapter, AdapterCapabilities } from '../types';
import { Logger } from '../../core/Logger';

/**
 * Abstract base class for all provider adapters.
 * Implements common utilities and the Adapter interface.
 */
export abstract class BaseAdapter implements Adapter {
  abstract label: string;
  abstract browserSafe: boolean;
  abstract supportsModelDiscovery: boolean;

  /**
   * Test connection by making a lightweight request.
   * Default implementation returns ok: true if the provider has an API key (or noKeyNeeded) and baseUrl.
   * Override for specific behaviour.
   */
  async testConnection(provider: ProviderConfig): Promise<{ ok: boolean; message: string }> {
    if (!provider.baseUrl && provider.authType !== 'none') {
      return { ok: false, message: 'Base URL is required.' };
    }
    if (!provider.apiKey && !provider.noKeyNeeded) {
      return { ok: false, message: 'API key is required.' };
    }
    // If baseUrl is set and we have a key, we could attempt a lightweight request.
    // For now, just assume healthy.
    return { ok: true, message: 'Provider configuration looks valid.' };
  }

  /**
   * Fetch available models from the provider.
   * Default: not supported.
   */
  async fetchModels(provider: ProviderConfig): Promise<string[]> {
    throw new Error(`Model discovery not supported by ${this.label}.`);
  }

  /**
   * Core method to call the provider API.
   * Subclasses must implement this.
   */
  abstract call(provider: ProviderConfig, input: any, options?: any): Promise<any>;

  /**
   * Helper to build authentication headers/query parameters.
   */
  protected buildAuth(provider: ProviderConfig, url: string, headers: Record<string, string>): { url: string; headers: Record<string, string> } {
    if (provider.authType === 'bearer' && provider.apiKey) {
      headers['Authorization'] = 'Bearer ' + provider.apiKey;
    } else if (provider.authType === 'header' && provider.apiKey) {
      const headerName = provider.authHeaderName || 'Authorization';
      headers[headerName] = provider.apiKey;
    } else if (provider.authType === 'query' && provider.apiKey) {
      const paramName = provider.authQueryParam || 'api_key';
      const sep = url.includes('?') ? '&' : '?';
      url += sep + encodeURIComponent(paramName) + '=' + encodeURIComponent(provider.apiKey);
    }
    // Merge extra headers from provider.headers
    let extraHeaders: Record<string, string> = {};
    try {
      const parsed = typeof provider.headers === 'string' ? JSON.parse(provider.headers) : provider.headers;
      if (parsed && typeof parsed === 'object') {
        extraHeaders = parsed;
      }
    } catch (e) {
      Logger.warn(`Invalid headers JSON for provider ${provider.id}`);
    }
    Object.assign(headers, extraHeaders);
    return { url, headers };
  }

  /**
   * Perform a fetch with retries and timeout.
   */
  protected async fetchWithRetry(
    url: string,
    init: RequestInit,
    provider: ProviderConfig,
    retries?: number
  ): Promise<Response> {
    const maxRetries = retries !== undefined ? retries : provider.retries || 0;
    const timeout = provider.timeoutMs || 30000;
    let attempt = 0;
    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(url, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return response;
      } catch (err: any) {
        clearTimeout(timeoutId);
        attempt++;
        if (attempt > maxRetries) throw err;
        // Simple backoff
        const backoff = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise(r => setTimeout(r, backoff));
        Logger.debug(`Retry ${attempt}/${maxRetries} for ${provider.name}`);
      }
    }
    throw new Error('Max retries exceeded');
  }
}
