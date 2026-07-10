import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

declare global {
  interface Window {
    puter?: {
      ai?: {
        chat?: (prompt: string, opts?: any) => Promise<any>;
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

  async call(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const mode = options?.mode || provider.type;
    if (mode === 'speech') return this.speech(input, options);
    return this.text(input, options);
  }

  private async text(input: any, options?: any): Promise<string> {
    if (typeof window === 'undefined' || !window.puter?.ai?.chat) {
      throw new Error('Puter.js failed to load from CDN');
    }
    const prompt = input?.prompt ?? input;
    const model = options?.puterModel || 'openai/gpt-5.4-nano';
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

  private async speech(input: any, options?: any): Promise<string> {
    if (typeof window === 'undefined' || !window.puter?.ai?.txt2speech) {
      throw new Error('Puter.js failed to load from CDN');
    }
    const text = (input?.prompt ?? input ?? '').slice(0, 2900);
    const audioEl = await window.puter.ai.txt2speech(text, options?.voice ? { provider: 'openai', voice: options.voice } : undefined);
    if (!audioEl?.src) throw new Error('Puter.js TTS returned no playable audio');
    return audioEl.src;
  }
}
