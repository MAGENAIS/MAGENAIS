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
   * Fast, bounded liveness probe — the actual implementation testConnection
   * uses, factored out so call() below can reuse the identical check as a
   * preflight instead of a second, slightly-different copy of the same
   * fetch-with-short-timeout logic.
   */
  private async probe(provider: ProviderConfig): Promise<{ ok: boolean; latencyMs: number; modelCount: number; httpStatus?: number }> {
    const startedAt = Date.now();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    try {
      const res = await fetch(this.url(provider, '/api/tags'), { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) return { ok: false, latencyMs: Date.now() - startedAt, modelCount: 0, httpStatus: res.status };
      const json = await res.json().catch(() => null);
      const modelCount = Array.isArray(json?.models) ? json.models.length : 0;
      return { ok: true, latencyMs: Date.now() - startedAt, modelCount };
    } catch {
      clearTimeout(timeoutId);
      return { ok: false, latencyMs: Date.now() - startedAt, modelCount: 0 };
    }
  }

  /**
   * Lightweight liveness probe. Deliberately uses a short, dedicated
   * timeout (not provider.timeoutMs, which defaults to 30s+ and would make
   * every health-check cycle feel sluggish) — a local server either answers
   * near-instantly or isn't there at all.
   */
  async testConnection(provider: ProviderConfig): Promise<{ ok: boolean; message: string; testedAt: number; latencyMs?: number }> {
    const testedAt = Date.now();
    const result = await this.probe(provider);
    if (!result.ok) {
      const message = result.httpStatus
        ? `Ollama responded with HTTP ${result.httpStatus}.`
        // No local Ollama install/daemon — this is the expected, common
        // case for most users, not an error. The health monitor marks it
        // unhealthy/unknown and the fallback chain moves on silently.
        : 'Ollama is not running locally (this is normal if it is not installed).';
      return { ok: false, message, testedAt, latencyMs: result.latencyMs };
    }
    return {
      ok: true,
      message: result.modelCount > 0
        ? `Ollama is running locally with ${result.modelCount} model(s) installed.`
        : 'Ollama is running locally, but no models are installed yet — run e.g. "ollama pull llama3.2".',
      testedAt,
      latencyMs: result.latencyMs,
    };
  }

  async fetchModels(provider: ProviderConfig): Promise<string[]> {
    const res = await fetch(this.url(provider, '/api/tags'));
    if (!res.ok) throw new Error(`HTTP ${res.status} fetching Ollama models`);
    const json = await res.json();
    return (json.models || []).map((m: any) => m.name).filter(Boolean);
  }

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    // ROOT CAUSE FIX (item 10 — "timeout after 60 seconds" with no faster
    // failure path): the real /api/chat or /api/embeddings request below
    // already fails fast when Ollama actively refuses the connection
    // (ECONNREFUSED surfaces as a TypeError almost immediately) — but a
    // firewall or VPN that silently DROPS the connection instead of
    // refusing it produces no such fast signal; the browser has to wait
    // out its own TCP-level connection timeout, which can run well past
    // provider.timeoutMs's own AbortController (that only bounds how long
    // THIS code waits, not how long the underlying OS-level TCP handshake
    // takes to give up). Running the same 1.5s-bounded probe testConnection
    // uses, first, means that specific failure mode is caught in ~1.5s with
    // a clear message instead of consuming the full configured timeout.
    const preflight = await this.probe(provider);
    if (!preflight.ok) {
      throw new Error(
        preflight.httpStatus
          ? `Ollama responded with HTTP ${preflight.httpStatus} — is the daemon healthy? (Restart it, or check its logs.)`
          : `Ollama isn't reachable at ${this.url(provider, '')} — make sure it's installed and running (see ollama.com), or disable this provider in Keys & Providers if you don't use it.`
      );
    }
    const mode = options?.mode || provider.type || 'text';
    if (mode === 'embeddings') return this.embeddings(provider, input, options);
    // text, coding, agents, research, and vision(caption-only, no true
    // multimodal support unless the user has pulled a vision-capable model
    // such as "llava" and set it as this provider's Preferred model) all
    // speak the same /api/chat endpoint.
    return this.chat(provider, input, options);
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
    // ("Qwen2.5-Coder or DeepSeek-Coder") — the user still needs to have
    // pulled it (`ollama pull qwen2.5-coder`); if they haven't, Ollama
    // returns a clear "model not found" error that the fallback chain
    // treats like any other provider failure and moves past.
    const mode = options?.mode || provider.type;
    const isCoding = mode === 'coding';
    const model = options?.model || provider.defaultModel || (isCoding ? 'qwen2.5-coder' : 'llama3.2');

    // ROOT CAUSE FIX (user-reported: Vision's local Ollama candidate
    // "succeeded" but the answer was a generic "I don't see an image" —
    // see registry/Manager.ts's callVision, which always passes
    // `input.imageBase64` for a vision call). This method previously
    // ignored it completely and sent only the text prompt, so ANY chat
    // model (vision-capable or not) would correctly report seeing nothing
    // — and because that's a perfectly valid, error-free response, it won
    // the race and buried every other candidate's real attempt. Ollama's
    // /api/chat takes images as a per-message `images: [base64, ...]`
    // array — raw base64, NOT a `data:image/...;base64,` URI — so the
    // prefix (present because VisionMode's canvas.toDataURL/FileReader
    // both produce full data URIs) has to be stripped before sending. If
    // the configured model genuinely has no vision support (e.g. plain
    // "llama3.2" instead of "llava"), Ollama itself now returns the real
    // per-model error for that instead of a silently-wrong success — see
    // the isVisionMode block immediately below for why that distinction
    // matters for the message body.
    const isVisionMode = mode === 'vision';
    const imageBase64: string | undefined = input?.imageBase64 ?? options?.imageBase64;
    const rawImage = imageBase64?.includes(',') ? imageBase64.slice(imageBase64.indexOf(',') + 1) : imageBase64;

    const body = {
      model,
      messages: [{
        role: 'user',
        content: String(prompt),
        ...(isVisionMode && rawImage ? { images: [rawImage] } : {}),
      }],
      stream: false,
      // Ollama unloads a model from memory 5 minutes after its last use by
      // default — keeping it loaded for longer within an active MAGENAIS
      // session means only the very first prompt (or the first one after a
      // long gap) pays the full cold-load cost; every request within this
      // window reuses the already-resident model.
      keep_alive: options?.keepAlive || '10m',
      options: {
        temperature: options?.temperature ?? 0.8,
      },
    };

    let response = await this.fetchWithRetry(
      this.url(provider, '/api/chat'),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      provider,
      undefined,
      options?.signal
    );
    if (!response.ok && response.status === 404) {
      const text = await response.text();
      if (/not found/i.test(text)) {
        // ROOT CAUSE (user-reported: "Ollama says the model isn't pulled,
        // but `ollama run llama3.2` works fine locally"): Ollama resolves
        // an untagged name like "llama3.2" to "llama3.2:latest" — if the
        // user instead pulled a specific tag (e.g. "llama3.2:3b" from a
        // menu, or a tag Ollama itself defaulted to for their platform),
        // the bare name genuinely has no exact match even though the
        // model is 100% present and working. Rather than assume "not
        // pulled" from a single failed exact-name lookup, check Ollama's
        // own /api/tags for a real match — anything actually installed
        // whose name starts with what was requested — and transparently
        // retry with the exact installed tag instead of a wrong guess.
        try {
          const tagsRes = await fetch(this.url(provider, '/api/tags'));
          const tagsJson = await tagsRes.json().catch(() => null);
          const installed: string[] = Array.isArray(tagsJson?.models)
            ? tagsJson.models.map((m: any) => m.name).filter(Boolean)
            : [];
          const match = installed.find(name => name === model || name.startsWith(`${model}:`));
          if (match && match !== model) {
            options?.log?.(`Ollama: "${model}" isn't an exact match, but "${match}" is installed — retrying with that tag.`, 'info');
            response = await this.fetchWithRetry(
              this.url(provider, '/api/chat'),
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...body, model: match }),
              },
              provider,
              undefined,
              options?.signal
            );
          } else if (installed.length > 0) {
            throw new Error(`Ollama is running, but "${model}" isn't among the models it actually has installed (${installed.slice(0, 6).join(', ')}${installed.length > 6 ? ', …' : ''}) — set one of those as this provider's Preferred model, or run "ollama pull ${model}".`);
          } else {
            throw new Error(`Ollama is running, but "${model}" isn't pulled yet — run "ollama pull ${model}" (or set a different Preferred model you already have) in Keys & Providers.`);
          }
        } catch (lookupErr: any) {
          if (lookupErr instanceof Error && lookupErr.message.startsWith('Ollama is running')) throw lookupErr;
          // /api/tags itself failed — fall back to the original message.
          throw new Error(`Ollama is running, but the "${model}" model isn't pulled yet — run "ollama pull ${model}" (or set a different Preferred model you already have) in Keys & Providers.`);
        }
      }
    }
    if (!response.ok) {
      const text = await response.text();
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
        body: JSON.stringify({ model, prompt: String(text), keep_alive: options?.keepAlive || '10m' }),
      },
      provider,
      undefined,
      options?.signal
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
