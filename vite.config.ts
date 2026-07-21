import { defineConfig } from 'vite';
import { resolve } from 'path';
import corsProxyPlugin from './build/corsProxyPlugin';

const isGitHubPages = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  base: isGitHubPages ? '/MAGENAIS/' : '/',

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