import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

const DEFAULT_VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

export class ElevenLabsAdapter extends BaseAdapter {
  label = 'ElevenLabs';
  browserSafe = true;
  supportsModelDiscovery = false;

  async call(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const text = input?.prompt ?? input;
    const voiceId = options?.voice || DEFAULT_VOICE_ID;
    const url = provider.baseUrl.replace(/\/$/, '') + '/text-to-speech/' + voiceId;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);

    const response = await this.fetchWithRetry(
      finalUrl,
      {
        method: 'POST',
        headers: finalHeaders,
        body: JSON.stringify({ text, model_id: provider.defaultModel || 'eleven_multilingual_v2' }),
      },
      provider,
      undefined,
      options?.signal
    );
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
    }
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }
}
