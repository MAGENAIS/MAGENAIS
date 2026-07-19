import { ProviderType } from './types';

/**
 * CapabilityMap — Phase 9, item #8 "Provider Capability Validation".
 *
 * SCOPE DECISION: only adapters that are genuinely single-purpose (their
 * `call()` implementation does exactly one kind of thing, verified by
 * reading each file rather than guessed) are listed here. Adapters that
 * are intentionally generic or multi-purpose — 'openai-compatible' (any
 * OpenAI-shaped backend a person points it at), 'huggingface',
 * 'ollama'/'puter'/'anthropic'/'gemini'/'groq' (all genuinely multimodal
 * or multi-endpoint) — are deliberately left out, since a "mismatch"
 * against them isn't a real mismatch, it's just one of the many things
 * they can legitimately do.
 *
 * This is advisory only — see checkCapabilityMismatch's doc comment for
 * why it's surfaced as a warning in the provider editor rather than wired
 * into ProviderValidator's hard-fail path: a false positive in this map
 * would silently break an otherwise-working provider, which is a worse
 * outcome than an occasional missed warning.
 */
const KNOWN_SINGLE_PURPOSE_ADAPTERS: Record<string, ProviderType[]> = {
  'browser-speech': ['speech'],
  'internal-fallback': ['video'],
  'wikipedia': ['research'],
  'pollinations-free': ['image'],
  'elevenlabs': ['speech'],
  'playht': ['speech'],
  'deepgram': ['audio'],
  'assemblyai': ['audio'],
  'falai': ['image', 'video'],
  'replicate': ['image', 'video'],
  'webllm': ['text', 'coding'],
  // Transformers.js backs several genuinely different pipelines depending
  // on which preset provider row it's attached to (see defaultProviders.ts)
  // — every one of these is real, verified in TransformersAdapter.call()'s
  // own dispatch switch.
  'transformers': ['text', 'vision', 'audio', 'music', 'embeddings'],
};

/**
 * Returns a warning message if `type` is clearly outside what `adapterId`
 * is known to do, or null if there's nothing to warn about (including for
 * every adapter not in the map above — "unknown" is treated as "no
 * opinion", not as a mismatch).
 */
export function checkCapabilityMismatch(adapterId: string, type: ProviderType): string | null {
  const known = KNOWN_SINGLE_PURPOSE_ADAPTERS[adapterId];
  if (!known) return null;
  if (known.includes(type)) return null;
  return `"${adapterId}" only ever handles ${known.map(t => `"${t}"`).join(' / ')} — it won't do anything for a "${type}" request. Did you mean one of those instead?`;
}
