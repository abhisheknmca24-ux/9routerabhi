/**
 * Timeline Engine — runs on port 20136
 *
 * Captures every request's full execution trace and serves
 * the timeline dashboard with charts, export, search, and live updates.
 */

import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { ConsoleLogger } from '../logger/console-logger.js';
import { createEngineServer } from '../engines/engine-server.js';
import { SecurityIntegration } from '../security/security-integration.js';
import { TimelineRepository } from '../repositories/timeline-repository.js';
import { TimelineService } from '../services/timeline.service.js';

const PORT = parseInt(process.env.TIMELINE_ENGINE_PORT || '20136', 10);

const logger = new ConsoleLogger(
  process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined,
  { service: 'timeline-engine' },
);

const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

const repository = new TimelineRepository(logger);
const timelineService = new TimelineService(repository, logger);

// Prune records older than 30 days on startup
repository.prune(30);

createEngineServer({
  name: 'Timeline Engine',
  port: PORT,
  host: '127.0.0.1',
  logger,
  security,
  configureRoutes: (app) => {
    // ─── REST API ───

    /** GET /api/timeline — list records with filters */
    app.get('/api/timeline', (req, res) => {
      const filter = {
        search: req.query.search as string | undefined,
        client: req.query.client as string | undefined,
        model: req.query.model as string | undefined,
        success: req.query.success !== undefined ? req.query.success === 'true' : undefined,
        aliased: req.query.aliased !== undefined ? req.query.aliased === 'true' : undefined,
        streamed: req.query.streamed !== undefined ? req.query.streamed === 'true' : undefined,
        minLatency: req.query.minLatency ? parseInt(req.query.minLatency as string) : undefined,
        maxLatency: req.query.maxLatency ? parseInt(req.query.maxLatency as string) : undefined,
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
        sortBy: req.query.sortBy as 'timestamp' | 'latencyMs' | 'tokens' | 'cost' | undefined,
        sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
        page: req.query.page ? parseInt(req.query.page as string) : undefined,
        limit: req.query.limit ? parseInt(req.query.limit as string) : undefined,
      };
      res.json(timelineService.list(filter));
    });

    /** GET /api/timeline/stats — aggregate stats */
    app.get('/api/timeline/stats', (req, res) => {
      const filter = {
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      };
      res.json(timelineService.getStats(filter));
    });

    /** GET /api/timeline/:requestId — single record */
    app.get('/api/timeline/:requestId', (req, res) => {
      const record = timelineService.get(req.params.requestId);
      if (!record) return res.status(404).json({ error: 'Record not found' });
      res.json(record);
    });

    /** GET /api/timeline/export/json — export all as JSON */
    app.get('/api/timeline/export/json', (req, res) => {
      const records = timelineService.exportJSON({
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      });
      res.setHeader('Content-Disposition', 'attachment; filename="timeline-export.json"');
      res.json(records);
    });

    /** GET /api/timeline/export/csv — export all as CSV */
    app.get('/api/timeline/export/csv', (req, res) => {
      const csv = timelineService.exportCSV({
        startDate: req.query.startDate as string | undefined,
        endDate: req.query.endDate as string | undefined,
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="timeline-export.csv"');
      res.send(csv);
    });

    /** POST /api/timeline/capture — capture a pipeline result */
    app.post('/api/timeline/capture', (req, res) => {
      const ctx = req.body;
      if (!ctx || !ctx.requestId) return res.status(400).json({ error: 'Pipeline context required' });
      // Store as-is from pipeline (the timeline service expects PipelineContext)
      // For now, store the raw record
      repository.insert({
        requestId: ctx.requestId || `req_${Date.now()}`,
        timestamp: ctx.timestamp || new Date().toISOString(),
        client: ctx.client || 'unknown',
        protocol: ctx.protocol || 'unknown',
        model: ctx.model || 'unknown',
        aliased: ctx.aliased || false,
        providers: (ctx.providers || []).join(', '),
        latencyMs: ctx.latencyMs || 0,
        success: ctx.success !== false,
        streamed: ctx.streamed || false,
        retries: ctx.retries || 0,
        fallbacks: ctx.fallbacks || 0,
        tokens: ctx.tokens || 0,
        cost: ctx.cost || 0,
        stageTimeline: JSON.stringify(ctx.stages || []),
        promptPreview: ctx.promptPreview || '',
        responseLength: ctx.responseLength || 0,
      });
      res.json({ status: 'captured' });
    });

    /** Dashboard UI */
    app.get('/timeline', (_req, res) => {
      const htmlPath = path.resolve(process.cwd(), 'src', 'gateway', 'timeline-dashboard.html');
      if (fs.existsSync(htmlPath)) return res.sendFile(htmlPath);
      const distPath = path.resolve(process.cwd(), 'dist', 'gateway', 'timeline-dashboard.html');
      if (fs.existsSync(distPath)) return res.sendFile(distPath);
      res.status(404).type('text').send('Dashboard not found');
    });
  },
});
