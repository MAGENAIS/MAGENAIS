import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

/**
 * Ollama adapter — talks to a locally-installed Ollama server
 * (https://ollama.com, default http://localhost:11434). This is MAGENAIS's
 * #1-priority provider for text/coding/agents/research/embeddings: it is
 * completely free, needs no API key, no signup, and never phones home —
 * every request stays on the user's own machine.
 *
 * AUTOMATIC DETECTION: `testConnection` (used by HealthMonitor, see
 * src/providers/Health.ts) issues a fast GET /api/tags. If Ollama isn't
 * installed or isn't running, this fails quickly and the provider is simply
 * skipped by ProviderManager.callWithFallback's fallback loop — the rest of
 * the app keeps working via the next provider in the chain (WebLLM in the
 * browser, then any free/keyed provider the user has enabled). Nothing else
 * needs to know or care whether Ollama is present; this is what satisfies
 * requirement #4 ("Local provider available -> use it, otherwise fall
 * through") with zero manual configuration.
 */
export class OllamaAdapter extends BaseAdapter {
  label = 'Ollama (Local)';
  browserSafe = true;
  supportsModelDiscovery = true;

  /**
   * Lightweight liveness probe. Deliberately uses a short, dedicated
   * timeout (not provider.timeoutMs, which defaults to 30s+ and would make
   * every health-check cycle feel sluggish) — a local server either answers
   * near-instantly or isn't there at all.
   */
  async testConnection(provider: ProviderConfig): Promise<{ ok: boolean; message: string }> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(this.url(provider, '/api/tags'), { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return { ok: false, message: `Ollama responded with HTTP ${res.status}.` };
      const json = await res.json().catch(() => null);
      const count = Array.isArray(json?.models) ? json.models.length : 0;
      return {
        ok: true,
        message: count > 0
          ? `Ollama is running locally with ${count} model(s) installed.`
          : 'Ollama is running locally, but no models are installed yet — run e.g. "ollama pull llama3.2".',
      };
    } catch {
      // No local Ollama install/daemon — this is the expected, common case
      // for most users, not an error. The health monitor marks it
      // unhealthy/unknown and the fallback chain moves on silently.
      return { ok: false, message: 'Ollama is not running locally (this is normal if it is not installed).' };
    }
  }

