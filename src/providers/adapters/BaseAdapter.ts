import { ProviderConfig, Adapter, AdapterCapabilities, ProviderTestResult } from '../types';
import { Logger } from '../../core/Logger';
import { toProxiedRequest, redactUrlForLogging } from './ProxyClient';

/**
 * Abstract base class for all provider adapters.
 * Implements common utilities and the Adapter interface.
 */
export abstract class BaseAdapter implements Adapter {
  abstract label: string;
  abstract browserSafe: boolean;
  abstract supportsModelDiscovery: boolean;

  /**
   * Test connection by making a lightweight request.
   * Default implementation only checks that the provider has an API key
   * (or noKeyNeeded) and baseUrl — it does NOT make a real network request,
   * since this default is shared by browser-native adapters (WebLLM,
   * Transformers.js, browser speech) where "is it configured" is a
   * meaningfully different (and cheaper/instant) question than "can it
   * reach a remote API." OpenAICompatibleAdapter overrides this with a
   * real minimal chat/completions call — see that file for the Phase 7
   * "Provider Testing" implementation most registry entries actually use.
   */
  async testConnection(provider: ProviderConfig): Promise<ProviderTestResult> {
    const testedAt = Date.now();
    if (!provider.baseUrl && provider.authType !== 'none') {
      return { ok: false, message: 'Base URL is required.', testedAt, category: 'other' };
    }
    if (!provider.apiKey && !provider.noKeyNeeded) {
      return { ok: false, message: 'API key is required.', testedAt, category: 'auth' };
    }
    // If baseUrl is set and we have a key, we could attempt a lightweight request.
    // For now, just assume healthy.
    return { ok: true, message: 'Provider configuration looks valid.', testedAt };
  }

  /**
   * Fetch available models from the provider.
   * Default: not supported.
   */
  async fetchModels(provider: ProviderConfig): Promise<string[]> {
    throw new Error(`Model discovery not supported by ${this.label}.`);
  }

  /**
   * Core method to call the provider API.
   * Subclasses must implement this.
   */
  abstract call(provider: ProviderConfig, input: any, options?: any): Promise<any>;

  /**
   * Helper to build authentication headers/query parameters.
   */
  protected buildAuth(provider: ProviderConfig, url: string, headers: Record<string, string>): { url: string; headers: Record<string, string> } {
    if (provider.authType === 'bearer' && provider.apiKey) {
      headers['Authorization'] = 'Bearer ' + provider.apiKey;
    } else if (provider.authType === 'header' && provider.apiKey) {
      const headerName = provider.authHeaderName || 'Authorization';
      headers[headerName] = (provider.authHeaderPrefix || '') + provider.apiKey;
    } else if (provider.authType === 'query' && provider.apiKey) {
      const paramName = provider.authQueryParam || 'api_key';
      const sep = url.includes('?') ? '&' : '?';
      url += sep + encodeURIComponent(paramName) + '=' + encodeURIComponent(provider.apiKey);
    }
    // Merge extra headers from provider.headers
    let extraHeaders: Record<string, string> = {};
    try {
      const parsed = typeof provider.headers === 'string' ? JSON.parse(provider.headers) : provider.headers;
      if (parsed && typeof parsed === 'object') {
        extraHeaders = parsed;
      }
    } catch (e) {
      Logger.warn(`Invalid headers JSON for provider ${provider.id}`);
    }
    Object.assign(headers, extraHeaders);
    return { url, headers };
  }

