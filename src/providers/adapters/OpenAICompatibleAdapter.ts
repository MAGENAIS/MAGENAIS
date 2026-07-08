import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';
import { Logger } from '../../core/Logger';

export class OpenAICompatibleAdapter extends BaseAdapter {
  label = 'OpenAI-compatible';
  browserSafe = true;
  supportsModelDiscovery = true;

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    // input is expected to be { prompt: string, ... } or a full messages array
    const endpoint = options?.endpoint || '/chat/completions';
    const url = provider.baseUrl.replace(/\/$/, '') + endpoint;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);

    const body: any = {
      model: options?.model || provider.defaultModel || 'gpt-3.5-turbo',
      messages: options?.messages || [{ role: 'user', content: input.prompt || input }],
      temperature: options?.temperature ?? 0.8,
      max_tokens: options?.maxTokens ?? 1024,
    };

    const response = await this.fetchWithRetry(
      finalUrl,
      {
        method: 'POST',
        headers: finalHeaders,
        body: JSON.stringify(body),
      },
      provider
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const json = await response.json();
    // Extract text from standard OpenAI response
    if (json.choices && json.choices.length > 0) {
      const message = json.choices[0].message;
      if (message && message.content) {
        return message.content;
      }
    }
    // Fallback: return the whole json
    return json;
  }

  async fetchModels(provider: ProviderConfig): Promise<string[]> {
    const url = provider.baseUrl.replace(/\/$/, '') + '/models';
    const headers: Record<string, string> = {};
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);
    const response = await this.fetchWithRetry(finalUrl, { method: 'GET', headers: finalHeaders }, provider, 0);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching models`);
    }
    const json = await response.json();
    const list = json.data || json.models || (Array.isArray(json) ? json : []);
    return list.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  }
}
