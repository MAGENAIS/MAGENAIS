import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

/**
 * Last-resort speech fallback using the browser's built-in SpeechSynthesis
 * API. Can be heard live but NOT saved to a file — a browser limitation, not
 * something this adapter can fix.
 *
 * ROOT CAUSE of "podcast/speech just starts making sound immediately, before
 * any text is shown, with no pause/stop": this used to call
 * `speechSynthesis.speak()` right here and not resolve until the utterance
 * finished (`utter.onend`) — meaning the audio played out loud DURING the
 * provider-fallback call itself, before the calling UI code ever got a
 * chance to render the text or set up playback controls. That's true
 * regardless of what the UI does afterward, since the speaking already
 * happened by the time it gets control back.
 *
 * Fixed by making this adapter a pure capability check: it resolves
 * immediately with a sentinel meaning "browser voice is available for this
 * text" WITHOUT speaking anything. Callers (AudioMode's renderBrowserSpeechBlock/
 * wireBrowserSpeechControls) are responsible for actually invoking
 * speechSynthesis themselves, on demand, via explicit Play/Pause/Stop
 * controls — after the corresponding text is already visible on screen.
 */
export class BrowserSpeechAdapter extends BaseAdapter {
  label = 'Browser Speech Synthesis';
  browserSafe = true;
  supportsModelDiscovery = false;

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const ok = typeof window !== 'undefined' && !!window.speechSynthesis;
    return { ok, message: ok ? 'Browser speech synthesis is available.' : 'speechSynthesis is not available in this browser.' };
  }

  async call(_provider: ProviderConfig, _input: any): Promise<string> {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      throw new Error('Browser speech synthesis not available');
    }
    // Deliberately does not speak here — see class comment above.
    return '__BROWSER_TTS_PENDING__';
  }
}
