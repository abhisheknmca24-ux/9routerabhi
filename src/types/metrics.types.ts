export interface MetricsData {
  requests?: number;
  errors?: number;
  latency?: number;
  provider?: string;
  model?: string;
  statusCode?: number;
}

export interface LatencyPercentiles {
  avg: number;
  p50: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  samples: number;
}

export interface MetricsSnapshot {
  requests: Record<string, number>;
  errors: Record<string, number>;
  errorRate: number;
  latency: LatencyPercentiles;
  providers: Record<string, ProviderMetrics>;
  uptime: number;
}

export interface ProviderMetrics {
  requests: number;
  errors: number;
  latencies: number[];
  avgLatency?: number;
}

export interface EventRecord {
  timestamp: string;
  type: string;
  provider?: string;
  model?: string;
  latency?: number;
  statusCode?: number;
  error?: string;
  [key: string]: unknown;
}

export interface EventFilter {
  since?: string;
  type?: string;
  limit?: number;
}
