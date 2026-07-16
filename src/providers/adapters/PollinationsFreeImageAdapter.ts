import { BaseAdapter } from './BaseAdapter';
import { ProviderConfig } from '../types';

/**
 * Pollinations "classic" free image endpoint — image.pollinations.ai/prompt/{prompt}.
 *
 * IMPORTANT — why this is a SEPARATE adapter from PollinationsAdapter:
 * PollinationsAdapter (see PollinationsAdapter.ts) targets gen.pollinations.ai,
 * which — per Pollinations' own current documentation — now requires a free
 * Pollen API key ("Bring-Your-Own-Pollen") for ALL generation, including
 * images. That's a real, useful provider once a user has a key, but it is
 * NOT a zero-setup default.
 *
 * image.pollinations.ai is Pollinations' original, still-live, genuinely
 * unauthenticated image generation endpoint: a plain GET request with the
 * prompt in the URL path, no key, no signup, no rate-limit handshake. It is
 * intentionally simple (no chat/audio/video modes — just images) and is
 * registered as MAGENAIS's #1-priority IMAGE default so Image (and, via
 * KenBurnsFallbackAdapter's still-image-then-pan approach, Video) works
 * immediately after install with zero configuration.
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

    const base = (provider.baseUrl || 'https://image.pollinations.ai').replace(/\/$/, '');
    const params = new URLSearchParams({
      width: String(options?.width || 1024),
      height: String(options?.height || 1024),
      nologo: 'true',
      seed: String(options?.seed ?? Math.floor(Math.random() * 2147483647)),
    });
    if (options?.model || provider.defaultModel) {
      params.set('model', options?.model || provider.defaultModel);
    }
    const url = `${base}/prompt/${encodeURIComponent(String(prompt))}?${params.toString()}`;

    const response = await this.fetchWithRetry(url, { method: 'GET' }, provider, undefined, options?.signal);
    if (!response.ok) {
      if (response.status === 429) throw new Error('Pollinations is rate-limiting this request (429) — it will retry via the fallback chain.');
      const text = await response.text().catch(() => '');
      // ROOT CAUSE (user-reported: this genuinely-free, no-key endpoint
      // started failing with HTTP 403 "Missing Turnstile token"): as of
      // mid-2026 Pollinations added a Cloudflare Turnstile bot-check in
      // front of anonymous image requests. Turnstile requires solving an
      // interactive widget in a real page context — there's no way to
      // pass it from a plain server-side/background fetch, by design, so
      // this specific failure mode can't be worked around here; the
      // honest fix is a clear message pointing at the actual alternative
      // (a free Pollinations API key still works) instead of a raw JSON
      // error dump that looks like a bug.
      if (response.status === 403 && /turnstile/i.test(text)) {
        throw new Error('Pollinations now requires a bot-check (Turnstile) for anonymous image requests that this app cannot solve automatically. Get a free API key at enter.pollinations.ai and add it in Keys & Providers to keep using Pollinations for images.');
      }
      throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
    }
    const blob = await response.blob();
    if (!blob.type.startsWith('image/')) {
      throw new Error('Pollinations did not return an image (it may be temporarily degraded).');
    }
    return URL.createObjectURL(blob);
  }
}
