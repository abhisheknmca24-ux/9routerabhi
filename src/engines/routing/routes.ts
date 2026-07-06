import { Router } from 'express';
import { RoutingService } from './routing.service.js';

export function createRoutingRouter(service: RoutingService): Router {
  const router = Router();

  router.get('/routing/status', (_req, res) => {
    res.json(service.getStatus());
  });

  router.get('/routing/resolve', (req, res) => {
    const { model } = req.query;
    if (!model || typeof model !== 'string') {
      return res.status(400).json({ error: 'Model parameter required' });
    }

    const result = service.resolveModel(model);
    if (!result) return res.status(404).json({ error: `No provider found for model: ${model}` });

    res.json(result);
  });

  router.get('/routing/chain/:model', (req, res) => {
    const { model } = req.params;
    const chain = service.getChain(model);
    if (!chain) return res.status(404).json({ error: `Model ${model} not found in any routing tier` });

    res.json(chain);
  });

  router.post('/routing/reload', (_req, res) => {
    const success = service.reload();
    res.json({ status: success ? 'reloaded' : 'error' });
  });

  router.get('/routing/providers', (_req, res) => {
    res.json(service.getProviders());
  });

  return router;
}
