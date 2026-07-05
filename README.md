# 9Router AI Gateway

**Multi-provider AI gateway with automatic failover, health monitoring, observability, and Claude Desktop / Claude Code support.**

Built on [9Router](https://9router.ai) — adds enterprise-grade security, three dedicated micro-engines, combo model profiles, and production documentation.

---

## Features

- **Unified API** — Single endpoint (`http://localhost:20128`) for all providers
- **Multi-Provider Routing** — OpenRouter, NVIDIA NIM, Cloudflare Workers AI
- **Automatic Failover** — If a provider fails, the gateway retries and switches to the next available provider
- **Health Monitoring** — Real-time provider health tracking with circuit breakers
- **9 Combo Profiles** — Abstract model selectors: `Coding`, `Reasoning`, `Chat`, `Balanced`, `Vision`, `Research`, `Fast`, `Long_Context`, `Planning`
- **OpenAI-Compatible API** — Use any OpenAI SDK by changing the base URL
- **Anthropic-Compatible API** — Native `/v1/messages` endpoint for Claude Desktop gateway mode
- **Streaming Support** — SSE streaming with backpressure handling
- **Rate Limiting** — Per-IP sliding window rate limiter
- **Authentication** — API key and JWT-based auth (optional)
- **Audit Logging** — Rotating audit trail with PII redaction
- **Secret Management** — AES-256-GCM encrypted secret storage
- **Backup & Restore** — Automated with SHA-256 checksum verification
- **Observability** — Metrics ingestion, latency percentiles, event tracking
- **Production Docs** — 17 documents: admin guide, security guide, runbook, troubleshooting

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│              9Router Gateway (port 20128)              │
│  OpenAI API  │  Anthropic API  │  Model Routing       │
│  Auth  │  Rate Limiting  │  Provider Dispatch         │
├──────────────────────────────────────────────────────┤
│  Health Engine    │  Routing Engine  │  Obs Engine   │
│  (port 20129)     │  (port 20130)    │  (port 20131)  │
├──────────────────────────────────────────────────────┤
│  Shared Modules                                        │
│  ┌────────────────┐  ┌──────────────────────────────┐ │
│  │  Performance   │  │         Security             │ │
│  │  Cache         │  │  Auth Middleware             │ │
│  │  Scheduler     │  │  Log Sanitizer              │ │
│  │  Stream Opt    │  │  Rate Limiter               │ │
│  │  Benchmark     │  │  Secret Manager             │ │
│  └────────────────┘  │  Audit Logger               │ │
│                      │  Backup Manager             │ │
│                      │  Integrity Verifier         │ │
│                      │  Security Monitor           │ │
│                      └──────────────────────────────┘ │
├──────────────────────────────────────────────────────┤
│  Config: providers  │  routing  │  health  │  retry   │
│         fallback  │  logging  │  profiles  │  server   │
└──────────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE_AND_WORKFLOW.md](docs/ARCHITECTURE_AND_WORKFLOW.md) for detailed diagrams.

---

## Quick Start

### Requirements

- **Node.js** >= 18.0.0
- **npm** (comes with Node.js)

### Installation

```bash
git clone <repository-url>
cd 9router-abhi
npm install
```

### Configuration

1. Copy the environment template:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add at least one provider API key:

   | Variable | Provider | Required |
   |----------|----------|----------|
   | `OPENROUTER_API_KEY` | OpenRouter | Optional |
   | `NVIDIA_API_KEY` | NVIDIA NIM | Optional |
   | `CLOUDFLARE_API_KEY` | Cloudflare AI | Optional |
   | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare AI | Required for Cloudflare |

3. Configure providers in `config/providers/providers.json`

### Run

```bash
# Start the gateway
npm start

# Or start all engines
node server.js & node health-engine/server.js & node routing-engine/server.js & node observability-engine/server.js
```

The gateway starts on **http://localhost:20128**.

---

## API Endpoints

### `GET /v1/models`
Returns available models (30+ models including 9 combo profiles).

### `POST /v1/chat/completions`
OpenAI-compatible chat completions.

```json
{
  "model": "Balanced",
  "messages": [{"role": "user", "content": "Hello!"}],
  "max_tokens": 100
}
```

### `POST /v1/messages`
Anthropic-compatible messages API (for Claude Desktop gateway mode).

### `GET /api/health`
Gateway health status.

---

## Combo Profiles

