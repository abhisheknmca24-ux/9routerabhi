import { type Logger } from '../types/logger.types.js';
import {
  type FailureType,
  type ProviderScore,
  STATUS_TO_FAILURE,
  ERROR_CODE_TO_FAILURE,
} from '../types/routing.types.js';

export interface ProviderHealthRecord {
  /** provider ID */
  providerId: string;
  /** Total requests routed */
  totalRequests: number;
  /** Successful requests */
  successes: number;
  /** Failed requests */
  failures: number;
  /** Consecutive failures (reset on success) */
  consecutiveFailures: number;
  /** Latency samples (rolling window, max 100) */
  latencies: number[];
  /** Computed average latency */
  avgLatency: number;
  /** Recent failure types (rolling window, max 50) */
  recentFailures: FailureType[];
  /** When the provider was last used */
  lastUsed: number | null;
  /** Whether provider is disabled by auth failure */
  authDisabled: boolean;
  /** ISO timestamp of auth disable, if applicable */
  authDisabledAt: string | null;
}

export const DEFAULT_HEALTH_RECORD: Omit<ProviderHealthRecord, 'providerId'> = {
  totalRequests: 0,
  successes: 0,
  failures: 0,
  consecutiveFailures: 0,
  latencies: [],
  avgLatency: 0,
  recentFailures: [],
  lastUsed: null,
  authDisabled: false,
  authDisabledAt: null,
};

export class ProviderHealthTracker {
  private readonly records = new Map<string, ProviderHealthRecord>();

  constructor(private readonly logger: Logger) {}

  /** Get or create a health record for a provider */
  getOrCreate(providerId: string): ProviderHealthRecord {
    if (!this.records.has(providerId)) {
      this.records.set(providerId, { providerId, ...DEFAULT_HEALTH_RECORD });
    }
    return this.records.get(providerId)!;
  }

  /** Get raw record */
  get(providerId: string): ProviderHealthRecord | undefined {
    return this.records.get(providerId);
  }

  /** Record a successful request */
  recordSuccess(providerId: string, latencyMs: number): void {
    const rec = this.getOrCreate(providerId);
    rec.totalRequests++;
    rec.successes++;
    rec.consecutiveFailures = 0;
    rec.lastUsed = Date.now();

    rec.latencies.push(latencyMs);
    if (rec.latencies.length > 100) rec.latencies.shift();
    rec.avgLatency = rec.latencies.reduce((a, b) => a + b, 0) / rec.latencies.length;

    this.logger.debug(`Health: ${providerId} success`, { latency: latencyMs, avgLatency: rec.avgLatency });
  }

  /** Record a failure with status/error classification */
  recordFailure(providerId: string, statusOrError: number | string): FailureType {
    const rec = this.getOrCreate(providerId);
    rec.totalRequests++;
    rec.failures++;
    rec.consecutiveFailures++;
    rec.lastUsed = Date.now();

    // Classify the failure
    const failureType = this._classify(statusOrError);

    rec.recentFailures.push(failureType);
    if (rec.recentFailures.length > 50) rec.recentFailures.shift();

    this.logger.warn(`Health: ${providerId} failure`, {
      type: failureType,
      consecutiveFailures: rec.consecutiveFailures,
      totalFailures: rec.failures,
    });

    // Auto-disable provider on auth failure
    if (failureType === 'auth_failure') {
      rec.authDisabled = true;
      rec.authDisabledAt = new Date().toISOString();
      this.logger.error(`Health: ${providerId} disabled due to auth failure`);
    }

    return failureType;
  }

  /** Re-enable a provider that was auth-disabled */
  reenable(providerId: string): void {
    const rec = this.records.get(providerId);
    if (rec) {
      rec.authDisabled = false;
      rec.authDisabledAt = null;
      rec.consecutiveFailures = 0;
    }
  }

  /** Calculate a composite health score (0.0 – 1.0) */
  getScore(providerId: string): ProviderScore {
    const rec = this.getOrCreate(providerId);
    const total = rec.totalRequests || 1;

    // Success rate: recent successes / total
    const successRate = rec.successes / total;

    // Latency score: lower is better, normalized against 10s cap
    const latencyScore = Math.max(0, 1 - (rec.avgLatency / 10000));

    // Error penalty: reduce score for recent failures
    const recentErrorPenalty = Math.min(1, rec.recentFailures.length / 20);

    // Consecutive failure penalty
    const consecutivePenalty = Math.min(1, rec.consecutiveFailures / 10);

    // Auth disabled: score = 0
    if (rec.authDisabled) {
      return {
        providerId,
        healthScore: 0,
        successRate: 0,
        avgLatencyMs: rec.avgLatency,
        totalRequests: rec.totalRequests,
        recentErrors: rec.recentFailures.length,
        consecutiveFailures: rec.consecutiveFailures,
        status: 'auth_disabled',
      };
    }

    // Composite score: weighted combination
    const healthScore = Math.max(0, Math.min(1,
      (successRate * 0.40) +
      (latencyScore * 0.25) +
      ((1 - recentErrorPenalty) * 0.20) +
      ((1 - consecutivePenalty) * 0.15)
    ));

    let status: string;
    if (rec.consecutiveFailures >= 5) status = 'critical';
    else if (rec.consecutiveFailures >= 3) status = 'degraded';
    else if (rec.consecutiveFailures >= 1) status = 'unstable';
    else status = 'healthy';

    return {
      providerId,
      healthScore: Math.round(healthScore * 100) / 100,
      successRate: Math.round(successRate * 100) / 100,
      avgLatencyMs: rec.avgLatency,
      totalRequests: rec.totalRequests,
      recentErrors: rec.recentFailures.length,
      consecutiveFailures: rec.consecutiveFailures,
      status,
    };
  }

  /** Get scores for all tracked providers */
  getAllScores(): ProviderScore[] {
    const ids = new Set(this.records.keys());
    return Array.from(ids)
      .map(id => this.getScore(id))
      .sort((a, b) => b.healthScore - a.healthScore);
  }

  /** Get scored + ranked provider order for a given set */
  getRankedProviders(providerIds: string[]): string[] {
    const scored = providerIds
      .map(id => ({ id, score: this.getScore(id) }))
      .filter(s => s.score.healthScore > 0);

    // Sort by score descending, then by total requests (experience) desc
    scored.sort((a, b) => {
      const scoreDiff = b.score.healthScore - a.score.healthScore;
      if (Math.abs(scoreDiff) > 0.01) return scoreDiff > 0 ? 1 : -1;
      return b.score.totalRequests - a.score.totalRequests;
    });

    return scored.map(s => s.id);
  }

  /** Reset all health data */
  reset(): void {
    this.records.clear();
    this.logger.info('Health tracker reset');
  }

  /** Classify a status code or error string into a FailureType */
  private _classify(statusOrError: number | string): FailureType {
    if (typeof statusOrError === 'number') {
      return STATUS_TO_FAILURE[statusOrError] || 'unknown';
    }
    return ERROR_CODE_TO_FAILURE[statusOrError] || 'unknown';
  }
}
