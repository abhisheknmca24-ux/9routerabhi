/**
 * Pipeline Server — runs on port 20135
 *
 * THE single execution pipeline for ALL requests:
 *   Claude Desktop, Claude CLI, Cursor, OpenAI SDK, etc.
 *
 * Pipeline: Auth → ClientDetection → ProtocolParsing → AliasResolution →
 *           PromptAnalysis → ComboSelection → ProviderHealth → Retry →
 *           Fallback → ProviderExecution → ResponseFormatter → Streaming →
 *           Analytics → AnthropicFormatter (if needed)
 *
 * Every stage reuses existing engines:
 *   - ComboSelectionStage uses existing combo profiles
 *   - ProviderHealthStage uses existing health tracker
 *   - ProviderExecutionStage uses existing HttpAgent
 *   - AliasResolutionStage uses existing AliasResolverEngine + ModelAliasManager
 *   - No duplicate routing, health, combo, or provider logic
 */

import path from 'node:path';
import { ConsoleLogger } from '../logger/console-logger.js';
import { SecurityIntegration } from '../security/security-integration.js';
import { AliasRepository } from '../repositories/alias-repository.js';
import { AliasResolverEngine } from '../services/alias-resolver-engine.js';
import { ModelAliasManager } from '../model-alias/model-alias-manager.js';
import { ProviderHealthTracker } from '../services/provider-health-tracker.js';
import { MonitoringDatabase } from '../repositories/monitoring-db.js';
import { MonitoringService } from '../services/monitoring.service.js';
import { HttpAgent } from '../performance/http-agent.js';
import { createEngineServer } from '../engines/engine-server.js';
import { createPipelineContext, createLoggingHook } from './index.js';
import {
  AuthStage, ClientDetectionStage, ProtocolParsingStage,
  AliasResolutionStage, PromptAnalysisStage, ComboSelectionStage,
  ProviderHealthStage, RetryStage, FallbackStage,
  ProviderExecutionStage, ResponseFormatterStage, StreamingStage,
  AnalyticsStage,
} from './stages/index.js';
import { AnthropicFormatterStage } from './stages/14-anthropic-formatter-stage.js';
import { PipelineEngine } from './pipeline-engine.js';

const PORT = parseInt(process.env.PIPELINE_ENGINE_PORT || '20135', 10);
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:20128';

const logger = new ConsoleLogger(
  process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
  { service: 'pipeline-engine' },
);

// ─── Dependencies (all existing engines, no duplication) ───
const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

// Alias resolution — supports both SQLite (existing) and file-based (Anthropic compat)
const aliasRepo = new AliasRepository(logger, path.resolve(process.cwd(), 'data', 'aliases.db'));
const aliasEngine = new AliasResolverEngine(aliasRepo, logger);
const fileAliases = new ModelAliasManager(path.resolve(process.cwd(), 'config', 'aliases.json'));

// Wrap both alias sources so the pipeline resolves from either
const multiAliasResolver = {
  resolve: (model: string) => {
    // Try file-based aliases first (claude-sonnet-4-5 → Coding)
    const fileResult = fileAliases.resolve(model);
    if (fileResult) return { target: fileResult, targetType: 'combo' as const };
    // Fall back to SQLite-based aliases
    return aliasEngine.resolve(model);
  },
};

const healthTracker = new ProviderHealthTracker(logger);

const monDb = new MonitoringDatabase(logger);
const monitoring = new MonitoringService(monDb, healthTracker, logger);
monitoring.start([]);

const httpAgent = new HttpAgent({ logger });

// ─── Known combo profiles (reused by ComboSelectionStage) ───
const COMBO_PROFILES: Record<string, { providers: string[]; fallback: string[] }> = {
  Coding: { providers: ['openrouter', 'nvidia'], fallback: ['cloudflare'] },
  Reasoning: { providers: ['openrouter'], fallback: ['nvidia', 'cloudflare'] },
  Chat: { providers: ['openrouter', 'nvidia', 'cloudflare'], fallback: [] },
  Balanced: { providers: ['openrouter', 'nvidia'], fallback: ['cloudflare'] },
  Vision: { providers: ['openrouter'], fallback: ['nvidia'] },
  Research: { providers: ['openrouter'], fallback: ['nvidia', 'cloudflare'] },
  Fast: { providers: ['nvidia', 'cloudflare'], fallback: [] },
  Long_Context: { providers: ['openrouter'], fallback: ['cloudflare'] },
  Planning: { providers: ['openrouter', 'nvidia'], fallback: ['cloudflare'] },
};

