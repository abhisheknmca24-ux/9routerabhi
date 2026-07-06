import { type Logger } from '../types/logger.types.js';
import {
  type FailureType,
  type FailureAction,
  FAILURE_TO_ACTION,
} from '../types/routing.types.js';
import { type ProviderConfig, type ProvidersFile } from '../types/provider.types.js';
import { ProviderHealthTracker } from './provider-health-tracker.js';

export interface RoutingDecision {
  /** The selected provider to try */
  provider: ProviderConfig;
  /** How this provider ranks in the order */
  rank: number;
  /** Whether to failover if this one fails */
  canFailover: boolean;
}

export interface FailoverResult {
  /** Which provider to use */
  selected: string;
  /** All attempted providers (in order) */
  attempted: string[];
  /** Whether the chain has been exhausted */
  exhausted: boolean;
}

/**
 * Intelligent router that uses provider health scores, failure-type-specific
 * actions, and automatic provider reordering to make smart routing decisions.
 */
export class IntelligentRouter {
  constructor(
    private readonly healthTracker: ProviderHealthTracker,
    private readonly logger: Logger,
  ) {}

  /**
   * Get the best-ranked providers for routing.
   * Reorders providers based on health scores and excludes disabled/auth-failed ones.
   */
  getRoutingOrder(providers: ProvidersFile, model?: string): ProviderConfig[] {
    // Get healthy providers that support this model (or all if no model specified)
    const candidates = providers.providers.filter(p => {
      if (!p.enabled) return false;
      const score = this.healthTracker.getScore(p.id);
      if (score.status === 'auth_disabled') return false;
      if (model) {
        return p.models.some(m => m.includes(model) || m.includes(p.id));
      }
      return true;
    });

    // Rank by health score
    const rankedIds = this.healthTracker.getRankedProviders(candidates.map(p => p.id));

    // Return in ranked order
    const ranked = rankedIds
      .map(id => candidates.find(p => p.id === id)!)
      .filter(Boolean);

    this.logger.debug('Routing order', {
      priority: ranked.map(p => `${p.id}(score:${this.healthTracker.getScore(p.id).healthScore},lat:${this.healthTracker.getScore(p.id).avgLatencyMs}ms)`),
    });

    return ranked;
  }

  /**
   * Given a failure on a provider, determine the action and next provider.
   */
  handleFailure(
    failedProvider: string,
    statusOrError: number | string,
    providers: ProvidersFile,
    model?: string,
  ): { action: FailureAction; failoverTo?: ProviderConfig } {
    // Record the failure
    const failureType = this.healthTracker.recordFailure(failedProvider, statusOrError);
    const action = FAILURE_TO_ACTION[failureType];

    this.logger.warn(`Routing failure on ${failedProvider}`, {
      statusOrError,
      failureType,
      action,
      consecutiveFailures: this.healthTracker.get(failedProvider)?.consecutiveFailures,
    });

    // Determine if failover should happen
    if (action === 'disable_provider') {
      return { action: 'disable_provider' };
    }

    // Get next best provider
    const ranked = this.getRoutingOrder(providers, model);
    const next = ranked.find(p => p.id !== failedProvider);

    return { action, failoverTo: next };
  }

  /**
   * Record a successful response from a provider.
   */
  recordSuccess(providerId: string, latencyMs: number): void {
    this.healthTracker.recordSuccess(providerId, latencyMs);
  }

  /**
   * Get detailed health scores for all providers.
   */
  getProviderScores() {
    return this.healthTracker.getAllScores();
  }

  /**
   * Get the current health status summary.
   */
  getHealthSummary(): Record<string, {
    score: number;
    status: string;
    avgLatency: number;
    successRate: number;
    consecutiveFailures: number;
  }> {
    const summary: Record<string, {
      score: number;
      status: string;
      avgLatency: number;
      successRate: number;
      consecutiveFailures: number;
    }> = {};

    for (const score of this.healthTracker.getAllScores()) {
      summary[score.providerId] = {
        score: score.healthScore,
        status: score.status,
        avgLatency: score.avgLatencyMs,
        successRate: score.successRate,
        consecutiveFailures: score.consecutiveFailures,
      };
    }
    return summary;
  }
}
