import { Router } from 'express';
import { AliasResolverEngine } from '../../services/alias-resolver-engine.js';

export function createAliasRouter(engine: AliasResolverEngine): Router {
  const router = Router();

  /** GET /api/aliases — list aliases with filters, search, sort, pagination */
  router.get('/', (req, res) => {
    const params = {
      search: req.query.search as string | undefined,
      targetType: req.query.targetType as 'combo' | 'model' | undefined,
      enabled: req.query.enabled !== undefined ? req.query.enabled === 'true' : undefined,
      sortBy: req.query.sortBy as 'name' | 'priority' | 'createdAt' | 'updatedAt' | undefined,
      sortOrder: req.query.sortOrder as 'asc' | 'desc' | undefined,
      page: req.query.page ? parseInt(req.query.page as string, 10) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
    };
    res.json(engine.list(params));
  });

  /** GET /api/aliases/stats — alias system statistics */
  router.get('/stats', (_req, res) => {
    res.json(engine.getStats());
  });

  /** GET /api/aliases/:name — get a single alias */
  router.get('/:name', (req, res) => {
    const alias = engine.get(req.params.name);
    if (!alias) return res.status(404).json({ error: `Alias "${req.params.name}" not found` });
    res.json(alias);
  });

  /** POST /api/aliases — create a new alias */
  router.post('/', (req, res) => {
    const { name, target, targetType, enabled, priority, description } = req.body;

    if (!name || !target) {
      return res.status(400).json({ errors: [{ field: 'name', message: 'Name and target are required' }] });
    }
    if (!targetType || !['combo', 'model'].includes(targetType)) {
      return res.status(400).json({ errors: [{ field: 'targetType', message: 'targetType must be "combo" or "model"' }] });
    }

    // Validate combo profile
    const COMBO_PROFILES = ['Coding', 'Reasoning', 'Chat', 'Balanced', 'Vision', 'Research', 'Fast', 'Long_Context', 'Planning'];
    if (targetType === 'combo' && !COMBO_PROFILES.includes(target)) {
      return res.status(400).json({ errors: [{ field: 'target', message: `Invalid combo profile "${target}". Valid: ${COMBO_PROFILES.join(', ')}` }] });
    }

    // Duplicate check
    if (engine.get(name)) {
      return res.status(409).json({ errors: [{ field: 'name', message: `Alias "${name}" already exists` }] });
    }

    // Name validation
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name)) {
      return res.status(400).json({ errors: [{ field: 'name', message: 'Name must start with letter/number and contain only letters, numbers, dots, hyphens, underscores' }] });
    }

    try {
      const alias = engine.create({ name, target, targetType, enabled, priority, description });
      res.status(201).json(alias);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** PUT /api/aliases/:name — update an alias */
  router.put('/:name', (req, res) => {
    if (!engine.get(req.params.name)) {
      return res.status(404).json({ error: `Alias "${req.params.name}" not found` });
    }

    const updates: Record<string, unknown> = {};
    if (req.body.target !== undefined) updates.target = req.body.target;
    if (req.body.targetType !== undefined) updates.targetType = req.body.targetType;
    if (req.body.enabled !== undefined) updates.enabled = req.body.enabled;
    if (req.body.priority !== undefined) updates.priority = req.body.priority;
    if (req.body.description !== undefined) updates.description = req.body.description;

    const updated = engine.update(req.params.name, updates);
    if (!updated) return res.status(500).json({ error: 'Update failed' });
    res.json(updated);
  });

  /** DELETE /api/aliases/:name — delete an alias */
  router.delete('/:name', (req, res) => {
    const deleted = engine.delete(req.params.name);
    if (!deleted) return res.status(404).json({ error: `Alias "${req.params.name}" not found` });
    res.json({ status: 'deleted' });
  });

  /** PATCH /api/aliases/:name/toggle — enable/disable */
  router.patch('/:name/toggle', (req, res) => {
    const { enabled } = req.body;
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }
    const alias = engine.toggle(req.params.name, enabled);
    if (!alias) return res.status(404).json({ error: `Alias "${req.params.name}" not found` });
    res.json(alias);
  });

  /** POST /api/aliases/import — bulk import */
  router.post('/import', (req, res) => {
    const { aliases, overwrite } = req.body;
    if (!Array.isArray(aliases)) {
      return res.status(400).json({ error: 'aliases must be an array' });
    }
    const result = engine.importAliases(aliases, overwrite === true);
    res.json(result);
  });

  /** GET /api/aliases/export/download — export as JSON download */
  router.get('/export/download', (_req, res) => {
    const aliases = engine.exportAliases();
    res.setHeader('Content-Disposition', 'attachment; filename="gateway-aliases.json"');
    res.setHeader('Content-Type', 'application/json');
    res.json(aliases);
  });

  /** POST /api/aliases/preview — preview what a model name resolves to */
  router.post('/preview', (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model is required' });
    const result = engine.preview(model);
    res.json(result);
  });

  /** POST /api/aliases/test — test an alias live (resolve + check) */
  router.post('/test', (req, res) => {
    const { model } = req.body;
    if (!model) return res.status(400).json({ error: 'model is required' });

    const resolved = engine.resolve(model);
    const alias = engine.get(model);

    if (!alias) {
      return res.json({ found: false, message: `No alias found for "${model}"` });
    }
    if (!alias.enabled) {
      return res.json({ found: true, enabled: false, message: `Alias "${model}" exists but is disabled`, alias });
    }

    res.json({
      found: true,
      enabled: true,
      alias,
      resolved: resolved ? { target: resolved.target, targetType: resolved.targetType } : null,
      message: `"${model}" → ${alias.target} (${alias.targetType})`,
    });
  });

  return router;
}
