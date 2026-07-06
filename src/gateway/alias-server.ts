/**
 * Universal Model Alias Engine — runs on port 20132
 *
 * Sits between incoming model names and the routing engine.
 * All alias resolution happens here via the AliasResolverEngine.
 *
 * Provides:
 *   Full REST API for alias CRUD, filter/search, bulk import/export
 *   Live preview and testing endpoints
 *   Dashboard UI
 *   Usage statistics tracking
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { ConsoleLogger } from '../logger/console-logger.js';
import { AliasRepository } from '../repositories/alias-repository.js';
import { AliasResolverEngine } from '../services/alias-resolver-engine.js';
import { createAliasRouter } from '../gateway/routes/alias.routes.js';
import { createEngineServer } from '../engines/engine-server.js';
import { SecurityIntegration } from '../security/security-integration.js';

const PORT = parseInt(process.env.ALIAS_ENGINE_PORT || '20132', 10);

const logger = new ConsoleLogger(
  process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
  { service: 'alias-engine' },
);

const dbPath = path.resolve(process.cwd(), 'data', 'aliases.db');
const repository = new AliasRepository(logger, dbPath);
const engine = new AliasResolverEngine(repository, logger);

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
    // API routes (engine handles all /api/aliases)
    app.use('/api/aliases', createAliasRouter(engine));

    // Resolution endpoint (used by routing engine)
    app.get('/api/aliases/resolve/:name', (req, res) => {
      const result = engine.resolve(req.params.name);
      if (!result) {
        return res.status(404).json({ error: `Alias "${req.params.name}" not found or disabled` });
      }
      res.json(result);
    });

    // Dashboard UI
    app.get('/aliases', (_req, res) => {
      const htmlPath = path.resolve(process.cwd(), 'src', 'gateway', 'routes', 'alias-dashboard.html');
      if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
      const distPath = path.resolve(process.cwd(), 'dist', 'gateway', 'routes', 'alias-dashboard.html');
      if (fs.existsSync(distPath)) return res.sendFile(distPath);
      res.status(404).type('text').send('Dashboard not found');
    });
  },
});
