import { type Repository } from '../types/repository.types.js';
import { type LatencyPercentiles, type ProviderMetrics, type EventRecord, type EventFilter, type MetricsSnapshot } from '../types/metrics.types.js';

export interface ProviderKey {
  providerId: string;
}

export class MetricsRepository {
  private readonly requests: Record<string, number> = {};
  private readonly errors: Record<string, number> = {};
  private readonly latencies: number[] = [];
  private readonly providerMetrics = new Map<string, ProviderMetrics>();
  private readonly events: EventRecord[] = [];

  recordRequest(providerId: string): void {
    this.requests.total = (this.requests.total ?? 0) + 1;
    const p = this._getProvider(providerId);
    p.requests++;
  }

  recordError(providerId: string): void {
    this.errors.total = (this.errors.total ?? 0) + 1;
    const p = this._getProvider(providerId);
    p.errors++;
  }

  recordLatency(providerId: string, ms: number): void {
    this.latencies.push(ms);
    if (this.latencies.length > 10000) this.latencies.splice(0, this.latencies.length - 10000);

    const p = this._getProvider(providerId);
    p.latencies.push(ms);
    if (p.latencies.length > 1000) p.latencies.shift();
    p.avgLatency = p.latencies.reduce((a, b) => a + b, 0) / p.latencies.length;
  }

  pushEvent(event: EventRecord): void {
    this.events.push(event);
    if (this.events.length > 10000) this.events.shift();
  }

  getEvents(filter?: EventFilter): EventRecord[] {
    let result = this.events;
    if (filter?.since) {
      const sinceTime = new Date(filter.since).getTime();
      result = result.filter(e => new Date(e.timestamp).getTime() >= sinceTime);
    }
    if (filter?.type) result = result.filter(e => e.type === filter.type);
    return result.slice(-(filter?.limit ?? 100));
  }

  getSnapshot(): MetricsSnapshot {
    const sorted = [...this.latencies].sort((a, b) => a - b);
    const total = sorted.length;
    const avg = total > 0 ? sorted.reduce((a, b) => a + b, 0) / total : 0;

    const providers: Record<string, ProviderMetrics> = {};
    for (const [id, pm] of this.providerMetrics) {
      providers[id] = { ...pm };
    }

    return {
      requests: { ...this.requests },
      errors: { ...this.errors },
      errorRate: (this.requests.total ?? 0) > 0 ? (this.errors.total ?? 0) / (this.requests.total ?? 0) : 0,
      latency: {
        avg,
        p50: total > 0 ? sorted[Math.floor(total * 0.5)] : 0,
        p95: total > 0 ? sorted[Math.floor(total * 0.95)] : 0,
        p99: total > 0 ? sorted[Math.floor(total * 0.99)] : 0,
        min: sorted[0] || 0,
        max: sorted[total - 1] || 0,
        samples: total,
      },
      providers,
      uptime: process.uptime(),
    };
  }

  getProviderMetrics(providerId: string): ProviderMetrics | undefined {
    return this.providerMetrics.get(providerId);
  }

  reset(): void {
    for (const key of Object.keys(this.requests)) delete this.requests[key];
    for (const key of Object.keys(this.errors)) delete this.errors[key];
    this.latencies.length = 0;
    this.providerMetrics.clear();
    this.events.length = 0;
  }

  private _getProvider(providerId: string): ProviderMetrics {
    if (!this.providerMetrics.has(providerId)) {
      this.providerMetrics.set(providerId, { requests: 0, errors: 0, latencies: [] });
    }
    return this.providerMetrics.get(providerId)!;
  }
}