| Profile | Best For |
|---------|----------|
| `Coding` | Code generation & completion |
| `Reasoning` | Logical deduction & analysis |
| `Chat` | General conversation |
| `Balanced` | Best overall quality/speed |
| `Vision` | Image understanding |
| `Research` | Deep reasoning & complex tasks |
| `Fast` | Low-latency responses |
| `Long_Context` | Large documents |
| `Planning` | Structured task breakdown |

---

## Claude Desktop Gateway

1. Open Claude Desktop → **Help → Troubleshooting → Enable Developer Mode**
2. Go to **Developer → Configure Third-Party Inference**
3. Set **Inference provider** to **Gateway**
4. Set **Gateway base URL** to `http://localhost:20128`
5. Apply and start a conversation

See [docs/CLAUDE_DESKTOP_GATEWAY_GUIDE.md](docs/CLAUDE_DESKTOP_GATEWAY_GUIDE.md).

---

## Browser MCP Configuration

```json
{
  "mcpServers": {
    "ai-gateway": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "PORT": "20128",
        "HOST": "127.0.0.1"
      }
    }
  }
}
```

---

## Supported Providers

| Provider | Priority | Models | Status |
|----------|----------|--------|--------|
| OpenRouter | 1 | 1000+ | Active |
| NVIDIA NIM | 2 | 8 | Active |
| Cloudflare Workers AI | 3 | 13 | Active |

---

## Testing

```bash
# Acceptance tests (16 tests)
npm test

# Failover tests (17 tests)
npm run test:failover

# Anthropic API tests
node tests/anthropic-api-test.js

# Chat completion verification
node tests/verify-completions.js
```

---

## Production Deployment

### PM2 (Recommended)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
```

### Docker

```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
EXPOSE 20128
CMD ["node", "server.js"]
```

### Security Checklist

- [ ] Set `HOST=127.0.0.1` in `.env`
- [ ] Set `REQUIRE_API_KEY=true` and generate a strong API key
- [ ] Deploy behind TLS-terminating reverse proxy (nginx, Caddy)
- [ ] Generate strong `JWT_SECRET`, `ENCRYPTION_KEY`, `INITIAL_PASSWORD`
- [ ] Rotate all provider API keys
- [ ] Configure rate limiting limits for your use case
- [ ] Set up monitoring and alerting

---

## Provider Failover

The gateway automatically handles provider failures:

| Error | Action |
|-------|--------|
| 401 Unauthorized | Skip provider |
| 429 Rate Limited | Retry with backoff |
| 500 Server Error | Retry |
| 502 Bad Gateway | Skip provider |
| 503 Unavailable | Wait 5s, then retry |
| 504 Timeout | Skip provider |
| Connection Timeout | Skip provider |
| Connection Reset | Retry |

Failover chain: **OpenRouter → NVIDIA NIM → Cloudflare Workers AI**

---

## Documentation

Full documentation is in the [docs/](docs/) directory:

- [Architecture & Workflow](docs/ARCHITECTURE_AND_WORKFLOW.md)
- [Administrator Guide](docs/ADMINISTRATOR_GUIDE.md)
- [Security Guide](docs/SECURITY_GUIDE.md)
- [Backup Guide](docs/BACKUP_GUIDE.md)
- [Troubleshooting Guide](docs/TROUBLESHOOTING_GUIDE.md)
- [Operational Runbook](docs/OPERATIONAL_RUNBOOK.md)
- [Claude Desktop Gateway Guide](docs/CLAUDE_DESKTOP_GATEWAY_GUIDE.md)
- [Claude Code Gateway Guide](docs/CLAUDE_CODE_GATEWAY_GUIDE.md)
- [Vanilla 9Router vs Gateway](docs/VANILLA_9ROUTER_VS_GATEWAY.md)

---

## License

MIT

---

## Troubleshooting

**Q: The gateway won't start**
- Check port 20128 is not in use
- Verify Node.js >= 18.0.0
- Check `.env` file exists

**Q: Provider returns errors**
- Verify API keys in `.env` are correct
- Check provider status in health engine: `http://localhost:20129/health`
- Review gateway logs in `logs/`

**Q: Can't connect from another machine**
- By default the gateway binds to `127.0.0.1` (localhost only)
- Set `HOST=0.0.0.0` to expose to the network (not recommended without TLS)

**Q: Streaming is slow**
- Check network latency to providers
- Adjust `max_tokens` and `temperature` parameters
- Use the `Fast` combo profile

---

*Built with [9Router](https://9router.ai)*
