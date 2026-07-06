/**
 * Provider Monitoring Engine — runs on port 20133
 *
 * Tracks per-provider metrics in SQLite with time-series snapshots.
 * Serves a real-time dashboard with health history and charts.
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { ConsoleLogger } from '../logger/console-logger.js';
import { SecurityIntegration } from '../security/security-integration.js';
import { ProviderHealthTracker } from '../services/provider-health-tracker.js';
import { MonitoringDatabase } from '../repositories/monitoring-db.js';
import { MonitoringService } from '../services/monitoring.service.js';
import { createEngineServer } from '../engines/engine-server.js';
import { Router } from 'express';

const PORT = parseInt(process.env.MONITORING_ENGINE_PORT || '20133', 10);

const logger = new ConsoleLogger(
  process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
  { service: 'monitoring-engine' },
);

const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

// Read providers config for initial setup
const configDir = process.env.CONFIG_DIR || path.resolve(process.cwd(), 'config');
const providersPath = path.join(configDir, 'providers', 'providers.json');
let providerIds: string[] = [];
try {
  if (fs.existsSync(providersPath)) {
    const data = JSON.parse(fs.readFileSync(providersPath, 'utf-8'));
    providerIds = (data.providers || []).map((p: { id: string }) => p.id);
  }
} catch {
  logger.warn('Could not load providers for monitoring');
}

// Wire up monitoring components
const healthTracker = new ProviderHealthTracker(logger);
const db = new MonitoringDatabase(logger);
const monitoringService = new MonitoringService(db, healthTracker, logger, 60_000);
monitoringService.start(providerIds);

// We'll create a second router for monitoring-specific stuff beyond the health tracker
function createMonitoringRouter() {
  const router = Router();

  /** GET /api/monitoring/status — current status of all providers */
  router.get('/status', (_req, res) => {
    res.json(monitoringService.getCurrentStatus());
  });

  /** GET /api/monitoring/summary — aggregate summary */
  router.get('/summary', (_req, res) => {
    res.json(monitoringService.getSummary());
  });

  /** GET /api/monitoring/provider/:id/history — time-series history */
  router.get('/provider/:id/history', (req, res) => {
    const hours = parseInt(req.query.hours as string) || 24;
    const history = monitoringService.getProviderHistory(req.params.id, hours);
    const daily = monitoringService.getDailyStats(req.params.id, 30);
    res.json({ history, daily });
  });

  /** POST /api/monitoring/report — report a request outcome */
  router.post('/report', (req, res) => {
    const { providerId, status, latencyMs, statusCode, errorType, tokens, cost } = req.body;
    if (!providerId || !status) return res.status(400).json({ error: 'providerId and status required' });

    monitoringService.report({
      providerId,
      status,
      latencyMs: latencyMs || 0,
      statusCode,
      errorType,
      tokens,
      cost,
    });

    res.json({ status: 'recorded' });
  });

  /** POST /api/monitoring/providers — refresh provider list */
  router.post('/providers', (req, res) => {
    const { providers } = req.body;
    if (!Array.isArray(providers)) return res.status(400).json({ error: 'providers array required' });
    monitoringService.refreshProviderList(providers);
    res.json({ status: 'updated', count: providers.length });
  });

  return router;
}

createEngineServer({
  name: 'Monitoring Engine',
  port: PORT,
  host: '127.0.0.1',
  logger,
  security,
  configureRoutes: (app) => {
    app.use('/api/monitoring', createMonitoringRouter());

    // Dashboard UI at /monitoring
    app.get('/monitoring', (_req, res) => {
      const htmlPath = path.resolve(process.cwd(), 'src', 'gateway', 'monitoring-dashboard.html');
      if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
      const distPath = path.resolve(process.cwd(), 'dist', 'gateway', 'monitoring-dashboard.html');
      if (fs.existsSync(distPath)) return res.sendFile(distPath);
      res.status(404).type('text').send('Dashboard HTML not found');
    });
  },
});
