import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';
import { Logger } from '../../core/Logger';

/**
 * Transformers.js adapter — runs small open models entirely in-browser via
 * ONNX Runtime Web / WASM (https://github.com/xenova/transformers.js — now
 * @huggingface/transformers), with WebGPU acceleration used automatically
 * when available and a WASM fallback otherwise, so — unlike WebLLMAdapter —
 * this one works on essentially any modern browser, not just WebGPU ones.
 *
 * This adapter backs THREE zero-key default pipelines:
 *   - Vision: image captioning (Xenova/vit-gpt2-image-captioning), used as
 *     MAGENAIS's guaranteed no-provider-configured fallback for the Vision
 *     tab and for auto-captioning images chained into text steps.
 *   - Audio (speech-to-text): Whisper (Xenova/whisper-tiny.en), the
 *     "Transformers.js Whisper" default called for in the spec.
 *   - Embeddings: all-MiniLM-L6-v2 sentence embeddings, for any future
 *     semantic-search/vector-store feature.
 *
 * Each task uses `pipeline()`'s built-in per-task model cache, and models
 * are downloaded once then cached by the browser (Cache Storage), same
 * tradeoff as WebLLMAdapter: first use per task is slower, everything after
 * is fast and fully offline.
 */

let transformersModulePromise: Promise<any> | null = null;
function loadTransformersModule(): Promise<any> {
  if (!transformersModulePromise) {
    // @ts-expect-error TS2307 — real runtime ES module resolved directly
    // from a CDN URL, not an npm package TypeScript can find declarations
    // for (see the matching comment in WebLLMAdapter.ts).
    transformersModulePromise = import(/* @vite-ignore */ 'https://esm.run/@huggingface/transformers');
  }
  return transformersModulePromise;
}

// One lazily-created pipeline instance per task, reused across every call so
// repeated Vision/Audio requests don't re-download and re-initialize the
// model each time.
const pipelineCache: Map<string, Promise<any>> = new Map();
async function getPipeline(task: string, model: string): Promise<any> {
  const key = `${task}::${model}`;
  let p = pipelineCache.get(key);
  if (!p) {
    p = loadTransformersModule().then(({ pipeline }) => pipeline(task, model));
    p.catch(() => pipelineCache.delete(key)); // allow retry on failure
    pipelineCache.set(key, p);
  }
  return p;
}

export class TransformersAdapter extends BaseAdapter {
  label = 'Transformers.js (Browser)';
  browserSafe = true;
  supportsModelDiscovery = false;

  /**
   * Transformers.js works via WASM on essentially every modern browser
   * (no WebGPU requirement), so the only real precondition is that the
   * browser can run WebAssembly at all — true for every browser MAGENAIS
   * otherwise supports. Reports healthy unconditionally; an actual model
   * load failure (e.g. offline on first-ever use, before caching) surfaces
   * as a normal call-time error handled by the fallback chain.
   */
  async testConnection(_provider: ProviderConfig): Promise<{ ok: boolean; message: string }> {
    if (typeof WebAssembly === 'undefined') {
      return { ok: false, message: "This browser doesn't support WebAssembly, which Transformers.js requires." };
    }
    return { ok: true, message: 'Ready — models download on first use and are cached afterward.' };
  }

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    const mode = options?.mode || provider.type;
    switch (mode) {
      case 'vision':
        return this.caption(provider, input, options);
      case 'audio':
        return this.transcribe(provider, input, options);
      case 'embeddings':
        return this.embed(provider, input, options);
      default:
        throw new Error(`Transformers.js adapter doesn't support mode "${mode}".`);
    }
  }

  /** Image captioning — used as Vision's zero-key fallback description. */
  private async caption(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const imageBase64: string | undefined = input?.imageBase64;
    if (!imageBase64) throw new Error('Transformers.js vision call is missing image data.');
    const model = provider.defaultModel || 'Xenova/vit-gpt2-image-captioning';
    const captioner = await getPipeline('image-to-text', model);
    const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
    const result = await captioner(dataUrl);
    const text = Array.isArray(result) ? result[0]?.generated_text : result?.generated_text;
    if (!text) throw new Error('Transformers.js produced no caption for this image.');
    // Locally-run image captioning models describe the scene but don't
    // follow an arbitrary user question the way a full multimodal chat
    // model does — surface the user's prompt alongside the caption so the
    // limitation is transparent rather than silently ignoring their ask.
    const userPrompt = input?.prompt as string | undefined;
    return userPrompt
      ? `${text}\n\n(Note: this ran on a local, caption-only model, so it can't directly answer "${userPrompt}" — for open-ended visual Q&A, enable a multimodal provider like Anthropic or Gemini in Keys & Providers.)`
      : text;
  }

  /** Whisper speech-to-text — used as Audio's zero-key transcription default. */
  private async transcribe(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const blob: Blob | undefined = input?.blob;
    if (!blob) throw new Error('Transformers.js audio call is missing an audio blob.');
    const model = provider.defaultModel || 'Xenova/whisper-tiny.en';
    const transcriber = await getPipeline('automatic-speech-recognition', model);
    const arrayBuffer = await blob.arrayBuffer();
    // Transformers.js's ASR pipeline accepts a Float32Array of 16kHz mono
    // PCM samples directly — decode the recorded blob via the Web Audio API
    // rather than shipping a second audio-decoding dependency.
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channelData = decoded.numberOfChannels > 1
      ? averageChannels(decoded)
      : decoded.getChannelData(0);
    const result = await transcriber(channelData, { chunk_length_s: 30, stride_length_s: 5 });
    const text = Array.isArray(result) ? result[0]?.text : result?.text;
    if (!text || !text.trim()) throw new Error('No speech was detected in this audio.');
    return text.trim();
  }

  /** Sentence embeddings — free local vector representations, no key needed. */
  private async embed(provider: ProviderConfig, input: any, options?: any): Promise<number[]> {
    const text = input?.prompt ?? input;
    const model = provider.defaultModel || 'Xenova/all-MiniLM-L6-v2';
    const extractor = await getPipeline('feature-extraction', model);
    const output = await extractor(String(text), { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }
}

function averageChannels(buffer: AudioBuffer): Float32Array {
  const length = buffer.length;
  const result = new Float32Array(length);
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) result[i] += data[i] / buffer.numberOfChannels;
  }
  return result;
}
