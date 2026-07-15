import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

/**
 * Hugging Face Inference (router.huggingface.co) adapter.
 * Mirrors the legacy monolith's HF_PIPELINE_CONFIG dispatch: each provider "type"
 * (text/image/video/image-to-video/speech/audio/music) has its own path, request
 * body shape, and response parsing — HF does not use one uniform contract.
 */
export class HuggingFaceAdapter extends BaseAdapter {
  label = 'Hugging Face Inference API';
  browserSafe = true;
  supportsModelDiscovery = false; // HF doesn't expose one universal browsable list across pipeline types

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    const model = options?.model || provider.defaultModel;
    if (!model) {
      throw new Error(`${provider.name} needs a model id entered manually — Hugging Face doesn't expose a browsable model list.`);
    }
    const pipelineType = options?.mode || provider.type;

    switch (pipelineType) {
      case 'text':
      // ROOT CAUSE: the built-in "Hugging Face (Research)" preset provider
      // (type: 'research') exists specifically to "reuse the Hugging Face
      // text pipeline for research/summarization-style prompts" — that's
      // its own `notes` field, verbatim. But this switch never actually
      // had a case for 'research' (or 'coding'/'agents'/'gamegen', for
      // anyone who points a custom provider of those types at this
      // adapter), so every call fell through to the `default` throw
      // regardless of API key. OpenAICompatibleAdapter already routes
      // these the same way callText does here — this just brings HF's
      // adapter in line with that existing, working pattern.
      case 'research':
      case 'coding':
      case 'agents':
      case 'gamegen':
        return this.callText(provider, model, input, options);
      case 'image':
        return this.callImage(provider, model, input, options);
      case 'video':
      case 'image-to-video':
        return this.callVideo(provider, model, pipelineType, input, options);
      case 'speech':
        return this.callSpeech(provider, model, input, options);
      case 'audio':
        return this.callAudioTranscription(provider, model, input);
      case 'music':
        return this.callMusic(provider, model, input, options);
      default:
        throw new Error(`Unsupported Hugging Face pipeline type '${pipelineType}'.`);
    }
  }

  private endpoint(provider: ProviderConfig, path: string): string {
    return provider.baseUrl.replace(/\/$/, '') + path;
  }

  private async jsonRequest(provider: ProviderConfig, url: string, body: any): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);
    const response = await this.fetchWithRetry(finalUrl, { method: 'POST', headers: finalHeaders, body: JSON.stringify(body) }, provider);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return response;
  }

  private async callText(provider: ProviderConfig, model: string, input: any, options?: any): Promise<string> {
    const prompt = input?.prompt ?? input;
    const res = await this.jsonRequest(provider, this.endpoint(provider, '/v1/chat/completions'), {
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: options?.temperature ?? 0.7,
      max_tokens: options?.maxTokens || 1024,
      stream: false,
    });
    const json = await res.json();
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error('Model returned no text — response shape was unexpected.');
    return text;
  }

  private async callImage(provider: ProviderConfig, model: string, input: any, options?: any): Promise<string> {
    const prompt = input?.prompt ?? input;
    let res: Response;
    try {
      res = await this.jsonRequest(provider, this.endpoint(provider, `/hf-inference/models/${model}`), {
        inputs: prompt,
        parameters: {
          width: options?.width ? parseInt(options.width, 10) : undefined,
          height: options?.height ? parseInt(options.height, 10) : undefined,
          ...(options?.extraParams || {}),
        },
      });
    } catch (err: any) {
      // ROOT CAUSE (user-reported: HF image providers failing with HTTP
      // 410 "model is deprecated" regardless of which model id is
      // configured): this isn't a per-model deprecation at all — Hugging
      // Face's own docs confirm their free `hf-inference` serverless
      // backend stopped serving image-generation models entirely in favor
      // of routing through third-party providers (fal-ai, replicate,
      // etc.) via a different endpoint shape this adapter doesn't
      // implement yet. Every model id will 410 here, not just this one —
      // surfacing that plainly (and quickly) instead of a raw JSON dump
      // is the honest, correct behavior until that routed endpoint is
      // implemented as its own follow-up.
      const msg = err?.message || String(err);
      if (/HTTP 410/.test(msg)) {
        throw new Error(`Hugging Face's free image-generation endpoint has been retired (this is not specific to "${model}" — HF now only serves image models through paid third-party providers). Use a different image provider, or add a Hugging Face key that has one of those providers enabled.`);
      }
      throw err;
    }
    const blob = await res.blob();
    if (blob.size < 500) throw new Error('Response was too small to be a real image — the model may have returned an error payload instead.');
    return URL.createObjectURL(blob);
  }

  private async callVideo(provider: ProviderConfig, model: string, pipelineType: string, input: any, options?: any): Promise<string> {
    const body = pipelineType === 'image-to-video'
      ? { image_url: input?.imageUrl ?? input, prompt: options?.prompt }
      : { prompt: input?.prompt ?? input, num_frames: options?.numFrames, fps: options?.fps };
    const res = await this.jsonRequest(provider, this.endpoint(provider, `/fal-ai/${model}`), body);
    const contentType = res.headers.get('content-type') || '';
    if (contentType.startsWith('video/')) {
      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }
    const json = await res.json().catch(() => null);
    const url = json && (json.video_url || json.video?.url || json.url || json.output?.url);
    if (url) return url;
    throw new Error(
      "Response wasn't a recognizable video. HF's raw REST contract for video isn't publicly stabilized per-provider — if this keeps failing, a server-side proxy calling fal.ai's own SDK is more reliable."
    );
  }

  private async callSpeech(provider: ProviderConfig, model: string, input: any, options?: any): Promise<string> {
    const text = input?.prompt ?? input;
    const res = await this.jsonRequest(provider, this.endpoint(provider, `/hf-inference/models/${model}`), { inputs: text });
    const blob = await res.blob();
    if (blob.size < 200) throw new Error('Response was too small to be real audio.');
    return URL.createObjectURL(blob);
  }

  private async callAudioTranscription(provider: ProviderConfig, model: string, input: any): Promise<string> {
    const blob: Blob = input?.blob ?? input;
    if (!(blob instanceof Blob)) {
      throw new Error('Audio transcription requires a Blob/File as input.');
    }
    const url = this.endpoint(provider, `/hf-inference/models/${model}`);
    const headers: Record<string, string> = { 'Content-Type': blob.type || 'application/octet-stream' };
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);
    const response = await this.fetchWithRetry(finalUrl, { method: 'POST', headers: finalHeaders, body: blob }, provider);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const json = await response.json();
    const text = json.text || (Array.isArray(json) && json[0]?.text);
    if (!text) throw new Error('Transcription returned no text.');
    return text;
  }

  private async callMusic(provider: ProviderConfig, model: string, input: any, options?: any): Promise<string> {
    const prompt = input?.prompt ?? input;
    const res = await this.jsonRequest(provider, this.endpoint(provider, `/hf-inference/models/${model}`), {
      inputs: prompt,
      parameters: { duration: options?.duration, ...(options?.extraParams || {}) },
    });
    const blob = await res.blob();
    if (blob.size < 500) throw new Error('Response was too small to be real audio.');
    return URL.createObjectURL(blob);
  }
}
