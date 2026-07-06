/**
 * Pipeline Server — runs on port 20135
 *
 * The ONE execution pipeline for ALL requests.
 *
 * Pipeline: Auth → ClientDetection → ProtocolParsing → AliasResolution →
 *           PromptAnalysis → ComboSelection → ProviderHealth → Retry →
 *           Fallback → ProviderExecution → ResponseFormatter → Streaming → Analytics
 *
 * Every stage is independent, testable, and has injected dependencies.
 */

import path from 'node:path';
import { ConsoleLogger } from '../logger/console-logger.js';
import { SecurityIntegration } from '../security/security-integration.js';
import { AliasRepository } from '../repositories/alias-repository.js';
import { AliasResolverEngine } from '../services/alias-resolver-engine.js';
import { ProviderHealthTracker } from '../services/provider-health-tracker.js';
import { MonitoringDatabase } from '../repositories/monitoring-db.js';
import { MonitoringService } from '../services/monitoring.service.js';
import { HttpAgent } from '../performance/http-agent.js';
import { createEngineServer } from '../engines/engine-server.js';
import { createPipelineContext, createLoggingHook } from './index.js';
import {
  AuthStage,
  ClientDetectionStage,
  ProtocolParsingStage,
  AliasResolutionStage,
  PromptAnalysisStage,
  ComboSelectionStage,
  ProviderHealthStage,
  RetryStage,
  FallbackStage,
  ProviderExecutionStage,
  ResponseFormatterStage,
  StreamingStage,
  AnalyticsStage,
} from './stages/index.js';
import { PipelineEngine } from './pipeline-engine.js';

const PORT = parseInt(process.env.PIPELINE_ENGINE_PORT || '20135', 10);
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:20128';

const logger = new ConsoleLogger(
  process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
  { service: 'pipeline-engine' },
);

// ─── Dependencies ───
const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

const aliasRepo = new AliasRepository(logger, path.resolve(process.cwd(), 'data', 'aliases.db'));
const aliasEngine = new AliasResolverEngine(aliasRepo, logger);

const healthTracker = new ProviderHealthTracker(logger);

const monDb = new MonitoringDatabase(logger);
const monitoring = new MonitoringService(monDb, healthTracker, logger);
monitoring.start([]);

const httpAgent = new HttpAgent({ logger });

// ─── Known combo profiles ───
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

// ─── Build Pipeline ───
function buildPipeline(): PipelineEngine {
  const pipeline = new PipelineEngine(logger);

  // Register all 13 stages
  pipeline.addStage(new AuthStage(security));
  pipeline.addStage(new ClientDetectionStage());
  pipeline.addStage(new ProtocolParsingStage());
  pipeline.addStage(new AliasResolutionStage(aliasEngine));
  pipeline.addStage(new PromptAnalysisStage());
  pipeline.addStage(new ComboSelectionStage(COMBO_PROFILES));
  pipeline.addStage(new ProviderHealthStage(healthTracker));
  pipeline.addStage(new RetryStage());
  pipeline.addStage(new FallbackStage());
  pipeline.addStage(new ProviderExecutionStage(httpAgent, GATEWAY_URL, healthTracker));
  pipeline.addStage(new ResponseFormatterStage());
  pipeline.addStage(new StreamingStage());
  pipeline.addStage(new AnalyticsStage(monitoring, healthTracker));

  // Add logging hook
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
    // Universal handler — ALL requests hit this
    app.all('/v1/chat/completions', async (req, res) => {
      const ctx = createPipelineContext(req as any, res as any, req.body || {});
      await pipeline.execute(ctx);
      if (ctx.error && !res.headersSent) {
        res.statusCode = ctx.error.statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { message: ctx.error.message, code: ctx.error.code } }));
      }
    });

    app.all('/v1/messages', async (req, res) => {
      const ctx = createPipelineContext(req as any, res as any, req.body || {});
      await pipeline.execute(ctx);
      if (ctx.error && !res.headersSent) {
        res.statusCode = ctx.error.statusCode;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { message: ctx.error.message, code: ctx.error.code } }));
      }
    });

    app.get('/v1/models', async (_req, res) => {
      try {
        const response = await httpAgent.get(`${GATEWAY_URL}/v1/models`);
        res.json(response.data || { data: [] });
      } catch {
        res.json({ data: [] });
      }
    });

    // Pipeline debug endpoint — returns the last request's timeline
    app.get('/api/pipeline/timeline', (_req, res) => {
      res.json({ pipeline: '13-stage pipeline', stages: [
        'auth', 'client-detection', 'protocol-parsing', 'alias-resolution',
        'prompt-analysis', 'combo-selection', 'provider-health', 'retry-config',
        'fallback-config', 'provider-execution', 'response-formatter',
        'streaming', 'analytics',
      ]});
    });
  },
});
