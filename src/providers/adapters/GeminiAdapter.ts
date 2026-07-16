import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

/**
 * Google Gemini (generateContent) adapter. Auth is a `?key=` query param, not a header.
 */
export class GeminiAdapter extends BaseAdapter {
  label = 'Google Gemini';
  browserSafe = true;
  supportsModelDiscovery = false;

  async call(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const prompt = input?.prompt ?? input;
    const model = options?.model || provider.defaultModel || 'gemini-1.5-flash';
    const url = provider.baseUrl.replace(/\/$/, '') + `/models/${model}:generateContent`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);

    // Vision: input.imageBase64 is a data URL — Gemini takes inline image data
    // as an additional part alongside the text part.
    const imageDataUrl: string | undefined = input?.imageBase64;
    const parts: any[] = [{ text: prompt || 'Describe what you see in this image.' }];
    if (imageDataUrl) {
      parts.push({
        inline_data: {
          mime_type: (imageDataUrl.match(/^data:(image\/[a-z]+);base64,/)?.[1]) || 'image/jpeg',
          data: imageDataUrl.replace(/^data:image\/[a-z]+;base64,/, ''),
        },
      });
    }

    const response = await this.fetchWithRetry(
      finalUrl,
      {
        method: 'POST',
        headers: finalHeaders,
        body: JSON.stringify({ contents: [{ parts }] }),
      },
      provider,
      undefined,
      options?.signal
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const json = await response.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`empty response from ${provider.name}`);
    return text;
  }
}
