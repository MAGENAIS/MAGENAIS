import { defineConfig } from 'vite';
import { resolve } from 'path';
import corsProxyPlugin from './build/corsProxyPlugin';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  base: isGitHubPages ? '/MAGENAIS/' : '/',

  define: {
    // Surfaced in Keys & Providers > Diagnostics (see SettingsModal.ts's
    // renderDiagnostics) so "GitHub Pages behaves differently than
    // localhost" can be checked against "is GitHub Pages even serving the
    // build I think it is" in ten seconds, instead of re-auditing
    // application code for a difference that was actually just a stale/
    // cached deploy. __BUILD_TIME__ changes on every build regardless of
    // CI; __COMMIT_SHA__ is only meaningful in GitHub Actions (falls back
    // to 'local' for `npm run dev`/`vite build` run by hand).
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __COMMIT_SHA__: JSON.stringify(process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : 'local'),
  },

  server: {
    port: 5173,
    open: true,
  },

  build: {
    target: 'es2022',
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,

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

  plugins: [
    corsProxyPlugin(),
  ],
});