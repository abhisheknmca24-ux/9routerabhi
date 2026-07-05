const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { SecurityHeaders } = require(path.join(__dirname, '..', 'shared', 'security', 'security-headers.js'));
const { RateLimiter } = require(path.join(__dirname, '..', 'shared', 'security', 'rate-limiter.js'));

const app = express();
const PORT = process.env.OBSERVABILITY_ENGINE_PORT || 20131;
const PROJECT_ROOT = path.resolve(__dirname, '..');

const securityHeaders = new SecurityHeaders();
const rateLimiter = new RateLimiter({ windowMs: 60000, maxRequests: 200 });
const DATA_DIR = path.join(__dirname, 'data');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const metrics = { requests: {}, errors: {}, latencies: [], providers: {} };
const events = [];

app.use(express.json({ limit: '5mb' }));
app.use(securityHeaders.apply.bind(securityHeaders));
app.use((req, res, next) => {
  const check = rateLimiter.check(req.ip);
  if (!check.allowed) {
    res.setHeader('Retry-After', check.retryAfter);
    return res.status(429).json({ error: { message: 'Too many requests', type: 'rate_limit_error' } });
  }
  next();
});

app.post('/metrics/ingest', (req, res) => {
  const data = req.body;
  if (!data) return res.status(400).json({ error: 'No data provided' });

  if (data.metrics) {
    if (data.metrics.provider) {
      const p = data.metrics.provider;
      metrics.providers[p] = metrics.providers[p] || { requests: 0, errors: 0, latencies: [] };
      metrics.providers[p].requests += data.metrics.requests || 0;
      metrics.providers[p].errors += data.metrics.errors || 0;
      if (data.metrics.latency) metrics.providers[p].latencies.push(data.metrics.latency);
    }
    metrics.requests.total = (metrics.requests.total || 0) + (data.metrics.requests || 0);
    metrics.errors.total = (metrics.errors.total || 0) + (data.metrics.errors || 0);
    if (data.metrics.latency) {
      metrics.latencies.push(data.metrics.latency);
      if (metrics.latencies.length > 10000) metrics.latencies.splice(0, metrics.latencies.length - 10000);
    }
  }

  if (data.event) {
    events.push(data.event);
    if (events.length > 10000) events.shift();
  }

  res.json({ status: 'ingested' });
});

app.get('/metrics', (req, res) => {
  const sorted = [...metrics.latencies].sort((a, b) => a - b);
  const total = sorted.length;
  const avg = total > 0 ? sorted.reduce((a, b) => a + b, 0) / total : 0;

  res.json({
    requests: metrics.requests,
    errors: metrics.errors,
    errorRate: metrics.requests.total > 0 ? metrics.errors.total / metrics.requests.total : 0,
    latency: {
      avg,
      p50: total > 0 ? sorted[Math.floor(total * 0.5)] : 0,
      p95: total > 0 ? sorted[Math.floor(total * 0.95)] : 0,
      p99: total > 0 ? sorted[Math.floor(total * 0.99)] : 0,
      min: sorted[0] || 0,
      max: sorted[total - 1] || 0,
      samples: total,
    },
    providers: Object.fromEntries(Object.entries(metrics.providers).map(([k, v]) => [k, { requests: v.requests, errors: v.errors, avgLatency: v.latencies.length > 0 ? v.latencies.reduce((a, b) => a + b, 0) / v.latencies.length : 0 }])),
    uptime: process.uptime(),
  });
});

app.get('/metrics/provider/:id', (req, res) => {
  const p = metrics.providers[req.params.id];
  if (!p) return res.status(404).json({ error: 'Provider not found' });
  res.json(p);
});

app.get('/events', (req, res) => {
  const { since, type, limit = 100 } = req.query;
  let result = events;
  if (since) result = result.filter(e => new Date(e.timestamp).getTime() >= new Date(since).getTime());
  if (type) result = result.filter(e => e.type === type);
  res.json(result.slice(-parseInt(limit)));
});

app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    metricsStored: metrics.latencies.length,
    eventsStored: events.length,
    providersTracked: Object.keys(metrics.providers).length,
    timestamp: new Date().toISOString(),
  });
});

app.post('/reset', (req, res) => {
  metrics.requests = {};
  metrics.errors = {};
  metrics.latencies = [];
  metrics.providers = {};
  events.length = 0;
  res.json({ status: 'reset' });
});

const server = http.createServer(app).listen(PORT, '127.0.0.1', () => {
  console.log(`Observability Engine running on port ${PORT}`);
});

function shutdown() {
  console.log('Observability Engine shutting down...');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
