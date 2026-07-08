import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';
import { Logger } from '../../core/Logger';

export class HuggingFaceAdapter extends BaseAdapter {
  label = 'Hugging Face Inference API';
  browserSafe = true;
  supportsModelDiscovery = false; // we don't have a universal models list

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    // input can be { prompt: string, ... } or { inputs: string }
    const model = options?.model || provider.defaultModel;
    if (!model) throw new Error('Hugging Face adapter requires a model id.');

    const endpoint = options?.endpoint || `/hf-inference/models/${model}`;
    const url = provider.baseUrl.replace(/\/$/, '') + endpoint;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);

    // Prepare body according to HF inference API
    let body: any;
    const pipelineType = options?.pipelineType || provider.type;
    if (pipelineType === 'audio') {
      // For audio transcription, input is binary
      // This is simplified; in real usage, we'd handle blob.
      throw new Error('Audio transcription with HF adapter not implemented in this demo.');
    } else {
      body = {
        inputs: input.prompt || input,
        parameters: options?.parameters || {},
      };
    }

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

    // Parse response based on pipeline type
    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('image/') || contentType.startsWith('audio/') || contentType.startsWith('video/')) {
      // Return blob URL for media
      const blob = await response.blob();
      return URL.createObjectURL(blob);
    }

    const json = await response.json();
    // Text generation often returns array with generated_text
    if (Array.isArray(json) && json.length > 0 && json[0].generated_text) {
      return json[0].generated_text;
    }
    if (json.generated_text) return json.generated_text;
    // Fallback
    return json;
  }
}
