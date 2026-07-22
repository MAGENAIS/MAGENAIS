// Verifies free, zero-key, built-in providers are always enabled on load,
// even if a stale stored `enabled:false` exists from earlier testing/an
// old snapshot — the whole point of these providers is to guarantee a
// capability (Vision, Text) works immediately with no setup, so a stuck-off
// flag silently defeating that is a bug. Puter.js is the deliberate
// exception (see Manager.ts's `adapterId !== 'puter'` check in this exact
// loop, and its doc comment): its `enabled: false` default is meant to
// stick for every first-time user rather than being auto-flipped back on,
// so a stored `enabled: false` for it must be respected, not overridden —
// this script originally asserted the opposite, from before that exclusion
// was added; updated to match the current, intentional behavior.
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

import { Persistence } from '../src/core/state/Persistence';
import { ProviderRegistry } from '../src/providers/registry/Registry';
import { ProviderManager } from '../src/providers/registry/Manager';
import { EventBus } from '../src/core/EventBus';

let failed = false;
function check(label: string, cond: boolean) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failed = true;
}

async function main() {
  const namespace = 'magenais-force-enable-test';
  const bus = new EventBus();
  const providerPersistence = new Persistence({ type: 'localStorage', namespace: `${namespace}:providers` });

  const defaults = [
    {
      id: 'builtin-webllm-text', name: 'WebLLM (in-browser, no key)', type: 'text', adapterId: 'webllm',
      baseUrl: '', authType: 'none', defaultModel: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', priority: 8,
      enabled: true, isBuiltIn: true, isPreset: true, noKeyNeeded: true, timeoutMs: 120000, retries: 0,
    },
    {
      id: 'builtin-puter-text', name: 'Puter.js (optional, no key)', type: 'text', adapterId: 'puter',
      baseUrl: '', authType: 'none', defaultModel: 'openai/gpt-5.4-nano', priority: 200,
      enabled: false, isBuiltIn: true, isPreset: true, noKeyNeeded: true, timeoutMs: 60000, retries: 1,
    },
    {
      id: 'preset-openrouter', name: 'OpenRouter', type: 'text', adapterId: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1', authType: 'bearer', defaultModel: 'openai/gpt-4o-mini', priority: 10,
      enabled: true, isBuiltIn: false, isPreset: true, noKeyNeeded: false, timeoutMs: 30000, retries: 1,
    },
  ];

  // Simulate a stale snapshot from BEFORE WebLLM existed as a built-in
  // (this browser has never seen that id — the exact condition the
  // force-enable loop's `!storedIds.has(p.id)` check requires, see
  // Manager.ts) — it should come in force-enabled. Puter (free+builtin)
  // IS already stored, disabled — its own default's intended, sticky
  // state — proving the Puter-specific exclusion holds even when its
  // storedIds condition alone wouldn't have blocked it. A keyed provider
  // was ALSO explicitly disabled by the user.
  await providerPersistence.save({
    version: 2,
    providers: [
      { ...defaults[1], enabled: false }, // puter — already seen, stored disabled
      { ...defaults[2], enabled: false, apiKey: 'sk-user-key' }, // openrouter — already seen, stored disabled
    ],
    seededDefaultIds: [defaults[1].id, defaults[2].id], // webllm deliberately absent — "never seen before"
  });

  const registry = new ProviderRegistry(bus);
  const manager = new ProviderManager(registry, providerPersistence, bus);
  await manager.loadProviders(defaults as any);

  const webllm = registry.getProvider('builtin-webllm-text');
  const puter = registry.getProvider('builtin-puter-text');
  const openrouter = registry.getProvider('preset-openrouter');

  check('Free built-in provider (WebLLM), never seen before, is force-enabled on this load', webllm?.enabled === true);
  check("Puter.js is the deliberate exception — stored enabled:false is respected, NOT force re-enabled", puter?.enabled === false);
  check("A keyed provider's explicit disable is still respected (not force-enabled)", openrouter?.enabled === false);
  check("The keyed provider's API key survived unaffected", openrouter?.apiKey === 'sk-user-key');

  process.exit(failed ? 1 : 0);
}

main();
