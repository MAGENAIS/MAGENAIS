import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';
import { Logger } from '../../core/Logger';

/**
 * Transformers.js adapter — runs small open models entirely in-browser via
 * ONNX Runtime Web (https://github.com/huggingface/transformers.js), with
 * WebGPU acceleration used when a real WebGPU adapter is obtainable and a
 * WASM fallback otherwise — unlike WebLLMAdapter, this works on essentially
 * any modern browser, not just WebGPU ones.
 *
 * ============================================================
 * CODE REVIEW — issues found in the previous implementation
 * ============================================================
 * 1. WebGPU was never actually requested. `pipeline(task, model)` was
 *    called with no `device` option, so despite the file's own comment
 *    claiming "WebGPU acceleration used automatically when available",
 *    @huggingface/transformers does NOT opt into WebGPU on its own — it
 *    only uses whatever `device` you pass it (defaulting to WASM/CPU).
 *    This was the root cause of Transformers.js Vision/Audio calls being
 *    slow enough to need 60-120s timeouts even on WebGPU-capable
 *    hardware — they were silently running on CPU the whole time. Fixed
 *    by `detectDevice()` below, actually requesting a WebGPU adapter
 *    (not just checking `navigator.gpu` exists — that object can be
 *    present and still fail to produce a working adapter) and passing
 *    the result into every pipeline() call.
 * 2. No text-generation/chat/summarization/translation support at all —
 *    `call()`'s switch only had vision/audio/embeddings branches; any
 *    other mode hit the default case and threw. Fixed by adding text,
 *    summarization, and translation branches (goal #1).
 * 3. `embeddings` was never a valid ProviderType (see types.ts before
 *    this change) — the `embed()` method existed but was structurally
 *    unreachable through ProviderRouter/ProviderManager, since nothing
 *    could ever register a provider of a type that doesn't exist. Fixed
 *    by adding `'embeddings'` to the ProviderType union (goal #9).
 * 4. Single point of failure on module load: only one CDN
 *    (esm.run) was ever tried. If it's blocked/down, Transformers.js was
 *    unavailable for the whole session with no retry path. Fixed with a
 *    short ordered fallback across three CDN mirrors (goal #6).
 * 5. No download-progress visibility — a multi-hundred-MB first-time
 *    model download looked identical to a hang. Fixed by wiring
 *    Transformers.js's own `progress_callback` into `options.log` (now
 *    actually threaded through — see the Node.ts/Manager.ts fix in this
 *    same change) so real percentages surface in the pipeline report.
 * 6. `testConnection()` only checked `typeof WebAssembly !== 'undefined'`
 *    — it never actually tried loading the library, so a CDN outage or a
 *    strict CSP silently blocking the dynamic import wouldn't show up
 *    until an actual generation attempt failed. Fixed with a real check
 *    (goal #5) that attempts the module load itself (bounded by a short
 *    timeout) and reports WebGPU vs WASM.
 * 7. Task/pipeline routing: this adapter is registered as a `type:'text'`
 *    provider purely so ProviderManager.callVision() can find it (see
 *    types.ts's `visionOnly` doc comment) — but that flag alone doesn't
 *    stop it from being offered for plain text-generation requests
 *    unless every install has it. Now that this adapter genuinely CAN
 *    serve text generation, a second, separate, real text-generation
 *    provider entry was added (`builtin-transformers-text`, NOT
 *    vision-only) so the two roles are cleanly distinct rather than
 *    overloading the vision-only entry into also answering text.
 *
 * Pipelines backed by this adapter:
 *   - Text generation / chat: SmolLM2-360M-Instruct — small enough to
 *     download and run in-browser, instruction-tuned.
 *   - Summarization: DistilBART-CNN.
 *   - Translation: T5-small (English source only — see translate()).
 *   - Vision / image captioning: ViT-GPT2.
 *   - OCR: TrOCR, reusing the same image-to-text pipeline as captioning
 *     but with a model trained specifically to read text in images.
 *   - Audio (speech-to-text): Whisper-tiny.en.
 *   - Embeddings: all-MiniLM-L6-v2 sentence embeddings.
 * All defaults are overridable per-provider via `provider.defaultModel`
 * in Keys & Providers, same as every other adapter (goal #3).
 */

