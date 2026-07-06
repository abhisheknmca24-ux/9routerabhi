/**
 * Anthropic Compatibility Server — Production Hardened
 *
 * A fully Claude Desktop-compatible server that speaks exact Anthropic protocol.
 * Runs on port 20138.
 *
 * Production features:
 *   - Request validation (types, bounds, constraints)
 *   - Retry policy (exponential backoff with jitter)
 *   - Timeout policy (per-request, per-stream, failover)
 *   - Rate limiting (per-IP, body size limits)
 *   - Metrics (latency buckets, status codes, model tracking)
 *   - Logging (structed, trace-level)
 *   - Tracing (per-request trace IDs)
 *   - Error mapping (upstream → Anthropic error types)
 *   - Health checks (detailed)
 *   - Memory cleanup (stale stream reaper)
 *   - Connection pooling (via HttpAgent)
 *   - Streaming cleanup (close handlers)
 *   - Graceful shutdown (drain + force exit)
 *
 * No routing engine changes. No provider logic. No combo engine changes.
 */

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { ConsoleLogger } from '../logger/console-logger.js';
import { HttpAgent } from '../performance/http-agent.js';
import { AnthropicController } from './anthropic-controller.js';
import { AnthropicMiddleware } from './anthropic-middleware.js';
import { ModelAliasManager } from '../model-alias/model-alias-manager.js';
import {
  validateRequestBody,
  DEFAULT_RETRY_POLICY,
  DEFAULT_TIMEOUTS,
  RateLimiter,
  MetricsCollector,
  mapUpstreamError,
  StreamTracker,
  setupGracefulShutdown,
  tracingMiddleware,
  generateTraceId,
} from './anthropic-harden.js';

// ─── Configuration ───
const PORT = parseInt(process.env.ANTHROPIC_PORT || '20138', 10);
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:20128';
const HOST = process.env.HOST || '127.0.0.1';
const LOG_LEVEL = process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined;

const logger = new ConsoleLogger(LOG_LEVEL, { service: 'anthropic-compat' });

// ─── Dependencies ───
const httpAgent = new HttpAgent({
  logger,
  timeout: DEFAULT_TIMEOUTS.upstreamConnectTimeoutMs,
  maxRetries: DEFAULT_RETRY_POLICY.maxRetries,
  maxSockets: parseInt(process.env.HTTP_MAX_SOCKETS || '100', 10),
  keepAlive: true,
});

const anthropicMiddleware = new AnthropicMiddleware({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.API_KEY_SECRET,
  anthropicVersion: '2023-06-01',
});

const anthropicController = new AnthropicController(httpAgent, {
  gatewayUrl: GATEWAY_URL,
  maxStreamingFailover: 3,
});

const aliasConfigPath = path.resolve(process.cwd(), 'config', 'aliases.json');
const aliasManager = new ModelAliasManager(aliasConfigPath);

// ─── Hardening Components ───
const rateLimiter = new RateLimiter(
  parseInt(process.env.RATE_LIMIT_MAX || '200', 10),
  parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
);
const metrics = new MetricsCollector();
const streamTracker = new StreamTracker(DEFAULT_TIMEOUTS.streamingTimeoutMs);

// Clean up stale streams every 60s
setInterval(() => {
  const cleaned = streamTracker.cleanupStale();
  if (cleaned > 0) logger.warn(`Cleaned ${cleaned} stale streams`);
}, 60000);

// ─── Express App ───
const app = express();
app.use(express.json({ limit: '10mb' }));

// Tracing middleware (every request gets a trace ID)
app.use(tracingMiddleware(logger));

// ─── Health check (detailed) ───
app.get('/health', (_req, res) => {
  const mem = process.memoryUsage();
  const metricsSnapshot = metrics.getSnapshot();
  res.json({
    status: 'ok',
    service: 'anthropic-compat',
    port: PORT,
    uptime: process.uptime(),
    version: '1.0.0',
    memory: {
      rss: Math.round(mem.rss / 1024 / 1024) + 'MB',
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024) + 'MB',
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024) + 'MB',
    },
    metrics: {
      totalRequests: metricsSnapshot.totalRequests,
      activeStreams: streamTracker.getActiveCount(),
      avgLatencyMs: Math.round(metricsSnapshot.avgLatency),
      p95LatencyMs: Math.round(metricsSnapshot.p95Latency),
      totalErrors: metricsSnapshot.totalErrors,
      statusCodes: metricsSnapshot.statusCodes,
    },
    config: {
      virtualModels: aliasManager.count,
      upstreamUrl: GATEWAY_URL,
      authEnabled: process.env.REQUIRE_API_KEY === 'true',
      timeouts: DEFAULT_TIMEOUTS,
    },
  });
});

