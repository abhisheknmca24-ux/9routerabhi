import { Router } from 'express';
import { ObservabilityService } from './observability.service.js';

export function createObservabilityRouter(service: ObservabilityService): Router {
  const router = Router();

  router.post('/metrics/ingest', (req, res) => {
    const data = req.body;
    if (!data) return res.status(400).json({ error: 'No data provided' });

    service.ingest(data);
    res.json({ status: 'ingested' });
  });

  router.get('/metrics', (_req, res) => {
    res.json(service.getMetrics());
  });

  router.get('/metrics/provider/:id', (req, res) => {
    const p = service.getProviderMetrics(req.params.id);
    if (!p) return res.status(404).json({ error: 'Provider not found' });
    res.json(p);
  });

  router.get('/events', (req, res) => {
    const { since, type, limit } = req.query as Record<string, string | undefined>;
    const events = service.getEvents({
      since,
      type,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    res.json(events);
  });

  router.get('/health', (_req, res) => {
    const metrics = service.getMetrics();
    res.json({
      status: 'healthy',
      uptime: process.uptime(),
      metricsStored: metrics.latency.samples,
      providersTracked: Object.keys(metrics.providers).length,
      timestamp: new Date().toISOString(),
    });
  });

  router.post('/reset', (_req, res) => {
    service.reset();
    res.json({ status: 'reset' });
  });

  return router;
}
