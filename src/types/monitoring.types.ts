/** Provider monitoring — time-series metrics stored in SQLite */

export interface ProviderMetricsSnapshot {
  id?: number;
  providerId: string;
  timestamp: string;
  alive: boolean;
  latency: number;
  successCount: number;
  errorCount: number;
  successRate: number;
  count429: number;
  count502: number;
  dailyRequests: number;
  tokens: number;
  cost: number;
  status: string;
  healthScore: number;
}

export interface ProviderDailyStats {
  date: string;
  providerId: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  successRate: number;
  count429: number;
  count502: number;
  avgLatency: number;
  totalTokens: number;
  totalCost: number;
}

export interface MonitoringReportRequest {
  providerId: string;
  status: 'success' | 'failure' | 'timeout' | 'error';
  latencyMs: number;
  statusCode?: number;
  errorType?: string;
  tokens?: number;
  cost?: number;
}

export interface ProviderHealthHistory {
  snapshots: ProviderMetricsSnapshot[];
  daily: ProviderDailyStats[];
}

export interface MonitoringSummary {
  providers: string[];
  alive: number;
  dead: number;
  totalRequests: number;
  avgLatency: number;
  totalCost: number;
}
