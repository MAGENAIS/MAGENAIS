import { ProviderRegistry } from './registry/Registry';
import { ProviderConfig, ProviderScore, ProviderType, ProviderHealth } from './types';
import { Logger } from '../core/Logger';

export interface RouterOptions {
  // Weights for scoring
  priorityWeight?: number;
  healthWeight?: number;
  latencyWeight?: number;
  successRateWeight?: number;
  costWeight?: number;
  quotaWeight?: number;
  // Minimum health status to consider
  minHealth?: 'healthy' | 'degraded' | 'unknown';
}

type ResolvedRouterOptions = Required<RouterOptions>;

export class SmartRouter {
  private registry: ProviderRegistry;
  private options: ResolvedRouterOptions;

  constructor(registry: ProviderRegistry, options: RouterOptions = {}) {
    this.registry = registry;
    this.options = {
      priorityWeight: 1.0,
      healthWeight: 1.0,
      // ROOT CAUSE FIX (requirement #1 — autonomous priority by real
      // performance): raised from 0.8 now that ProviderManager actually
      // feeds real per-call latency into `averageLatency` (see
      // ProviderManager.recordLiveOutcome) instead of that field being
      // populated only by an occasional background ping. Latency now
      // carries roughly as much weight as the static `priority` number,
      // so a provider that's proven itself fast in actual use can outrank
      // a merely well-positioned one, and a provider that's proven itself
      // slow sinks — without anyone hand-editing priorities.
      latencyWeight: 1.2,
      successRateWeight: 0.9,
      costWeight: 0.5,
      quotaWeight: 0.3,
      minHealth: 'degraded',
      ...options,
    };
  }

  /**
   * Select the best provider for a given type, based on current health and scoring.
   * Returns the provider config, or null if none available.
   */
  selectProvider(type: ProviderType, excludeIds: string[] = []): ProviderConfig | null {
    const candidates = this.registry.getProviders(type, true)
      .filter(p => !excludeIds.includes(p.id));

    if (candidates.length === 0) return null;

    // Score each candidate
    const scored = candidates.map(p => this.scoreProvider(p));
    // Sort descending by score
    scored.sort((a, b) => b.score - a.score);

    if (scored.length === 0) return null;
    const best = scored[0];

    Logger.debug(`Router selected provider '${best.providerId}' with score ${best.score.toFixed(2)}`);
    return this.registry.getProvider(best.providerId) || null;
  }

  /**
   * Score a single provider.
   */
  private scoreProvider(provider: ProviderConfig): ProviderScore {
    const health = provider.health || { status: 'unknown', lastCheck: 0 };
    const healthScore = this.healthToScore(health.status);

    // Normalize priority (lower priority = higher score, but we invert: priority 1 => 100, priority 100 => 1)
    const priorityScore = Math.max(0, 100 - (provider.priority || 50));

    // Normalize latency. ROOT CAUSE FIX: the old 0-5000ms range was far too
    // narrow relative to real observed latencies in this app — a browser
    // model's cold-start download alone can legitimately take 30-120
    // seconds (see WebLLM/Transformers `timeoutMs`), so under the old
    // scale anything past 5s already scored a flat 0 and couldn't be
    // penalized any further relative to, say, a 90s outlier. Widened to a
    // 12s reference ceiling (fast cloud APIs typically answer in well
    // under 3s, so they still score high) with a graceful floor rather
    // than clamping straight to 0, so an occasional slow-but-not-hopeless
    // response doesn't swing the score as violently as a genuine timeout.
    const latency = provider.averageLatency || 1500; // unmeasured yet — assume a modest, not-great-not-bad latency rather than rewarding the unknown
    const latencyScore = Math.max(0, 100 - (latency / 12000) * 100);

    // Success rate: 0-1 -> 0-100
    const successScore = (provider.successRate || 0.8) * 100;

    // Cost: lower is better (0-1, we assume costPerUnit 0-10)
    const cost = provider.costPerUnit || 1;
    const costScore = Math.max(0, 100 - (cost / 10) * 100);

    // Quota: remaining percentage (0-100)
    const quotaScore = Math.min(100, (provider.quotaRemaining || 0) * 100);

    const weights = this.options;
    const totalWeight = weights.priorityWeight + weights.healthWeight + weights.latencyWeight +
                        weights.successRateWeight + weights.costWeight + weights.quotaWeight;

    const score = (
      (priorityScore * weights.priorityWeight) +
      (healthScore * weights.healthWeight) +
      (latencyScore * weights.latencyWeight) +
      (successScore * weights.successRateWeight) +
      (costScore * weights.costWeight) +
      (quotaScore * weights.quotaWeight)
    ) / totalWeight;

    return {
      providerId: provider.id,
      score,
      details: {
        priority: priorityScore,
        health: healthScore,
        latency: latencyScore,
        successRate: successScore,
        cost: costScore,
        quota: quotaScore,
      },
    };
  }

  private healthToScore(status: ProviderHealth['status']): number {
    switch (status) {
      case 'healthy': return 100;
      case 'degraded': return 60;
      case 'unhealthy': return 10;
      default: return 50;
    }
  }

  /**
   * Get a list of providers sorted by score (useful for fallback chains).
   */
  getSortedProviders(type: ProviderType): ProviderConfig[] {
    const candidates = this.registry.getProviders(type, true);
    const scored = candidates.map(p => ({ provider: p, score: this.scoreProvider(p) }));
    scored.sort((a, b) => b.score.score - a.score.score);
    return scored.map(s => s.provider);
  }
}
