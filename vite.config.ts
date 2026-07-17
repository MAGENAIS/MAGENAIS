import { defineConfig } from 'vite';
import { resolve } from 'path';
import { handleProxyRequest } from './server/proxyHandler.mjs';

/**
 * Dev-server counterpart to server/proxy-server.mjs — see that file's doc
 * comment for the full rationale. Same handler, same behavior, just
 * mounted via Vite's own middleware instead of a standalone http.Server,
 * so `npm run dev` and a production `npm start` both proxy
 * requiresServerProxy providers identically.
 */
function corsProxyPlugin() {
  return {
    name: 'magenais-cors-proxy',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const handled = await handleProxyRequest(req, res, console);
        if (!handled) next();
      });
    },
  };
}

export default defineConfig({
  server: {
    port: 5173,
    open: true,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [corsProxyPlugin()],
});