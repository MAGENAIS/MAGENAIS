#!/usr/bin/env node
/**
 * proxy-server.mjs — production entry point for MAGENAIS.
 *
 * `npm run build` produces a static `dist/` bundle, same as before this
 * change — nothing about the build output changed. What's new is this
 * script: `npm start` runs it to serve that bundle AND host the same
 * `/api/magenais-proxy` endpoint the Vite dev server exposes during
 * `npm run dev` (see the plugin in vite.config.ts), so
 * `requiresServerProxy` providers (Moonshot/Kimi, and any future one
 * flagged the same way) work in production exactly as they do in dev —
 * no separate reverse-proxy or hosting-platform-specific config needed.
 *
 * Deploying `dist/` to a static host with no server (GitHub Pages, a plain
 * CDN, etc.) still works for every provider that doesn't need
 * `requiresServerProxy` — this script is only required if you want to
 * self-host the app somewhere that also serves the proxy endpoint. If
 * you're deploying dist/ to a static-only host instead, point
 * `requiresServerProxy` providers' base URLs at whatever proxy that host
 * provides (e.g. a serverless function importing handleProxyRequest's
 * logic) — the provider-side flag and BaseAdapter routing are unchanged
 * either way.
 */
import { createServer } from 'node:http';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname } from 'node:path';
import { handleProxyRequest, PROXY_PATH } from './proxyHandler.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');
const port = Number(process.env.PORT) || 4173;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

async function serveStatic(req, res) {
  // Basic path traversal guard — normalize and reject anything that
  // escapes distDir before it ever touches the filesystem.
  const urlPath = decodeURIComponent(new URL(req.url, 'http://internal.invalid').pathname);
  const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(distDir, safePath);

  try {
    const st = await stat(filePath);
    if (st.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // Not a real file — SPA fallback to index.html so client-side routes
    // (if any are added later) don't 404 on a hard refresh.
    filePath = join(distDir, 'index.html');
  }

  try {
    const ext = extname(filePath);
    res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500);
    res.end(`Failed to serve ${filePath}: ${err.message}`);
  }
}

const server = createServer(async (req, res) => {
  try {
    const handled = await handleProxyRequest(req, res, console);
    if (handled) return;
    await serveStatic(req, res);
  } catch (err) {
    console.error('[server] unhandled error:', err);
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error.' }));
  }
});

server.listen(port, () => {
  console.log(`MAGENAIS production server running at http://localhost:${port}`);
  console.log(`  Serving static files from: ${distDir}`);
  console.log(`  CORS proxy mounted at:     ${PROXY_PATH}`);
});
