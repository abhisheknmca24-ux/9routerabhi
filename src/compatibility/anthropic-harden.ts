/**
 * Production hardening for the Anthropic Compatibility Server.
 *
 * All features are self-contained. No routing, provider, health, or
 * combo engine changes.
 */

import type { Request, Response, NextFunction } from 'express';
import type { Server } from 'node:http';
import { type Logger } from '../types/logger.types.js';

// ═══════════════════════════════════════════════════════════════
//  1. Request Validation
// ═══════════════════════════════════════════════════════════════

export interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  message?: string;
}

const MESSAGE_RULES: ValidationRule[] = [
  { field: 'model', type: 'string', required: true, maxLength: 128 },
  { field: 'max_tokens', type: 'number', required: true, min: 1, max: 200000 },
  { field: 'messages', type: 'array', required: true, min: 1, max: 500 },
  { field: 'stream', type: 'boolean', required: false },
  { field: 'temperature', type: 'number', required: false, min: 0, max: 2 },
  { field: 'top_p', type: 'number', required: false, min: 0, max: 1 },
  { field: 'top_k', type: 'number', required: false, min: 1, max: 500 },
  { field: 'stop_sequences', type: 'array', required: false, max: 10 },
  { field: 'system', type: 'string', required: false, maxLength: 100000 },
];

export function validateRequestBody(body: Record<string, unknown>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  for (const rule of MESSAGE_RULES) {
    const value = body[rule.field];

    if (value === undefined || value === null) {
      if (rule.required) errors.push(`${rule.field} is required`);
      continue;
    }

    if (rule.type === 'array') {
      if (!Array.isArray(value)) {
        errors.push(`${rule.field} must be an array`);
        continue;
      }
      if (rule.min !== undefined && value.length < rule.min) {
        errors.push(`${rule.field} must have at least ${rule.min} item(s)`);
      }
      if (rule.max !== undefined && value.length > rule.max) {
        errors.push(`${rule.field} must have at most ${rule.max} item(s)`);
      }
      continue;
    }

    if (typeof value !== rule.type) {
      errors.push(`${rule.field} must be a ${rule.type}`);
      continue;
    }

    if (rule.type === 'number') {
      const num = value as number;
      if (rule.min !== undefined && num < rule.min) errors.push(`${rule.field} must be ≥ ${rule.min}`);
      if (rule.max !== undefined && num > rule.max) errors.push(`${rule.field} must be ≤ ${rule.max}`);
    }

    if (rule.type === 'string') {
      const str = value as string;
      if (rule.maxLength !== undefined && str.length > rule.maxLength) {
        errors.push(`${rule.field} must be ≤ ${rule.maxLength} characters`);
      }
    }
  }

  // Validate messages array content
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(messages)) {
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      if (!msg.role) errors.push(`messages[${i}].role is required`);
      if (!msg.content && msg.content !== '') errors.push(`messages[${i}].content is required`);
      if (msg.role && !['user', 'assistant'].includes(msg.role as string)) {
        errors.push(`messages[${i}].role must be 'user' or 'assistant'`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ═══════════════════════════════════════════════════════════════
//  2. Retry Policy
// ═══════════════════════════════════════════════════════════════

export interface RetryPolicyConfig {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  retryableStatuses: number[];
  retryableErrors: string[];
}

export const DEFAULT_RETRY_POLICY: RetryPolicyConfig = {
  maxRetries: 3,
  baseDelayMs: 500,
  maxDelayMs: 5000,
  retryableStatuses: [429, 500, 502, 503, 504],
  retryableErrors: ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE'],
};

export function shouldRetry(statusCode: number, errorCode?: string, policy: RetryPolicyConfig = DEFAULT_RETRY_POLICY): boolean {
  if (policy.retryableStatuses.includes(statusCode)) return true;
  if (errorCode && policy.retryableErrors.includes(errorCode)) return true;
  return false;
}

export function getRetryDelay(attempt: number, policy: RetryPolicyConfig = DEFAULT_RETRY_POLICY): number {
  const delay = Math.min(policy.baseDelayMs * Math.pow(2, attempt), policy.maxDelayMs);
  // Add jitter: ±25%
  const jitter = delay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(delay + jitter);
}

// ═══════════════════════════════════════════════════════════════
//  3. Timeout Policy
// ═══════════════════════════════════════════════════════════════

export interface TimeoutConfig {
  /** Hard timeout for non-streaming requests (ms) */
  requestTimeoutMs: number;
  /** Timeout for streaming responses (ms) */
  streamingTimeoutMs: number;
  /** Time to wait for upstream connection (ms) */
  upstreamConnectTimeoutMs: number;
  /** Max duration for streaming failover (ms) */
  failoverTotalTimeoutMs: number;
}

export const DEFAULT_TIMEOUTS: TimeoutConfig = {
  requestTimeoutMs: 120000,
  streamingTimeoutMs: 300000,
  upstreamConnectTimeoutMs: 15000,
  failoverTotalTimeoutMs: 600000,
};

// ═══════════════════════════════════════════════════════════════
//  4. Rate Limiting (enhanced)
// ═══════════════════════════════════════════════════════════════

export interface RateLimitEntry {
  count: number;
  resetAt: number;
  bodyBytes: number;
}

export class RateLimiter {
  private readonly store = new Map<string, RateLimitEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly maxRequests: number = 200,
    private readonly windowMs: number = 60000,
    private readonly maxBodyBytes: number = 10 * 1024 * 1024,
  ) {
    this.cleanupTimer = setInterval(() => this._cleanup(), 60000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  check(ip: string, bodySize: number = 0): { allowed: boolean; remaining: number; resetAt: number; error?: string } {
    const now = Date.now();
    let entry = this.store.get(ip);

    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + this.windowMs, bodyBytes: 0 };
      this.store.set(ip, entry);
    }

    if (bodySize > this.maxBodyBytes) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt, error: 'Request body too large' };
    }

    entry.bodyBytes += bodySize;
    entry.count++;
    const remaining = Math.max(0, this.maxRequests - entry.count);

    if (entry.count > this.maxRequests) {
      return { allowed: false, remaining: 0, resetAt: entry.resetAt, error: 'Too many requests' };
    }

    return { allowed: true, remaining, resetAt: entry.resetAt };
  }

  destroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    this.store.clear();
  }

  private _cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.resetAt) this.store.delete(key);
    }
  }
}

