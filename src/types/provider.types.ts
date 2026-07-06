/** Provider configuration as read from providers.json */
export interface ProviderAuth {
  apiKey?: string;
  endpoint?: string;
  accountId?: string;
  [key: string]: string | undefined;
}

export interface ProviderConfig {
  id: string;
  name: string;
  type: string;
  enabled: boolean;
  models: string[];
  auth: ProviderAuth;
  headers?: Record<string, string>;
  rateLimit?: number;
  timeout?: number;
  priority: number;
}

export interface ProvidersFile {
  providers: ProviderConfig[];
  defaultProvider: string;
  fallbackProvider: string;
  providerOrder: string[];
}

/** Runtime provider health state (not config-derived) */
export interface ProviderHealthState {
  status: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  failures: number;
  successes: number;
  lastCheck: string | null;
  latency: number[];
  avgLatency?: number;
  lastError?: string;
}
