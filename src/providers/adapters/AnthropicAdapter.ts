import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

/**
 * Anthropic Messages API adapter.
 * Anthropic blocks direct browser calls via CORS unless the
 * anthropic-dangerous-direct-browser-access header is sent — added here automatically,
 * same as the legacy monolith did.
 */
export class AnthropicAdapter extends BaseAdapter {
  label = 'Anthropic';
  browserSafe = true;
  supportsModelDiscovery = false;

  async call(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const prompt = input?.prompt ?? input;
    const model = options?.model || provider.defaultModel || 'claude-3-5-haiku-latest';
    const url = provider.baseUrl.replace(/\/$/, '') + '/messages';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);

    const response = await this.fetchWithRetry(
      finalUrl,
      {
        method: 'POST',
        headers: finalHeaders,
        body: JSON.stringify({
          model,
          max_tokens: options?.maxTokens ?? 1024,
          temperature: options?.temperature ?? 0.8,
          messages: [{ role: 'user', content: prompt }],
        }),
      },
      provider
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const json = await response.json();
    const text = json.content?.[0]?.text;
    if (!text) throw new Error(`empty response from ${provider.name}`);
    return text;
  }
}
