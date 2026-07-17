/**
 * ProxyClient — browser side of the CORS proxy (see server/proxyHandler.mjs
 * for the server side and the full rationale). Turns a normal
 * `fetch(url, init)` call into an equivalent same-origin call to the local
 * proxy, with the real target URL carried in a request header — the proxy
 * server reads that header and forwards everything else untouched.
 */

/** Must match server/proxyHandler.mjs's PROXY_PATH exactly. */
export const PROXY_PATH = '/api/magenais-proxy';
/** Must match server/proxyHandler.mjs's TARGET_HEADER exactly (header names are case-insensitive over HTTP, but keep them textually identical for clarity). */
export const TARGET_HEADER = 'X-Proxy-Target';

/**
 * Rewrites a (url, init) pair to go through the local proxy instead of
 * directly to `url`. Every other part of the request — method, body,
 * Authorization/Content-Type/etc headers, abort signal — passes through
 * completely unchanged, so the adapter code that built them needs no
 * awareness this happened, and the Response it gets back has the same
 * status/headers/body shape it would have gotten from a direct call.
 */
export function toProxiedRequest(url: string, init: RequestInit): { url: string; init: RequestInit } {
  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set(TARGET_HEADER, url);
  return { url: PROXY_PATH, init: { ...init, headers } };
}

/**
 * Strips any known API-key-bearing query parameter before a URL is logged
 * or shown in the Pipeline Report — satisfies "log the request URL without
 * exposing API keys" for the (uncommon) authType:'query' providers, whose
 * key would otherwise sit in plain sight in the URL itself. Bearer/header
 * auth (the overwhelming majority of providers, including Moonshot) never
 * puts the key in the URL at all, so this is a no-op for them.
 */
export function redactUrlForLogging(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const sensitiveParams = ['api_key', 'apikey', 'key', 'token', 'access_token', 'auth'];
    let redacted = false;
    for (const param of sensitiveParams) {
      if (url.searchParams.has(param)) {
        url.searchParams.set(param, '***');
        redacted = true;
      }
    }
    return redacted ? url.toString() : rawUrl;
  } catch {
    return rawUrl;
  }
}
