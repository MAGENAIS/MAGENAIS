/**
 * HealthCooldown — Phase 3b of the MAGENAIS improvement plan.
 *
 * ROOT CAUSE (Phase 1 audit finding): `HealthMonitor` re-checked every
 * enabled provider on the same fixed 60s interval regardless of outcome —
 * a provider returning 401/403/404 (a bad key, or a model that doesn't
 * exist) got retried exactly as often as a healthy one, and worse,
 * `ProviderManager.callWithFallback`/`callVision` also happily included it
 * in every real request's race, burning a slot (and up to its full
 * `timeoutMs`) on a call that was certain to fail again in the exact same
 * way. Neither path had any memory of "this failed last time for a reason
 * that won't have changed by the next request."
 *
 * This module is the single source of truth both paths now share:
 *   1. classifyFailure() turns a raw error message into a category —
 *      auth/not_found/rate_limited/timeout/network/other.
 *   2. computeCooldownMs() maps (category, consecutive failure count) to
 *      how long to leave the provider alone, escalating on repeat failures
 *      of the same kind and capped at MAX_COOLDOWN_MS.
 *   3. isInCooldown()/cooldownRemainingLabel() let callers check/display
 *      current state.
 * ProviderRegistry.updateHealth() (the one place both Manager.ts's real
 * call outcomes and Health.ts's periodic checks already report through)
 * applies this on every failure/success — see its updated doc comment.
 */
import { ProviderHealth } from './types';

export type FailureCategory = 'auth' | 'not_found' | 'rate_limited' | 'timeout' | 'network' | 'other';

/**
 * Classifies a thrown error's message into a failure category. Adapters in
 * this codebase consistently format HTTP failures as `HTTP <status>: ...`
 * (see BaseAdapter-derived adapters' fetchWithRetry callers) — that's
 * parsed first since it's the most reliable signal; a handful of substring
 * fallbacks cover errors that never went through an HTTP response at all
 * (a genuine network failure, or Manager.ts's own withTimeout() message).
 */
export function classifyFailure(message: string | undefined): FailureCategory {
  const text = message || '';
  const httpMatch = text.match(/HTTP (\d{3})/);
  const code = httpMatch ? parseInt(httpMatch[1], 10) : null;

  if (code === 401 || code === 403 || /unauthorized|forbidden|invalid api key|bad credentials|incorrect api key/i.test(text)) {
    return 'auth';
  }
  if (code === 404 || /not found|no such model|model[^.]*does not exist|unknown model/i.test(text)) {
    return 'not_found';
  }
  if (code === 429 || /rate.?limit|too many requests|quota exceeded/i.test(text)) {
    return 'rate_limited';
  }
  if (/timed out|timeout/i.test(text)) {
    return 'timeout';
  }
  if (code !== null && code >= 500) {
    // Server-side failure — treat like a network blip: not the person's
    // fault, worth a short retry window rather than a long auth-style one.
    return 'network';
  }
  if (/cors|failed to fetch|network|err_|dns/i.test(text)) {
    return 'network';
  }
  return 'other';
}

/**
 * Base cooldown per category, before escalation. Auth/not_found are long
 * by default because retrying a bad key or a nonexistent model on the very
 * next request is guaranteed to fail the same way — there's no "maybe it
 * recovers" case like there is for a timeout or transient network blip.
 */
const BASE_COOLDOWN_MS: Record<FailureCategory, number> = {
  auth: 10 * 60 * 1000,
  not_found: 10 * 60 * 1000,
  rate_limited: 2 * 60 * 1000,
  timeout: 30 * 1000,
  network: 30 * 1000,
  other: 60 * 1000,
};

/** Absolute ceiling regardless of category or how many times it's failed in a row. */
const MAX_COOLDOWN_MS = 15 * 60 * 1000;

/**
 * Cooldown duration for the Nth consecutive failure of a given category —
 * doubles per repeat (1x, 2x, 4x, 8x, ...) so a provider that keeps failing
 * the same way gets left alone for progressively longer, capped at
 * MAX_COOLDOWN_MS so a single provider can never be sidelined indefinitely
 * without a person having a chance to notice and fix it.
 */
export function computeCooldownMs(category: FailureCategory, consecutiveFailures: number): number {
  const base = BASE_COOLDOWN_MS[category];
  const streak = Math.max(1, consecutiveFailures);
  const scaled = base * Math.pow(2, streak - 1);
  return Math.min(scaled, MAX_COOLDOWN_MS);
}

export function isInCooldown(health?: ProviderHealth): boolean {
  return !!health?.cooldownUntil && health.cooldownUntil > Date.now();
}

/** Human-readable "Xs"/"Xmin" remaining, or null if not currently in cooldown. */
export function cooldownRemainingLabel(health?: ProviderHealth): string | null {
  if (!isInCooldown(health)) return null;
  const ms = health!.cooldownUntil! - Date.now();
  const secs = Math.ceil(ms / 1000);
  return secs < 60 ? `${secs}s` : `${Math.ceil(secs / 60)}min`;
}

const CATEGORY_LABEL: Record<FailureCategory, string> = {
  auth: 'an authentication failure (bad/missing API key)',
  not_found: 'a missing/invalid model',
  rate_limited: 'rate limiting',
  timeout: 'repeated timeouts',
  network: 'a network/connectivity failure',
  other: 'repeated failures',
};

export function cooldownReasonLabel(category: FailureCategory): string {
  return CATEGORY_LABEL[category];
}

/**
 * Whether this category is expected to resolve on its own with the exact
 * same configuration (rate limits ease up, a network blip passes, a
 * server recovers) — as opposed to auth/not_found/other, which are
 * certain to fail again identically until a person actually changes the
 * provider's configuration. Both kinds still use the skip mechanism above
 * (isInCooldown) to avoid hammering a known-bad candidate on every single
 * request, but only transient ones should ever be *displayed* as "cooling
 * down (Xmin left)" — showing a countdown for a bad API key implies it'll
 * just start working again once the timer runs out, which isn't true and
 * is actively misleading. See SettingsModal.ts's friendlyStatus() and the
 * provider row's cooldown badge for where this is used.
 */
export function isTransientCategory(category: FailureCategory): boolean {
  return category === 'rate_limited' || category === 'timeout' || category === 'network';
}
