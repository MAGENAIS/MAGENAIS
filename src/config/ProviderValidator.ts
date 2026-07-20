import { ProviderConfig } from '../providers/types';

/**
 * Validates a provider configuration before it's used to make a network call.
 *
 * ROOT CAUSE (Priority 4 — silent/unclear provider failures): this class
 * previously validated an entirely different, dead `Provider` interface
 * (from `./ProviderTypes`, with fields like `adapter`/`endpoint`/`timeout`/
 * `retry` that don't exist on the real `ProviderConfig` used everywhere
 * else) and was never imported or called by anything. There was no actual
 * pre-flight validation anywhere in the call path — a misconfigured
 * provider (empty base URL, zero timeout, missing required API key, no
 * registered adapter) would only surface as a raw, unhelpful fetch/adapter
 * error at call time, or would fail silently and simply move on to the
 * next fallback candidate with no explanation.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export class ProviderValidator {
  /**
   * Validate a provider's static configuration (shape/fields), independent
   * of whether its adapter is actually registered.
   */
  static validate(provider: ProviderConfig): ValidationResult {
    const errors: string[] = [];

    if (!provider.name || !provider.name.trim()) {
      errors.push('Provider name is required.');
    }
    if (!provider.adapterId || !provider.adapterId.trim()) {
      errors.push('Provider adapter is required.');
    }
    // Endpoint validation: most adapters need a base URL; a few (browser
    // speech, Puter, and other environment-provided adapters) legitimately
    // don't call out to a configured URL at all.
    const urlNotRequired = ['browser-speech', 'puter', 'internal-fallback'];
    if (!urlNotRequired.includes(provider.adapterId)) {
      if (!provider.baseUrl || !provider.baseUrl.trim()) {
        errors.push(`${provider.name || provider.id}: Base URL is required for this adapter.`);
      } else {
        try {
          // Relative/template URLs are allowed by some adapters, but
          // anything that looks absolute should be a well-formed URL.
          if (/^https?:\/\//i.test(provider.baseUrl)) {
            new URL(provider.baseUrl);
          }
        } catch {
          errors.push(`${provider.name || provider.id}: Base URL "${provider.baseUrl}" is not a valid URL.`);
        }
        // AUDIT FIX (Medium priority): OpenAICompatibleAdapter always appends its
        // own path suffix (e.g. '/chat/completions', '/audio/speech') to whatever
        // baseUrl is configured. If a user manually pastes a baseUrl that already
        // ends in one of those segments — an easy mistake when copying a URL from
        // a provider's own docs, which often show the full endpoint rather than
        // the API root — the adapter silently doubles the path (e.g.
        // '.../v1/responses' + '/chat/completions' => '.../v1/responses/chat/
        // completions', a URL that will never exist). Previously this surfaced
        // only as an opaque 404 with no indication of why. This check doesn't
        // change call behavior — it only adds an early, specific warning so the
        // real cause is visible instead of a bare "HTTP 404".
        const suspiciousSuffixes = ['/chat/completions', '/completions', '/responses', '/audio/speech', '/audio/transcriptions', '/images/generations'];
        const trimmedBaseUrl = provider.baseUrl.replace(/\/$/, '').toLowerCase();
        const suffixHit = suspiciousSuffixes.find(s => trimmedBaseUrl.endsWith(s));
        if (suffixHit) {
          errors.push(
            `${provider.name || provider.id}: Base URL "${provider.baseUrl}" already ends in "${suffixHit}", but this adapter appends its own path suffix on top of it, which will double the path. Set the Base URL to just the API root (e.g. "https://api.example.com/v1"), not the full endpoint.`
          );
        }
        // A few presets (Cloudflare Workers AI) ship with a placeholder
        // segment in their default Base URL that the person is instructed
        // (in the provider's Notes field) to replace with their own account
        // ID — easy to miss since Notes are easy to skip past. Left as-is,
        // the request still goes out and comes back as an opaque
        // provider-side 404/400 with no indication that the URL itself was
        // never actually finished being configured. ALL_CAPS_WITH_UNDERSCORES
        // segments are treated as placeholders — real path segments in
        // these adapters' URLs (account IDs, resource names) are never
        // shaped like that.
        const placeholderMatch = provider.baseUrl.match(/\/([A-Z][A-Z0-9_]{3,})(?:\/|$)/);
        if (placeholderMatch) {
          errors.push(
            `${provider.name || provider.id}: Base URL "${provider.baseUrl}" still contains a placeholder ("${placeholderMatch[1]}") that needs to be replaced with your actual value — check this provider's Notes field for what goes there.`
          );
        }
      }
    }
    // Same placeholder pattern, applied to provider.headers — e.g. PlayHT's
    // required X-User-ID header defaults to "YOUR_USER_ID" until edited.
    // Extra headers are legitimately free-form (any custom API could put
    // anything there), so this only flags the exact same ALL_CAPS
    // convention as above, not header values in general.
    if (provider.headers) {
      try {
        const parsed = typeof provider.headers === 'string' ? JSON.parse(provider.headers) : provider.headers;
        for (const [headerName, headerValue] of Object.entries(parsed || {})) {
          if (typeof headerValue === 'string' && /^[A-Z][A-Z0-9_]{3,}$/.test(headerValue)) {
            errors.push(
              `${provider.name || provider.id}: Header "${headerName}" still has its placeholder value ("${headerValue}") — check this provider's Notes field for what goes there.`
            );
          }
        }
      } catch {
        // Malformed headers JSON — not this check's job to report; whatever
        // tries to actually use it will surface a clearer error.
      }
    }
    if (provider.timeoutMs === undefined || provider.timeoutMs === null || provider.timeoutMs <= 0) {
      errors.push(`${provider.name || provider.id}: Timeout must be a positive number of milliseconds.`);
    }
    if (provider.retries === undefined || provider.retries === null || provider.retries < 0) {
      errors.push(`${provider.name || provider.id}: Retries cannot be negative.`);
    }
    if (!provider.noKeyNeeded && provider.authType !== 'none' && !provider.apiKey) {
      errors.push(`${provider.name || provider.id}: An API key is required for this provider (auth type "${provider.authType}").`);
    }
    if (provider.authType === 'header' && !provider.authHeaderName) {
      errors.push(`${provider.name || provider.id}: Header auth requires an auth header name.`);
    }
    if (provider.authType === 'query' && !provider.authQueryParam) {
      errors.push(`${provider.name || provider.id}: Query auth requires an auth query parameter name.`);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate that a provider is actually usable right now — its config is
   * well-formed AND it has a registered adapter implementation.
   */
  static validateForCall(provider: ProviderConfig, hasRegisteredAdapter: boolean): ValidationResult {
    const result = ProviderValidator.validate(provider);
    if (!hasRegisteredAdapter) {
      result.errors.push(
        `${provider.name || provider.id}: no adapter implementation is registered for adapterId "${provider.adapterId}".`
      );
    }
    return { valid: result.errors.length === 0, errors: result.errors };
  }
}
