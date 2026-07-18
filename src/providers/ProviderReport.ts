/**
 * Shared "Provider Report" formatting for the fallback chain.
 *
 * ROOT CAUSE (user-reported: "when providers fail I just get a wall of
 * text, no idea what actually happened or what to do about it"):
 * callWithFallback/callVision already tried every candidate provider in
 * priority order and already collected a per-provider reason when one was
 * skipped or failed — but that information was only ever joined into a
 * single flat string ("All 3 provider(s) for 'text' failed:\nOllama:
 * ...\nWebLLM: ..."). This module turns the same per-provider attempts into
 * the short ✓ / ⚠ checklist the app's design calls for, and (via
 * `summarizeReason`) collapses long raw error text into a short, scannable
 * label — "Missing API Key", "Not Installed", "Timeout", "Credits
 * exhausted" — so a first-time user can tell at a glance which providers
 * are simply not set up yet vs. genuinely broken, without changing any
 * function signatures or return types elsewhere in the app.
 */

export type ProviderAttemptStatus = 'ok' | 'skipped' | 'error';

export interface ProviderAttempt {
  name: string;
  status: ProviderAttemptStatus;
  detail?: string;
}

/**
 * Collapse a raw validation/error message into a short, human label.
 * Falls back to a trimmed version of the original message when nothing
 * more specific matches, so nothing is ever silently swallowed.
 */
export function summarizeReason(raw: string): string {
  const s = (raw || '').toLowerCase();
  if (s.includes('api key is required') || s.includes('an api key is required') || s.includes('missing') && s.includes('key')) {
    return 'Missing API Key';
  }
  if (s.includes('credit') || s.includes('quota') || s.includes('insufficient') || s.includes('exhausted') || s.includes('billing') || s.includes('no usage left') || s.includes('upgrade now')) {
    return 'Credits exhausted';
  }
  if (s.includes('429') || s.includes('rate') && s.includes('limit')) {
    return 'Rate limited';
  }
  if (s.includes('timed out') || s.includes('timeout')) {
    return 'Timeout';
  }
  if (s.includes('webgpu')) {
    return 'WebGPU unavailable';
  }
  if (s.includes('failed to load from cdn') || s.includes('cdn')) {
    return 'Not loaded';
  }
  if (s.includes("isn't pulled") || s.includes('model not found') || s.includes("model '") && s.includes('not found')) {
    return 'Model not installed';
  }
  if (s.includes('turnstile') || s.includes('bot-check') || s.includes('bot check')) {
    return 'Blocked (bot-check)';
  }
  if (s.includes('retired') || s.includes('deprecated') || s.includes('no longer serves')) {
    return 'Endpoint retired';
  }
  if (s.includes('econnrefused') || s.includes('failed to fetch') || s.includes('not installed') || s.includes('network')) {
    return 'Not installed / unreachable';
  }
  if (s.includes('401') || s.includes('unauthorized') || s.includes('invalid') && s.includes('key')) {
    return 'Invalid API Key';
  }
  if (s.includes('no adapter implementation')) {
    return 'Not supported';
  }
  // Fall back to a short version of whatever the adapter actually said.
  const trimmed = (raw || 'Unavailable').trim();
  return trimmed.length > 60 ? trimmed.slice(0, 57) + '…' : trimmed;
}

/**
 * PHASE 6 — meaningful recovery suggestions, one per summarizeReason()
 * label. Concrete and actionable rather than "check your settings" —
 * each one names the exact place to look (Keys & Providers, the
 * provider's own dashboard, a local service) and, where relevant, why.
 */
const RECOVERY_SUGGESTIONS: Record<string, string> = {
  'Missing API Key': 'add an API key for one of the providers above in Keys & Providers',
  'Invalid API Key': "double-check the affected provider's API key in Keys & Providers — it may be expired, revoked, or pasted incorrectly",
  'Credits exhausted': "add billing/credits on the provider's own dashboard, or switch to a different provider in Keys & Providers",
  'Rate limited': 'wait a short while before trying again, or enable a second provider as a fallback in Keys & Providers',
  'Timeout': "check your connection, or increase the affected provider's Timeout in Keys & Providers if it's usually just slow",
  'WebGPU unavailable': 'try a different browser/device with WebGPU support, or switch to a WASM/CPU-compatible local model',
  'Not loaded': "check your connection — this provider's library failed to load from its CDN",
  'Model not installed': "check the model name in Keys & Providers, or (for Ollama) run 'ollama pull <model>' first",
  'Blocked (bot-check)': 'this provider is blocking automated requests right now — try again later, or use a different provider',
  'Endpoint retired': "this provider's API has changed — check Keys & Providers for an updated endpoint, or switch providers",
  'Not installed / unreachable': 'make sure the local service (Ollama, etc.) is running, or check your connection',
  'Not supported': "this provider doesn't support this type of request — pick a different one in Keys & Providers",
};

/** Returns a recovery suggestion for a summarizeReason() label, or null if there's nothing more specific to say than the generic fallback. */
export function recoverySuggestionFor(label: string): string | null {
  return RECOVERY_SUGGESTIONS[label] || null;
}

/**
 * Render a list of attempts as the ✓ / ⚠ checklist.
 */
export function formatProviderReport(attempts: ProviderAttempt[]): string {
  if (attempts.length === 0) return '';
  return attempts
    .map(a => {
      if (a.status === 'ok') return `✓ ${a.name}`;
      return `⚠ ${a.name} (${summarizeReason(a.detail || 'unavailable')})`;
    })
    .join('\n');
}

/**
 * Build the message used when every candidate for a type failed — the
 * checklist plus one actionable closing line, instead of a bare stack of
 * raw error strings.
 *
 * PHASE 6: the closing line now reflects what actually went wrong instead
 * of always being the same generic "add an API key" text — e.g. if every
 * failure here was a timeout, the suggestion is about connectivity/timeout
 * settings, not a nudge to add a key that isn't the problem.
 */
export function formatAllFailedMessage(type: string, attempts: ProviderAttempt[]): string {
  const report = formatProviderReport(attempts);
  const failureLabels = attempts
    .filter(a => a.status !== 'ok')
    .map(a => summarizeReason(a.detail || 'unavailable'));
  const mostCommonLabel = mostCommon(failureLabels);
  const suggestion = mostCommonLabel ? recoverySuggestionFor(mostCommonLabel) : null;
  const closingLine = suggestion
    ? `Generation stops here because every available provider was skipped or failed — most were "${mostCommonLabel}", so try this: ${suggestion}.`
    : `Generation stops here because every available provider was skipped or failed — enable a local/browser option ` +
      `(Ollama, WebLLM) or add an API key for one of the providers above in Keys & Providers, then try again.`;
  return `No provider could complete this '${type}' request. Here's what was tried:\n${report}\n\n${closingLine}`;
}

/** Most frequent string in a list, ties broken by first occurrence — used to pick which failure category the closing suggestion should address. */
function mostCommon(items: string[]): string | null {
  if (items.length === 0) return null;
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) || 0) + 1);
  let best: string = items[0];
  let bestCount = 0;
  for (const item of items) {
    const count = counts.get(item)!;
    if (count > bestCount) { best = item; bestCount = count; }
  }
  return best;
}
