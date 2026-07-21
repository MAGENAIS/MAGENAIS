/**
 * Environment.ts — single source of truth for "what kind of runtime is this
 * app currently executing in".
 *
 * WHY THIS EXISTS: the provider registry (Discovery/Registry/Manager) needs
 * to know, at runtime, whether capabilities like the local CORS proxy
 * (server/proxyHandler.mjs, see requiresServerProxy in providers/types.ts)
 * actually exist in the current deployment. GitHub Pages (and any other
 * plain static host) serves ONLY the `dist/` output produced by
 * `vite build` — there is no Node process behind it, so
 * `requiresServerProxy` providers can never reach `/api/magenais-proxy`
 * there (see deploy-pages.yml, which uploads `dist/` as a static artifact).
 * Desktop and Localhost, by contrast, are expected to have one (the Vite
 * dev server's corsProxyPlugin, or a bundled companion process — see
 * build/corsProxyPlugin.ts and server/proxy-server.mjs).
 *
 * This module is deliberately the ONLY place that inspects `window.location`
 * / `navigator.userAgent` / etc. for this purpose — everything downstream
 * (Capability.ts, Manager.ts, Router.ts, SettingsModal.ts) reads
 * `Environment.current` / `Environment.hasServerProxy` rather than
 * re-deriving it, so there is exactly one definition of "what environment
 * are we in" to ever get out of sync.
 *
 * Computed once at module load (same style as RoutingMode.ts's
 * LOCAL_ADAPTER_IDS) rather than re-detected on every read — the runtime
 * environment cannot change during a single page session, so there is
 * nothing to gain from re-computing it and a real cost (every hot call
 * site: Router.scoreProvider, Manager's per-request filters) to doing so.
 */

export enum RuntimeEnvironment {
  /** A plain browser tab pointed at some static deployment that isn't specifically recognized below (e.g. a self-hosted `dist/` on a CDN with no companion proxy). Treated the same as GitHubPages for capability purposes — see hasServerProxy. */
  Browser = 'browser',
  /** *.github.io — see deploy-pages.yml. Static-only, no backend of any kind. */
  GitHubPages = 'github-pages',
  /** Running inside a packaged desktop shell (Electron/Tauri/etc.) — see detectDesktop() below. No such shell is wired up in this repo yet; this is the extension point for when one is. */
  Desktop = 'desktop',
  /** `npm run dev` / `vite preview`, or `npm start` (server/proxy-server.mjs) reached via localhost. */
  Localhost = 'localhost',
  /** Non-browser execution context (SSR/build tooling/tests) — `window` doesn't exist at all. Treated as a full server environment since nothing here is subject to browser CORS restrictions in the first place. */
  Server = 'server',
}

interface EnvironmentOverrides {
  current?: RuntimeEnvironment;
  hasServerProxy?: boolean;
}

/**
 * Escape hatch for deployments this module's heuristics can't see on their
 * own — e.g. someone self-hosting via `server/proxy-server.mjs` (which DOES
 * mount the CORS proxy — see that file) behind a custom domain that is
 * neither `localhost` nor `*.github.io`. Without this, such a deployment
 * would be miscategorized as plain `Browser` (no proxy) even though one is
 * genuinely running right behind it.
 *
 * Set `window.__MAGENAIS_ENV__ = { hasServerProxy: true }` (or `current:
 * RuntimeEnvironment.Server`) before this module loads — e.g. an inline
 * `<script>` in a custom `index.html` — to override the auto-detected
 * values. Read once at module load, same as every other signal here.
 */
function readOverrides(): EnvironmentOverrides {
  if (typeof window === 'undefined') return {};
  return (window as any).__MAGENAIS_ENV__ || {};
}

/**
 * Detects a packaged desktop shell. Nothing in this repo sets any of these
 * hooks today (see the Desktop doc comment above) — this exists so that
 * whenever a desktop wrapper IS added, Environment automatically picks it
 * up with zero changes to Discovery/Registry/Manager/Router/SettingsModal,
 * all of which only ever read `Environment.current`/`Environment.isDesktop`.
 */
function detectDesktop(): boolean {
  if (typeof window === 'undefined') return false;
  const w = window as any;
  return !!(
    w.__MAGENAIS_DESKTOP__ || // explicit hook a future desktop shell can set
    w.__TAURI__ ||
    w.process?.versions?.electron ||
    /\belectron\b/i.test(navigator.userAgent || '')
  );
}

function detectCurrent(overrides: EnvironmentOverrides): RuntimeEnvironment {
  if (overrides.current) return overrides.current;
  if (typeof window === 'undefined') return RuntimeEnvironment.Server;
  if (detectDesktop()) return RuntimeEnvironment.Desktop;

  const host = window.location.hostname;
  if (host === 'github.io' || host.endsWith('.github.io')) return RuntimeEnvironment.GitHubPages;
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' || host === '') {
    return RuntimeEnvironment.Localhost;
  }
  return RuntimeEnvironment.Browser;
}

function detectHasServerProxy(current: RuntimeEnvironment, overrides: EnvironmentOverrides): boolean {
  if (overrides.hasServerProxy !== undefined) return overrides.hasServerProxy;
  // Localhost (npm run dev, via build/corsProxyPlugin.ts) and Desktop
  // (expected to bundle/run its own companion process) are assumed to have
  // a same-origin proxy reachable at server/proxyHandler.mjs's PROXY_PATH.
  // A 'Server' deployment (this app served by proxy-server.mjs itself, or
  // an equivalent) has one by definition. Plain 'Browser' and
  // 'GitHubPages' are genuine static hosting with nothing behind them —
  // see vite.config.ts's isGitHubPages base-path handling and
  // deploy-pages.yml, which only ever upload static `dist/` output.
  return (
    current === RuntimeEnvironment.Localhost ||
    current === RuntimeEnvironment.Desktop ||
    current === RuntimeEnvironment.Server
  );
}

const overrides = readOverrides();
const current = detectCurrent(overrides);
const hasServerProxy = detectHasServerProxy(current, overrides);

export const Environment = {
  current,

  isGitHubPages: current === RuntimeEnvironment.GitHubPages,
  isDesktop: current === RuntimeEnvironment.Desktop,
  isLocalhost: current === RuntimeEnvironment.Localhost,
  isServer: current === RuntimeEnvironment.Server,
  isBrowser: current === RuntimeEnvironment.Browser,

  /** Browser or GitHubPages — "a tab with no backend of its own". Used to nudge browser-native providers ahead of ones that might need a proxy this environment doesn't have — see Router.ts's environmentAffinityScore. */
  isStaticHost: current === RuntimeEnvironment.Browser || current === RuntimeEnvironment.GitHubPages,

  /** Whether a same-origin backend (server/proxyHandler.mjs's PROXY_PATH) is actually reachable from here right now. This is what Capability.ts keys `requiresServerProxy` providers' availability off of. */
  hasServerProxy,
};
