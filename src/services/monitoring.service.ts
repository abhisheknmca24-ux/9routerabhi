import { type Logger } from '../types/logger.types.js';
import { type ProviderScore } from '../types/routing.types.js';
import {
  type ProviderMetricsSnapshot,
  type MonitoringReportRequest,
  type MonitoringSummary,
} from '../types/monitoring.types.js';
import { MonitoringDatabase } from '../repositories/monitoring-db.js';
import { ProviderHealthTracker } from './provider-health-tracker.js';

export class MonitoringService {
  // Rolling counters reset per snapshot interval
  private windowCounts: Map<string, { count429: number; count502: number; successCount: number; errorCount: number; latencySum: number; latencyCount: number; tokens: number; cost: number }> = new Map();
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private providerList: string[] = [];

  constructor(
    private readonly db: MonitoringDatabase,
    private readonly healthTracker: ProviderHealthTracker,
    private readonly logger: Logger,
    private readonly snapshotIntervalMs: number = 60_000, // 1 min
  ) {}

  start(providerIds: string[]): void {
    this.providerList = providerIds;
    for (const id of providerIds) {
      this.windowCounts.set(id, { count429: 0, count502: 0, successCount: 0, errorCount: 0, latencySum: 0, latencyCount: 0, tokens: 0, cost: 0 });
    }

    // Take initial snapshot
    this._snapshot();

    // Periodic snapshot
    this.snapshotTimer = setInterval(() => this._snapshot(), this.snapshotIntervalMs);
    if (this.snapshotTimer.unref) this.snapshotTimer.unref();

    // Also snapshot daily stats every minute
    this.logger.info(`Monitoring started for ${providerIds.length} providers, snapshot interval ${this.snapshotIntervalMs}ms`);
  }

  stop(): void {
    if (this.snapshotTimer) {
      this._snapshot(); // Final snapshot
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  report(report: MonitoringReportRequest): void {
    const key = report.providerId;
    if (!this.windowCounts.has(key)) {
      this.windowCounts.set(key, { count429: 0, count502: 0, successCount: 0, errorCount: 0, latencySum: 0, latencyCount: 0, tokens: 0, cost: 0 });
    }

    const wc = this.windowCounts.get(key)!;

    if (report.status === 'success') {
      wc.successCount++;
      wc.latencySum += report.latencyMs;
      wc.latencyCount++;
      if (report.tokens) wc.tokens += report.tokens;
      if (report.cost) wc.cost += report.cost;
    } else {
      wc.errorCount++;
      if (report.statusCode === 429) wc.count429++;
      if (report.statusCode === 502) wc.count502++;
    }

    // Also update daily stats
    const today = new Date().toISOString().slice(0, 10);
    const success = report.status === 'success' || report.statusCode === 200;
    const tokens = report.tokens || 0;
    const cost = report.cost || 0;
    this.db.updateDailyStats(today, report.providerId, success, report.latencyMs, report.statusCode, tokens, cost);
  }

  getCurrentStatus(): ProviderMetricsSnapshot[] {
    return this.db.getAllLatestSnapshots();
  }

  getProviderHistory(providerId: string, hours?: number): ProviderMetricsSnapshot[] {
    return this.db.getProviderHistory(providerId, hours || 24);
  }

  getDailyStats(providerId: string, days?: number) {
    return this.db.getDailyStats(providerId, days || 30);
  }

  getSummary(): MonitoringSummary {
    const snapshots = this.db.getAllLatestSnapshots();
    const alive = snapshots.filter(s => s.alive).length;
    const dead = snapshots.filter(s => !s.alive).length;
    const totalRequests = snapshots.reduce((a, s) => a + s.successCount + s.errorCount, 0);
    const totalLatency = snapshots.reduce((a, s) => a + s.latency, 0);
    const avgLatency = snapshots.length > 0 ? totalLatency / snapshots.length : 0;
    const totalCost = snapshots.reduce((a, s) => a + s.cost, 0);

    return {
      providers: snapshots.map(s => s.providerId),
      alive,
      dead,
      totalRequests,
      avgLatency,
      totalCost,
    };
  }

  refreshProviderList(providerIds: string[]): void {
    this.providerList = providerIds;
    for (const id of providerIds) {
      if (!this.windowCounts.has(id)) {
        this.windowCounts.set(id, { count429: 0, count502: 0, successCount: 0, errorCount: 0, latencySum: 0, latencyCount: 0, tokens: 0, cost: 0 });
      }
    }
  }

  private _snapshot(): void {
    const now = new Date().toISOString();

    for (const providerId of this.providerList) {
      const wc = this.windowCounts.get(providerId);
      const score: ProviderScore = this.healthTracker.getScore(providerId);
      const alive = score.status !== 'auth_disabled' && score.status !== 'critical';

      const snapshot: ProviderMetricsSnapshot = {
        providerId,
        timestamp: now,
        alive,
        latency: score.avgLatencyMs,
        successCount: wc?.successCount || 0,
        errorCount: wc?.errorCount || 0,
        successRate: score.successRate,
        count429: wc?.count429 || 0,
        count502: wc?.count502 || 0,
        dailyRequests: score.totalRequests,
        tokens: wc?.tokens || 0,
        cost: wc?.cost || 0,
        status: score.status,
        healthScore: score.healthScore,
      };

      this.db.insertSnapshot(snapshot);

      // Reset window counters
      if (wc) {
        wc.count429 = 0;
        wc.count502 = 0;
        wc.successCount = 0;
        wc.errorCount = 0;
        wc.latencySum = 0;
        wc.latencyCount = 0;
        wc.tokens = 0;
        wc.cost = 0;
      }
    }
  }
}
