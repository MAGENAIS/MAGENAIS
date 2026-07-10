import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

/**
 * Last-resort speech fallback using the browser's built-in SpeechSynthesis API.
 * Can be heard live but NOT saved to a file — a browser limitation, not something
 * this adapter can fix. Returns a sentinel string the UI layer can recognize to
 * know playback already happened live rather than treating it as a media URL.
 */
export class BrowserSpeechAdapter extends BaseAdapter {
  label = 'Browser Speech Synthesis';
  browserSafe = true;
  supportsModelDiscovery = false;

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const ok = typeof window !== 'undefined' && !!window.speechSynthesis;
    return { ok, message: ok ? 'Browser speech synthesis is available.' : 'speechSynthesis is not available in this browser.' };
  }

  async call(_provider: ProviderConfig, input: any): Promise<string> {
    const text = input?.prompt ?? input;
    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) {
        reject(new Error('Browser speech synthesis not available'));
        return;
      }
      const utter = new SpeechSynthesisUtterance(text);
      utter.onend = () => resolve('__BROWSER_TTS_PLAYED__');
      utter.onerror = () => reject(new Error('Speech synthesis error'));
      window.speechSynthesis.speak(utter);
    });
  }
}
