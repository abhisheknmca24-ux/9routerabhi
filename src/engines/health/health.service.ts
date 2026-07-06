import { type Logger } from '../../types/logger.types.js';
import { type ProviderHealthState } from '../../types/provider.types.js';
import { type HealthSummary, type HealthReportRequest, type HealthConfig } from '../../types/health.types.js';
import { ProviderStateRepository } from '../../repositories/provider-state-repository.js';
import { type CircuitBreakerRepository } from '../../repositories/circuit-breaker-repository.js';

export class HealthService {
  private transitionTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly providerRepo: ProviderStateRepository,
    private readonly circuitBreakerRepo: CircuitBreakerRepository,
    private readonly healthConfig: HealthConfig,
    private readonly logger: Logger,
  ) {}

  startTransitionChecker(): void {
    this.transitionTimer = setInterval(() => {
      this.circuitBreakerRepo.advanceHalfOpen(this.healthConfig.cooldownPeriod);
    }, 10000);
    if (this.transitionTimer.unref) this.transitionTimer.unref();
  }

  stopTransitionChecker(): void {
    if (this.transitionTimer) {
      clearInterval(this.transitionTimer);
      this.transitionTimer = null;
    }
  }

  getHealthSummary(): HealthSummary {
    const statuses: Record<string, ProviderHealthState> = {};
    for (const [provider, state] of this.providerRepo.entries()) {
      statuses[provider] = state;
    }

    const cbStates: Record<string, string> = {};
    for (const [provider, state] of this.circuitBreakerRepo.entries()) {
      cbStates[provider] = state.state;
    }

    return {
      status: [...this.providerRepo.entries().values()].some(s => s.status === 'healthy') ? 'healthy' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      providers: statuses,
      circuitBreakers: cbStates,
    };
  }

  getProviderStatus(providerId: string): ProviderHealthState | undefined {
    return this.providerRepo.get(providerId);
  }

  reportHealth(data: HealthReportRequest): { status: string; provider: string; currentStatus: string } {
    const prev = this.providerRepo.get(data.provider) ?? {
      status: 'unknown' as const,
      failures: 0,
      successes: 0,
      lastCheck: null,
      latency: [],
      avgLatency: 0,
    };
    const now = Date.now();

    if (data.status === 'healthy' || data.status === 'ok') {
      prev.successes = (prev.successes || 0) + 1;
      prev.failures = 0;
      if (prev.successes >= this.healthConfig.healthyThreshold) {
        prev.status = 'healthy';
        this.circuitBreakerRepo.transitionTo(data.provider, 'closed');
      }
    } else {
      prev.failures = (prev.failures || 0) + 1;
      if (prev.failures >= this.healthConfig.unhealthyThreshold) {
        prev.status = 'unhealthy';
        this.circuitBreakerRepo.transitionTo(data.provider, 'open');
      } else {
        prev.status = 'degraded';
      }
    }

    if (data.latency !== undefined) {
      prev.latency.push(data.latency);
      if (prev.latency.length > 10) prev.latency.shift();
      prev.avgLatency = prev.latency.reduce((a, b) => a + b, 0) / prev.latency.length;
    }

    prev.lastCheck = new Date().toISOString();
    if (data.error) prev.lastError = data.error;
    this.providerRepo.set(data.provider, prev);

    this.logger.debug('Health report received', { provider: data.provider, status: data.status, currentStatus: prev.status });

    return { status: 'reported', provider: data.provider, currentStatus: prev.status };
  }

  reset(provider?: string): void {
    if (provider) {
      this.providerRepo.delete(provider);
      this.circuitBreakerRepo.delete(provider);
    } else {
      this.providerRepo.clear();
      this.circuitBreakerRepo.clear();
    }
    this.logger.info('Health state reset', { provider: provider ?? 'all' });
  }

  getCircuitBreakers(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, val] of this.circuitBreakerRepo.entries()) {
      result[key] = val;
    }
    return result;
  }
}
