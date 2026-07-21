import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

declare global {
  interface Window {
    puter?: {
      ai?: {
        chat?: (prompt: string, imageOrOpts?: string | any, opts?: any) => Promise<any>;
        txt2speech?: (text: string, opts?: any) => Promise<HTMLAudioElement>;
      };
    };
  }
}

/**
 * Puter.js adapter — no API key needed, but hosted models can hit Puter's own
 * paid-usage paywall (an "Upgrade Now" modal this app can't control), which is why
 * these providers ship disabled by default in defaultProviders.ts.
 */
export class PuterAdapter extends BaseAdapter {
  label = 'Puter.js';
  browserSafe = true;
  supportsModelDiscovery = false;

  /**
   * ROOT CAUSE (Puter reported as "failed to load from CDN" even when the
   * network was fine): index.html loads https://js.puter.com/v2/ with
   * `<script defer>`, which only guarantees the script runs before
   * DOMContentLoaded — it does NOT guarantee it has finished by the time a
   * user clicks Generate a moment after the page paints, especially on a
   * slow connection or a cold cache. The old code checked `window.puter`
   * exactly once and threw immediately if it wasn't there yet, permanently
   * failing this provider for that request even though the script was
   * simply still in flight. This polls briefly (a real CDN script tag
   * resolves in well under a second once network access exists at all)
   * before giving up, so a merely-still-loading script no longer looks
   * identical to a genuinely blocked/unreachable one.
   */
  private async waitForPuter(timeoutMs = 6000): Promise<void> {
    if (typeof window === 'undefined') throw new Error('Puter.js failed to load from CDN');
    if (window.puter?.ai) return;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 150));
      if (window.puter?.ai) return;
    }
    throw new Error('Puter.js failed to load from CDN');
  }

  async call(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const mode = options?.mode || provider.type;
    if (mode === 'speech') return this.speech(input, options);
    if (mode === 'vision') return this.vision(input, options);
    return this.text(input, options);
  }

  private async text(input: any, options?: any): Promise<string> {
    await this.waitForPuter();
    if (!window.puter?.ai?.chat) {
      throw new Error('Puter.js failed to load from CDN');
    }
    const prompt = input?.prompt ?? input;
    // ROOT CAUSE FIX: Manager.ts populates `options.model` from
    // provider.defaultModel for every adapter call (see registry/Manager.ts,
    // `modelForThisProvider`) — this was reading `options.puterModel`
    // instead, a field nothing in the app ever sets. That meant a
    // provider's "Preferred model" (or a distinct defaultModel on a
    // second/third Puter-backed preset) silently had no effect at all;
    // every call used the hardcoded fallback regardless. `options.model`
    // now takes precedence, with `puterModel` kept as a legacy fallback in
    // case anything external still sets it directly.
    const model = options?.model || options?.puterModel || 'openai/gpt-5.4-nano';
    const response = await window.puter.ai.chat(prompt, { model, temperature: options?.temperature ?? 0.8 });

    let text: string | undefined;
    if (typeof response === 'string') {
      text = response;
    } else if (response?.message && Array.isArray(response.message.content)) {
      text = response.message.content.map((c: any) => c.text || '').join('');
    } else if (typeof response?.message === 'string') {
      text = response.message;
    } else if (typeof response?.message?.content === 'string') {
      text = response.message.content;
    }
    if (!text) throw new Error('empty or unrecognized response shape from Puter.js');
    return text;
  }

  /**
   * Vision via Puter.js: puter.ai.chat(prompt, imageUrlOrDataUrl, options)
   * — a base64 data: URL works the same way a hosted image URL would, per
   * Puter's documented multimodal chat signature. This gives Vision mode a
   * genuine zero-API-key option, not just a routing fix — previously
   * Vision only worked at all if the user had Anthropic/Gemini/another
   * paid provider configured.
   */
  private async vision(input: any, options?: any): Promise<string> {
    await this.waitForPuter();
    if (!window.puter?.ai?.chat) {
      throw new Error('Puter.js failed to load from CDN');
    }
    const prompt = input?.prompt || 'Describe what you see in this image in detail.';
    const imageBase64: string | undefined = input?.imageBase64;
    if (!imageBase64) throw new Error('Puter.js vision call is missing image data.');
    const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
    // Same fix as text() above — see that comment.
    const model = options?.model || options?.puterModel || 'openai/gpt-5.4-nano';
    const response = await window.puter.ai.chat(prompt, dataUrl, { model });

    let text: string | undefined;
    if (typeof response === 'string') {
      text = response;
    } else if (response?.message && Array.isArray(response.message.content)) {
      text = response.message.content.map((c: any) => c.text || '').join('');
    } else if (typeof response?.message?.content === 'string') {
      text = response.message.content;
    }
    if (!text) throw new Error('empty or unrecognized response shape from Puter.js');
    return text;
  }

  private async speech(input: any, options?: any): Promise<string> {
    await this.waitForPuter();
    if (!window.puter?.ai?.txt2speech) {
      throw new Error('Puter.js failed to load from CDN');
    }
    const text = (input?.prompt ?? input ?? '').slice(0, 2900);
    const audioEl = await window.puter.ai.txt2speech(text, options?.voice ? { provider: 'openai', voice: options.voice } : undefined);
    if (!audioEl?.src) throw new Error('Puter.js TTS returned no playable audio');
    return audioEl.src;
  }
}
