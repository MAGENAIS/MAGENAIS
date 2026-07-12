// Verifies (without hitting any real network):
//  1) HuggingFaceAdapter now handles the 'research' pipeline type instead
//     of throwing "Unsupported Hugging Face pipeline type 'research'".
//  2) A stored provider pinned to the decommissioned GitHub Models Azure
//     endpoint gets auto-migrated to the current models.github.ai one.
//  3) DocNodeExecutor / DataNodeExecutor / GameGenNodeExecutor route their
//     provider calls through 'text' instead of the nonexistent
//     'doc'/'data'/'gamegen' provider types.
import { HuggingFaceAdapter } from '../src/providers/adapters/HuggingFaceAdapter';
import { ProviderConfig } from '../src/providers/types';

const store = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, v); },
  removeItem: (k: string) => { store.delete(k); },
};

let failed = false;
function check(label: string, cond: boolean) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failed = true;
}

async function testHFResearchPipeline() {
  const calls: any[] = [];
  (globalThis as any).fetch = async (url: string, init: any) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: 'synthesized answer' } }] }),
      text: async () => '',
    };
  };
  const adapter = new HuggingFaceAdapter();
  const provider: ProviderConfig = {
    id: 'preset-huggingface-research', name: 'Hugging Face (Research)', type: 'research',
    adapterId: 'huggingface', baseUrl: 'https://router.huggingface.co', authType: 'bearer',
    apiKey: 'hf_test', defaultModel: 'meta-llama/Llama-3.3-70B-Instruct', priority: 30,
    enabled: true, noKeyNeeded: false, isPreset: true, isBuiltIn: false,
    timeoutMs: 30000, retries: 1,
  } as any;
  try {
    const result = await adapter.call(provider, { prompt: 'test query' }, { mode: 'research' });
    check('HuggingFaceAdapter handles the research pipeline type (no longer throws "Unsupported...")', result === 'synthesized answer');
    check('HF research call hit the chat/completions endpoint (text pipeline reused)', calls[0]?.url.includes('/v1/chat/completions'));
  } catch (err: any) {
    check('HuggingFaceAdapter handles the research pipeline type (no longer throws "Unsupported...")', false);
    console.log('  error was:', err.message);
  }
}

async function testGitHubModelsMigration() {
  const { Persistence } = await import('../src/core/state/Persistence');
  const { ProviderRegistry } = await import('../src/providers/registry/Registry');
  const { ProviderManager } = await import('../src/providers/registry/Manager');
  const { EventBus } = await import('../src/core/EventBus');
  const { DEFAULT_PROVIDERS } = await import('../src/providers/defaultProviders');

  const namespace = 'magenais-migration-test';
  const bus = new EventBus();
  const providerPersistence = new Persistence({ type: 'localStorage', namespace: `${namespace}:providers` });

  // Simulate a pre-fix install: provider saved with the old, dead endpoint.
  await providerPersistence.save({
    version: 1,
    providers: [{
      id: 'preset-github-models', name: 'GitHub Models', type: 'text', adapterId: 'openai-compatible',
      baseUrl: 'https://models.inference.ai.azure.com', authType: 'bearer', apiKey: 'ghp_usersOwnToken',
      defaultModel: 'gpt-4o-mini', priority: 15, enabled: true, noKeyNeeded: false,
      isPreset: true, isBuiltIn: false, timeoutMs: 30000, retries: 1,
    }],
    seededDefaultIds: DEFAULT_PROVIDERS.map((p: any) => p.id),
  });

  const registry = new ProviderRegistry(bus);
  const manager = new ProviderManager(registry, providerPersistence, bus);
  await manager.loadProviders(DEFAULT_PROVIDERS as any);

  const migrated = registry.getProvider('preset-github-models');
  check('GitHub Models baseUrl migrated off the decommissioned Azure endpoint', migrated?.baseUrl === 'https://models.github.ai/inference');
  check("user's own API key was preserved through the migration", migrated?.apiKey === 'ghp_usersOwnToken');
}

async function testDocDataGameGenRouteThroughText() {
  const src = await import('fs/promises');
  const nodeTs = await src.readFile(new URL('../src/workflows/Node.ts', import.meta.url), 'utf8');
  check("DocNodeExecutor's summary path routes through 'text'", /callProvider\(node, \{ prompt: summaryPrompt \}, context, \{\}, 'text'\)/.test(nodeTs));
  check("DataNodeExecutor's AI-answer path routes through 'text'", /callProvider\(node, \{ prompt: analysisPrompt \}, context, \{\}, 'text'\)/.test(nodeTs));
  check("GameGenNodeExecutor routes through 'text'", /this\.callProvider\(node, \{ prompt \}, context, opts, 'text'\)/.test(nodeTs));
}

async function main() {
  await testHFResearchPipeline();
  await testGitHubModelsMigration();
  await testDocDataGameGenRouteThroughText();
  process.exit(failed ? 1 : 0);
}

main();
