/**
 * 9Router AI Gateway — Main Entry Point
 *
 * This is kept minimal intentionally. The 9router package monkey-patches
 * http.createServer and runs its own Next.js-based proxy internally.
 * We wrap around it.
 */

import { ConsoleLogger } from '../logger/console-logger.js';
import { ConfigLoader } from '../config/config-loader.js';

const logger = new ConsoleLogger(
  (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') ?? 'info',
  { service: '9router-gateway' },
);

const port = parseInt(process.env.PORT || '20128', 10);
const host = process.env.HOST || '0.0.0.0';

// Read config (validates on startup)
const configDir = process.env.CONFIG_DIR || __dirname + '/../config';
const configLoader = new ConfigLoader(logger, configDir);

try {
  const configs = configLoader.loadAll();
  logger.info('Configuration loaded successfully', {
    providers: configs.providers.providers.length,
    routingTiers: configs.routing.tiers.length,
  });
} catch (err) {
  logger.error('Failed to load configuration', { error: (err as Error).message });
  process.exit(1);
}

// Set environment variables for 9router consumption
process.env.CONFIG_DIR = configDir;
process.env.PROJECT_ROOT = process.cwd();
process.env.LOGS_DIR = process.env.LOGS_DIR || __dirname + '/../../logs';

console.log(`Starting 9Router on ${host}:${port} ...`);

// Load 9router custom-server — this monkey-patches http.createServer
// and starts the 9Router Next.js server as a side effect
require('../../node_modules/9router/app/custom-server');

function shutdown(): void {
  console.log('Gateway shutting down...');
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGBREAK', shutdown);