// ─── Build Pipeline (single pipeline for all clients) ───
function buildPipeline(): PipelineEngine {
  const pipeline = new PipelineEngine(logger);

  // Stages 1-13: shared by ALL clients (OpenAI, Anthropic, CLI, Dashboard)
  pipeline.addStage(new AuthStage(security));
  pipeline.addStage(new ClientDetectionStage());
  pipeline.addStage(new ProtocolParsingStage());
  pipeline.addStage(new AliasResolutionStage(aliasEngine, fileAliases));
  pipeline.addStage(new PromptAnalysisStage());
  pipeline.addStage(new ComboSelectionStage(COMBO_PROFILES));
  pipeline.addStage(new ProviderHealthStage(healthTracker));
  pipeline.addStage(new RetryStage());
  pipeline.addStage(new FallbackStage());
  pipeline.addStage(new ProviderExecutionStage(httpAgent, GATEWAY_URL, healthTracker));
  pipeline.addStage(new ResponseFormatterStage());
  pipeline.addStage(new StreamingStage());
  pipeline.addStage(new AnalyticsStage(monitoring, healthTracker));

  // Stage 14: Anthropic-specific formatting (only activates for anthropic-messages protocol)
  pipeline.addStage(new AnthropicFormatterStage());

  pipeline.addHook(createLoggingHook(logger));

  return pipeline;
}

const pipeline = buildPipeline();

// ─── Server ───
createEngineServer({
  name: 'Pipeline Engine',
  port: PORT,
  host: '127.0.0.1',
  logger,
  security,
  configureRoutes: (app) => {
    // ── ALL requests hit this pipeline ──
    // Whether from Claude Desktop (/v1/messages), OpenAI SDK (/v1/chat/completions),
    // or dashboard (internal). One pipeline. One routing engine. One set of providers.

    app.post('/v1/chat/completions', async (req, res) => {
      const ctx = createPipelineContext(req as any, res as any, req.body || {});
      await pipeline.execute(ctx);
      if (ctx.error && !res.headersSent) {
        res.statusCode = ctx.error.statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { message: ctx.error.message, code: ctx.error.code } }));
      }
    });

    app.post('/v1/messages', async (req, res) => {
      const ctx = createPipelineContext(req as any, res as any, req.body || {});
      await pipeline.execute(ctx);

      if (ctx.error && !res.headersSent) {
        const anthropicError = ctx.error.statusCode === 429 ? 'rate_limit_error'
          : ctx.error.statusCode === 401 ? 'authentication_error'
          : ctx.error.statusCode === 403 ? 'permission_error'
          : 'api_error';
        res.statusCode = ctx.error.statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({
          type: 'error',
          error: { type: anthropicError, message: ctx.error.message },
        }));
        return;
      }

      // Response already formatted by AnthropicFormatterStage
      if (ctx.metadata['anthropicFormatted']) {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('x-request-id', ctx.requestId);
        res.setHeader('anthropic-version', '2023-06-01');
        res.end(ctx.responseData?.content || '');
      }
    });

    // Model list — returns virtual Anthropic model names for Claude Desktop
    app.get('/v1/models', async (_req, res) => {
      const aliases = fileAliases.getAll();
      const models = aliases.map(a => ({
        type: 'model',
        id: a.name,
        display_name: a.description || a.name,
        created_at: new Date().toISOString(),
      }));
      res.json({ object: 'list', data: models });
    });

    app.get('/api/pipeline/timeline', (_req, res) => {
      res.json({
        pipeline: '14-stage pipeline',
        stages: [
          'auth', 'client-detection', 'protocol-parsing', 'alias-resolution',
          'prompt-analysis', 'combo-selection', 'provider-health', 'retry-config',
          'fallback-config', 'provider-execution', 'response-formatter',
          'streaming', 'analytics', 'anthropic-formatter',
        ],
      });
    });
  },
});