  /**
   * Perform a fetch with retries and timeout.
   *
   * `externalSignal` (added for the ProviderManager "first success wins"
   * race — see Manager.ts callWithFallback): when provided, aborting it
   * cancels the in-flight fetch immediately, on top of this method's own
   * per-attempt timeout controller. An abort from the caller intentionally
   * skips the retry/backoff loop below, since retrying a call the caller
   * no longer wants is wasted work — a faster sibling provider already won.
   *
   * ============================================================
   * PHASE 4 — CORS proxy routing (Moonshot/Kimi fix)
   * ============================================================
   * Some provider APIs (Moonshot/Kimi confirmed, likely others) never send
   * an Access-Control-Allow-Origin header — they're built to be called
   * server-side, so a browser blocks the request before it ever reaches
   * the network, surfacing only a generic "Failed to fetch" with no status
   * code to work with. This is the ONE place in the whole provider system
   * that needed to change to fix that, because every adapter that talks
   * over HTTP already funnels its requests through here.
   *
   * Two ways a request ends up going through the local proxy
   * (server/proxyHandler.mjs, mounted in vite.config.ts for dev and
   * server/proxy-server.mjs for production) instead of straight to
   * `provider.baseUrl`:
   *   1. `provider.requiresServerProxy === true` — routes through the
   *      proxy from the very first attempt. This is how Moonshot/Kimi's
   *      preset is configured (see defaultProviders.ts) and how any
   *      future provider with the same problem should be configured too —
   *      it's plain data, not code, so nothing here is Moonshot-specific.
   *   2. Auto-detected mid-call: a direct request throws the exact
   *      TypeError("Failed to fetch") signature a CORS block produces —
   *      retried immediately through the proxy (not counted against
   *      maxRetries/backoff, since this isn't a flaky-network retry, it's
   *      switching transport). If that succeeds, `requiresServerProxy` is
   *      flipped to `true` on the provider's own config object so every
   *      later call this session goes straight through the proxy without
   *      re-detecting each time. This covers a provider nobody has
   *      flagged yet, at the cost of one wasted round-trip the first time
   *      it's called.
   */
  protected async fetchWithRetry(
    url: string,
    init: RequestInit,
    provider: ProviderConfig,
    retries?: number,
    externalSignal?: AbortSignal,
    onRetry?: (attempt: number) => void
  ): Promise<Response> {
    if (externalSignal?.aborted) {
      throw new Error(`${provider.name} request was cancelled before it started.`);
    }
    const maxRetries = retries !== undefined ? retries : provider.retries || 0;
    const timeout = provider.timeoutMs || 30000;
    let attempt = 0;
    let usingProxy = !!provider.requiresServerProxy;
    let request = usingProxy ? toProxiedRequest(url, init) : { url, init };

    Logger.debug(`${provider.name}: ${init.method || 'GET'} ${redactUrlForLogging(url)}${usingProxy ? ' (via local CORS proxy)' : ''}`);

    while (attempt <= maxRetries) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      const onExternalAbort = () => controller.abort();
      externalSignal?.addEventListener('abort', onExternalAbort);
      try {
        const response = await fetch(request.url, {
          ...request.init,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (usingProxy && !provider.requiresServerProxy) {
          // Self-healed mid-call (case 2 above) — remember it. `provider`
          // is the same object instance the registry holds (not a copy),
          // so this takes effect for every subsequent call to this
          // provider for the rest of the session without any other
          // wiring, exactly like flipping it by hand in Keys & Providers.
          provider.requiresServerProxy = true;
          Logger.info(`${provider.name}: requests will go through the local proxy from now on (auto-detected a CORS block on the direct call).`);
        }
        return response;
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (externalSignal?.aborted) {
          throw new Error(`${provider.name} request was cancelled — a faster provider already responded.`);
        }

        const timedOut = controller.signal.aborted;
        const looksLikeCorsOrNetworkFailure =
          !usingProxy && err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(err.message || '');

        if (looksLikeCorsOrNetworkFailure) {
          usingProxy = true;
          request = toProxiedRequest(url, init);
          Logger.warn(
            `${provider.name}: direct browser request to ${redactUrlForLogging(url)} failed with "${err.message}" — ` +
            `this is the signature of a CORS block (the provider's API doesn't allow direct browser calls), not a real ` +
            `network outage. Retrying once through the local proxy...`
          );
          continue; // not counted against maxRetries — this is a transport switch, not a flaky-network retry
        }

        attempt++;
        if (attempt > maxRetries) {
          throw this.describeFetchFailure(err, provider, url, timedOut, timeout);
        }
        onRetry?.(attempt);
        // Simple backoff
        const backoff = Math.min(1000 * Math.pow(2, attempt), 8000);
        await new Promise(r => setTimeout(r, backoff));
        Logger.debug(`Retry ${attempt}/${maxRetries} for ${provider.name}`);
      } finally {
        externalSignal?.removeEventListener('abort', onExternalAbort);
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Turns a raw pre-response fetch failure into a clear, categorized
   * message — this is specifically for failures that happen BEFORE any
   * HTTP response exists (timeout, CORS, DNS/connection failure); HTTP
   * status errors (401/403/404/429/5xx) are unaffected by this and are
   * still surfaced by each adapter's own `response.ok` check exactly as
   * before, since those DO have a real response to report on.
   */
  private describeFetchFailure(err: any, provider: ProviderConfig, url: string, timedOut: boolean, timeoutMs: number): Error {
    const target = redactUrlForLogging(url);
    if (timedOut) {
      return new Error(`${provider.name} did not respond within ${Math.round(timeoutMs / 1000)}s (timed out) — ${target}`);
    }
    if (err instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(err.message || '')) {
      const viaProxy = provider.requiresServerProxy;
      return new Error(
        `${provider.name}: network error calling ${target}${viaProxy ? ' (via local proxy)' : ''} — ` +
        (viaProxy
          ? 'the proxy server itself may not be running (see server/proxy-server.mjs for production, or restart `npm run dev`).'
          : "the browser could not reach this URL at all (DNS/connection failure, or the provider blocks direct browser calls — " +
            "if so, set requiresServerProxy:true for this provider).")
      );
    }
    return new Error(`${provider.name}: ${err?.message || String(err)} — ${target}`);
  }
}
