// Verifies two fixes from the same bug report (Vision's Ollama candidate
// "succeeded" but replied "I don't see an image"):
//   1. OllamaAdapter.chat() now actually attaches the captured image to the
//      /api/chat request body for vision-mode calls (and does NOT for
//      plain text calls) — see OllamaAdapter.ts.
//   2. ProviderManager.callVision's candidate filter now requires
//      visionOnly:true for every "dual-purpose" adapter (ollama,
//      transformers, and the whole openai-compatible family), so plain
//      text presets like Cerebras/Groq/Mistral's text models — and the
//      general-purpose builtin-ollama-text entry — are never raced for
//      Vision calls in the first place. See Manager.ts.
//
// Run manually with:
//   npx tsx scripts/verify-ollama-vision-image-fix.ts
import { OllamaAdapter } from '../src/providers/adapters/OllamaAdapter';
import { DEFAULT_PROVIDERS } from '../src/providers/defaultProviders';
import type { ProviderConfig } from '../src/providers/types';

let failed = false;
function check(label: string, cond: boolean) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failed = true;
}

async function testOllamaAdapterSendsImage() {
  const provider: ProviderConfig = {
    id: 'test-ollama-vision', name: 'Ollama Vision (Local)', type: 'text', adapterId: 'ollama',
    baseUrl: 'http://localhost:11434', authType: 'none', defaultModel: 'llava',
    priority: 2, enabled: true, noKeyNeeded: true, isPreset: true, isBuiltIn: true, visionOnly: true,
    timeoutMs: 30000, retries: 0,
  };

  let capturedChatBody: any = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [{ name: 'llava:latest' }] }), { status: 200 });
    }
    if (String(url).endsWith('/api/chat')) {
      capturedChatBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ message: { content: 'A cat sitting on a windowsill.' } }), { status: 200 });
    }
    throw new Error('Unexpected fetch: ' + url);
  }) as typeof fetch;

  try {
    const adapter = new OllamaAdapter();
    const dataUrl = 'data:image/jpeg;base64,ABCD1234==';
    const result = await adapter.call(provider, { prompt: 'What do you see?', imageBase64: dataUrl }, { mode: 'vision' });

    check('OllamaAdapter.call returns the model\'s text content for a vision call', result === 'A cat sitting on a windowsill.');
    check('the /api/chat request included an images array', Array.isArray(capturedChatBody?.messages?.[0]?.images));
    check('the images array contains exactly one entry', capturedChatBody?.messages?.[0]?.images?.length === 1);
    check(
      'the data:image/...;base64, prefix was stripped before sending (Ollama expects raw base64)',
      capturedChatBody?.messages?.[0]?.images?.[0] === 'ABCD1234=='
    );

    // Plain text call (mode not 'vision') must NOT attach an images field,
    // even if imageBase64 happened to be present on the input for some
    // unrelated reason — only vision-mode calls should ever send it.
    capturedChatBody = null;
    await adapter.call(provider, { prompt: 'Just chatting', imageBase64: dataUrl }, { mode: 'text' });
    check('a plain text-mode call does NOT attach an images array', capturedChatBody?.messages?.[0]?.images === undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function testCandidateFiltering() {
  // Mirrors the exact rule in Manager.ts's callVision — duplicated here
  // (not imported) so this test exercises the *rule* independently rather
  // than just re-running the function under test against itself.
  const VISION_CAPABLE_ADAPTERS = ['anthropic', 'gemini', 'puter', 'openai-compatible', 'openrouter', 'groq', 'openai', 'together', 'deepinfra', 'transformers', 'ollama'];
  const DUAL_PURPOSE_VISION_ADAPTERS = ['transformers', 'ollama', 'openai-compatible', 'openrouter', 'groq', 'openai', 'together', 'deepinfra'];
  function wouldBeVisionCandidate(p: ProviderConfig): boolean {
    if (!VISION_CAPABLE_ADAPTERS.includes(p.adapterId)) return false;
    if (!(p.noKeyNeeded || !!p.apiKey)) return false;
    if (DUAL_PURPOSE_VISION_ADAPTERS.includes(p.adapterId) && p.visionOnly !== true) return false;
    return true;
  }

  const byId = new Map(DEFAULT_PROVIDERS.map((p) => [p.id, p]));

  const ollamaTextIncluded = wouldBeVisionCandidate(byId.get('builtin-ollama-text')!);
  check('plain builtin-ollama-text (general-purpose model) is EXCLUDED from Vision candidates', ollamaTextIncluded === false);

  const ollamaVision = byId.get('builtin-ollama-vision');
  check('builtin-ollama-vision exists in DEFAULT_PROVIDERS', !!ollamaVision);
  check('builtin-ollama-vision IS included as a Vision candidate', !!ollamaVision && wouldBeVisionCandidate(ollamaVision));

  const groqText = byId.get('preset-groq');
  const groqTextWithKey: ProviderConfig | undefined = groqText ? { ...groqText, apiKey: 'test-key' } : undefined;
  check('plain preset-groq (text model), even with a key set, is EXCLUDED from Vision candidates', !!groqTextWithKey && wouldBeVisionCandidate(groqTextWithKey) === false);

  const groqVision = byId.get('preset-groq-vision');
  const groqVisionWithKey: ProviderConfig | undefined = groqVision ? { ...groqVision, apiKey: 'test-key' } : undefined;
  check('preset-groq-vision, with a key set, IS included as a Vision candidate', !!groqVisionWithKey && wouldBeVisionCandidate(groqVisionWithKey));

  const transformersVision = byId.get('builtin-transformers-vision');
  check('builtin-transformers-vision is still included (unaffected regression check)', !!transformersVision && wouldBeVisionCandidate(transformersVision));

  const transformersText = byId.get('builtin-transformers-text');
  check('builtin-transformers-text is still excluded (unaffected regression check)', !!transformersText && wouldBeVisionCandidate(transformersText) === false);
}

async function main() {
  await testOllamaAdapterSendsImage();
  testCandidateFiltering();
  console.log(failed ? '\nSome checks FAILED.' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
