/**
 * corsProxyPlugin.ts — wires the shared CORS proxy (server/proxyHandler.mjs)
 * into Vite's dev server middleware.
 *
 * This is the dev-time counterpart to server/proxy-server.mjs. Both share
 * the exact same handleProxyRequest implementation (see proxyHandler.mjs
 * for the full rationale) so there is only one place that logic can drift:
 *   - `npm run dev`   -> this plugin, via Vite's `configureServer` hook
 *   - `npm start`     -> server/proxy-server.mjs, via Node's `http` server
 *   - `npm run build` -> not used at all; this plugin is a no-op outside
 *                        of `configureServer`, so it never affects what
 *                        ends up in dist/. Static hosts (GitHub Pages
 *                        included) that need `requiresServerProxy`
 *                        providers must run proxy-server.mjs (or an
 *                        equivalent) themselves — see that file's header.
 */
import type { Plugin } from 'vite';
import { handleProxyRequest } from '../server/proxyHandler.mjs';

export default function corsProxyPlugin(): Plugin {
  return {
    name: 'magenais-cors-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const handled = await handleProxyRequest(req, res, server.config.logger);
          if (!handled) next();
        } catch (err) {
          server.config.logger.error(`[cors-proxy] unhandled error: ${(err as Error).message}`);
          if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error.' }));
        }
      });
    },
  };
}
