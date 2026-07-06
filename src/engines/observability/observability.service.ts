import { type Logger } from '../../types/logger.types.js';
import { type MetricsSnapshot, type MetricsData, type EventRecord, type EventFilter } from '../../types/metrics.types.js';
import { MetricsRepository } from '../../repositories/metrics-repository.js';

export class ObservabilityService {
  constructor(
    private readonly metricsRepo: MetricsRepository,
    private readonly logger: Logger,
  ) {}

  ingest(data: { metrics?: MetricsData; event?: EventRecord }): void {
    if (data.metrics) {
      const provider = data.metrics.provider || 'unknown';

      if (data.metrics.requests) this.metricsRepo.recordRequest(provider);
      if (data.metrics.errors) this.metricsRepo.recordError(provider);
      if (data.metrics.latency !== undefined) this.metricsRepo.recordLatency(provider, data.metrics.latency);
    }

    if (data.event) {
      this.metricsRepo.pushEvent(data.event);
    }

    this.logger.debug('Metrics ingested', { provider: data.metrics?.provider });
  }

  getMetrics(): MetricsSnapshot {
    return this.metricsRepo.getSnapshot();
  }

  getProviderMetrics(providerId: string): ReturnType<MetricsRepository['getProviderMetrics']> {
    return this.metricsRepo.getProviderMetrics(providerId);
  }

  getEvents(filter?: EventFilter): EventRecord[] {
    return this.metricsRepo.getEvents(filter);
  }

  reset(): void {
    this.metricsRepo.reset();
    this.logger.info('Metrics reset');
  }
}
