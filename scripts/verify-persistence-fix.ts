// Runtime smoke test for the Priority-3 fix (provider persistence
// clobbering). Run manually with: npx tsx scripts/verify-persistence-fix.ts
//
// Simulates the real sequence that used to lose API keys:
//   1. Provider manager saves a provider (with an API key) to storage.
//   2. The user generates something -> Store dispatches ADD_HISTORY_ENTRY.
//   3. App "restarts" -> a fresh ProviderManager loads from storage.
// Before the fix, step 2 would blindly overwrite the whole shared
// localStorage blob with just AppState (whose `providers` field is always
// empty), so step 3 came back with zero saved providers/API keys.

// --- minimal in-memory localStorage polyfill (Node has no window/localStorage) ---
const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

import { Persistence } from '../src/core/state/Persistence';
import { Store } from '../src/core/state/Store';
import { ProviderRegistry } from '../src/providers/registry/Registry';
import { ProviderManager } from '../src/providers/registry/Manager';
import { EventBus } from '../src/core/EventBus';

async function main() {
  const namespace = 'magenais-test';
  const storeConfig = { type: 'localStorage' as const, namespace };
  const providerConfig = { type: 'localStorage' as const, namespace: `${namespace}:providers` };

  // --- "First launch" ---
  const bus1 = new EventBus();
  const sharedPersistence1 = new Persistence(storeConfig);
  const store1 = new Store(sharedPersistence1, bus1);
  await store1.load();

  const providerPersistence1 = new Persistence(providerConfig);
  const registry1 = new ProviderRegistry(bus1);
  const manager1 = new ProviderManager(registry1, providerPersistence1, bus1, sharedPersistence1);
  await manager1.loadProviders([
    { id: 'demo', name: 'Demo Provider', type: 'text', adapterId: 'openai-compatible',
      baseUrl: 'https://example.com', authType: 'bearer', authHeaderName: 'Authorization',
      defaultModel: 'demo-model', timeoutMs: 30000, retries: 1, priority: 50,
      enabled: true, isBuiltIn: true, isPreset: true, noKeyNeeded: false } as any,
  ]);

  // User sets an API key and saves (this is what SettingsModal does).
  registry1.updateProvider('demo', { apiKey: 'sk-secret-123' } as any);
  await manager1.saveProviders();

  // User clicks Generate -> a history entry gets dispatched (this used to
  // clobber the providers blob).
  store1.dispatch({ type: 'ADD_HISTORY_ENTRY', payload: { id: 'h1', ts: Date.now(), text: 'result' } });
  // dispatch's persist is fire-and-forget; give it a tick to flush.
  await new Promise(r => setTimeout(r, 20));

  // --- "App restart": brand-new instances reading the same localStorage ---
  const bus2 = new EventBus();
  const sharedPersistence2 = new Persistence(storeConfig);
  const providerPersistence2 = new Persistence(providerConfig);
  const registry2 = new ProviderRegistry(bus2);
  const manager2 = new ProviderManager(registry2, providerPersistence2, bus2, sharedPersistence2);
  await manager2.loadProviders([
    { id: 'demo', name: 'Demo Provider', type: 'text', adapterId: 'openai-compatible',
      baseUrl: 'https://example.com', authType: 'bearer', authHeaderName: 'Authorization',
      defaultModel: 'demo-model', timeoutMs: 30000, retries: 1, priority: 50,
      enabled: true, isBuiltIn: true, isPreset: true, noKeyNeeded: false } as any,
  ]);

  const restored = registry2.getProvider('demo');
  console.log('restored API key =', restored?.apiKey);

  const pass = restored?.apiKey === 'sk-secret-123';
  console.log(pass
    ? '\nPASS: API key survived a Store dispatch + simulated restart.'
    : '\nFAIL: API key was lost — persistence clobbering bug is still present.');
  process.exit(pass ? 0 : 1);
}

main();
