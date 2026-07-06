import type { CircuitBreakerConfig } from './routing.types.js';
import type { ProviderHealthState } from './provider.types.js';

export type CircuitBreakerStateValue = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerState {
  state: CircuitBreakerStateValue;
  lastFailure: number | null;
  openedAt?: number;
}

export interface HealthConfig {
  checkInterval: number;
  requestTimeout: number;
  unhealthyThreshold: number;
  healthyThreshold: number;
  cooldownPeriod: number;
  circuitBreaker: CircuitBreakerConfig;
  checks: {
    http: HttpHealthCheckConfig;
    latency: LatencyCheckConfig;
    rateLimit: RateLimitCheckConfig;
  };
  endpoints: {
    status: string;
    metrics: string;
  };
}

export interface HttpHealthCheckConfig {
  enabled: boolean;
  method: string;
  expectedStatus: number;
  expectedResponseTime: number;
}

export interface LatencyCheckConfig {
  enabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  samplesPerWindow: number;
}

export interface RateLimitCheckConfig {
  enabled: boolean;
  warningThreshold: number;
  criticalThreshold: number;
  windowMs: number;
}

export interface HealthReportRequest {
  provider: string;
  status: 'healthy' | 'ok' | 'unhealthy' | 'degraded';
  latency?: number;
  error?: string;
}

export interface HealthSummary {
  status: 'healthy' | 'degraded';
  uptime: number;
  timestamp: string;
  providers: Record<string, ProviderHealthState>;
  circuitBreakers: Record<string, string>;
}
