import path from 'node:path';
import { ConsoleLogger } from '../../logger/console-logger.js';
import { SecurityIntegration } from '../../security/security-integration.js';
import { AliasRepository } from '../../repositories/alias-repository.js';
import { AliasService } from '../../services/alias.service.js';
import { createEngineServer } from '../engine-server.js';
import { RoutingService, type AliasResolver } from './routing.service.js';
import { createRoutingRouter } from './routes.js';

const PORT = parseInt(process.env.ROUTING_ENGINE_PORT || '20130', 10);

const logger = new ConsoleLogger(process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined, { service: 'routing-engine' });

const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

// Wire alias resolution into routing
const configDir = path.resolve(process.env.CONFIG_DIR || path.join(process.cwd(), 'config'));
const aliasRepo = new AliasRepository(logger, configDir);
const aliasService = new AliasService(aliasRepo, logger);
const aliasResolver: AliasResolver = {
  resolve: (name) => aliasService.resolveAlias(name),
};

const routingService = new RoutingService(
  configDir,
  logger,
  aliasResolver,
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