// ─── GET /v1/models ───
app.get('/v1/models', anthropicMiddleware.handle, (_req, res) => {
  const aliases = aliasManager.getAll();
  const models = aliases.map(a => ({
    type: 'model',
    id: a.name,
    display_name: a.description || a.name,
    created_at: new Date().toISOString(),
  }));
  res.json({ object: 'list', data: models });
});

// ─── POST /v1/messages ───
app.post('/v1/messages', anthropicMiddleware.handle, async (req, res) => {
  const traceId = (req as any).traceId || generateTraceId();
  const startTime = Date.now();
  const body = req.body ?? {};
  const stream = body.stream === true;

  // ── 1. Validate request ──
  const validation = validateRequestBody(body);
  if (!validation.valid) {
    const err = mapUpstreamError(400, validation.errors.join('; '));
    metrics.recordStatus(400);
    res.statusCode = err.httpStatus;
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-request-id', traceId);
    res.end(JSON.stringify({ type: 'error', error: { type: err.anthropicType, message: err.message } }));
    return;
  }

  // ── 2. Rate limit ──
  const clientIp = req.ip ?? req.socket.remoteAddress ?? 'unknown';
  const bodySize = JSON.stringify(body).length;
  const rateCheck = rateLimiter.check(clientIp, bodySize);
  if (!rateCheck.allowed) {
    metrics.recordStatus(429);
    res.statusCode = 429;
    res.setHeader('content-type', 'application/json');
    res.setHeader('x-request-id', traceId);
    res.setHeader('retry-after', String(Math.ceil((rateCheck.resetAt - Date.now()) / 1000)));
    res.end(JSON.stringify({
      type: 'error',
      error: { type: 'rate_limit_error', message: rateCheck.error || 'Rate limit exceeded' },
    }));
    return;
  }

  // ── 3. Track metrics ──
  metrics.recordRequest(body.model as string || '', (req.headers['anthropic-version'] as string));
  if (stream) metrics.recordStreamStart();
  metrics.recordBytes(bodySize, 0);

  // ── 4. Register stream for cleanup ──
  if (stream) {
    streamTracker.register(traceId, req, res);
  }

  // ── 5. Execute ──
  try {
    await anthropicController.handleMessages(req as any, res as any, body);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    logger.error('Handler failed', { traceId, error: message });
    metrics.recordStatus(500);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.setHeader('x-request-id', traceId);
      res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message } }));
    }
  }

  // ── 6. Finalize metrics ──
  const duration = Date.now() - startTime;
  metrics.recordLatency(duration);
  const statusCode = res.statusCode || 200;
  metrics.recordStatus(statusCode);
  if (stream) metrics.recordStreamEnd(statusCode < 400);
  if (stream) streamTracker.unregister(traceId);

  const bytesSent = res.getHeader('content-length')
    ? parseInt(String(res.getHeader('content-length')), 10)
    : 0;
  metrics.recordBytes(0, bytesSent);

  logger.info('Request complete', {
    traceId,
    method: req.method,
    path: req.path,
    model: body.model,
    stream,
    statusCode,
    durationMs: duration,
    activeStreams: streamTracker.getActiveCount(),
  });
});

// ─── Metrics endpoint ───
app.get('/metrics', (_req, res) => {
  res.json(metrics.getSnapshot());
});

// ─── Start ───
const server = http.createServer(app).listen(PORT, HOST, () => {
  logger.info(`Anthropic Compatibility Server (production) running on ${HOST}:${PORT}`);
  logger.info(`POST /v1/messages → ${GATEWAY_URL}/v1/chat/completions`);
  logger.info(`GET /v1/models  → ${aliasManager.count} virtual models`);
  logger.info(`Rate limit: ${rateLimiter['maxRequests']}/min per IP`);
  logger.info(`Stream timeout: ${DEFAULT_TIMEOUTS.streamingTimeoutMs}ms`);
  logger.info('Auth: ' + (process.env.REQUIRE_API_KEY === 'true' ? 'enabled' : 'disabled'));
  logger.info('No routing engine, provider, or health engine modifications.');
});

// ─── Graceful shutdown ───
setupGracefulShutdown(server, logger, [
  () => rateLimiter.destroy(),
  () => {
    const terminated = streamTracker.destroyAll();
    if (terminated > 0) logger.warn(`Terminated ${terminated} active streams`);
  },
  () => httpAgent.destroy(),
], 15000);

export { app, server };
