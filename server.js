const path = require('path');
const fs = require('fs');

const projectRoot = __dirname;
const configDir = path.join(projectRoot, 'config');
const logsDir = path.join(projectRoot, 'logs');

if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const port = parseInt(process.env.PORT || '20128', 10);
const host = process.env.HOST || '0.0.0.0';

process.env.CONFIG_DIR = configDir;
process.env.PROJECT_ROOT = projectRoot;
process.env.LOGS_DIR = logsDir;
process.env.PORT = String(port);
process.env.HOSTNAME = host;

const config = {
  port,
  host,
  configDir,
  logsDir,
  providersPath: path.join(configDir, 'providers', 'providers.json'),
  routingPath: path.join(configDir, 'routing', 'routing-policy.json'),
  healthPath: path.join(configDir, 'health', 'health-config.json'),
  retryPath: path.join(configDir, 'retry', 'retry-config.json'),
  fallbackPath: path.join(configDir, 'fallback', 'fallback-config.json'),
  loggingPath: path.join(configDir, 'logging', 'logging-config.json'),
  serverConfigPath: path.join(configDir, 'server', 'server-config.json'),
  sharedPath: path.join(projectRoot, 'shared'),
};

console.log('Starting 9Router on', host + ':' + port, '...');

// custom-server monkey-patches http.createServer and then starts the 9Router Next.js server
require('9router/app/custom-server');

function shutdown() {
  console.log('Gateway shutting down...');
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('SIGBREAK', shutdown);
