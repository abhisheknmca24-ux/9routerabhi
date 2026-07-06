import express from 'express';
import http from 'node:http';
import { type Logger } from '../types/logger.types.js';
import { SecurityIntegration } from '../security/security-integration.js';

export interface EngineOptions {
  name: string;
  port: number;
  host?: string;
  logger: Logger;
  security?: SecurityIntegration;
  configureRoutes: (app: express.Application) => void;
}

export function createEngineServer(opts: EngineOptions): http.Server {
  const app = express();
  app.use(express.json());

  if (opts.security) {
    app.use((req, res, next) => opts.security!.middleware(req as Parameters<SecurityIntegration['middleware']>[0], res as Parameters<SecurityIntegration['middleware']>[1], next));
  }

  opts.configureRoutes(app);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    opts.logger.error('Unhandled engine error', { error: err.message, path: (_req as express.Request).path });
    res.status(500).json({ error: 'Internal server error' });
  });

  const server = http.createServer(app).listen(opts.port, opts.host || '127.0.0.1', () => {
    opts.logger.info(`${opts.name} running on port ${opts.port}`);
  });

  const shutdown = () => {
    opts.logger.info(`${opts.name} shutting down...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  return server;
}
