import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';
import { Logger } from '../../core/Logger';

/**
 * WebLLM adapter — runs a real LLM entirely inside the browser tab via
 * WebGPU (https://github.com/mlc-ai/web-llm). This is MAGENAIS's #2-priority
 * text/coding provider: it needs no API key and no local server install,
 * only a WebGPU-capable browser (current Chrome/Edge on desktop; support
 * elsewhere is improving but not universal). It is the "Otherwise use
 * browser/local models" step of the required detection order (requirement
 * #4) — reached only when Ollama isn't installed/running.
 *
 * IMPLEMENTATION NOTE: this project intentionally ships with zero npm
 * dependencies (see package.json) and instead loads a handful of libraries
 * as CDN globals from index.html (pdf.js, mammoth, xlsx, tesseract, ...).
 * @mlc-ai/web-llm is ESM-only and fairly large, so rather than adding a
 * <script> tag that loads on every page view (even for people who never use
 * Text/Coding, or who have Ollama installed and never need it), it is
 * lazy-loaded via dynamic `import()` from a CDN the FIRST time this adapter
 * is actually called — subsequent calls reuse the cached module and the
 * already-initialized engine. The model weights themselves are cached by
 * the browser (Cache Storage / IndexedDB, managed internally by WebLLM), so
 * only the very first generation on a fresh browser profile pays the
 * download cost.
 */

// Keep the imported module + engine instance at module scope so they are
// shared across every call and every mode/tab that ends up routed to this
// adapter (Text, Coding, Agents, Research synthesis, ...) — re-initializing
// a multi-hundred-MB model on every single request would be unusable.
let webllmModulePromise: Promise<any> | null = null;
let enginePromise: Promise<any> | null = null;
let loadedModelId: string | null = null;

// A small, broadly-compatible instruction model by default — fast enough to
// load and run on modest consumer GPUs. Users who want something larger can
// override this via the provider's "Preferred model" field with any model
// id from WebLLM's prebuilt model list.
const DEFAULT_WEBLLM_MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC';
const DEFAULT_WEBLLM_CODE_MODEL = 'Llama-3.2-3B-Instruct-q4f16_1-MLC'; // no small dedicated code model ships prebuilt; same base model handles both

function loadWebLLMModule(): Promise<any> {
  if (!webllmModulePromise) {
    // esm.run (jsdelivr's ESM-optimized endpoint) serves an import-ready
    // ES module build — this is the standard zero-build-step way to pull
    // an npm package into a plain browser <script type="module"> context.
    //
    // Bounded with its own short race timeout: this is purely a network
    // fetch of the (small) module wrapper, not the (large) model weights,
    // so it should resolve in well under a second on a working connection.
    // If it doesn't resolve at all within a few seconds, the CDN/network is
    // unreachable — fail fast here rather than silently eating most of
    // this provider's whole timeoutMs budget on a request that was never
    // going to succeed, leaving no time for the model itself to load.
    const importPromise =
      // @ts-expect-error TS2307 — this is a real ES module resolved at
      // runtime directly from a CDN URL (like PluginLoader.ts's blob-URL
      // plugin imports), not an npm package in this project's dependency
      // graph, so TypeScript has no declaration file to check it against.
      import(/* @vite-ignore */ 'https://esm.run/@mlc-ai/web-llm');
    webllmModulePromise = Promise.race([
      importPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out reaching the WebLLM CDN module (no network access to esm.run?).')), 8000)),
    ]).catch((err) => {
      webllmModulePromise = null; // allow retry later (e.g. once network is back) instead of caching a permanent failure
      throw err;
    });
  }
  return webllmModulePromise;
}

export class WebLLMAdapter extends BaseAdapter {
  label = 'WebLLM (Browser, WebGPU)';
  browserSafe = true;
  supportsModelDiscovery = false;

  /**
   * Health check is deliberately cheap: it only checks for WebGPU support,
   * not a full model load (which can take from several seconds to a couple
   * of minutes on first run and would make routine health-check polling
   * unacceptably expensive/disruptive). The real "does this actually work"
   * signal happens lazily on first real `call()`.
   */
  async testConnection(_provider: ProviderConfig): Promise<{ ok: boolean; message: string; testedAt: number }> {
    const testedAt = Date.now();
    if (typeof navigator === 'undefined' || !(navigator as any).gpu) {
      return { ok: false, message: "This browser doesn't expose WebGPU — WebLLM needs a WebGPU-capable browser (e.g. current Chrome/Edge).", testedAt };
    }
    return { ok: true, message: 'WebGPU is available — a model will download and initialize on first use.', testedAt };
  }

  async call(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    if (typeof navigator === 'undefined' || !(navigator as any).gpu) {
      throw new Error("WebGPU isn't available in this browser — WebLLM can't run here.");
    }
    const prompt = input?.prompt ?? input;
    const isCoding = (options?.mode || provider.type) === 'coding';
    const modelId = options?.model || provider.defaultModel || (isCoding ? DEFAULT_WEBLLM_CODE_MODEL : DEFAULT_WEBLLM_MODEL);

    const engine = await this.getEngine(modelId, options?.log);
    const reply = await engine.chat.completions.create({
      messages: [{ role: 'user', content: String(prompt) }],
      temperature: options?.temperature ?? 0.8,
    });
    const content = reply?.choices?.[0]?.message?.content;
    if (!content) throw new Error('WebLLM returned an empty response.');
    return content;
  }

  /**
   * Lazily creates (or reuses) the singleton WebLLM engine for the
   * requested model id. Switching to a different model id than what's
   * currently loaded re-initializes the engine — this only happens if the
   * user explicitly changes the "Preferred model" field.
   */
  private async getEngine(modelId: string, log?: (msg: string, level?: 'info' | 'warn' | 'error') => void): Promise<any> {
    if (enginePromise && loadedModelId === modelId) {
      log?.(`WebLLM: reusing the already-loaded "${modelId}" engine from this browser session — should be fast.`, 'info');
      return enginePromise;
    }

    const webllm = await loadWebLLMModule();
    loadedModelId = modelId;
    // ROOT CAUSE of "WebLLM sometimes succeeds, sometimes fails" (no code
    // change fixes this outright — it's inherent to a real first-time
    // multi-hundred-MB download racing a timeout — but it's worth
    // explaining): ProviderManager.withTimeout races this whole call
    // against provider.timeoutMs and, if it loses, simply stops waiting —
    // it does NOT and cannot cancel the underlying CreateMLCEngine()
    // download below, which keeps running in the background regardless
    // and gets cached here in `enginePromise` the moment it finishes. So a
    // request that times out isn't really "failed", it's "still loading" —
    // and whichever request happens to come in AFTER that background
    // download finally finishes will find `enginePromise` already
    // resolved above and return near-instantly, which is exactly the
    // "sometimes fails, sometimes succeeds fast" pattern being reported.
    log?.(`WebLLM: first-time download/initialization of "${modelId}" in your browser — this can take up to the full timeout window on a normal connection. If this particular request times out, the download keeps running in the background regardless and your NEXT request should reuse it and be fast.`, 'info');
    enginePromise = webllm.CreateMLCEngine(modelId, {
      initProgressCallback: (progress: { text?: string }) => {
        Logger.debug(`WebLLM init: ${progress?.text || ''}`);
      },
    }).catch((err: any) => {
      // Reset so a later call retries from scratch instead of permanently
      // caching a rejected promise.
      enginePromise = null;
      loadedModelId = null;
      throw err;
    });
    return enginePromise;
  }
}
