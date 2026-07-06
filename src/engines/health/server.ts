import { ConsoleLogger } from '../../logger/console-logger.js';
import { ConfigLoader } from '../../config/config-loader.js';
import { ProviderStateRepository } from '../../repositories/provider-state-repository.js';
import { InMemoryCircuitBreakerRepository } from '../../repositories/circuit-breaker-repository.js';
import { SecurityIntegration } from '../../security/security-integration.js';
import { createEngineServer } from '../engine-server.js';
import { HealthService } from './health.service.js';
import { createHealthRouter } from './routes.js';

const PORT = parseInt(process.env.HEALTH_ENGINE_PORT || '20129', 10);

const logger = new ConsoleLogger(process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined, { service: 'health-engine' });

const configLoader = new ConfigLoader(logger);
const healthConfig = configLoader.loadHealthConfig();

const providerRepo = new ProviderStateRepository();
const circuitBreakerRepo = new InMemoryCircuitBreakerRepository();

const healthService = new HealthService(providerRepo, circuitBreakerRepo, healthConfig, logger);
healthService.startTransitionChecker();

const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

createEngineServer({
  name: 'Health Engine',
  port: PORT,
  host: '127.0.0.1',
  logger,
  security,
  configureRoutes: (app) => {
    app.use(createHealthRouter(healthService));
  },
});
