/** Gateway timeline — records every request with full trace */

export interface TimelineRecord {
  id?: number;
  /** Unique request ID */
  requestId: string;
  /** ISO timestamp */
  timestamp: string;
  /** Detected client type */
  client: string;
  /** Detected protocol */
  protocol: string;
  /** The model requested by the client */
  model: string;
  /** Resolved model after alias */
  resolvedModel?: string;
  /** Whether an alias was used */
  aliased: boolean;
  /** Alias name if aliased */
  aliasName?: string;
  /** Combo profile selected */
  combo?: string;
  /** Provider chain tried */
  providers: string;
  /** Final provider that succeeded */
  finalProvider?: string;
  /** Total latency in ms */
  latencyMs: number;
  /** Whether the request succeeded */
  success: boolean;
  /** Whether the request was streaming */
  streamed: boolean;
  /** Number of retries */
  retries: number;
  /** Number of fallbacks */
  fallbacks: number;
  /** HTTP status code */
  statusCode?: number;
  /** Error message if failed */
  error?: string;
  /** Tokens used */
  tokens?: number;
  /** Cost */
  cost?: number;
  /** Stage-by-stage timeline JSON */
  stageTimeline: string;
  /** Prompt preview (first 200 chars) */
  promptPreview?: string;
  /** Response length */
  responseLength?: number;
}

export interface TimelineFilter {
  search?: string;
  client?: string;
  model?: string;
  success?: boolean;
  aliased?: boolean;
  streamed?: boolean;
  minLatency?: number;
  maxLatency?: number;
  startDate?: string;
  endDate?: string;
  sortBy?: 'timestamp' | 'latencyMs' | 'tokens' | 'cost';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface TimelineListResult {
  records: TimelineRecord[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface TimelineStats {
  totalRequests: number;
  successRate: number;
  avgLatency: number;
  totalTokens: number;
  totalCost: number;
  topClients: Array<{ client: string; count: number }>;
  topModels: Array<{ model: string; count: number }>;
  errorRate: number;
  aliasUsageRate: number;
  streamingRate: number;
}