// ---------------------------------------------------------------------------
// Module loading — multiple CDN mirrors, short bounded timeout per attempt
// so an unreachable/blocked CDN fails fast rather than eating the whole
// provider timeout before a real model pipeline gets a chance to start.
// ---------------------------------------------------------------------------
const TRANSFORMERS_CDN_URLS = [
  'https://esm.run/@huggingface/transformers',
  'https://cdn.jsdelivr.net/npm/@huggingface/transformers/+esm',
  'https://unpkg.com/@huggingface/transformers?module',
];

let transformersModulePromise: Promise<any> | null = null;
function loadTransformersModule(log?: (msg: string, level?: 'info' | 'warn' | 'error') => void): Promise<any> {
  if (!transformersModulePromise) {
    transformersModulePromise = (async () => {
      let lastError: any = null;
      for (const url of TRANSFORMERS_CDN_URLS) {
        try {
          // Real runtime ES module resolved directly from a CDN URL at
          // runtime, not an npm package TypeScript has type declarations
          // for — using a variable (not a string literal) here means TS
          // doesn't attempt module resolution on it at all, so no type
          // suppression comment is needed here (unlike the literal-URL
          // case in WebLLMAdapter.ts).
          const mod = await Promise.race([
            import(/* @vite-ignore */ url),
            new Promise((_, reject) => setTimeout(() => reject(new Error('CDN request timed out')), 8000)),
          ]);
          return mod;
        } catch (err: any) {
          lastError = err;
          log?.(`Transformers.js: couldn't load from ${url} (${err?.message || err}), trying next source…`, 'warn');
        }
      }
      throw new Error(`Transformers.js library failed to load from all ${TRANSFORMERS_CDN_URLS.length} CDN sources — check your network connection or content-security-policy. Last error: ${lastError?.message || lastError}`);
    })().catch((err) => {
      transformersModulePromise = null; // allow retry later instead of caching a permanent failure
      throw err;
    });
  }
  return transformersModulePromise;
}

// ---------------------------------------------------------------------------
// Device capability detection: WebGPU → WASM. `navigator.gpu` existing is
// not sufficient on its own (it can be present but fail to produce a real
// adapter, e.g. GPU blocklisted or out of memory) — actually request one.
// ---------------------------------------------------------------------------
let cachedDevice: 'webgpu' | 'wasm' | null = null;
async function detectDevice(): Promise<'webgpu' | 'wasm'> {
  if (cachedDevice) return cachedDevice;
  try {
    const gpu = (navigator as any)?.gpu;
    if (gpu && typeof gpu.requestAdapter === 'function') {
      const adapter = await Promise.race([
        gpu.requestAdapter(),
        new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
      ]);
      if (adapter) {
        cachedDevice = 'webgpu';
        return cachedDevice;
      }
    }
  } catch {
    // fall through to wasm
  }
  cachedDevice = 'wasm';
  return cachedDevice;
}

