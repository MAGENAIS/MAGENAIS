// Verifies the fix for a bug report showing every OpenAI-compatible Vision
// provider failing — Groq Vision's "invalid base64 url", Mistral Pixtral's
// "Image content must be a URL... or base64 encoded image", Cerebras'
// "Image data could not be decoded". ROOT CAUSE: `input.imageBase64` is
// always a full data URL (e.g. "data:image/jpeg;base64,/9j/4AAQ...") by the
// time it reaches any adapter — VisionMode's canvas.toDataURL/FileReader
// both produce one. OpenAICompatibleAdapter.callText blindly re-wrapped it
// in a SECOND "data:image/jpeg;base64," prefix, producing a corrupted
// string no provider could decode. AnthropicAdapter, GeminiAdapter, and
// PuterAdapter all already handled this correctly — see their doc comments
// on imageBase64 handling for the reference pattern this fix now matches.
//
// Run manually with:
//   npx tsx scripts/verify-openai-compatible-vision-double-prefix-fix.ts
import { OpenAICompatibleAdapter } from '../src/providers/adapters/OpenAICompatibleAdapter';
import type { ProviderConfig } from '../src/providers/types';

let failed = false;
function check(label: string, cond: boolean) {
  console.log((cond ? 'PASS' : 'FAIL') + ': ' + label);
  if (!cond) failed = true;
}

async function main() {
  const provider: ProviderConfig = {
    id: 'test-groq-vision', name: 'Groq Vision', type: 'text', adapterId: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1', authType: 'bearer', apiKey: 'test-key',
    defaultModel: 'qwen/qwen3.6-27b', priority: 57, enabled: true, noKeyNeeded: false,
    isPreset: true, isBuiltIn: false, visionOnly: true, timeoutMs: 30000, retries: 0,
  };

  let capturedBody: any = null;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: 'A red bicycle leaning against a wall.' } }] }), { status: 200 });
  }) as typeof fetch;

  try {
    const adapter = new OpenAICompatibleAdapter();

    // The exact shape VisionMode/VisionNodeExecutor actually produce: a
    // COMPLETE data URL, not raw base64.
    const fullDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD';
    await adapter.callText(provider, { prompt: 'What is this?', imageBase64: fullDataUrl }, { mode: 'vision', model: provider.defaultModel });

    const sentUrl = capturedBody?.messages?.[0]?.content?.find((c: any) => c.type === 'image_url')?.image_url?.url;
    check('a full data URL input is sent through as-is, not double-wrapped', sentUrl === fullDataUrl);
    check('the sent URL does not contain a duplicated "data:image" prefix', (sentUrl?.match(/data:image/g) || []).length === 1);

    // Backward-compat: if some future/other caller ever passes RAW base64
    // (no data: prefix at all), it should still get wrapped exactly once —
    // this is the one case the original code's wrapping was actually meant
    // to handle, and must keep working.
    capturedBody = null;
    const rawBase64 = '/9j/4AAQSkZJRgABAQAAAQABAAD';
    await adapter.callText(provider, { prompt: 'What is this?', imageBase64: rawBase64 }, { mode: 'vision', model: provider.defaultModel });
    const sentUrl2 = capturedBody?.messages?.[0]?.content?.find((c: any) => c.type === 'image_url')?.image_url?.url;
    check('raw base64 (no data: prefix) still gets wrapped exactly once', sentUrl2 === `data:image/jpeg;base64,${rawBase64}`);
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log(failed ? '\nSome checks FAILED.' : '\nAll checks passed.');
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
