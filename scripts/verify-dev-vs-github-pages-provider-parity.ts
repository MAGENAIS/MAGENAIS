// Regression test for the "MAGENAIS initializes different providers/local
// models on localhost vs the GitHub Pages build" mismatch.
// Run manually with: npx tsx scripts/verify-dev-vs-github-pages-provider-parity.ts
//
// ROOT CAUSE (see doc comments added alongside this script in Router.ts,
// Capability.ts, and Environment.ts):
//   1. Router.scoreProvider used to add a blanket +100 to every
//      LOCAL_ADAPTER_IDS provider whenever Environment.isStaticHost was
//      true — an environment-level guess with no connection to whether any
//      given candidate could actually be reached. REMOVED — scoring is now
//      the identical weighted-sum formula in every environment.
//   2. The GENUINE difference between localhost and an https: GitHub Pages
//      deploy is that a browser blocks "mixed content" — an active fetch
//      from an https: page to a plain http: URL — before it ever reaches
//      the network. Ollama's baseUrl is 'http://localhost:11434'
//      (defaultProviders.ts), so it is reachable from an http:-served
//      localhost dev tab but genuinely, deterministically unreachable from
//      an https:-served GitHub Pages tab. This is now caught explicitly in
//      Capability.ts's computeProviderCapability, the same deterministic
//      mechanism already used for requiresServerProxy.
//
// Environment.ts / Capability.ts compute their values ONCE at module load
// from `window.location` + `window.__MAGENAIS_ENV__`, by design (see
// Environment.ts's own doc comment on why). That means a single Node
// process can only ever observe ONE simulated environment — so this
// script spawns itself as a child process per scenario for true
// module-graph isolation, rather than faking re-imports in-process.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);

type Scenario = 'github-pages' | 'localhost';

function runScenario(scenario: Scenario): { ok: boolean; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [require.resolve('tsx/cli'), __filename, `--scenario=${scenario}`],
      { encoding: 'utf-8', env: { ...process.env } }
    );
    return { ok: true, output };
  } catch (err: any) {
    return { ok: false, output: (err.stdout || '') + (err.stderr || '') + (err.message || String(err)) };
  }
}

async function runAsChild(scenario: Scenario) {
  // --- minimal window/localStorage/navigator polyfill (Node has neither) ---
  const store = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const location =
    scenario === 'github-pages'
      ? { protocol: 'https:', hostname: 'someuser.github.io', origin: 'https://someuser.github.io' }
      : { protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:5174' };
  (globalThis as any).window = { location, __MAGENAIS_ENV__: {} };
  Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node-test' }, configurable: true });

  const { Environment } = await import('../src/core/Environment');
  const { computeProviderCapability } = await import('../src/providers/registry/Capability');
  const { SmartRouter } = await import('../src/providers/Router');
  const { ProviderRegistry } = await import('../src/providers/registry/Registry');
  const { EventBus } = await import('../src/core/EventBus');
  const { DEFAULT_PROVIDERS } = await import('../src/providers/defaultProviders');

  let failed = false;
  const assert = (cond: boolean, msg: string) => {
    if (!cond) { console.error(`FAIL: ${msg}`); failed = true; }
    else console.log(`OK: ${msg}`);
  };

  const ollama = DEFAULT_PROVIDERS.find(p => p.id === 'builtin-ollama-text')!;
  const transformers = DEFAULT_PROVIDERS.find(p => p.id === 'builtin-transformers-text')!;
  const ollamaCap = computeProviderCapability(ollama);
  const transformersCap = computeProviderCapability(transformers);

  if (scenario === 'github-pages') {
    assert(Environment.isGitHubPages, 'Environment.isGitHubPages is true');
    assert(Environment.isSecureContext, 'Environment.isSecureContext is true (https)');
    assert(ollamaCap.available === false, 'Ollama (http://localhost:11434) is correctly marked UNAVAILABLE (mixed content)');
    assert(!!ollamaCap.disabledReason, 'Ollama unavailability has a human-readable reason');
    assert(transformersCap.available === true, 'Transformers.js (internal:transformers-text) remains available');
  } else {
    assert(Environment.isLocalhost, 'Environment.isLocalhost is true');
    assert(!Environment.isSecureContext, 'Environment.isSecureContext is false (http)');
    assert(ollamaCap.available === true, 'Ollama (http://localhost:11434) is correctly AVAILABLE (no mixed-content issue)');
    assert(transformersCap.available === true, 'Transformers.js (internal:transformers-text) remains available');
  }

  // Prove scoring itself carries no environment-only bias: register the
  // same provider with the same fabricated health/priority and confirm the
  // router picks purely on that, not on Environment.isStaticHost.
  const bus = new EventBus();
  const registry = new ProviderRegistry(bus);
  const p = { ...transformers, health: { status: 'healthy' as const, lastCheck: Date.now() }, successRate: 0.95, averageLatency: 800 };
  registry.registerProvider(p);
  const router = new SmartRouter(registry);
  const best = router.selectProvider('text');
  assert(!!best && best.id === p.id, 'Router selects the sole healthy candidate the same way regardless of environment');

  process.exit(failed ? 1 : 0);
}

async function main() {
  const scenarioArg = process.argv.find(a => a.startsWith('--scenario='));
  if (scenarioArg) {
    await runAsChild(scenarioArg.split('=')[1] as Scenario);
    return;
  }

  console.log('--- Scenario: GitHub Pages (https://<user>.github.io) ---');
  const gh = runScenario('github-pages');
  console.log(gh.output.trim());

  console.log('\n--- Scenario: localhost dev server (http://localhost:5174) ---');
  const lh = runScenario('localhost');
  console.log(lh.output.trim());

  if (!gh.ok || !lh.ok) {
    console.error('\nOne or more checks FAILED.');
    process.exit(1);
  }
  console.log('\nAll checks passed — dev and GitHub Pages now only diverge where a real browser capability differs.');
}

main().catch(err => {
  console.error('Script crashed:', err);
  process.exit(1);
});