// ---------------------------------------------------------------------------
// One lazily-created pipeline instance per (task, model, device) triple,
// reused across every call so repeated requests don't re-download and
// re-initialize the model each time. Keying on device too means a rare
// mid-session device change (e.g. GPU context lost) creates a fresh
// pipeline instead of silently reusing one built for the wrong backend.
// ---------------------------------------------------------------------------
const pipelineCache: Map<string, Promise<any>> = new Map();
async function getPipeline(
  task: string,
  model: string,
  log?: (msg: string, level?: 'info' | 'warn' | 'error') => void
): Promise<any> {
  const device = await detectDevice();
  const key = `${task}::${model}::${device}`;
  let p = pipelineCache.get(key);
  if (!p) {
    log?.(`Transformers.js: loading "${model}" for ${task} (${device === 'webgpu' ? 'WebGPU-accelerated' : 'WASM/CPU'})… first run downloads and caches the model, later runs reuse it instantly.`, 'info');
    let lastPct = -1;
    p = loadTransformersModule(log).then(({ pipeline }) =>
      pipeline(task, model, {
        device,
        // Falls back to wasm automatically inside the library too if a
        // webgpu op isn't implemented for this model — belt and suspenders.
        progress_callback: (progress: any) => {
          if (progress?.status === 'progress' && typeof progress.progress === 'number') {
            const pct = Math.round(progress.progress);
            if (pct !== lastPct && pct % 20 === 0) {
              lastPct = pct;
              log?.(`Transformers.js: downloading "${progress.file || model}" — ${pct}%`, 'info');
            }
          }
        },
      })
    );
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
   * Real health check (previously just checked `typeof WebAssembly`):
   * verifies the library itself actually loads from a CDN within a short
   * bound, and reports which backend (WebGPU vs WASM) will be used —
   * catching a blocked/unreachable CDN or a restrictive CSP here instead
   * of only surfacing it as a confusing failure on first real use.
   */
  async testConnection(_provider: ProviderConfig): Promise<{ ok: boolean; message: string }> {
    if (typeof WebAssembly === 'undefined') {
      return { ok: false, message: "This browser doesn't support WebAssembly, which Transformers.js requires." };
    }
    try {
      await Promise.race([
        loadTransformersModule(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 6000)),
      ]);
    } catch (err: any) {
      return { ok: false, message: `Transformers.js library couldn't be loaded: ${err?.message || err}` };
    }
    const device = await detectDevice();
    return {
      ok: true,
      message: device === 'webgpu'
        ? 'Ready — WebGPU acceleration available. Models download on first use and are cached afterward.'
        : 'Ready — running on WASM/CPU (no WebGPU adapter available, so this will be slower). Models download on first use and are cached afterward.',
    };
  }

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    const mode = options?.mode || provider.type;
    const task = options?.task; // optional sub-task hint, e.g. 'ocr' within vision
    try {
      switch (mode) {
        case 'vision':
          return task === 'ocr'
            ? await this.ocr(provider, input, options)
            : await this.caption(provider, input, options);
        case 'audio':
          return await this.transcribe(provider, input, options);
        case 'embeddings':
          return await this.embed(provider, input, options);
        case 'text':
          if (task === 'summarization') return await this.summarize(provider, input, options);
          if (task === 'translation') return await this.translate(provider, input, options);
          return await this.generateText(provider, input, options);
        default:
          // Friendly, predictable message rather than letting an unexpected
          // mode value fall through to something task-specific below.
          throw new Error(`Transformers.js doesn't support the "${mode}" task in this app.`);
      }
    } catch (err: any) {
      // Goal #7: never let a raw/unexpected exception (a WASM abort, an
      // ONNX runtime internal error, a malformed model response) bubble up
      // as-is — always a clean, readable Error so the fallback chain's
      // report shows something a person can actually act on.
      if (err instanceof Error) throw err;
      throw new Error(`Transformers.js error: ${String(err)}`);
    }
  }

  /** Text generation / chat — small in-browser instruct model, works without WebGPU. */
  private async generateText(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const prompt = (input?.prompt ?? input) as string;
    if (!prompt) throw new Error('Transformers.js text generation requires a prompt.');
    const model = provider.defaultModel || 'HuggingFaceTB/SmolLM2-360M-Instruct';
    const generator = await getPipeline('text-generation', model, options?.log);
    const messages = [{ role: 'user', content: prompt }];
    const output = await generator(messages, {
      max_new_tokens: Math.min(options?.maxTokens || 512, 1024),
      temperature: options?.temperature ?? 0.7,
      do_sample: true,
    });
    // text-generation with a chat-template input returns the full
    // conversation back; the assistant's reply is the last turn.
    const generated = Array.isArray(output) ? output[0]?.generated_text : output?.generated_text;
    const reply = Array.isArray(generated) ? generated[generated.length - 1]?.content : generated;
    const text = (reply || '').trim();
    if (!text) throw new Error('Transformers.js produced no text for this prompt.');
    return `${text}\n\n(Note: this ran on a small local model — ${model.split('/').pop()} — for best quality, enable a larger provider in Keys & Providers.)`;
  }

  /** Summarization — DistilBART. */
  private async summarize(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const text = (input?.prompt ?? input) as string;
    if (!text) throw new Error('Transformers.js summarization requires text.');
    const model = options?.summarizationModel || 'Xenova/distilbart-cnn-6-6';
    const summarizer = await getPipeline('summarization', model, options?.log);
    const output = await summarizer(text, { max_new_tokens: options?.maxTokens || 150 });
    const result = Array.isArray(output) ? output[0]?.summary_text : output?.summary_text;
    if (!result) throw new Error('Transformers.js produced no summary for this text.');
    return result.trim();
  }

  /**
   * Translation — T5-small. Note: T5's Transformers.js port only supports
   * translating FROM English to a handful of target languages (French,
   * German, Romanian) — it is not a general multilingual model. This is a
   * genuine model limitation, not a bug; callers wanting broader language
   * support should use a keyed provider instead.
   */
  private async translate(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const text = (input?.prompt ?? input) as string;
    if (!text) throw new Error('Transformers.js translation requires text.');
    const model = options?.translationModel || 'Xenova/t5-small';
    const targetLang = (options?.targetLang || 'fr').toLowerCase();
    const SUPPORTED: Record<string, string> = { fr: 'French', de: 'German', ro: 'Romanian' };
    if (!SUPPORTED[targetLang]) {
      throw new Error(`Transformers.js's built-in translation model only supports English → French/German/Romanian, not "${targetLang}" — use a keyed provider for other languages.`);
    }
    const translator = await getPipeline('translation', model, options?.log);
    const output = await translator(text, { src_lang: 'en', tgt_lang: targetLang });
    const result = Array.isArray(output) ? output[0]?.translation_text : output?.translation_text;
    if (!result) throw new Error('Transformers.js produced no translation for this text.');
    return result.trim();
  }

  /** Image captioning — used as Vision's zero-key fallback description. */
  private async caption(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const imageBase64: string | undefined = input?.imageBase64;
    if (!imageBase64) throw new Error('Transformers.js vision call is missing image data.');
    const model = provider.defaultModel || 'Xenova/vit-gpt2-image-captioning';
    const captioner = await getPipeline('image-to-text', model, options?.log);
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

  /**
   * OCR — reuses the image-to-text pipeline task, but with TrOCR (trained
   * specifically to read text in images) instead of the captioning model.
   * Best-effort: works well on clear printed text, poorly on handwriting
   * or heavily stylized text.
   */
  private async ocr(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const imageBase64: string | undefined = input?.imageBase64;
    if (!imageBase64) throw new Error('Transformers.js OCR call is missing image data.');
    const model = options?.ocrModel || 'Xenova/trocr-base-printed';
    const reader = await getPipeline('image-to-text', model, options?.log);
    const dataUrl = imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
    const result = await reader(dataUrl);
    const text = Array.isArray(result) ? result[0]?.generated_text : result?.generated_text;
    if (!text || !text.trim()) throw new Error('Transformers.js OCR found no readable text in this image.');
    return text.trim();
  }

  /** Whisper speech-to-text — used as Audio's zero-key transcription default. */
  private async transcribe(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const blob: Blob | undefined = input?.blob;
    if (!blob) throw new Error('Transformers.js audio call is missing an audio blob.');
    const model = provider.defaultModel || 'Xenova/whisper-tiny.en';
    const transcriber = await getPipeline('automatic-speech-recognition', model, options?.log);
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
    const extractor = await getPipeline('feature-extraction', model, options?.log);
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
