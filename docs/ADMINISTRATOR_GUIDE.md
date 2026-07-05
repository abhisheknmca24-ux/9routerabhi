# Administrator Guide

## System Overview

The 9Router AI Gateway consists of 4 services:

| Service | Port | Purpose |
|---------|------|---------|
| 9Router Gateway | 20128 | Primary API endpoint, model routing, provider management |
| Health Engine | 20129 | Provider health monitoring, circuit breakers |
| Routing Engine | 20130 | Routing policy resolution, failover chain |
| Observability Engine | 20131 | Metrics, events, latency tracking |

## Starting the System

### Start all services
```bash
# Terminal 1: Gateway
npm start

# Terminal 2: Sub-engines
node health-engine/server.js &
node routing-engine/server.js &
node observability-engine/server.js &

# Or use PM2
npm install -g pm2
pm2 start ecosystem.config.cjs
```

### Verify all services
```bash
# Gateway
curl http://localhost:20128/api/health

# Sub-engines
curl http://localhost:20129/health
curl http://localhost:20130/routing/status
curl http://localhost:20131/health
```

## Configuration Management

### Environment Variables (`.env`)

Required variables for each active provider:

| Variable | Provider | Required |
|----------|----------|----------|
| `OPENROUTER_API_KEY` | OpenRouter | Yes |
| `NVIDIA_API_KEY` | NVIDIA NIM | Yes |
| `CLOUDFLARE_API_KEY` | Cloudflare Workers AI | Yes |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare Workers AI | Yes |

### Provider Configuration (`config/providers/providers.json`)

Each provider requires:
- `id` — Unique provider identifier
- `name` — Display name
- `type` — Authentication type (`api-key`)
- `enabled` — `true` or `false`
- `models` — Array of model identifiers
- `auth` — API key reference and endpoint URL
- `priority` — Failover priority (lower = higher priority)

### Routing Configuration (`config/routing/routing-policy.json`)

3-tier failover:
1. **Primary** — OpenRouter (min health 0.8, max latency 10s)
2. **Secondary** — NVIDIA NIM (min health 0.7, max latency 15s)
3. **Fallback** — Cloudflare Workers AI (min health 0.5, max latency 30s)

## Security Administration

### Enabling authentication
1. Set `REQUIRE_API_KEY=true` in `.env`
2. Generate a random `API_KEY_SECRET`
3. Restart the gateway
4. Distribute API key to clients

### Managing API keys
```bash
# Send API key in requests
curl -H "x-api-key: your-api-key" http://localhost:20128/v1/models
curl -H "Authorization: Bearer your-api-key" http://localhost:20128/v1/models
```

### Rate limiting
Default: 100 requests per 60-second window per client. Adjust in `.env`:
```bash
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
```

## Claude Desktop Administration

### Deploying Gateway config via registry (Windows)
```powershell
New-Item -Path "HKLM:\SOFTWARE\Policies\Claude" -Force
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Claude" -Name "inferenceProvider" -Value "gateway"
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Claude" -Name "inferenceBaseUrl" -Value "http://localhost:20128"
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Claude" -Name "inferenceApiKey" -Value "sk-placeholder"
Set-ItemProperty -Path "HKLM:\SOFTWARE\Policies\Claude" -Name "inferenceAuthType" -Value "bearer"
```

### Per-user config location
`%LOCALAPPDATA%\Claude-3p\configLibrary\` — One JSON file per configuration. `_meta.json` controls which config is active.

## Monitoring

### Health checks
```bash
# All providers
curl http://localhost:20129/health/providers

# Specific provider
curl http://localhost:20129/health/provider/nvidia

# Circuit breakers
curl http://localhost:20129/health/circuit-breakers
```

### Metrics
```bash
# All metrics
curl http://localhost:20131/metrics

# Per-provider
curl http://localhost:20131/metrics/provider/nvidia

# Events
curl http://localhost:20131/events
```

### Logs
Logs are written to `logs/` directory in JSON format with automatic rotation (100MB, 30-day retention). Secrets and PII are automatically redacted.

## Backup

```bash
# Create backup
npm run backup

# View backups
ls backups/
```

Backups include all configuration, test files, and scripts with SHA-256 checksum manifests.

## Troubleshooting

See `docs/TROUBLESHOOTING_GUIDE.md` for detailed troubleshooting procedures.
