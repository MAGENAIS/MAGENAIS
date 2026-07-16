import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

/**
 * Generic REST adapter for any provider that speaks a plain OpenAI-shaped API
 * (chat/completions for text, and simple JSON-in/blob-or-json-out for the other
 * modalities). This is the fallback used by the majority of registry entries —
 * Groq, OpenRouter, Cerebras, SambaNova, GitHub Models, Cloudflare Workers AI,
 * Together AI, DeepInfra, xAI, Mistral, Stability AI, Novita, Deepgram, AssemblyAI,
 * PlayHT, fal.ai and Replicate (the latter two only work through this adapter when
 * called from a server-side proxy — direct browser calls are CORS-blocked, same as
 * in the legacy monolith) — none of which need a bespoke adapter class of their own,
 * mirroring how the legacy monolith funneled them all through a handful of generic
 * callers keyed on request 'mode' rather than one function per provider.
 */
export class OpenAICompatibleAdapter extends BaseAdapter {
  label = 'OpenAI-compatible';
  browserSafe = true;
  supportsModelDiscovery = true;

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    const mode = options?.mode || provider.type || 'text';
    switch (mode) {
      case 'text':
      case 'coding':
      case 'agents':
      case 'research':
      case 'vision':
        return this.callText(provider, input, options);
      case 'image':
        return this.callImage(provider, input, options);
      case 'video':
        return this.callVideo(provider, input, options);
      case 'speech':
        return this.callSpeech(provider, input, options);
      case 'audio':
        return this.callAudioTranscription(provider, input, options);
      case 'music':
        return this.callMusic(provider, input, options);
      default:
        return this.callText(provider, input, options);
    }
  }

  private url(provider: ProviderConfig, path: string): string {
    return provider.baseUrl.replace(/\/$/, '') + path;
  }

  private async request(provider: ProviderConfig, url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);
    const response = await this.fetchWithRetry(finalUrl, { ...init, headers: finalHeaders }, provider, undefined, signal);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return response;
  }

  async callText(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const endpoint = options?.endpoint || '/chat/completions';
    // Vision support: when callVision passes imageBase64, build the
    // standard multimodal `content: [{type:'text'},{type:'image_url'}]`
    // message shape most OpenAI-compatible chat/completions backends
    // accept (OpenRouter, GitHub Models' gpt-4o, Groq's llama-vision
    // models, etc.) — this is what lets Vision mode work through any
    // configured OpenAI-compatible provider with a vision-capable model,
    // not just the Anthropic/Gemini-specific adapters.
    const imageBase64: string | undefined = input?.imageBase64 ?? options?.imageBase64;
    const messages =
      options?.messages ||
      (imageBase64
        ? [{
            role: 'user',
            content: [
              { type: 'text', text: input?.prompt ?? '' },
              { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
            ],
          }]
        : [{ role: 'user', content: input?.prompt ?? input }]);
    const response = await this.request(provider, this.url(provider, endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || provider.defaultModel || 'default',
        messages,
        temperature: options?.temperature ?? 0.8,
        max_tokens: options?.maxTokens ?? 1024,
      }),
    }, options?.signal);
    const json = await response.json();
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error(`empty response from ${provider.name}`);
    return text;
  }

  async callImage(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const response = await this.request(provider, this.url(provider, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || provider.defaultModel || 'default',
        prompt: input?.prompt ?? input,
        width: options?.width,
        height: options?.height,
      }),
    }, options?.signal);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('image/')) {
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }
    const json = await response.json();
    const candidate = json.data?.[0] || json.images?.[0] || json.output?.[0] || json;
    if (typeof candidate === 'string' && candidate.startsWith('http')) return candidate;
    if (candidate?.url) return candidate.url;
    if (candidate?.b64_json) return 'data:image/png;base64,' + candidate.b64_json;
    throw new Error(`unrecognized image response shape from ${provider.name}`);
  }

  async callVideo(provider: ProviderConfig, input: any, options?: any): Promise<{ url: string; isFallback: boolean }> {
    const response = await this.request(provider, this.url(provider, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || provider.defaultModel || 'default',
        prompt: input?.prompt ?? input,
        duration: options?.duration,
      }),
    }, options?.signal);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('video/')) {
      const blob = await response.blob();
      return { url: URL.createObjectURL(blob), isFallback: false };
    }
    const json = await response.json();
    const candidate = json.data?.[0] || json.output?.[0] || json;
    if (typeof candidate === 'string' && candidate.startsWith('http')) return { url: candidate, isFallback: false };
    if (candidate?.url) return { url: candidate.url, isFallback: false };
    throw new Error(`unrecognized video response shape from ${provider.name} (it may use async job-polling, which isn't supported generically)`);
  }

  async callSpeech(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const response = await this.request(provider, this.url(provider, '/audio/speech'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.defaultModel || 'tts-1',
        voice: options?.voice || 'alloy',
        input: input?.prompt ?? input,
      }),
    }, options?.signal);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  async callAudioTranscription(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const blob: Blob = input?.blob ?? input;
    if (!(blob instanceof Blob)) throw new Error('Audio transcription requires a Blob/File as input.');
    const form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('model', provider.defaultModel || 'whisper-1');
    const headers: Record<string, string> = {};
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, this.url(provider, '/audio/transcriptions'), headers);
    const response = await this.fetchWithRetry(finalUrl, { method: 'POST', headers: finalHeaders, body: form }, provider, undefined, options?.signal);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const json = await response.json();
    const text = json.text || json.transcript;
    if (!text) throw new Error(`empty transcription response from ${provider.name}`);
    return text;
  }

  async callMusic(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const response = await this.request(provider, this.url(provider, '/audio/generations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.defaultModel || 'default',
        prompt: input?.prompt ?? input,
        duration: options?.duration || 30,
      }),
    }, options?.signal);
    const blob = await response.blob();
    if (blob.size < 500) throw new Error('Response was too small to be real audio.');
    return URL.createObjectURL(blob);
  }

  async fetchModels(provider: ProviderConfig): Promise<string[]> {
    const url = this.url(provider, '/models');
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
