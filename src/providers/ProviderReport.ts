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
 */
export function formatAllFailedMessage(type: string, attempts: ProviderAttempt[]): string {
  const report = formatProviderReport(attempts);
  return (
    `No provider could complete this '${type}' request. Here's what was tried:\n${report}\n\n` +
    `Generation stops here because every available provider was skipped or failed — enable a local/browser option ` +
    `(Ollama, WebLLM) or add an API key for one of the providers above in Keys & Providers, then try again.`
  );
}
