import { Router } from 'express';
import { HealthService } from './health.service.js';

export function createHealthRouter(service: HealthService): Router {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json(service.getHealthSummary());
  });

  router.get('/health/providers', (_req, res) => {
    const statuses: Record<string, unknown> = {};
    const summary = service.getHealthSummary();
    res.json(summary.providers);
  });

  router.get('/health/provider/:id', (req, res) => {
    const state = service.getProviderStatus(req.params.id);
    if (!state) return res.status(404).json({ error: 'Provider not found' });
    res.json(state);
  });

  router.post('/health/report', (req, res) => {
    const { provider, status, latency, error } = req.body;
    if (!provider) return res.status(400).json({ error: 'Provider name required' });

    const result = service.reportHealth({ provider, status, latency, error });
    res.json(result);
  });

  router.post('/health/reset', (req, res) => {
    const { provider } = req.body;
    service.reset(provider);
    res.json({ status: 'reset' });
  });

  router.get('/health/circuit-breakers', (_req, res) => {
    res.json(service.getCircuitBreakers());
  });

  return router;
}
