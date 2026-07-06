import path from 'node:path';
import fs from 'node:fs';
import { ConsoleLogger } from '../../logger/console-logger.js';
import { SecurityIntegration } from '../../security/security-integration.js';
import { AliasRepository } from '../../repositories/alias-repository.js';
import { AliasService } from '../../services/alias.service.js';
import { ProviderHealthTracker } from '../../services/provider-health-tracker.js';
import { IntelligentRouter } from '../../services/intelligent-router.js';
import { createEngineServer } from '../engine-server.js';
import { RoutingService, type AliasResolver } from './routing.service.js';
import { createRoutingRouter } from './routes.js';
import { Router } from 'express';

const PORT = parseInt(process.env.ROUTING_ENGINE_PORT || '20130', 10);

const logger = new ConsoleLogger(
  process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
  { service: 'routing-engine' },
);

const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

// Wire alias resolution into routing
const configDir = path.resolve(process.env.CONFIG_DIR || path.join(process.cwd(), 'config'));
const aliasRepo = new AliasRepository(logger, configDir);
const aliasService = new AliasService(aliasRepo, logger);
const aliasResolver: AliasResolver = {
  resolve: (name) => aliasService.resolveAlias(name),
};

// Intelligent routing components
const healthTracker = new ProviderHealthTracker(logger);
const intelligentRouter = new IntelligentRouter(healthTracker, logger);

const routingService = new RoutingService(
  configDir,
  logger,
  aliasResolver,
);

// Helper to read providers config
function loadProviders() {
  const providerPath = path.join(configDir, 'providers', 'providers.json');
  if (!fs.existsSync(providerPath)) return null;
  return JSON.parse(fs.readFileSync(providerPath, 'utf-8'));
}

createEngineServer({
  name: 'Routing Engine',
  port: PORT,
  host: '127.0.0.1',
  logger,
  security,
  configureRoutes: (app) => {
    // Core routing endpoints
    app.use(createRoutingRouter(routingService));

    // Intelligent routing endpoints
    const intelligentRouter_router = Router();

    /** GET /routing/intelligent/health — provider health scores */
    intelligentRouter_router.get('/health', (_req, res) => {
      res.json(healthTracker.getAllScores());
    });

    /** GET /routing/intelligent/order — get ranked provider order */
    intelligentRouter_router.get('/order', (req, res) => {
      const providers = loadProviders();
      if (!providers) return res.status(500).json({ error: 'No providers config' });
      const model = req.query.model as string | undefined;
      const ranked = intelligentRouter.getRoutingOrder(providers, model);
      res.json({
        order: ranked.map(p => ({
          id: p.id,
          name: p.name,
          priority: p.priority,
          healthScore: healthTracker.getScore(p.id).healthScore,
          avgLatency: healthTracker.getScore(p.id).avgLatencyMs,
          status: healthTracker.getScore(p.id).status,
        })),
      });
    });

    /** POST /routing/intelligent/report — report a routing outcome */
    intelligentRouter_router.post('/report', (req, res) => {
      const { provider, status, latencyMs } = req.body;
      if (!provider) return res.status(400).json({ error: 'Provider required' });

      if (status === 'success') {
        intelligentRouter.recordSuccess(provider, latencyMs || 0);
        return res.json({ status: 'recorded', type: 'success' });
      }

      // It's a failure — determine action and failover
      const providers = loadProviders();
      const result = intelligentRouter.handleFailure(provider, status, providers || { providers: [], defaultProvider: '', fallbackProvider: '', providerOrder: [] });
      res.json({
        status: 'recorded',
        type: 'failure',
        failureType: result.action === 'disable_provider' ? 'auth_failure' : 'routing_failure',
        action: result.action,
        ...(result.failoverTo ? {
          failoverTo: {
            id: result.failoverTo.id,
            name: result.failoverTo.name,
            endpoint: result.failoverTo.auth?.endpoint,
            priority: result.failoverTo.priority,
          },
        } : { chainExhausted: true }),
      });
    });

    /** GET /routing/intelligent/summary — summary of all provider health */
    intelligentRouter_router.get('/summary', (_req, res) => {
      res.json(intelligentRouter.getHealthSummary());
    });

    /** POST /routing/intelligent/reenable — re-enable a disabled provider */
    intelligentRouter_router.post('/reenable', (req, res) => {
      const { provider } = req.body;
      if (!provider) return res.status(400).json({ error: 'Provider required' });
      healthTracker.reenable(provider);
      res.json({ status: 'reenabled', provider });
    });

    app.use('/routing/intelligent', intelligentRouter_router);
  },
});
