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
  async testConnection(provider: ProviderConfig): Promise<{ ok: boolean; message: string; testedAt: number; latencyMs?: number }> {
    const testedAt = Date.now();
    const startedAt = Date.now();
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 1500);
      const res = await fetch(this.url(provider, '/api/tags'), { signal: controller.signal });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startedAt;
      if (!res.ok) return { ok: false, message: `Ollama responded with HTTP ${res.status}.`, testedAt, latencyMs };
      const json = await res.json().catch(() => null);
      const count = Array.isArray(json?.models) ? json.models.length : 0;
      return {
        ok: true,
        message: count > 0
          ? `Ollama is running locally with ${count} model(s) installed.`
          : 'Ollama is running locally, but no models are installed yet — run e.g. "ollama pull llama3.2".',
        testedAt,
        latencyMs,
      };
    } catch {
      // No local Ollama install/daemon — this is the expected, common case
      // for most users, not an error. The health monitor marks it
      // unhealthy/unknown and the fallback chain moves on silently.
      return { ok: false, message: 'Ollama is not running locally (this is normal if it is not installed).', testedAt };
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
    const isCoding = (options?.mode || provider.type) === 'coding';
    const model = options?.model || provider.defaultModel || (isCoding ? 'qwen2.5-coder' : 'llama3.2');

    const body = {
      model,
      messages: [{ role: 'user', content: String(prompt) }],
      stream: false,
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
        body: JSON.stringify({ model, prompt: String(text) }),
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
