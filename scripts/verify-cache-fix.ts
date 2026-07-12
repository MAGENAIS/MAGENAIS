// Runtime smoke test for the Priority-1 fix in src/workflows/Engine.ts.
// Not part of `npm test` (that harness's plain Node ESM resolver can't
// follow this codebase's extensionless internal imports — see
// PHASE_REPORT.md "Remaining issues"). Run manually with:
//   npx tsx scripts/verify-cache-fix.ts
import { WorkflowEngine } from '../src/workflows/Engine';
import { NodeRegistry } from '../src/workflows/Registry';

let callCount = 0;
const registry = new NodeRegistry();
registry.register({
  type: 'text',
  async execute(node: any) {
    callCount++;
    return `echo:${node.inputs?.prompt}`;
  },
});

function buildWorkflow(prompt: string) {
  return {
    id: 'temp-' + Date.now() + Math.random(),
    name: 'Text Generation',
    graph: {
      nodes: [
        {
          id: 'text1', // same hardcoded id every call, like TextMode.ts uses
          type: 'text' as const,
          label: 'Text Generator',
          config: { model: 'openai', temperature: 0.8 }, // unchanged between calls
          inputs: { prompt },
          enabled: true,
        },
      ],
      edges: [],
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function main() {
  const sharedCache = new Map<string, any>(); // same lifetime as Kernel's shared cache
  const engine = new WorkflowEngine({ registry, cache: sharedCache });

  const first = await engine.execute(buildWorkflow('first prompt') as any, { prompt: 'first prompt' });
  const second = await engine.execute(buildWorkflow('second prompt') as any, { prompt: 'second prompt' });
  // "Regenerate" click: identical prompt/config to the previous call. This
  // must also execute fresh (e.g. image generation should return a new
  // variation), not replay whatever was cached from an earlier identical
  // call — caching is opt-in only now, so this always re-runs.
  const third = await engine.execute(buildWorkflow('second prompt') as any, { prompt: 'second prompt' });

  console.log('first.finalOutput  =', first.finalOutput);
  console.log('second.finalOutput =', second.finalOutput);
  console.log('third.finalOutput  =', third.finalOutput, '(Regenerate, identical inputs to `second`)');
  console.log('executor call count =', callCount);

  const pass =
    first.finalOutput === 'echo:first prompt' &&
    second.finalOutput === 'echo:second prompt' &&
    third.finalOutput === 'echo:second prompt' &&
    callCount === 3;

  console.log(pass ? '\nPASS: second Generate click returns a fresh result, not the first click\'s cached output.'
                    : '\nFAIL: stale-cache bug is still present.');
  process.exit(pass ? 0 : 1);
}

main();
