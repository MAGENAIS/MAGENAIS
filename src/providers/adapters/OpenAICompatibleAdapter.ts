import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig, ProviderTestResult } from '../types';
import { classifyFailure } from '../HealthCooldown';

/**
 * Generic REST adapter for any provider that speaks a plain OpenAI-shaped API
 * (chat/completions for text, and simple JSON-in/blob-or-json-out for the other
 * modalities). This is the fallback used by the majority of registry entries —
 * Groq, OpenRouter, Cerebras, SambaNova, GitHub Models, Cloudflare Workers AI,
 * Together AI, DeepInfra, xAI, Mistral, Stability AI, Novita, Deepgram, AssemblyAI,
 * PlayHT, fal.ai and Replicate (the latter two only work through this adapter when
 * called from a server-side proxy — direct browser calls are CORS-blocked, same as
 * in the legacy monolith) — none of which need a bespoke adapter class of their own,
 * mirroring how the legacy monolith funneled them all through a handful of generic
 * callers keyed on request 'mode' rather than one function per provider.
 */
export class OpenAICompatibleAdapter extends BaseAdapter {
  label = 'OpenAI-compatible';
  browserSafe = true;
  supportsModelDiscovery = true;

  /**
   * PHASE 7 — Provider Testing. BaseAdapter's default testConnection only
   * checks that a baseUrl/key are *present* — it never actually calls the
   * provider, so a typo'd key or a renamed model silently reports "looks
   * valid" right up until the first real generation fails. This makes one
   * minimal, cheap chat/completions request (max_tokens:1, a one-word
   * prompt) through the exact same request()/fetchWithRetry() path every
   * real call uses — including the CORS proxy routing from Phase 4 — so a
   * pass here means URL, auth, endpoint, and the configured model all
   * genuinely work together, not just that fields are non-empty.
   */
  async testConnection(provider: ProviderConfig): Promise<ProviderTestResult> {
    const testedAt = Date.now();
    if (!provider.baseUrl && provider.authType !== 'none') {
      return { ok: false, message: 'Base URL is required.', testedAt, category: 'other' };
    }
    if (!provider.apiKey && !provider.noKeyNeeded) {
      return { ok: false, message: 'API key is required.', testedAt, category: 'auth' };
    }

    // ROOT CAUSE FIX: this used to always test a `/chat/completions` POST
    // regardless of the provider's actual type. That's correct for
    // text/coding/agents/research/vision (callText really does hit that
    // endpoint), but callImage/callVideo/callSpeech/callAudioTranscription/
    // callMusic below don't use that shape at all — most POST straight to
    // the bare base URL with no suffix. Testing image/video/speech/audio/
    // music providers against `/chat/completions` checks a URL real usage
    // never calls, which is exactly how Cloudflare FLUX's baseUrl
    // (".../ai/run") plus this hardcoded suffix produced the nonsensical
    // ".../ai/run/chat/completions" 404 — a pure testing-methodology bug,
    // not necessarily a sign the real image endpoint was ever broken. It
    // also meant every non-text OpenAI-compatible provider's health (this
    // feeds HealthMonitor's periodic checks, not just the manual Test
    // button) was being judged against the wrong endpoint the whole time.
    if (provider.type !== 'text' && provider.type !== 'coding' && provider.type !== 'agents' && provider.type !== 'research') {
      return this.testNonChatConnection(provider, testedAt);
    }

    const model = provider.defaultModel || 'default';
    const startedAt = Date.now();
    try {
      const response = await this.request(provider, this.url(provider, '/chat/completions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1,
        }),
      });
      const latencyMs = Date.now() - startedAt;
      const json = await response.json();
      if (!json.choices?.[0]) {
        return { ok: false, message: `Provider responded (HTTP ${response.status}) but not in the expected chat/completions shape — is this really an OpenAI-compatible endpoint?`, latencyMs, checkedModel: model, testedAt, category: 'other' };
      }
      return { ok: true, message: `Chat completion succeeded (HTTP ${response.status}).`, latencyMs, checkedModel: model, testedAt };
    } catch (err: any) {
      const latencyMs = Date.now() - startedAt;
      const message = err?.message || String(err);
      return { ok: false, message, latencyMs, checkedModel: model, testedAt, category: classifyFailure(message) };
    }
  }

  /**
   * Lightweight, cost-free reachability check for image/video/speech/
   * audio/music providers — deliberately does NOT attempt a real
   * generation (that would spend real money/credits on every health
   * check) and does NOT guess at a provider-specific request shape (most
   * of these differ enough — Cloudflare's path-based model selection vs.
   * OpenAI-shaped JSON bodies vs. fal.ai's queue-based API — that a single
   * guessed shape would be wrong for some of them, the same mistake this
   * function replaces). A GET to the base URL can't "succeed" in the
   * generation sense, but the distinction that actually matters for a
   * connectivity test is real: a 404/405 (this URL doesn't accept GET,
   * expected for a POST-only endpoint) still proves the host is reachable
   * and auth headers were accepted, which is a meaningfully different,
   * useful signal from a DNS failure, a connection refusal, or a 401/403.
   */
  private async testNonChatConnection(provider: ProviderConfig, testedAt: number): Promise<ProviderTestResult> {
    const startedAt = Date.now();
    try {
      const headers: Record<string, string> = {};
      const { url, headers: finalHeaders } = this.buildAuth(provider, provider.baseUrl, headers);
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(url, { method: 'GET', headers: finalHeaders, signal: controller.signal });
      clearTimeout(timeoutId);
      const latencyMs = Date.now() - startedAt;
      if (response.status === 401 || response.status === 403) {
        return { ok: false, message: `HTTP ${response.status} — the server is reachable, but rejected the API key/auth.`, latencyMs, testedAt, category: 'auth' };
      }
      // Any other response (2xx, or a 404/405 from a POST-only endpoint
      // not accepting GET) means the host answered and auth wasn't
      // rejected — as much as a cost-free check can confirm without
      // actually generating something.
      return { ok: true, message: `Reachable (HTTP ${response.status}). This checks connectivity only — it doesn't run a real generation, so a working test here doesn't guarantee the exact endpoint/model configuration is correct.`, latencyMs, testedAt };
    } catch (err: any) {
      const latencyMs = Date.now() - startedAt;
      const message = err?.message || String(err);
      return { ok: false, message, latencyMs, testedAt, category: classifyFailure(message) };
    }
  }

  async call(provider: ProviderConfig, input: any, options?: any): Promise<any> {
    const mode = options?.mode || provider.type || 'text';
    switch (mode) {
      case 'text':
      case 'coding':
      case 'agents':
      case 'research':
      case 'vision':
        return this.callText(provider, input, options);
      case 'image':
        return this.callImage(provider, input, options);
      case 'video':
        return this.callVideo(provider, input, options);
      case 'speech':
        return this.callSpeech(provider, input, options);
      case 'audio':
        return this.callAudioTranscription(provider, input, options);
      case 'music':
        return this.callMusic(provider, input, options);
      default:
        return this.callText(provider, input, options);
    }
  }

  private url(provider: ProviderConfig, path: string): string {
    return provider.baseUrl.replace(/\/$/, '') + path;
  }

  private async request(provider: ProviderConfig, url: string, init: RequestInit, signal?: AbortSignal, onRetry?: (attempt: number) => void): Promise<Response> {
    const headers: Record<string, string> = { ...(init.headers as Record<string, string> | undefined) };
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);
    const response = await this.fetchWithRetry(finalUrl, { ...init, headers: finalHeaders }, provider, undefined, signal, onRetry);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return response;
  }

  async callText(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const endpoint = options?.endpoint || '/chat/completions';
    // Vision support: when callVision passes imageBase64, build the
    // standard multimodal `content: [{type:'text'},{type:'image_url'}]`
    // message shape most OpenAI-compatible chat/completions backends
    // accept (OpenRouter, GitHub Models' gpt-4o, Groq's llama-vision
    // models, etc.) — this is what lets Vision mode work through any
    // configured OpenAI-compatible provider with a vision-capable model,
    // not just the Anthropic/Gemini-specific adapters.
    // Same "input.imageBase64 is actually a full data URL" fact every
    // other vision-capable adapter already accounts for (see
    // AnthropicAdapter/GeminiAdapter's `.replace(/^data:image\/[a-z]+;base64,/, '')`
    // and PuterAdapter's `.startsWith('data:') ? ... : ...` — this adapter
    // was the one exception, blindly wrapping an already-complete data URL
    // in a second prefix and corrupting it. Matches PuterAdapter's pattern:
    // pass a data: URL through as-is, only add the prefix for the (today,
    // theoretical) case of a caller that ever passes raw base64 directly.
    const imageBase64: string | undefined = input?.imageBase64 ?? options?.imageBase64;
    const imageDataUrl = imageBase64 ? (imageBase64.startsWith('data:') ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`) : undefined;
    const messages =
      options?.messages ||
      (imageDataUrl
        ? [{
            role: 'user',
            content: [
              { type: 'text', text: input?.prompt ?? '' },
              { type: 'image_url', image_url: { url: imageDataUrl } },
            ],
          }]
        : [{ role: 'user', content: input?.prompt ?? input }]);
    const response = await this.request(provider, this.url(provider, endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || provider.defaultModel || 'default',
        messages,
        temperature: options?.temperature ?? 0.8,
        max_tokens: options?.maxTokens ?? 1024,
      }),
    }, options?.signal, options?.onRetry);
    const json = await response.json();
    const text = json.choices?.[0]?.message?.content;
    if (!text) throw new Error(`empty response from ${provider.name}`);
    // PHASE 6 — Tokens: every OpenAI-compatible chat/completions response
    // includes a `usage` object; this was parsed for `choices` and the
    // rest silently discarded. Reported through the same kind of optional
    // side-channel callback `options.log` already used for narrative
    // logging, rather than changing this method's return type (still just
    // the plain string every caller of callText already expects) — see
    // ProviderCallEvent/Logger.event in ProviderManager.raceForFirstSuccess,
    // which is what actually consumes this.
    if (json.usage) {
      options?.onUsage?.({
        prompt: json.usage.prompt_tokens,
        completion: json.usage.completion_tokens,
        total: json.usage.total_tokens,
      });
    }
    return text;
  }

  /**
   * ROOT CAUSE FIX (verified against each provider's own docs, July 2026):
   * this used to POST { model, prompt, width, height } straight to the
   * provider's bare baseUrl with no path suffix, for EVERY provider routed
   * through this adapter — a shape/endpoint that doesn't match any real
   * image API. This never showed up as a "broken" provider in Keys &
   * Providers because testNonChatConnection() only does a cheap GET
   * reachability check, not a real generation — the app just silently
   * fell through to the next provider in the fallback chain every time.
   *
   * Rather than special-casing each provider by id/name in code (which
   * breaks the moment someone adds a new preset or their own custom
   * OpenAI-compatible image provider), the request shape is entirely
   * data-driven from four optional ProviderConfig fields — see their doc
   * comments in types.ts — with defaults that match the plain OpenAI
   * /images/generations contract most of these APIs already speak. A
   * provider only needs to set imageEndpoint/imageRequestFormat/etc. when
   * its API genuinely deviates from that default (Cloudflare's
   * model-in-path routing, Stability's multipart+binary v2beta endpoints —
   * both expressed purely as config in defaultProviders.ts, not as an
   * if-branch here).
   */
  async callImage(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const prompt = input?.prompt ?? input;
    if (!prompt) throw new Error('Image generation requires a prompt.');

    const model = options?.model || provider.defaultModel || 'default';
    const endpointPath = (provider.imageEndpoint ?? '/images/generations').replace('{model}', encodeURIComponent(model));
    const endpoint = this.url(provider, endpointPath);

    if (provider.imageRequestFormat === 'multipart') {
      return this.callImageMultipart(provider, endpoint, model, prompt, options);
    }

    const size = options?.width ? `${options.width}x${options.height || options.width}` : undefined;
    const body: Record<string, any> = { prompt, width: options?.width, height: options?.height };
    if (size) body.size = size;
    if (provider.imageIncludeModelInBody !== false) body.model = model;
    if (options?.seed !== undefined) body.seed = options.seed;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (provider.imageResponseFormat === 'binary') headers['Accept'] = 'image/*';

    const response = await this.request(provider, endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }, options?.signal);
    return this.parseImageResponse(response, provider);
  }

  /** multipart/form-data variant of the request above — same field set, just form-encoded instead of JSON. Used when provider.imageRequestFormat === 'multipart' (e.g. Stability AI's v2beta endpoints). */
  private async callImageMultipart(provider: ProviderConfig, endpoint: string, model: string, prompt: string, options?: any): Promise<string> {
    const form = new FormData();
    form.append('prompt', prompt);
    form.append('output_format', 'png');
    if (provider.imageIncludeModelInBody !== false) form.append('model', model);
    if (options?.width) form.append('width', String(options.width));
    if (options?.height) form.append('height', String(options.height));
    if (options?.seed !== undefined) form.append('seed', String(options.seed));

    const headers: Record<string, string> = {};
    if (provider.imageResponseFormat === 'binary') headers['Accept'] = 'image/*';
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, endpoint, headers);
    const response = await this.fetchWithRetry(finalUrl, { method: 'POST', headers: finalHeaders, body: form }, provider, undefined, options?.signal);
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    return this.parseImageResponse(response, provider);
  }

  /** Shared response parsing for both request formats above — handles raw-bytes responses (any image/* Content-Type, or whenever imageResponseFormat is 'binary') plus every JSON envelope shape seen across OpenAI-compatible, OpenRouter, and chat-completions-based image APIs. */
  private async parseImageResponse(response: Response, provider: ProviderConfig): Promise<string> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('image/') || provider.imageResponseFormat === 'binary') {
      const blob = await response.blob();
      if (blob.type.startsWith('image/') || provider.imageResponseFormat === 'binary') {
        return URL.createObjectURL(blob);
      }
      // Declared binary but the body wasn't actually an image (e.g. a JSON
      // error payload sent with an image/* Accept header) — fall through
      // and try to parse it as JSON instead of returning a broken blob.
      const text = await blob.text();
      return this.extractImageFromJson(JSON.parse(text), provider);
    }
    const json = await response.json();
    return this.extractImageFromJson(json, provider);
  }

  private extractImageFromJson(json: any, provider: ProviderConfig): string {
    const candidate = json.data?.[0] || json.images?.[0] || json.output?.[0] || json;
    if (typeof candidate === 'string' && candidate.startsWith('http')) return candidate;
    if (candidate?.url) return candidate.url;
    if (candidate?.b64_json) return 'data:image/png;base64,' + candidate.b64_json;
    // Covers image-capable chat models (e.g. OpenRouter's
    // google/gemini-2.5-flash-image) reached via /chat/completions with
    // modalities:['image','text'] — the image comes back inside
    // choices[0].message.images rather than data[]/images[]/output[].
    const chatImage = json.choices?.[0]?.message?.images?.[0];
    const chatImageUrl = chatImage?.image_url?.url || chatImage?.url;
    if (chatImageUrl) return chatImageUrl;
    throw new Error(`unrecognized image response shape from ${provider.name}`);
  }

  async callVideo(provider: ProviderConfig, input: any, options?: any): Promise<{ url: string; isFallback: boolean }> {
    const response = await this.request(provider, this.url(provider, ''), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: options?.model || provider.defaultModel || 'default',
        prompt: input?.prompt ?? input,
        duration: options?.duration,
      }),
    }, options?.signal);
    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('video/')) {
      const blob = await response.blob();
      return { url: URL.createObjectURL(blob), isFallback: false };
    }
    const json = await response.json();
    const candidate = json.data?.[0] || json.output?.[0] || json;
    if (typeof candidate === 'string' && candidate.startsWith('http')) return { url: candidate, isFallback: false };
    if (candidate?.url) return { url: candidate.url, isFallback: false };
    throw new Error(`unrecognized video response shape from ${provider.name} (it may use async job-polling, which isn't supported generically)`);
  }

  async callSpeech(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const response = await this.request(provider, this.url(provider, '/audio/speech'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.defaultModel || 'tts-1',
        voice: options?.voice || 'alloy',
        input: input?.prompt ?? input,
      }),
    }, options?.signal);
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  }

  async callAudioTranscription(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const blob: Blob = input?.blob ?? input;
    if (!(blob instanceof Blob)) throw new Error('Audio transcription requires a Blob/File as input.');
    const form = new FormData();
    form.append('file', blob, 'audio.webm');
    form.append('model', provider.defaultModel || 'whisper-1');
    const headers: Record<string, string> = {};
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, this.url(provider, '/audio/transcriptions'), headers);
    const response = await this.fetchWithRetry(finalUrl, { method: 'POST', headers: finalHeaders, body: form }, provider, undefined, options?.signal);
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const json = await response.json();
    const text = json.text || json.transcript;
    if (!text) throw new Error(`empty transcription response from ${provider.name}`);
    return text;
  }

  async callMusic(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const response = await this.request(provider, this.url(provider, '/audio/generations'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: provider.defaultModel || 'default',
        prompt: input?.prompt ?? input,
        duration: options?.duration || 30,
      }),
    }, options?.signal);
    const blob = await response.blob();
    if (blob.size < 500) throw new Error('Response was too small to be real audio.');
    return URL.createObjectURL(blob);
  }

  async fetchModels(provider: ProviderConfig): Promise<string[]> {
    const url = this.url(provider, '/models');
    const headers: Record<string, string> = {};
    const { url: finalUrl, headers: finalHeaders } = this.buildAuth(provider, url, headers);
    const response = await this.fetchWithRetry(finalUrl, { method: 'GET', headers: finalHeaders }, provider, 0);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} fetching models`);
    }
    const json = await response.json();
    const list = json.data || json.models || (Array.isArray(json) ? json : []);
    return list.map((m: any) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
  }
}
