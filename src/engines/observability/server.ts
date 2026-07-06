import { ConsoleLogger } from '../../logger/console-logger.js';
import { MetricsRepository } from '../../repositories/metrics-repository.js';
import { SecurityIntegration } from '../../security/security-integration.js';
import { createEngineServer } from '../engine-server.js';
import { ObservabilityService } from './observability.service.js';
import { createObservabilityRouter } from './routes.js';

const PORT = parseInt(process.env.OBSERVABILITY_ENGINE_PORT || '20131', 10);

const logger = new ConsoleLogger(process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error' | undefined, { service: 'observability-engine' });

const security = new SecurityIntegration({
  requireAuth: process.env.REQUIRE_API_KEY === 'true',
  logger,
});

const metricsRepo = new MetricsRepository();
const observabilityService = new ObservabilityService(metricsRepo, logger);

createEngineServer({
  name: 'Observability Engine',
  port: PORT,
  host: '127.0.0.1',
  logger,
  security,
  configureRoutes: (app) => {
    app.use(createObservabilityRouter(observabilityService));
  },
});
