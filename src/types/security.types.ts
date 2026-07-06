export interface AuthContext {
  authenticated: boolean;
  actor?: string;
  method: 'api-key' | 'jwt' | 'none';
}

export interface AuditEvent {
  eventType: string;
  actor: string;
  action: string;
  resource: string;
  result: 'success' | 'failure';
  details?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

export interface SecurityAlert {
  severity: 'low' | 'medium' | 'high' | 'critical';
  type: string;
  message: string;
  key?: string;
  timestamp: number;
  id: string;
}

export interface RateLimitResult {
  allowed: boolean;
  retryAfter?: number;
  remaining?: number;
  resetMs?: number;
  blocked?: boolean;
}
