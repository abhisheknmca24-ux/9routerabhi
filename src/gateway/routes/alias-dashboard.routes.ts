import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';

export function createAliasDashboardRouter(): Router {
  const router = Router();

  // Serve the HTML dashboard at GET /aliases
  router.get('/', (_req, res) => {
    const htmlPath = path.resolve(process.cwd(), 'src', 'gateway', 'routes', 'alias-dashboard.html');
    if (!fs.existsSync(htmlPath)) {
      // Also try compiled output location
      const distPath = path.resolve(process.cwd(), 'dist', 'gateway', 'routes', 'alias-dashboard.html');
      if (fs.existsSync(distPath)) {
        return res.sendFile(distPath);
      }
      return res.status(500).type('text').send('Dashboard HTML not found');
    }
    res.sendFile(htmlPath);
  });

  return router;
}
