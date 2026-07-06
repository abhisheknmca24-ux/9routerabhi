import type { ProvidersFile } from './provider.types.js';
import type { RoutingPolicy } from './routing.types.js';
import type { HealthConfig } from './health.types.js';

export interface RetryConfig {
  enabled: boolean;
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
  jitter: boolean;
  jitterMax: number;
  retryableStatuses: number[];
  retryableErrors: string[];
  exponentialBackoff: boolean;
  overallTimeout: number;
}

export interface ErrorMappingEntry {
  action: 'skip_provider' | 'retry' | 'retry_with_backoff' | 'wait_and_retry';
  message: string;
  waitMs?: number;
}

export interface FallbackConfig {
  enabled: boolean;
  providers: string[];
  fallbackStrategy: string;
  chainOrder: string[];
  timeoutMs: number;
  maxFallbacks: number;
  errorMapping: Record<string, ErrorMappingEntry>;
  healthAware: boolean;
  circuitBreakerAware: boolean;
}

export interface RedactionPattern {
  pattern: string;
  flags: string;
  replacement: string;
}

export interface LoggingConfig {
  level: string;
  format: 'json' | 'text';
  outputs: ('console' | 'file')[];
  file: {
    directory: string;
    filename: string;
    maxSize: string;
    maxFiles: number;
    zippedArchive: boolean;
    datePattern: string;
  };
  redaction: {
    enabled: boolean;
    patterns: RedactionPattern[];
    maskFullValue: boolean;
    maskChar: string;
  };
  include: Record<string, unknown>;
  sampling: {
    enabled: boolean;
    rate: number;
  };
}

export interface ServerConfig {
  port: number;
  host: string;
  cors: {
    enabled: boolean;
    origins: string[];
    methods: string[];
    allowedHeaders: string[];
  };
  ssl: {
    enabled: boolean;
    cert: string;
    key: string;
  };
  rateLimiting: {
    enabled: boolean;
    windowMs: number;
    maxRequests: number;
    standardHeaders: boolean;
    legacyHeaders: boolean;
  };
  bodyParser: {
    limit: string;
    extended: boolean;
  };
  trustProxy: boolean;
  maxHeaderSize: number;
  keepAliveTimeout: number;
  headersTimeout: number;
}

export interface FeatureFlags {
  streaming: boolean;
  failover: boolean;
  healthChecks: boolean;
  circuitBreaker: boolean;
  rateLimiting: boolean;
  auditLogging: boolean;
  dashboard: boolean;
}

export interface ProfileConfig {
  name: string;
  description: string;
  active: boolean;
  routingPolicy: string;
  providers: string[];
  features: FeatureFlags;
  limits: {
    maxConcurrentRequests: number;
    maxRetries: number;
    requestTimeoutMs: number;
  };
}

export interface AllConfigs {
  providers: ProvidersFile;
  routing: RoutingPolicy;
  health: HealthConfig;
  retry: RetryConfig;
  fallback: FallbackConfig;
  logging: LoggingConfig;
  server: ServerConfig;
  profile: ProfileConfig;
}