  async fetchModels(provider: ProviderConfig): Promise<string[]> {
    const res = await fetch(this.url(provider, '/api/tags'));
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching Ollama models`);
    const json = await res.json();
    return (json.models || []).map((m: any) => m.name).filter(Boolean);
  }

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    const mode = options?.mode || provider.type || 'text';
    if (mode === 'embeddings') return this.embeddings(provider, input, options);
    // text, coding, agents, research, and vision(caption-only, no true
    // multimodal support unless the user has pulled a vision-capable model
    // such as "llava" and set it as this provider's Preferred model) all
    // speak the same /api/chat endpoint.
    return this.chat(provider, input, options);
  }

  /**
   * Returns `requestedModel` unchanged if it's already pulled, otherwise
   * substitutes whatever model IS locally available (preferring one with
   * "coder"/"code" in its name for coding requests), so a fresh Ollama
   * install with e.g. only "mistral" pulled still works out of the box
   * instead of demanding "llama3.2" specifically. Returns `requestedModel`
   * unchanged (letting the normal /api/chat 404 handling in `chat()`
   * explain things) if the tags list can't be read or is genuinely empty.
   */
  private async resolveInstalledModel(provider: ProviderConfig, requestedModel: string, isCoding: boolean): Promise<string> {
    let installed: string[];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(this.url(provider, '/api/tags'), { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return requestedModel;
      const json = await res.json().catch(() => null);
      installed = Array.isArray(json?.models) ? json.models.map((m: any) => m.name).filter(Boolean) : [];
    } catch {
      // Can't reach /api/tags for some reason — fall through to the
      // original behaviour (attempt the requested model, let /api/chat's
      // own error handling take it from here).
      return requestedModel;
    }

    if (installed.length === 0) return requestedModel; // nothing pulled at all — let the normal "not pulled" error fire

    // Exact match (accounting for Ollama's implicit ":latest" tag suffix).
    const normalize = (n: string) => n.split(':')[0];
    if (installed.some(n => n === requestedModel || normalize(n) === normalize(requestedModel))) {
      return requestedModel;
    }

    // Requested model isn't pulled, but something else is — use that
    // instead of failing. Prefer a code-oriented model for coding requests.
    const substitute = isCoding
      ? installed.find(n => /coder|code/i.test(n)) || installed[0]
      : installed[0];
    return substitute;
  }

  private url(provider: ProviderConfig, path: string): string {
    const base = (provider.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
    return base + path;
  }

  private async chat(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const prompt = input?.prompt ?? input;
    // Sensible default: a small, fast, widely-available instruction model.
    // Coding requests get a code-specialized model when the user hasn't
    // overridden it, matching the requested default priority
    // ("Qwen2.5-Coder or DeepSeek-Coder").
    const isCoding = (options?.mode || provider.type) === 'coding';
    const requestedModel = options?.model || provider.defaultModel || (isCoding ? 'qwen2.5-coder' : 'llama3.2');

    // ROOT CAUSE FIX (user-reported: "Ollama is running but the 'llama3.2'
    // model is not pulled yet, how can we fix this that user does not need
    // to download or install llama model for default setting"): requiring
    // one specific model name to be pulled defeats the point of Ollama
    // being a true zero-setup default — plenty of users already have
    // Ollama running with a *different* model pulled (mistral, phi3,
    // qwen2.5, gemma2, whatever they set up previously). Since Ollama
    // exposes the exact list of locally-installed models at GET
    // /api/tags (already used by testConnection above), check that list
    // first: if the requested model isn't there but something else is,
    // silently use whichever model IS already installed instead of
    // failing — no download required. Only surface the "not pulled" error
    // when Ollama genuinely has zero models installed, since at that point
    // there is nothing this adapter can do locally and the fallback chain
    // needs to move on to WebLLM/cloud providers.
    const model = await this.resolveInstalledModel(provider, requestedModel, isCoding);

    const body = {
      model,
      messages: [{ role: 'user', content: String(prompt) }],
      stream: false,
      options: {
        temperature: options?.temperature ?? 0.8,
      },
    };

    const response = await this.fetchWithRetry(
      this.url(provider, '/api/chat'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      provider
    );
    if (!response.ok) {
      const text = await response.text();
      // ROOT CAUSE (user-reported: confusing raw JSON like {"error":"model
      // 'llama3.2' not found"} in the fallback-chain report): Ollama being
      // installed and running is not the same as having the specific model
      // this request wants — that's a one-command fix ("ollama pull
      // <model>"), not a real provider failure, so surface it as such
      // instead of a bare HTTP status + JSON blob.
      if (response.status === 404 && /not found/i.test(text)) {
        throw new Error(`Ollama is running, but the "${model}" model isn't pulled yet — run "ollama pull ${model}" (or set a different Preferred model you already have) in Keys & Providers.`);
      }
      throw new Error(`Ollama HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const json = await response.json();
    const content = json?.message?.content;
    if (!content) throw new Error('Ollama returned an empty response — is the model fully downloaded?');
    return content;
  }

  private async embeddings(provider: ProviderConfig, input: any, options?: any): Promise<number[]> {
    const text = input?.prompt ?? input;
    const model = options?.model || provider.defaultModel || 'nomic-embed-text';
    const response = await this.fetchWithRetry(
      this.url(provider, '/api/embeddings'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: String(text) }),
      },
      provider
    );
    if (!response.ok) {
      const text2 = await response.text();
      throw new Error(`Ollama HTTP ${response.status}: ${text2.slice(0, 200)}`);
    }
    const json = await response.json();
    if (!Array.isArray(json?.embedding)) throw new Error('Ollama returned no embedding vector.');
    return json.embedding;
  }
}
