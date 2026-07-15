import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

/**
 * Pollinations free-tier image endpoint.
 *
 * ROOT CAUSE FIX (user-reported: "Pollinations (Free Image, no key) HTTP
 * 403: Missing Turnstile token"): this adapter used to target the legacy
 * `image.pollinations.ai/prompt/{prompt}` host. Pollinations has since
 * consolidated every modality behind the unified `gen.pollinations.ai`
 * gateway and put the old host behind a Cloudflare Turnstile
 * (browser-only, human-interaction) challenge — a plain server-style GET
 * can never pass that, so every request failed with HTTP 403 regardless of
 * network conditions or retries. Per Pollinations' own current docs and
 * examples (gen.pollinations.ai/docs), light/no-signup use of
 * `GET https://gen.pollinations.ai/image/{prompt}` is still genuinely
 * unauthenticated — no bot challenge, no key required for reasonable use —
 * so that's the endpoint this adapter now calls. If the user later adds an
 * API key to this same provider entry (Keys & Providers), it's sent along
 * too (higher, more reliable Pollen-based rate limits), but it is never
 * required.
 */
export class PollinationsFreeImageAdapter extends BaseAdapter {
  label = 'Pollinations (Free Image, no key)';
  browserSafe = true;
  supportsModelDiscovery = false;

  async testConnection(_provider: ProviderConfig): Promise<{ ok: boolean; message: string }> {
    // No auth/handshake endpoint to probe safely without generating a real
    // (rate/quota-consuming) image — treat "configured with a base URL" as
    // healthy, and let real usage surface any transient outage through the
    // normal fallback-chain error path.
    return { ok: true, message: 'No key required — ready to generate.' };
  }

  async call(provider: ProviderConfig, input: any, options?: any): Promise<string> {
    const prompt = input?.prompt ?? input;
    if (!prompt) throw new Error('Image generation requires a prompt.');

    // Guard against a stale locally-saved baseUrl (from before this fix)
    // still pointing at the retired, Turnstile-gated host — always use the
    // current unified gateway regardless of what's stored.
    let base = (provider.baseUrl || 'https://gen.pollinations.ai').replace(/\/$/, '');
    if (/(^|\/\/)image\.pollinations\.ai/i.test(base)) {
      base = 'https://gen.pollinations.ai';
    }
    const params = new URLSearchParams({
      width: String(options?.width || 1024),
      height: String(options?.height || 1024),
      nologo: 'true',
      seed: String(options?.seed ?? Math.floor(Math.random() * 2147483647)),
    });
    if (options?.model || provider.defaultModel) {
      params.set('model', options?.model || provider.defaultModel);
    }
    if (provider.apiKey) {
      params.set('key', provider.apiKey);
    }
    const url = `${base}/image/${encodeURIComponent(String(prompt))}?${params.toString()}`;

    const response = await this.fetchWithRetry(url, { method: 'GET' }, provider);
    if (!response.ok) {
      if (response.status === 429) throw new Error('Pollinations is rate-limiting this request (429) — it will retry via the fallback chain.');
      if (response.status === 403) {
        const text = await response.text().catch(() => '');
        throw new Error(`Pollinations rejected the request (403: ${text.slice(0, 120) || 'forbidden'}) — this can happen under heavy anonymous traffic; add a free key at enter.pollinations.ai for reliable access, or let the fallback chain continue.`);
      }
      const text = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
      throw new Error('Pollinations did not return an image (it may be temporarily degraded).');
    }
    return URL.createObjectURL(blob);
  }
}
