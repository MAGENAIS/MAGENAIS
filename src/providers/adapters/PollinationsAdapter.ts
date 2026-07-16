import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

export class PollinationsAdapter extends BaseAdapter {
  label = 'Pollinations';
  browserSafe = true;
  supportsModelDiscovery = true;

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    // Input can be { prompt: string, ... } with optional mode
    const prompt = input.prompt || input;
    const mode = options?.mode || 'text'; // text, image, audio, video, music
    const model = options?.model || provider.defaultModel || 'openai';

    let url: string;
    let method: 'GET' | 'POST';
    let body: any = null;
    let headers: Record<string, string> = {};

    if (mode === 'text') {
      // Use chat completion endpoint
      url = provider.baseUrl.replace(/\/$/, '') + '/v1/chat/completions';
      method = 'POST';
      body = {
        model: model,
        messages: [{ role: 'user', content: prompt }],
        temperature: options?.temperature ?? 0.8,
      };
      headers['Content-Type'] = 'application/json';
    } else if (mode === 'image') {
      // Image generation: GET request with query params
      const params = new URLSearchParams({
        width: options?.width || 1024,
        height: options?.height || 1024,
        model: model,
        seed: options?.seed || Math.floor(Math.random() * 2147483647).toString(),
      });
      url = `${provider.baseUrl.replace(/\/$/, '')}/image/${encodeURIComponent(prompt)}?${params}`;
      method = 'GET';
    } else if (mode === 'audio' || mode === 'speech') {
      // TTS: GET with voice param
      const params = new URLSearchParams({
        voice: options?.voice || 'nova',
      });
      url = `${provider.baseUrl.replace(/\/$/, '')}/audio/${encodeURIComponent(prompt)}?${params}`;
      method = 'GET';
    } else if (mode === 'video') {
      // Video generation (may require Pollen balance)
      const params = new URLSearchParams({
        model: model,
        duration: options?.duration || 4,
        aspectRatio: options?.aspect || '16:9',
      });
      url = `${provider.baseUrl.replace(/\/$/, '')}/video/${encodeURIComponent(prompt)}?${params}`;
      method = 'GET';
    } else if (mode === 'music') {
      const params = new URLSearchParams({
        model: model || 'elevenmusic',
      });
      if (options?.style) params.set('voice', options.style);
      const fullPrompt = options?.style ? `${prompt}, style: ${options.style}` : prompt;
      url = `${provider.baseUrl.replace(/\/$/, '')}/audio/${encodeURIComponent(fullPrompt)}?${params}`;
      method = 'GET';
    } else {
      throw new Error(`Unsupported mode '${mode}' for Pollinations adapter.`);
    }

    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);

    const fetchOptions: RequestInit = {
      method,
      headers: finalHeaders,
    };
    if (body) {
      fetchOptions.body = JSON.stringify(body);
    }

    const response = await this.fetchWithRetry(finalUrl, fetchOptions, provider, undefined, options?.signal);
    if (!response.ok) {
      const text = await response.text();
      // Provide specific error if it's about Pollen balance
      if (response.status === 402) {
        throw new Error('Pollinations account has insufficient Pollen balance (402).');
      }
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    // Parse based on mode
    if (mode === 'text') {
      const json = await response.json();
      const content = json.choices?.[0]?.message?.content;
      if (content) return content;
      return json;
    } else {
      // For image/audio/video, return blob URL
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
  }

  async fetchModels(provider: ProviderConfig): Promise<string[]> {
    const url = provider.baseUrl.replace(/\/$/, '') + '/v1/models';
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
