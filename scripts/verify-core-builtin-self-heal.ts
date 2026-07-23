// Regression test for the reported bug: builtin-transformers-text was
// completely missing from Local Models on GitHub Pages, while
// builtin-transformers-vision was completely missing on localhost — each
// origin's persisted `stored` provider list had silently lost exactly one
// of the two rows (most likely an earlier accidental Delete during UI
// testing on each origin, which is independent per-origin browser state).
// Run manually with: npx tsx scripts/verify-core-builtin-self-heal.ts
//
// FIX: Manager.loadProviders now re-seeds any currently-valid "TRUE
// ZERO-SETUP DEFAULT" (noKeyNeeded && isBuiltIn && adapterId !== 'puter' —
// the exact same predicate the pre-existing force-enable loop already
// uses) that is completely ABSENT from the merged provider list, even on a
// browser that has seen/seeded it before. It deliberately does NOT touch a
// row that's merely disabled (present with enabled:false) — that's a real
// user choice and must still stick — and does NOT touch ordinary
// presets/keyed/custom providers, which keep the original
// "deleted-means-deleted" behavior.

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
import { DEFAULT_PROVIDERS } from '../src/providers/defaultProviders';

let failed = false;
function assert(cond: boolean, msg: string) {
  if (!cond) { console.error(`FAIL: ${msg}`); failed = true; }
  else console.log(`OK: ${msg}`);
}

async function main() {
  const namespace = 'magenais-selfheal-test';
  const providerConfig = { type: 'localStorage' as const, namespace: `${namespace}:providers` };

  // --- Scenario 1: normal first boot seeds everything, including both
  //     builtin-transformers-text and builtin-transformers-vision. ---
  {
    const bus = new EventBus();
    const persistence = new Persistence(providerConfig);
    const registry = new ProviderRegistry(bus);
    const manager = new ProviderManager(registry, persistence, bus);
    await manager.loadProviders(DEFAULT_PROVIDERS);
    assert(!!registry.getProvider('builtin-transformers-text'), 'Scenario 1 (fresh install): Transformers.js Text is present');
    assert(!!registry.getProvider('builtin-transformers-vision'), 'Scenario 1 (fresh install): Transformers.js Vision is present');
    await manager.saveProviders();
  }

  // --- Scenario 2: simulate a browser whose persisted state already had
  //     both ids seeded (a normal returning user), but at some point
  //     'builtin-transformers-text' was deleted (e.g. an accidental click
  //     on the provider row's DELETE button during testing) — matching
  //     what the GitHub Pages screenshot showed. ---
  {
    const namespace2 = 'magenais-selfheal-test-2';
    const persistence2 = new Persistence({ type: 'localStorage', namespace: `${namespace2}:providers` });
    const seededDefaultIds = DEFAULT_PROVIDERS.map(p => p.id);
    const storedProviders = DEFAULT_PROVIDERS
      .filter(p => p.id !== 'builtin-transformers-text') // simulate the deleted row
      .map(p => ({ ...p }));
    await persistence2.save({ providers: storedProviders, seededDefaultIds });

    const bus2 = new EventBus();
    const registry2 = new ProviderRegistry(bus2);
    const manager2 = new ProviderManager(registry2, persistence2, bus2);
    await manager2.loadProviders(DEFAULT_PROVIDERS);

    assert(
      !!registry2.getProvider('builtin-transformers-text'),
      'Scenario 2 (previously-deleted core built-in): Transformers.js Text is SELF-HEALED back'
    );
    assert(
      !!registry2.getProvider('builtin-transformers-vision'),
      'Scenario 2: Transformers.js Vision (never deleted) is still present'
    );
  }

  // --- Scenario 3: a genuinely disabled (not deleted) core built-in must
  //     stay disabled — self-heal must not fight a real user choice. ---
  {
    const namespace3 = 'magenais-selfheal-test-3';
    const persistence3 = new Persistence({ type: 'localStorage', namespace: `${namespace3}:providers` });
    const seededDefaultIds = DEFAULT_PROVIDERS.map(p => p.id);
    const storedProviders = DEFAULT_PROVIDERS.map(p =>
      p.id === 'builtin-transformers-text' ? { ...p, enabled: false } : { ...p }
    );
    await persistence3.save({ providers: storedProviders, seededDefaultIds });

    const bus3 = new EventBus();
    const registry3 = new ProviderRegistry(bus3);
    const manager3 = new ProviderManager(registry3, persistence3, bus3);
    await manager3.loadProviders(DEFAULT_PROVIDERS);

    const p = registry3.getProvider('builtin-transformers-text');
    assert(!!p, 'Scenario 3 (disabled, not deleted): Transformers.js Text is still present');
    assert(p?.enabled === false, 'Scenario 3: the user\'s disable choice is respected, NOT force-re-enabled');
  }

  // --- Scenario 4: an ordinary deleted PRESET (keyed, not zero-key) must
  //     stay deleted — self-heal must be scoped to true zero-key built-ins
  //     only, never resurrecting a deliberately-removed keyed provider. ---
  {
    const namespace4 = 'magenais-selfheal-test-4';
    const persistence4 = new Persistence({ type: 'localStorage', namespace: `${namespace4}:providers` });
    const keyedPreset = DEFAULT_PROVIDERS.find(p => p.isPreset && !p.noKeyNeeded)!;
    assert(!!keyedPreset, 'Sanity: at least one keyed preset exists in DEFAULT_PROVIDERS');
    const seededDefaultIds = DEFAULT_PROVIDERS.map(p => p.id);
    const storedProviders = DEFAULT_PROVIDERS.filter(p => p.id !== keyedPreset.id).map(p => ({ ...p }));
    await persistence4.save({ providers: storedProviders, seededDefaultIds });

    const bus4 = new EventBus();
    const registry4 = new ProviderRegistry(bus4);
    const manager4 = new ProviderManager(registry4, persistence4, bus4);
    await manager4.loadProviders(DEFAULT_PROVIDERS);

    assert(
      !registry4.getProvider(keyedPreset.id),
      `Scenario 4: deliberately-deleted keyed preset "${keyedPreset.name}" stays deleted (not resurrected)`
    );
  }

  if (failed) {
    console.error('\nOne or more checks FAILED.');
    process.exit(1);
  }
  console.log('\nAll checks passed.');
}

main().catch(err => {
  console.error('Script crashed:', err);
  process.exit(1);
});
