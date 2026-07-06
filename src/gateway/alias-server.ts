/**
 * Standalone Alias Engine — runs on port 20132
 *
 * Provides:
 *   GET  /api/aliases          — List/search aliases
 *   GET  /api/aliases/:name    — Get single alias
 *   POST /api/aliases          — Create alias
 *   PUT  /api/aliases/:name    — Update alias
 *   DELETE /api/aliases/:name  — Delete alias
 *   PATCH /api/aliases/:name/toggle — Enable/disable
 *   POST /api/aliases/import   — Import JSON
 *   GET  /api/aliases/export/download — Export as JSON file
 *   GET  /aliases              — Dashboard UI
 *   GET  /api/aliases/resolve/:name — Resolve an alias to its target
 */

import express from 'express';
import http from 'node:http';
import path from 'node:path';
import { ConsoleLogger } from '../logger/console-logger.js';
import { AliasRepository } from '../repositories/alias-repository.js';
import { AliasService } from '../services/alias.service.js';
import { createAliasRouter } from '../gateway/routes/alias.routes.js';
import { createAliasDashboardRouter } from '../gateway/routes/alias-dashboard.routes.js';
import { createEngineServer } from '../engines/engine-server.js';
import { SecurityIntegration } from '../security/security-integration.js';

const PORT = parseInt(process.env.ALIAS_ENGINE_PORT || '20132', 10);

const logger = new ConsoleLogger(
  process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
  { service: 'alias-engine' },
);

const configDir = process.env.CONFIG_DIR || path.resolve(process.cwd(), 'config');
const repository = new AliasRepository(logger, configDir);
const service = new AliasService(repository, logger);
const apiRouter = createAliasRouter(service);
const dashboardRouter = createAliasDashboardRouter();

const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

createEngineServer({
  name: 'Alias Engine',
  port: PORT,
  host: '127.0.0.1',
  logger,
  security,
  configureRoutes: (app) => {
    // API routes
    app.use('/api/aliases', apiRouter);

    // Dashboard UI route
    app.use('/aliases', dashboardRouter);

    // Alias resolution endpoint (used by routing engine)
    app.get('/api/aliases/resolve/:name', (req, res) => {
      const result = service.resolveAlias(req.params.name);
      if (!result) return res.status(404).json({ error: `Alias "${req.params.name}" not found or disabled` });
      res.json(result);
    });
  },
});
