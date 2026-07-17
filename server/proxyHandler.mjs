/**
 * proxyHandler.mjs — CORS proxy for MAGENAIS's Universal Provider Manager.
 *
 * WHY THIS EXISTS: some provider APIs (Moonshot/Kimi being the immediate
 * case — see the "HTTP" section of docs.moonshot.ai, which documents no
 * Access-Control-Allow-Origin header on api.moonshot.ai; likewise OpenAI's
 * and Anthropic's own APIs are not meant to be called directly from a
 * browser origin) never send CORS headers, because they're designed to be
 * called from a server, not a browser tab. A browser calling them directly
 * gets exactly the failure in the bug report: the request never even
 * reaches the provider — Chrome blocks it client-side and reports "Failed
 * to fetch" with no useful status code.
 *
 * CORS is a browser-only restriction — it does not apply to server-to-
 * server requests. So the fix is architecturally simple: the browser talks
 * to this same-origin endpoint (no CORS problem, it's same-origin), and
 * THIS Node process — which is not a browser and is not subject to CORS —
 * makes the real request to the provider and relays the response back
 * byte-for-byte (status code, body, and the handful of headers that matter)
 * exactly as if the browser had reached it directly. No adapter code needs
 * to know or care that this happened; ProviderConfig.requiresServerProxy
 * (see BaseAdapter.fetchWithRetry) is the only thing that decides whether
 * a given request is routed through here.
 *
 * This module only knows raw Node `http.IncomingMessage`/`http.ServerResponse`
 * (or Connect-style req/res, which are the same objects) — that's what
 * both Vite's `configureServer` middleware hook and Node's own `http`
 * server module hand it, so ONE implementation covers dev (vite.config.ts)
 * and production (proxy-server.mjs) with no duplication.
 */

export const PROXY_PATH = '/api/magenais-proxy';
/** Request header the browser uses to tell this proxy where the request should actually go. */
export const TARGET_HEADER = 'x-proxy-target';

// Hop-by-hop / connection-specific headers that must never be blindly
// copied in either direction — copying these verbatim between two
// different HTTP connections produces broken or mismatched responses
// (e.g. forwarding the upstream's `content-encoding: gzip` after Node's
// fetch() has already transparently decompressed the body, or forwarding
// `content-length` computed for a different byte count).
const STRIP_REQUEST_HEADERS = new Set(['host', 'origin', 'referer', 'content-length', TARGET_HEADER, 'connection']);
const STRIP_RESPONSE_HEADERS = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection']);

/**
 * Minimal SSRF guard: only plain `https:` targets are relayed, and
 * loopback/private-network hosts are rejected outright. This is a proxy
 * for calling third-party cloud provider APIs from the browser — it has no
 * legitimate reason to ever reach into localhost or a private LAN, so
 * blocking that outright costs nothing while closing off the classic
 * "use an open proxy to probe the server's own network" abuse case.
 */
function isSafeProxyTarget(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  const host = url.hostname.toLowerCase();
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1' || host === '127.0.0.1') return false;
  if (/^127\./.test(host)) return false;
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  return true;
}

/** Buffers a Node request body into a single Buffer (requests to LLM APIs are small JSON payloads — no need to stream). */
function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function logInfo(log, message) {
  if (typeof log.info === 'function') log.info(message);
  else console.log(message);
}
function logWarn(log, message) {
  if (typeof log.warn === 'function') log.warn(message);
  else console.warn(message);
}

/**
 * Handles one proxied request. Returns true if it handled the request
 * (whether it succeeded or responded with an error), false if `req` wasn't
 * a request for this proxy at all — callers use that to fall through to
 * their normal handling (serving static files, Vite's own middleware, etc).
 */
export async function handleProxyRequest(req, res, log = console) {
  const requestUrl = new URL(req.url, 'http://internal.invalid');
  if (requestUrl.pathname !== PROXY_PATH) return false;

  const target = req.headers[TARGET_HEADER];
  if (!target || Array.isArray(target)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `Missing or invalid ${TARGET_HEADER} header.` }));
    return true;
  }
  if (!isSafeProxyTarget(target)) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Proxy target must be an https:// URL and may not point at a local/private address.' }));
    return true;
  }

  // Log the target and method, never the Authorization header/API key —
  // this satisfies "log the final request URL without exposing API keys."
  const targetForLog = new URL(target);
  logInfo(log, `[proxy] ${req.method} ${targetForLog.origin}${targetForLog.pathname}`);

  const forwardHeaders = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (STRIP_REQUEST_HEADERS.has(key.toLowerCase()) || value === undefined) continue;
    forwardHeaders[key] = Array.isArray(value) ? value.join(', ') : value;
  }

  const hasBody = !['GET', 'HEAD'].includes((req.method || 'GET').toUpperCase());
  const body = hasBody ? await readRequestBody(req) : undefined;

  let upstream;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: forwardHeaders,
      body,
    });
  } catch (err) {
    // A genuine network failure on the SERVER side (DNS, connection
    // refused, TLS error, provider outright unreachable) — this is a real
    // network error, not a CORS artifact (there is no such thing as CORS
    // between two servers), so it's reported as such rather than as
    // whatever generic message a browser-side "Failed to fetch" would
    // otherwise have produced.
    logWarn(log, `[proxy] network error reaching ${targetForLog.origin}: ${err.message}`);
    res.writeHead(502, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: `Proxy could not reach ${targetForLog.origin}: ${err.message}` }));
    return true;
  }

  const responseHeaders = {};
  upstream.headers.forEach((value, key) => {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) responseHeaders[key] = value;
  });
  const responseBody = Buffer.from(await upstream.arrayBuffer());
  logInfo(log, `[proxy] ${targetForLog.origin}${targetForLog.pathname} -> HTTP ${upstream.status}`);

  res.writeHead(upstream.status, responseHeaders);
  res.end(responseBody);
  return true;
}
