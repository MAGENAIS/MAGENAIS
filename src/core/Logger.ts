type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LoggerConfig {
  level: LogLevel;
}

/**
 * PHASE 6 — structured provider-call logging. One consistent shape for
 * every provider call outcome, instead of each call site free-texting its
 * own message — see Logger.event() below and its call sites in
 * ProviderManager.raceForFirstSuccess.
 */
export interface ProviderCallEvent {
  requestId: string;
  provider: string;
  model?: string;
  /** Wall-clock time for this attempt, in ms. */
  latencyMs?: number;
  /** Token usage, when the adapter reported it — see BaseAdapter's optional `options.onUsage` hook. */
  tokens?: { prompt?: number; completion?: number; total?: number };
  /** True for the attempt that actually won the race and produced the response the person saw. */
  winner?: boolean;
  /** Present only for a failed attempt — see HealthCooldown.classifyFailure for the category this is drawn from. */
  failureReason?: string;
  /** Present when the adapter reported it — see BaseAdapter's optional `options.onRetry` hook. */
  retryCount?: number;
}

export class Logger {
  private static level: LogLevel = 'info';
  private static levels: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  static configure(level: LogLevel) {
    this.level = level;
  }

  static getLevel(): LogLevel {
    return this.level;
  }

  static debug(message: string, ...args: unknown[]) {
    this.log('debug', message, ...args);
  }

  static info(message: string, ...args: unknown[]) {
    this.log('info', message, ...args);
  }

  static warn(message: string, ...args: unknown[]) {
    this.log('warn', message, ...args);
  }

  static error(message: string, ...args: unknown[]) {
    this.log('error', message, ...args);
  }

  /**
   * Structured provider-call event — one consistent, greppable line shape
   * (`requestId=... provider=... model=... latency=...ms ...`) instead of
   * free text, so a person with the browser console open (or piping it
   * somewhere) can correlate every log line belonging to one request, and
   * a script can parse this reliably. Only emitted at 'debug' level or
   * above failures (a failed attempt always logs, even outside Debug Mode,
   * since that's exactly when someone needs the detail) — successful
   * attempts stay debug-only so normal use doesn't spam the console.
   */
  static event(e: ProviderCallEvent) {
    const isFailure = !!e.failureReason;
    if (!isFailure && this.levels['debug'] < this.levels[this.level]) return;

    const parts = [
      `requestId=${e.requestId}`,
      `provider="${e.provider}"`,
      e.model ? `model="${e.model}"` : null,
      e.latencyMs !== undefined ? `latency=${e.latencyMs}ms` : null,
      e.tokens?.total !== undefined ? `tokens=${e.tokens.total}${e.tokens.prompt !== undefined && e.tokens.completion !== undefined ? ` (${e.tokens.prompt} prompt + ${e.tokens.completion} completion)` : ''}` : null,
      e.retryCount !== undefined ? `retries=${e.retryCount}` : null,
      e.winner ? 'winner=true' : null,
      e.failureReason ? `failureReason="${e.failureReason}"` : null,
    ].filter((p): p is string => p !== null);

    const prefix = isFailure ? '[EVENT:FAIL]' : '[EVENT:OK]';
    console[isFailure ? 'warn' : 'log'](prefix, parts.join(' '));
  }

  /** Short, URL-safe correlation ID for one top-level provider call — see ProviderManager.callWithFallback/callVision. */
  static newRequestId(): string {
    return `req_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  private static log(level: LogLevel, message: string, ...args: unknown[]) {
    if (this.levels[level] < this.levels[this.level]) return;
    const prefix = `[${level.toUpperCase()}]`;
    console[level === 'debug' ? 'log' : level](prefix, message, ...args);
  }
}
