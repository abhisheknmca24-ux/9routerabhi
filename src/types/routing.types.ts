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
