import path from 'node:path';
import { ConsoleLogger } from '../../logger/console-logger.js';
import { SecurityIntegration } from '../../security/security-integration.js';
import { createEngineServer } from '../engine-server.js';
import { RoutingService } from './routing.service.js';
import { createRoutingRouter } from './routes.js';

const PORT = parseInt(process.env.ROUTING_ENGINE_PORT || '20130', 10);

const logger = new ConsoleLogger(process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined, { service: 'routing-engine' });

const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

const routingService = new RoutingService(
  path.resolve(process.env.CONFIG_DIR || path.join(process.cwd(), 'config')),
  logger,
);

createEngineServer({
  name: 'Routing Engine',
  port: PORT,
  host: '127.0.0.1',
  logger,
  security,
  configureRoutes: (app) => {
    app.use(createRoutingRouter(routingService));
  },
});
