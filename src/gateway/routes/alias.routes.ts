import { Router } from 'express';
import { AliasService } from '../../services/alias.service.js';

export function createAliasRouter(service: AliasService): Router {
  const router = Router();

  /** GET /api/aliases — list all aliases (with optional ?search=) */
  router.get('/', (req, res) => {
    const search = req.query.search as string | undefined;
    const aliases = service.list(search);
    res.json({ aliases, total: aliases.length });
  });

  /** GET /api/aliases/:name — get a single alias */
  router.get('/:name', (req, res) => {
    const alias = service.get(req.params.name);
    if (!alias) return res.status(404).json({ error: `Alias "${req.params.name}" not found` });
    res.json(alias);
  });

  /** POST /api/aliases — create a new alias */
  router.post('/', (req, res) => {
    const result = service.create(req.body);
    if (result.errors) {
      return res.status(400).json({ errors: result.errors });
    }
    res.status(201).json(result.alias);
  });

  /** PUT /api/aliases/:name — update an alias */
  router.put('/:name', (req, res) => {
    const result = service.update(req.params.name, req.body);
    if (result.errors) {
      return res.status(400).json({ errors: result.errors });
    }
    res.json(result.alias);
  });

  /** DELETE /api/aliases/:name — delete an alias */
  router.delete('/:name', (req, res) => {
    const deleted = service.delete(req.params.name);
    if (!deleted) return res.status(404).json({ error: `Alias "${req.params.name}" not found` });
    res.json({ status: 'deleted' });
  });

  /** PATCH /api/aliases/:name/toggle — enable/disable an alias */
  router.patch('/:name/toggle', (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    const alias = service.toggle(req.params.name, enabled);
    if (!alias) return res.status(404).json({ error: `Alias "${req.params.name}" not found` });
    res.json(alias);
  });

  /** POST /api/aliases/import — import aliases from JSON */
  router.post('/import', (req, res) => {
    const { aliases, overwrite } = req.body;
    const result = service.importAliases(aliases, overwrite === true);
    if (result.errors) {
      return res.status(400).json({ errors: result.errors });
    }
    res.json(result.result);
  });

  /** GET /api/aliases/export/download — export all aliases as JSON download */
  router.get('/export/download', (_req, res) => {
    const aliases = service.exportAliases();
    res.setHeader('Content-Disposition', 'attachment; filename="gateway-aliases.json"');
    res.json(aliases);
  });

  return router;
}
