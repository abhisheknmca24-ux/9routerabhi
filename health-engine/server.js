const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { SecurityHeaders } = require(path.join(__dirname, '..', 'shared', 'security', 'security-headers.js'));
const { RateLimiter } = require(path.join(__dirname, '..', 'shared', 'security', 'rate-limiter.js'));

const app = express();
const PORT = process.env.HEALTH_ENGINE_PORT || 20129;
const PROJECT_ROOT = path.resolve(__dirname, '..');
const healthConfigPath = path.join(PROJECT_ROOT, 'config', 'health', 'health-config.json');

const securityHeaders = new SecurityHeaders();
const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 200 });

const config = { checkInterval: 30000, unhealthyThreshold: 3, healthyThreshold: 2, cooldownPeriod: 300000 };
if (fs.existsSync(healthConfigPath)) {
  Object.assign(config, JSON.parse(fs.readFileSync(healthConfigPath, 'utf8')));
}

const providerHealth = new Map();
const circuitBreakerState = new Map();

app.use(express.json());
app.use(securityHeaders.apply.bind(securityHeaders));
app.use((req, res, next) => {
  const check = rateLimiter.check(req.ip);
  if (!check.allowed) {
    res.setHeader('Retry-After', check.retryAfter);
    return res.status(429).json({ error: { message: 'Too many requests', type: 'rate_limit_error' } });
  }
  next();
});

app.get('/health', (req, res) => {
  const statuses = {};
  for (const [provider, state] of providerHealth) {
    statuses[provider] = state;
  }
  res.json({
    status: [...providerHealth.values()].some(s => s.status === 'healthy') ? 'healthy' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    providers: statuses,
    circuitBreakers: Object.fromEntries([...circuitBreakerState].map(([k, v]) => [k, v.state])),
  });
});

app.get('/health/providers', (req, res) => {
  const statuses = {};
  for (const [provider, state] of providerHealth) {
    statuses[provider] = state;
  }
  res.json(statuses);
});

app.get('/health/provider/:id', (req, res) => {
  const state = providerHealth.get(req.params.id);
  if (!state) return res.status(404).json({ error: 'Provider not found' });
  res.json(state);
});

app.post('/health/report', (req, res) => {
  const { provider, status, latency, error } = req.body;
  if (!provider) return res.status(400).json({ error: 'Provider name required' });

  const prev = providerHealth.get(provider) || { status: 'unknown', failures: 0, successes: 0, lastCheck: null, latency: [] };
  const now = Date.now();

  if (status === 'healthy' || status === 'ok') {
    prev.successes = (prev.successes || 0) + 1;
    prev.failures = 0;
    if (prev.successes >= config.healthyThreshold) {
      prev.status = 'healthy';
      circuitBreakerState.set(provider, { state: 'closed', lastFailure: null });
    }
  } else {
    prev.failures = (prev.failures || 0) + 1;
    if (prev.failures >= config.unhealthyThreshold) {
      prev.status = 'unhealthy';
      circuitBreakerState.set(provider, { state: 'open', lastFailure: now, openedAt: now });
    } else {
      prev.status = 'degraded';
    }
  }

  if (latency) {
    prev.latency = prev.latency || [];
    prev.latency.push(latency);
    if (prev.latency.length > 10) prev.latency.shift();
    prev.avgLatency = prev.latency.reduce((a, b) => a + b, 0) / prev.latency.length;
  }

  prev.lastCheck = new Date().toISOString();
  if (error) prev.lastError = error;
  providerHealth.set(provider, prev);

  res.json({ status: 'reported', provider, currentStatus: prev.status });
});

app.post('/health/reset', (req, res) => {
  const { provider } = req.body;
  if (provider) {
    providerHealth.delete(provider);
    circuitBreakerState.delete(provider);
  } else {
    providerHealth.clear();
    circuitBreakerState.clear();
  }
  res.json({ status: 'reset' });
});

app.get('/health/circuit-breakers', (req, res) => {
  res.json(Object.fromEntries([...circuitBreakerState].map(([k, v]) => [k, v])));
});

setInterval(() => {
  const now = Date.now();
  for (const [provider, state] of circuitBreakerState) {
    if (state.state === 'open' && now - state.openedAt > config.cooldownPeriod) {
      state.state = 'half-open';
    }
  }
}, 10000);

const server = http.createServer(app).listen(PORT, '127.0.0.1', () => {
  console.log(`Health Engine running on port ${PORT}`);
});

function shutdown() {
  console.log('Health Engine shutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