// ═══════════════════════════════════════════════════════════════
//  5. Metrics
// ═══════════════════════════════════════════════════════════════

export interface RequestMetrics {
  totalRequests: number;
  activeStreams: number;
  completedStreams: number;
  failedStreams: number;
  totalErrors: number;
  latencyBuckets: number[]; // ms
  statusCodes: Record<number, number>;
  modelsUsed: Record<string, number>;
  clientsByVersion: Record<string, number>;
  lastRequestAt: number | null;
  bytesSent: number;
  bytesReceived: number;
}

export class MetricsCollector {
  private metrics: RequestMetrics = {
    totalRequests: 0,
    activeStreams: 0,
    completedStreams: 0,
    failedStreams: 0,
    totalErrors: 0,
    latencyBuckets: [],
    statusCodes: {},
    modelsUsed: {},
    clientsByVersion: {},
    lastRequestAt: null,
    bytesSent: 0,
    bytesReceived: 0,
  };

  recordRequest(model: string, version?: string): void {
    this.metrics.totalRequests++;
    this.metrics.lastRequestAt = Date.now();
    this.metrics.modelsUsed[model] = (this.metrics.modelsUsed[model] || 0) + 1;
    if (version) {
      this.metrics.clientsByVersion[version] = (this.metrics.clientsByVersion[version] || 0) + 1;
    }
  }

  recordStreamStart(): void {
    this.metrics.activeStreams++;
  }

  recordStreamEnd(success: boolean): void {
    this.metrics.activeStreams = Math.max(0, this.metrics.activeStreams - 1);
    if (success) this.metrics.completedStreams++;
    else this.metrics.failedStreams++;
  }

  recordLatency(ms: number): void {
    this.metrics.latencyBuckets.push(ms);
    if (this.metrics.latencyBuckets.length > 1000) this.metrics.latencyBuckets.shift();
  }

  recordStatus(code: number): void {
    this.metrics.statusCodes[code] = (this.metrics.statusCodes[code] || 0) + 1;
    if (code >= 400) this.metrics.totalErrors++;
  }

  recordBytes(sent: number, received: number): void {
    this.metrics.bytesSent += sent;
    this.metrics.bytesReceived += received;
  }

  getSnapshot(): RequestMetrics & { avgLatency: number; p95Latency: number } {
    const sorted = [...this.metrics.latencyBuckets].sort((a, b) => a - b);
    const len = sorted.length;
    return {
      ...this.metrics,
      avgLatency: len > 0 ? sorted.reduce((a, b) => a + b, 0) / len : 0,
      p95Latency: len > 0 ? sorted[Math.floor(len * 0.95)] : 0,
    };
  }

