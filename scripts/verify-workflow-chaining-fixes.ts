import { GraphUtils } from '../src/workflows/Graph';
import type { Node } from '../src/workflows/types';

let failed = false;
function check(label: string, cond: boolean) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failed = true;
}

function mkNode(type: any, inputs: Record<string, any>): Node {
  return { id: 'n2', type, label: 'n2', config: {}, inputs, enabled: true } as any;
}

// 1) Image (blob:) -> Text: whole-value reference must NOT leak the raw blob URL.
{
  const outputs = new Map<string, any>([['step1', 'blob:http://localhost:5173/abc-123']]);
  const node = mkNode('text', { prompt: '${step1}' });
  const resolved = GraphUtils.resolveInputs(node, outputs, {});
  check(
    'Image->Text whole-value chaining does not leak the raw blob: URL as the prompt',
    typeof resolved.prompt === 'string' && !resolved.prompt.startsWith('blob:') && resolved.prompt.includes('media file')
  );
}

// 2) Image (blob:) -> Vision: media SHOULD pass through untouched (vision needs the actual image).
{
  const outputs = new Map<string, any>([['step1', 'blob:http://localhost:5173/abc-123']]);
  const node = mkNode('vision', { imageBase64: '${step1}' });
  const resolved = GraphUtils.resolveInputs(node, outputs, {});
  check('Image->Vision chaining still passes the real media reference through', resolved.imageBase64 === 'blob:http://localhost:5173/abc-123');
}

// 3) Embedded reference substitution (AgentsMode's {{previous}} -> ${prevId} translation relies on this).
{
  const outputs = new Map<string, any>([['step1', 'Paris is the capital of France.']]);
  const node = mkNode('text', { prompt: 'Summarize this: ${step1} Keep it short.' });
  const resolved = GraphUtils.resolveInputs(node, outputs, {});
  check(
    'Embedded ${ref} inside a larger prompt string is substituted correctly',
    resolved.prompt === 'Summarize this: Paris is the capital of France. Keep it short.'
  );
}

// 4) Embedded reference to a media output gets a safe placeholder, not a leaked URL, in a text-consuming node.
{
  const outputs = new Map<string, any>([['step1', 'blob:http://localhost:5173/xyz']]);
  const node = mkNode('text', { prompt: 'Describe: ${step1}' });
  const resolved = GraphUtils.resolveInputs(node, outputs, {});
  check(
    'Embedded media reference in a text prompt also gets a safe placeholder',
    !resolved.prompt.includes('blob:') && resolved.prompt.startsWith('Describe:')
  );
}

// 5) Plain text output chaining still works exactly as before (no regression).
{
  const outputs = new Map<string, any>([['step1', 'hello world']]);
  const node = mkNode('research', { query: '${step1}' });
  const resolved = GraphUtils.resolveInputs(node, outputs, {});
  check('Plain text whole-value chaining is unaffected', resolved.query === 'hello world');
}

process.exit(failed ? 1 : 0);
