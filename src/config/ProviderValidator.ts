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
