// Verifies the one-time migration in registry/Manager.ts's loadProviders()
// that corrects Puter's three Vision entries for browsers that already
// persisted them from an EARLIER app version — back when they were
// enabled:true at priority 45-47. Editing defaultProviders.ts alone (which
// now ships enabled:false, priority 90-92) only affects fresh installs;
// this migration is what makes existing installs actually pick up the
// correction too, exactly once, without fighting a genuine later
// re-enable by the person using the app.
//
// Run manually with:
//   npx tsx scripts/verify-puter-vision-deprioritize-migration.ts
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
function check(label: string, cond: boolean) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failed = true;
}

async function main() {
  const namespace = 'magenais-puter-vision-migration-test';
  const bus = new EventBus();
  const providerPersistence = new Persistence({ type: 'localStorage', namespace: `${namespace}:providers` });

  const puterVisionIds = ['builtin-puter-vision', 'builtin-puter-vision-claude', 'builtin-puter-vision-gemini'];
  const staleDefaults = DEFAULT_PROVIDERS.filter((p) => puterVisionIds.includes(p.id));
  check('sanity: found all 3 Puter vision defaults in DEFAULT_PROVIDERS', staleDefaults.length === 3);

  // Simulate exactly the reported bug: a browser that seeded these three
  // rows back when they shipped enabled:true, priority 45/46/47 — i.e.
  // stored data an EARLIER app version wrote, now stale relative to the
  // current defaultProviders.ts (enabled:false, priority 90/91/92).
  const staleStored = DEFAULT_PROVIDERS.map((p) => {
    if (p.id === 'builtin-puter-vision') return { ...p, enabled: true, priority: 45 };
    if (p.id === 'builtin-puter-vision-claude') return { ...p, enabled: true, priority: 46 };
    if (p.id === 'builtin-puter-vision-gemini') return { ...p, enabled: true, priority: 47 };
    return p;
  });
  await providerPersistence.save({
    version: 2,
    providers: staleStored,
    seededDefaultIds: DEFAULT_PROVIDERS.map((p) => p.id),
    // Deliberately no puterVisionDeprioritizedV1 key — matches a real
    // pre-migration browser, which has never seen this field.
  });

  // --- First load after the fix ships: migration should fire ---
  const registry1 = new ProviderRegistry(bus);
  const manager1 = new ProviderManager(registry1, providerPersistence, bus);
  await manager1.loadProviders(DEFAULT_PROVIDERS);

  const afterMigration = registry1.getAllProviders().filter((p) => puterVisionIds.includes(p.id));
  check('migration disabled all 3 Puter vision entries', afterMigration.every((p) => p.enabled === false));
  check('migration moved all 3 to priority >= 90', afterMigration.every((p) => (p.priority ?? 0) >= 90));

  // --- Person explicitly re-enables one afterward (their real choice) ---
  const toReEnable = registry1.getAllProviders().find((p) => p.id === 'builtin-puter-vision')!;
  toReEnable.enabled = true;
  registry1.updateProvider(toReEnable.id, { enabled: true });
  await manager1.saveProviders();

  // --- Second load (e.g. next page refresh): must NOT fight that choice ---
  const registry2 = new ProviderRegistry(bus);
  const manager2 = new ProviderManager(registry2, providerPersistence, bus);
  await manager2.loadProviders(DEFAULT_PROVIDERS);
  const reEnabled = registry2.getAllProviders().find((p) => p.id === 'builtin-puter-vision')!;
  check('a genuine later re-enable by the person survives the next load (migration only ran once)', reEnabled.enabled === true);
  const stillDisabled = registry2.getAllProviders().find((p) => p.id === 'builtin-puter-vision-claude')!;
  check('the two NOT re-enabled by the person stay disabled', stillDisabled.enabled === false);

  console.log(failed ? '\nSome checks FAILED.' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
