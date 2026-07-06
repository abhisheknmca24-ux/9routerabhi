export interface TierCondition {
  minHealthScore?: number;
  maxLatency?: number;
  requiredModels?: string[];
}

export interface RoutingTier {
  name: string;
  providers: string[];
  conditions?: TierCondition;
}

export interface CircuitBreakerConfig {
  enabled: boolean;
  failureThreshold: number;
  resetTimeout: number;
  halfOpenMaxRequests: number;
  monitoredStatusCodes?: number[];
}

export interface RoutingPolicy {
  strategy: string;
  tiers: RoutingTier[];
  defaultTier: string;
  failoverTimeout: number;
  maxFailoverAttempts: number;
  circuitBreaker: CircuitBreakerConfig;
  stickySession: boolean;
  loadBalancing: {
    enabled: boolean;
    algorithm: string;
  };
}

export interface RouteResolution {
  model: string;
  provider: string;
  tier: string;
  endpoint?: string;
  priority?: number;
  models?: string[];
}

export interface RouteChainLink {
  provider: string;
  tier: string;
  endpoint?: string;
  priority?: number;
}

export interface RouteChain {
  model: string;
  chain: RouteChainLink[];
  chainLength: number;
  strategy: string;
}

// ─── Intelligent Routing Types ───

/** Categorised failure types for routing decisions */
export type FailureType =
  | 'rate_limited'       // 429 — immediately skip
  | 'bad_gateway'        // 502 — retry once
  | 'unavailable'        // 503 — retry different provider
  | 'timeout'            // ETIMEDOUT, 504 — next provider
  | 'auth_failure'       // 401, 403 — disable provider
  | 'network_error'      // ECONNRESET, ENOTFOUND, etc. — retry another provider
  | 'server_error'       // 500 — retry with backoff
  | 'unknown';

/** Action to take for a given failure */
export type FailureAction =
  | 'skip_provider'
  | 'retry_once'
  | 'retry_different'
  | 'next_provider'
  | 'disable_provider'
  | 'retry_another'
  | 'retry_with_backoff';

/** Mapping from HTTP status / error code to failure type */
export const STATUS_TO_FAILURE: Record<number, FailureType> = {
  401: 'auth_failure',
  403: 'auth_failure',
  429: 'rate_limited',
  500: 'server_error',
  502: 'bad_gateway',
  503: 'unavailable',
  504: 'timeout',
};

export const ERROR_CODE_TO_FAILURE: Record<string, FailureType> = {
  ETIMEDOUT: 'timeout',
  ESOCKETTIMEDOUT: 'timeout',
  ECONNRESET: 'network_error',
  ECONNREFUSED: 'network_error',
  ENOTFOUND: 'network_error',
  EPIPE: 'network_error',
  ENETUNREACH: 'network_error',
  ABORTED: 'timeout',
};

export const FAILURE_TO_ACTION: Record<FailureType, FailureAction> = {
  rate_limited: 'skip_provider',
  bad_gateway: 'retry_once',
  unavailable: 'retry_different',
  timeout: 'next_provider',
  auth_failure: 'disable_provider',
  network_error: 'retry_another',
  server_error: 'retry_with_backoff',
  unknown: 'retry_different',
};

/** Extended provider health with scoring */
export interface ProviderScore {
  providerId: string;
  healthScore: number;       // 0.0 – 1.0
  successRate: number;       // 0.0 – 1.0
  avgLatencyMs: number;
  totalRequests: number;
  recentErrors: number;
  consecutiveFailures: number;
  status: string;
}
