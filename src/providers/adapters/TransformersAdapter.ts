import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';
import { Logger } from '../../core/Logger';
import { getSelectedModelId, LocalModelTask } from '../LocalModelRegistry';
import { isInstalled, markUsed, registerWarmModelImpl } from '../LocalModelDownloadManager';

/**
 * Thrown by getPipeline() when a generation call needs a model that hasn't
 * been downloaded yet — see LocalModelDownloadManager.ts's doc comment for
 * the full root-cause writeup. `.code` lets ProviderReport.ts recognize
 * this specific failure (see its 'Local model not downloaded' bucket) and
 * give a message that says "go download it" instead of a generic error;
 * `.modelId`/`.task` let the UI offer a direct one-click way to do that
 * (see Manager.ts's lastLocalModelMissing tracking).
 */
export class ModelNotInstalledError extends Error {
  code = 'LOCAL_MODEL_NOT_INSTALLED' as const;
  constructor(public modelId: string, public task: LocalModelTask) {
    super(`"${modelId.split('/').pop()}" hasn't been downloaded yet. Open Local Models in the Universal Provider Manager to download it, then try again.`);
    this.name = 'ModelNotInstalledError';
  }
}

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
 * 8. builtin-transformers-music (registered since this file's first
 *    version) had no matching implementation — call()'s switch had no
 *    'music' case, so every call threw immediately. Fixed by adding
 *    generateMusic() (MusicGen via the 'text-to-audio' pipeline task,
 *    WAV-encoded for playback — see floatArrayToWavBlob).
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
 *   - Music generation: MusicGen-small — see PHASE 3 note below; this was
 *     registered as a provider from day one but had no implementation
 *     until now.
 *   - Embeddings: all-MiniLM-L6-v2 sentence embeddings.
 * All defaults are overridable per-provider via `provider.defaultModel`
 * in Keys & Providers, same as every other adapter (goal #3).
 *
 * ============================================================
 * PHASE 8 — Performance (item 11), and what's deliberately NOT here.
 * ============================================================
 * WebGPU-first device detection with a real (not just feature-detected)
 * WASM fallback, lazy CDN loading, one-pipeline-per-(task,model,device)
 * reuse (no re-download/re-init per request — see pipelineCache below),
 * and best-effort memory cleanup on model switch (disposeModelPipelines)
 * were already solid before this pass; item 11's "tokenizer caching /
 * graph caching / ONNX session reuse" are inherent side effects of that
 * same pipelineCache reuse, not separate work needed. This pass added a
 * cancellation check to call() below (see its own comment for exact scope
 * — it covers the common "a faster provider already won the race" case,
 * not true mid-generation abort).
 *
 * Deliberately NOT attempted: moving inference into a Web Worker so a
 * long WASM/CPU generation can't block the main thread's UI responsiveness
 * ("worker reuse" in the brief). Not skipped for lack of value — skipped
 * because doing it correctly means a real postMessage protocol,
 * transferring image/audio buffers across that boundary, and depending on
 * transformers.js's own worker-mode API, none of which this pass could
 * actually run in a browser to verify. Shipping that untested risked a
 * worse outcome than not shipping it at all: a "fix" that silently breaks
 * vision/audio input, or one nobody can tell isn't actually running in a
 * worker. Left for a pass that can be tested against a real browser.
 *
 * ============================================================
 * PHASE 2 — LocalModelRegistry wiring
 * ============================================================
 * Every hardcoded model-ID literal below (e.g. the previous
 * `'HuggingFaceTB/SmolLM2-360M-Instruct'` fallback) has been replaced with
 * a lookup against `../LocalModelRegistry` — `getSelectedModelId(task,
 * role?)`, which returns the person's saved Keys & Providers choice for
 * that task if they made one, else the registry's recommended default.
 * `provider.defaultModel` (the per-provider field already editable in
 * Keys & Providers, now backed by a registry-driven dropdown there instead
 * of free text) still takes priority when set, for the tasks that map to a
 * single ProviderConfig row (text-generation, captioning, transcription,
 * embeddings) — this preserves exact prior behavior for anyone who already
 * customized it. Summarization/translation/OCR don't have their own
 * ProviderConfig row (they're sub-tasks the text/vision providers also
 * serve — see the `task` option below), so those three read directly from
 * the registry's own selection storage instead. Adding a new model to the
 * catalog (`LOCAL_MODEL_REGISTRY` in LocalModelRegistry.ts) makes it show
 * up here with zero changes to this file.
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
export async function detectDevice(): Promise<'webgpu' | 'wasm'> {
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
  log?: (msg: string, level?: 'info' | 'warn' | 'error') => void,
  allowDownload: boolean = false,
  onProgress?: (file: string, loaded: number, total: number, done: boolean) => void
): Promise<any> {
  const device = await detectDevice();
  const key = `${task}::${model}::${device}`;
  let p = pipelineCache.get(key);
  if (!p) {
    // THE FIX for "pipeline must never trigger downloads" + the repeating
    // download-loop bug (see LocalModelDownloadManager.ts's doc comment):
    // a generation call (allowDownload defaults to false) that reaches
    // here with nothing already in pipelineCache for this exact model
    // means it has never been downloaded in this browser AND nothing else
    // is currently downloading it — refuse immediately instead of starting
    // a multi-hundred-MB download on the hot path of a timeboxed request.
    // Only warmModel() (called exclusively from LocalModelDownloadManager,
    // itself only triggered by an explicit Download click) passes
    // allowDownload:true and is allowed past this point to start one.
    if (!allowDownload && !isInstalled(model, task as LocalModelTask)) {
      throw new ModelNotInstalledError(model, task as LocalModelTask);
    }

    log?.(`Transformers.js: loading "${model}" for ${task} (${device === 'webgpu' ? 'WebGPU-accelerated' : 'WASM/CPU'})… first run downloads and caches the model, later runs reuse it instantly.`, 'info');

    // PHASE 5 — download manager UX (progress/speed/ETA/cache status).
    // Per-file trackers so a multi-file model (tokenizer.json, config.json,
    // the ONNX weights, ...) reports each file's own speed/ETA rather than
    // one number blurred across all of them. `smoothedBps` is an
    // exponential moving average (alpha 0.3) over consecutive callback
    // ticks, not a raw loaded-delta/time-delta reading — individual fetch
    // chunks arrive in bursts, so an unsmoothed instantaneous rate jumps
    // around too much to be readable at a glance.
    const fileTrackers = new Map<string, { lastLoaded: number; lastTs: number; smoothedBps: number }>();
    const lastEmitAt = new Map<string, number>(); // throttle: at most one DOM update per ~250ms per file
    let anyBytesDownloaded = false;

    p = loadTransformersModule(log).then(({ pipeline }) =>
      pipeline(task, model, {
        device,
        // Falls back to wasm automatically inside the library too if a
        // webgpu op isn't implemented for this model — belt and suspenders.
        progress_callback: (progress: any) => {
          const file = progress?.file || model;
          // Lets LocalModelDownloadManager's pauseDownload/cancelDownload
          // interrupt an in-progress warmModel() download cooperatively —
          // see that module's "Pause" honesty note. No-op (onProgress is
          // undefined) for ordinary generation calls.
          if (progress?.status === 'progress' && typeof progress.loaded === 'number' && typeof progress.total === 'number') {
            onProgress?.(file, progress.loaded, progress.total, progress.loaded >= progress.total);
          }
          if (progress?.status === 'progress' && typeof progress.loaded === 'number' && typeof progress.total === 'number' && progress.total > 0) {
            anyBytesDownloaded = true;
            const now = Date.now();
            const isDone = progress.loaded >= progress.total;
            let tracker = fileTrackers.get(file);
            if (!tracker) {
              tracker = { lastLoaded: 0, lastTs: now, smoothedBps: 0 };
              fileTrackers.set(file, tracker);
            }
            const dt = (now - tracker.lastTs) / 1000;
            if (dt > 0.05) {
              const instantBps = Math.max(0, (progress.loaded - tracker.lastLoaded) / dt);
              tracker.smoothedBps = tracker.smoothedBps === 0 ? instantBps : tracker.smoothedBps * 0.7 + instantBps * 0.3;
              tracker.lastLoaded = progress.loaded;
              tracker.lastTs = now;
            }

            if (!isDone && now - (lastEmitAt.get(file) || 0) < 250) return; // throttle mid-download ticks
            lastEmitAt.set(file, now);

            const pct = Math.round((progress.loaded / progress.total) * 100);
            const speedLabel = tracker.smoothedBps > 0 ? `${formatBytes(tracker.smoothedBps)}/s` : 'starting…';
            const remaining = progress.total - progress.loaded;
            const etaSeconds = tracker.smoothedBps > 0 ? remaining / tracker.smoothedBps : null;
            const etaLabel = etaSeconds !== null && isFinite(etaSeconds) && !isDone ? ` · ETA ${formatDuration(etaSeconds)}` : '';
            log?.(`Transformers.js ⬇ "${file}" — ${pct}% (${formatBytes(progress.loaded)} / ${formatBytes(progress.total)}) · ${speedLabel}${etaLabel}`, 'info');
          } else if (progress?.status === 'done' && fileTrackers.has(file)) {
            // Only announce "done" for a file that actually had bytes
            // tracked above — a 'done' with no preceding 'progress' at all
            // means it was served straight from cache (see the aggregate
            // cache-hit message below instead).
            const tracker = fileTrackers.get(file)!;
            log?.(`Transformers.js ⬇ "${file}" — done (${formatBytes(tracker.lastLoaded)})`, 'info');
          }
        },
      })
    ).then((pipe) => {
      log?.(
        anyBytesDownloaded
          ? `Transformers.js: "${model}" ready.`
          : `Transformers.js: "${model}" loaded from cache — instant, no download needed.`,
        'info'
      );
      markUsed(model, task as LocalModelTask);
      return pipe;
    });
    p.catch(() => pipelineCache.delete(key)); // allow retry on failure
    pipelineCache.set(key, p);
  } else {
    markUsed(model, task as LocalModelTask);
  }
  return p;
}

/**
 * The ONLY function that should ever start a real download — called
 * exclusively by LocalModelDownloadManager's queue worker, itself only
 * reachable from an explicit "Download"/"Resume" click in the Local Models
 * Manager UI. Thin wrapper over getPipeline(..., allowDownload:true) so the
 * exact same single-flight pipelineCache and CDN-loading logic is reused
 * rather than duplicated (item 6's "no duplicate download workers" rule).
 */
export async function warmModel(
  modelId: string,
  task: LocalModelTask,
  _role: 'caption' | 'ocr' | undefined,
  onProgress: (file: string, loaded: number, total: number, done: boolean) => void,
  log?: (msg: string, level?: 'info' | 'warn' | 'error') => void
): Promise<void> {
  await getPipeline(task, modelId, log, true, onProgress);
}
registerWarmModelImpl(warmModel);

/** Formats a byte count as a human-readable size — used by the download-progress reporting above. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`;
}

/** Formats a duration in seconds as a human-readable ETA — used by the download-progress reporting above. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/**
 * Frees a superseded model's pipeline (and, best-effort, its underlying
 * ONNX Runtime session) when the person switches to a different model for
 * a task in Keys & Providers — without this, every model anyone ever
 * selected stays resident in pipelineCache (and holding WebGPU/WASM memory)
 * for the rest of the browser session, even after nothing references it
 * anymore.
 *
 * KNOWN LIMITATION: transformers.js's own pipeline.dispose() does not
 * always fully reclaim native-side (WASM heap / GPU) memory on the main
 * thread — the library's own maintainers note full reclamation can require
 * the worker/context that created it to be torn down entirely (see
 * https://github.com/huggingface/transformers.js/issues/715 and #836).
 * Calling dispose() here is still strictly better than never calling it
 * (it does release what it can, and always removes the JS-side reference
 * so it becomes garbage-collectable), but isn't a hard memory guarantee —
 * a person who repeatedly swaps between several large local models in one
 * long session may still want to reload the page occasionally.
 */
export async function disposeModelPipelines(modelId: string, log?: (msg: string, level?: 'info' | 'warn' | 'error') => void): Promise<void> {
  const staleKeys = Array.from(pipelineCache.keys()).filter((key) => key.split('::')[1] === modelId);
  for (const key of staleKeys) {
    const p = pipelineCache.get(key);
    pipelineCache.delete(key);
    try {
      const instance = await p;
      await instance?.dispose?.();
    } catch {
      // Already failed/never resolved, or dispose() itself threw — either
      // way there's nothing left to clean up for this key.
    }
  }
  if (staleKeys.length) log?.(`Transformers.js: released "${modelId}" from memory.`, 'info');
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
  async testConnection(_provider: ProviderConfig): Promise<{ ok: boolean; message: string; testedAt: number }> {
    const testedAt = Date.now();
    if (typeof WebAssembly === 'undefined') {
      return { ok: false, message: "This browser doesn't support WebAssembly, which Transformers.js requires.", testedAt };
    }
    try {
      await Promise.race([
        loadTransformersModule(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timed out')), 6000)),
      ]);
    } catch (err: any) {
      return { ok: false, message: `Transformers.js library couldn't be loaded: ${err?.message || err}`, testedAt };
    }
    const device = await detectDevice();
    return {
      ok: true,
      message: device === 'webgpu'
        ? 'Ready — WebGPU acceleration available. Models download on first use and are cached afterward.'
        : 'Ready — running on WASM/CPU (no WebGPU adapter available, so this will be slower). Models download on first use and are cached afterward.',
      testedAt,
    };
  }

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    // Item 11 cancellation support — honest scope: this is a real, useful
    // check, not a complete one. It catches the common case where
    // ProviderManager raced this provider against others (Hybrid routing
    // mode, or any multi-candidate fallback) and a faster one already won
    // BEFORE this local generation got a chance to start — exactly the
    // same externalSignal?.aborted check BaseAdapter.fetchWithRetry already
    // does for HTTP-based adapters, applied here so a local CPU/GPU
    // generation doesn't start work that's already been abandoned. It does
    // NOT abort generation that's already in progress: transformers.js's
    // pipeline() call doesn't expose a documented, version-stable way to
    // interrupt token generation mid-stream from the caller side, and
    // guessing at an internal API here risked shipping something that
    // silently does nothing (or breaks) against a real library version.
    if (options?.signal?.aborted) {
      throw new Error(`${provider.name} request was cancelled — a faster provider already responded.`);
    }
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
        case 'music':
          return await this.generateMusic(provider, input, options);
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
    const model = provider.defaultModel || getSelectedModelId('text-generation') || 'HuggingFaceTB/SmolLM2-360M-Instruct';
    const generator = await getPipeline('text-generation', model, options?.log);
    // RUNTIME AUDIT FIX (Phase 3 — "model download finishes, inference never
    // completes"): getPipeline() resolving only means the download+ONNX
    // session creation phase is done — it says nothing about how long actual
    // token generation will take. That was the missing half of the picture:
    // this call's max_new_tokens ceiling (previously a flat 1024 regardless
    // of backend) is fine on WebGPU, but on WASM/CPU — the fallback used by
    // every browser without a WebGPU adapter — autoregressive decoding of a
    // 360M-parameter model has no GPU acceleration or batching, and 512-1024
    // tokens can alone take well over a minute. Manager.ts's withTimeout
    // wraps the ENTIRE call (download + inference together), so on WASM the
    // generation step alone could consume the whole remaining budget after
    // an already-slow download, timing out with a message that looks
    // identical to a genuine hang. Scaling the ceiling to the detected
    // device — not just leaving it fixed — is the actual fix; the log line
    // below also marks the download→inference boundary so a future timeout
    // report shows which phase it happened in instead of one opaque
    // "did not respond within 90s".
    const device = await detectDevice();
    const deviceTokenCeiling = device === 'webgpu' ? 1024 : 220;
    const maxNewTokens = Math.min(options?.maxTokens || 512, deviceTokenCeiling);
    options?.log?.(`Transformers.js: model ready, running inference on ${device === 'webgpu' ? 'WebGPU' : 'WASM/CPU'} (up to ${maxNewTokens} tokens)…`, 'info');
    const messages = [{ role: 'user', content: prompt }];
    const output = await generator(messages, {
      max_new_tokens: maxNewTokens,
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
    const model = options?.summarizationModel || getSelectedModelId('summarization') || 'Xenova/distilbart-cnn-6-6';
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
    const model = options?.translationModel || getSelectedModelId('translation') || 'Xenova/t5-small';
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
    const model = provider.defaultModel || getSelectedModelId('image-to-text', 'caption') || 'Xenova/vit-gpt2-image-captioning';
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
    const model = options?.ocrModel || getSelectedModelId('image-to-text', 'ocr') || 'Xenova/trocr-base-printed';
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
    const model = provider.defaultModel || getSelectedModelId('automatic-speech-recognition') || 'Xenova/whisper-tiny.en';
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
    const model = provider.defaultModel || getSelectedModelId('feature-extraction') || 'Xenova/all-MiniLM-L6-v2';
    const extractor = await getPipeline('feature-extraction', model, options?.log);
    const output = await extractor(String(text), { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
  }

  /**
   * Music generation — MusicGen via transformers.js's 'text-to-audio' task.
   * PHASE 3 FIX (found during Local Model Registry work): builtin-transformers-music
   * was registered as a real provider (adapterId:'transformers', type:'music')
   * since this file's very first version, but this adapter had no 'music'
   * case in call()'s switch — every call to it fell through to the
   * catch-all `default` branch and threw immediately. It could never
   * succeed even once; MusicNodeExecutor's fallback chain just silently
   * moved on to the next provider (or failed outright if none else were
   * configured). This method is the actual missing implementation.
   *
   * transformers.js's text-to-audio pipeline returns raw PCM
   * (`{ audio: Float32Array, sampling_rate: number }`), not an encoded
   * audio file — WAV-encoding it here (see floatArrayToWavBlob) is the
   * simplest reliable way to get something every browser <audio> element
   * can play without pulling in an MP3 encoder dependency.
   */
  private async generateMusic(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const prompt = (input?.prompt ?? input) as string;
    if (!prompt) throw new Error('Transformers.js music generation requires a prompt.');
    const model = provider.defaultModel || getSelectedModelId('text-to-audio') || 'Xenova/musicgen-small';
    const fullPrompt = options?.style ? `${prompt}, style: ${options.style}` : prompt;

    const generator = await getPipeline('text-to-audio', model, options?.log);

    // MusicGen's frame rate is ~50 tokens/second of audio — there's no
    // exposed "seconds" parameter, only max_new_tokens, so duration has to
    // be converted. This runs on WASM/CPU for anyone without WebGPU, where
    // MusicGen is genuinely slow (see builtin-transformers-music's short
    // 30s timeoutMs) — clamped to a range that has a realistic chance of
    // finishing rather than reliably timing out.
    const device = await detectDevice();
    const maxSeconds = device === 'webgpu' ? 30 : 10;
    const requestedSeconds = Math.min(Math.max(Number(options?.duration) || 15, 3), maxSeconds);
    const maxNewTokens = Math.round(requestedSeconds * 50);

    options?.log?.(`Transformers.js: generating ~${requestedSeconds}s of audio with MusicGen (${device === 'webgpu' ? 'WebGPU' : 'WASM/CPU — this is slow without WebGPU'})…`, 'info');
    const output = await generator(fullPrompt, { max_new_tokens: maxNewTokens });
    const audio: Float32Array | undefined = output?.audio;
    const samplingRate: number | undefined = output?.sampling_rate;
    if (!audio || !audio.length || !samplingRate) {
      throw new Error('Transformers.js produced no audio for this prompt.');
    }
    const blob = floatArrayToWavBlob(audio, samplingRate);
    return URL.createObjectURL(blob);
  }
}

/**
 * Encodes raw mono PCM float samples (as returned by transformers.js's
 * text-to-audio pipeline output.audio, range -1..1) into a playable 16-bit
 * PCM WAV Blob. Deliberately independent of the Web Audio API (no
 * AudioContext/AudioBuffer round-trip needed) since the input here is
 * already a plain Float32Array + sample rate, not a decoded audio file.
 */
function floatArrayToWavBlob(samples: Float32Array, sampleRate: number): Blob {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample; // mono
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let pos = 44;
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(pos, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    pos += 2;
  }
  return new Blob([buffer], { type: 'audio/wav' });
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
