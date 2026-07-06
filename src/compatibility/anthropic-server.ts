/**
 * Anthropic Compatibility Server
 *
 * A fully Claude Desktop-compatible server that speaks exact Anthropic protocol.
 * Runs on port 20138.
 *
 * Endpoints:
 *   POST /v1/messages  — Chat completions (streaming + non-streaming)
 *   GET  /v1/models    — Virtual model list (alias names only)
 *
 * Claude Desktop should work without any configuration changes.
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

const PORT = parseInt(process.env.ANTHROPIC_PORT || '20138', 10);
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:20128';
const HOST = process.env.HOST || '127.0.0.1';

const logger = new ConsoleLogger(
  process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
  { service: 'anthropic-compat' },
);

// ─── Dependencies (existing services only) ───
const httpAgent = new HttpAgent({ logger });

// ─── Anthropic middleware handles auth, headers, rate limits ───
const anthropicMiddleware = new AnthropicMiddleware({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  apiKey: process.env.ANTHROPIC_API_KEY || process.env.API_KEY_SECRET,
  anthropicVersion: '2023-06-01',
});

// ─── Controller handles /v1/messages format translation ───
const anthropicController = new AnthropicController(httpAgent, { gatewayUrl: GATEWAY_URL });

// ─── Alias manager for virtual model discovery ───
const aliasConfigPath = path.resolve(process.cwd(), 'config', 'aliases.json');
const aliasManager = new ModelAliasManager(aliasConfigPath);

// ─── Express App ───
const app = express();
app.use(express.json({ limit: '10mb' }));

// Health check (no auth required)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'anthropic-compat', port: PORT });
});

// GET /v1/models — return virtual model names from aliases
// Claude Desktop sees only alias names, never internal provider IDs
app.get('/v1/models', anthropicMiddleware.handle, (_req, res) => {
  const aliases = aliasManager.getAll();
  const models = aliases.map(a => ({
    type: 'model',
    id: a.name,
    display_name: a.description || a.name,
    created_at: new Date().toISOString(),
  }));

  res.json({
    object: 'list',
    data: models,
  });
});

// POST /v1/messages — with full Anthropic compatibility
app.post('/v1/messages', anthropicMiddleware.handle, async (req, res) => {
  const start = Date.now();
  logger.info('Anthropic request received', {
    model: req.body?.model,
    messageCount: (req.body?.messages as Array<unknown> | undefined)?.length,
    stream: req.body?.stream,
  });

  try {
    await anthropicController.handleMessages(
      req as any,
      res as any,
      req.body ?? {},
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Internal error';
    logger.error('Anthropic handler failed', { error: message });
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message },
      }));
    }
  }

  const duration = Date.now() - start;
  logger.info('Anthropic response sent', { durationMs: duration });
});

// ─── Start ───
const server = http.createServer(app).listen(PORT, HOST, () => {
  logger.info(`Anthropic Compatibility Server running on ${HOST}:${PORT}`);
  logger.info(`POST /v1/messages → ${GATEWAY_URL}/v1/chat/completions`);
  logger.info(`GET /v1/models  → ${aliasManager.count} virtual models`);
  logger.info('Anthropic auth: ' + (process.env.REQUIRE_API_KEY === 'true' ? 'enabled' : 'disabled'));
  logger.info('No routing engine, provider, or health engine modifications.');
});

// Graceful shutdown
const shutdown = () => {
  logger.info('Shutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server };
