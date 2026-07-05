const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { SecurityHeaders } = require(path.join(__dirname, '..', 'shared', 'security', 'security-headers.js'));
const { RateLimiter } = require(path.join(__dirname, '..', 'shared', 'security', 'rate-limiter.js'));

const app = express();
const PORT = process.env.ROUTING_ENGINE_PORT || 20130;
const PROJECT_ROOT = path.resolve(__dirname, '..');

const securityHeaders = new SecurityHeaders();
const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 200 });
const routingPath = path.join(PROJECT_ROOT, 'config', 'routing', 'routing-policy.json');
const providersPath = path.join(PROJECT_ROOT, 'config', 'providers', 'providers.json');

let routingPolicy = { strategy: 'priority-failover', tiers: [], defaultTier: 'primary' };
let providers = { providers: [], providerOrder: [] };

function loadConfig() {
  if (fs.existsSync(routingPath)) {
    routingPolicy = JSON.parse(fs.readFileSync(routingPath, 'utf8'));
  }
  if (fs.existsSync(providersPath)) {
    providers = JSON.parse(fs.readFileSync(providersPath, 'utf8'));
  }
}

loadConfig();

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

app.get('/routing/status', (req, res) => {
  res.json({
    strategy: routingPolicy.strategy,
    tiers: routingPolicy.tiers.map(t => ({ name: t.name, providers: t.providers })),
    defaultTier: routingPolicy.defaultTier,
    providerCount: providers.providers.length,
    enabledCount: providers.providers.filter(p => p.enabled).length,
    providerOrder: providers.providerOrder,
  });
});

app.get('/routing/resolve', (req, res) => {
  const { model } = req.query;
  if (!model) return res.status(400).json({ error: 'Model parameter required' });

  const providerId = model.split('/')[0];
  const provider = providers.providers.find(p => p.id === providerId);

  if (!provider) return res.status(404).json({ error: `No provider found for model: ${model}` });
  if (!provider.enabled) return res.status(404).json({ error: `Provider ${providerId} is disabled` });

  const tier = routingPolicy.tiers.find(t => t.providers.includes(providerId));
  res.json({
    model,
    provider: provider.id,
    tier: tier ? tier.name : routingPolicy.defaultTier,
    endpoint: provider.auth?.endpoint,
    priority: provider.priority,
    models: provider.models,
  });
});

app.get('/routing/chain/:model', (req, res) => {
  const { model } = req.params;
  const providerId = model.split('/')[0];

  const chain = [];
  let found = false;

  for (const tier of routingPolicy.tiers) {
    for (const pid of tier.providers) {
      const p = providers.providers.find(pr => pr.id === pid && pr.enabled);
      if (p) {
        chain.push({ provider: p.id, tier: tier.name, endpoint: p.auth?.endpoint, priority: p.priority });
        if (pid === providerId) found = true;
      }
    }
  }

  if (!found) return res.status(404).json({ error: `Model ${model} not found in any routing tier` });
  res.json({ model, chain, chainLength: chain.length, strategy: routingPolicy.strategy });
});

app.post('/routing/reload', (req, res) => {
  loadConfig();
  res.json({ status: 'reloaded' });
});

app.get('/routing/providers', (req, res) => {
  res.json(providers.providers.map(p => ({ id: p.id, name: p.name, enabled: p.enabled, type: p.type, models: p.models, priority: p.priority })));
});

const server = http.createServer(app).listen(PORT, '127.0.0.1', () => {
  console.log(`Routing Engine running on port ${PORT}`);
});

function shutdown() {
  console.log('Routing Engine shutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
