// Verifies free, zero-key, built-in providers (like Puter.js) are always
// enabled on load, even if a stale stored `enabled:false` exists from
// earlier testing/an old snapshot — the whole point of these providers is
// to guarantee a capability (Vision, Text) works immediately with no
// setup, so a stuck-off flag silently defeating that is a bug.
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
      id: 'builtin-puter-text', name: 'Puter.js (optional, no key)', type: 'text', adapterId: 'puter',
      baseUrl: '', authType: 'none', defaultModel: 'openai/gpt-5.4-nano', priority: 200,
      enabled: true, isBuiltIn: true, isPreset: true, noKeyNeeded: true, timeoutMs: 60000, retries: 1,
    },
    {
      id: 'preset-openrouter', name: 'OpenRouter', type: 'text', adapterId: 'openai-compatible',
      baseUrl: 'https://openrouter.ai/api/v1', authType: 'bearer', defaultModel: 'openai/gpt-4o-mini', priority: 10,
      enabled: true, isBuiltIn: false, isPreset: true, noKeyNeeded: false, timeoutMs: 30000, retries: 1,
    },
  ];

  // Simulate a stale snapshot: Puter (free+builtin) got disabled somehow,
  // and a keyed provider was ALSO explicitly disabled by the user.
  await providerPersistence.save({
    version: 2,
    providers: [
      { ...defaults[0], enabled: false },
      { ...defaults[1], enabled: false, apiKey: 'sk-user-key' },
    ],
    seededDefaultIds: defaults.map(p => p.id),
  });

  const registry = new ProviderRegistry(bus);
  const manager = new ProviderManager(registry, providerPersistence, bus);
  await manager.loadProviders(defaults as any);

  const puter = registry.getProvider('builtin-puter-text');
  const openrouter = registry.getProvider('preset-openrouter');

  check('Free built-in provider (Puter.js) is force re-enabled despite stored enabled:false', puter?.enabled === true);
  check("A keyed provider's explicit disable is still respected (not force-enabled)", openrouter?.enabled === false);
  check("The keyed provider's API key survived unaffected", openrouter?.apiKey === 'sk-user-key');

  process.exit(failed ? 1 : 0);
}

main();
