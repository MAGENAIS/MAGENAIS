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

    // Vision: input.imageBase64 is a data URL (data:image/jpeg;base64,...) —
    // Anthropic's Messages API accepts multimodal content blocks natively.
    const imageDataUrl: string | undefined = input?.imageBase64;
    const content = imageDataUrl
      ? [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (imageDataUrl.match(/^data:(image\/[a-z]+);base64,/)?.[1]) || 'image/jpeg',
              data: imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, ''),
            },
          },
          { type: 'text', text: prompt || 'Describe what you see in this image.' },
        ]
      : prompt;

    const response = await this.fetchWithRetry(
      finalUrl,
      {
        method: 'POST',
        headers: finalHeaders,
        body: JSON.stringify({
          model,
          max_tokens: options?.maxTokens ?? 1024,
          temperature: options?.temperature ?? 0.8,
          messages: [{ role: 'user', content }],
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