  reset(): void {
    this.metrics = {
      totalRequests: 0, activeStreams: 0, completedStreams: 0, failedStreams: 0,
      totalErrors: 0, latencyBuckets: [], statusCodes: {}, modelsUsed: {},
      clientsByVersion: {}, lastRequestAt: null, bytesSent: 0, bytesReceived: 0,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
//  6. Error Mapping
// ═══════════════════════════════════════════════════════════════

export function mapUpstreamError(statusCode: number, upstreamError?: string): {
  anthropicType: string;
  httpStatus: number;
  message: string;
} {
  // Explicit mapping for known statuses
  switch (statusCode) {
    case 400: return { anthropicType: 'invalid_request_error', httpStatus: 400, message: upstreamError || 'Bad request' };
    case 401: return { anthropicType: 'authentication_error', httpStatus: 401, message: upstreamError || 'Invalid API key' };
    case 403: return { anthropicType: 'permission_error', httpStatus: 403, message: upstreamError || 'Permission denied' };
    case 404: return { anthropicType: 'not_found', httpStatus: 404, message: upstreamError || 'Resource not found' };
    case 429: return { anthropicType: 'rate_limit_error', httpStatus: 429, message: upstreamError || 'Rate limit exceeded' };
    case 502: return { anthropicType: 'api_error', httpStatus: 502, message: upstreamError || 'Bad upstream gateway' };
    case 503: return { anthropicType: 'overloaded_error', httpStatus: 503, message: upstreamError || 'Service unavailable' };
    case 504: return { anthropicType: 'api_error', httpStatus: 504, message: upstreamError || 'Gateway timeout' };
    case 529: return { anthropicType: 'overloaded_error', httpStatus: 529, message: upstreamError || 'Service overloaded' };
    default:
      if (statusCode >= 500) return { anthropicType: 'api_error', httpStatus: statusCode, message: upstreamError || 'Internal server error' };
      return { anthropicType: 'invalid_request_error', httpStatus: statusCode, message: upstreamError || 'Request error' };
  }
}

// ═══════════════════════════════════════════════════════════════
//  7. Streaming Cleanup
// ═══════════════════════════════════════════════════════════════

export class StreamTracker {
  private readonly activeStreams = new Map<string, { createdAt: number; req: Request; res: Response }>();
  private readonly maxStreamAge: number;

  constructor(maxStreamAgeMs: number = 300_000) {
    this.maxStreamAge = maxStreamAgeMs;
  }

  register(id: string, req: Request, res: Response): void {
    this.activeStreams.set(id, { createdAt: Date.now(), req, res });
    res.on('close', () => this.activeStreams.delete(id));
    res.on('error', () => this.activeStreams.delete(id));
  }

  unregister(id: string): void {
    this.activeStreams.delete(id);
  }

  getActiveCount(): number {
    return this.activeStreams.size;
  }

  cleanupStale(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, stream] of this.activeStreams) {
      if (now - stream.createdAt > this.maxStreamAge) {
        try { stream.res.end(); } catch {}
        this.activeStreams.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  destroyAll(): number {
    const count = this.activeStreams.size;
    for (const [, stream] of this.activeStreams) {
      try { stream.res.end(); } catch {}
    }
    this.activeStreams.clear();
    return count;
  }
}

// ═══════════════════════════════════════════════════════════════
//  8. Graceful Shutdown
// ═══════════════════════════════════════════════════════════════

export function setupGracefulShutdown(
  server: Server,
  logger: Logger,
  cleanup: Array<() => void>,
  timeoutMs: number = 10000,
): void {
  let shuttingDown = false;

  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}. Starting graceful shutdown...`);

    // Run all cleanup handlers
    for (const handler of cleanup) {
      try { handler(); } catch {}
    }

    // Stop accepting new connections
    server.close(() => {
      logger.info('Server closed. Exiting.');
      process.exit(0);
    });

    // Force exit after timeout
    setTimeout(() => {
      logger.error(`Graceful shutdown timed out after ${timeoutMs}ms. Forcing exit.`);
      process.exit(1);
    }, timeoutMs);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGBREAK', () => shutdown('SIGBREAK'));
  process.on('uncaughtException', (err) => {
    logger.error('Uncaught exception', { error: err.message, stack: err.stack });
    shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { error: String(reason) });
  });
}

// ═══════════════════════════════════════════════════════════════
//  9. Request Tracing
// ═══════════════════════════════════════════════════════════════

let requestCounter = 0;

export function generateTraceId(): string {
  requestCounter = (requestCounter + 1) % 100000;
  return `tr_${Date.now().toString(36)}_${requestCounter.toString(36).padStart(4, '0')}`;
}

export function tracingMiddleware(logger: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const traceId = generateTraceId();
    const startTime = Date.now();

    // Attach trace context
    (req as any).traceId = traceId;
    (req as any).startTime = startTime;

    // Log request
    logger.info(`→ ${req.method} ${req.path}`, {
      traceId,
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: (req.headers['user-agent'] || '').slice(0, 100),
    });

    // Wrap end to log response
    const originalEnd = res.end.bind(res);
    res.end = function (this: Response, ...args: any[]): Response {
      const duration = Date.now() - startTime;
      logger.info(`← ${req.method} ${req.path} ${res.statusCode} ${duration}ms`, {
        traceId,
        statusCode: res.statusCode,
        durationMs: duration,
      });
      return originalEnd(...args);
    } as any;

    next();
  };
}
