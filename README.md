# 9Router AI Gateway

**Multi-provider AI gateway with 3-engine architecture, enterprise security, intelligent failover, and full Claude Desktop / Claude Code support.**

Built on top of [9Router](https://9router.com) (v0.5.18) — transforms the vanilla desktop proxy into a production-grade, team-scale AI gateway with dedicated micro-engines, 14 security modules, 6 performance modules, 9 abstract combo profiles, and 17 professional documents.

---

## What This Project Does

This project takes the **original 9Router** (a single-developer MITM proxy for routing AI tool traffic) and builds a complete **enterprise AI gateway** around it. The gateway exposes:

- **OpenAI-compatible `/v1/chat/completions` endpoint**
- **Anthropic-compatible `/v1/messages` endpoint** (native Claude Desktop gateway mode)
- **9 abstract combo profiles** instead of raw model IDs
- **3 sidecar micro-engines** for health, routing, and observability
- **14 security modules** for production-grade protection
- **6 performance modules** for caching, scheduling, and streaming

---

## What I Built vs. Original 9Router

### Original 9Router (v0.5.18)
A **desktop MITM proxy** for AI coding tools (Claude Code, Copilot, Cursor, etc.). It intercepts traffic on port 443 and maps requests to alternative models. Designed for a single developer's machine.

### What I Added (This Project)

#### 1. Three Dedicated Micro-Engines

| Engine | Port | What It Does |
|--------|------|-------------|
| **Health Engine** | `20129` | Real-time provider health tracking, circuit breaker state management, latency monitoring |
| **Routing Engine** | `20130` | Routing policy API, dynamic reloading, chain resolution |
| **Observability Engine** | `20131` | Metrics ingestion, latency percentiles, event store |

These run as independent Express microservices alongside the gateway.

#### 2. Enterprise Security Layer (14 Modules)

| Module | What It Does |
|--------|-------------|
| **Auth Middleware** | API key + JWT authentication with timing-safe comparison |
| **Rate Limiter** | Per-IP sliding window rate limiting |
| **Security Headers** | OWASP headers (HSTS, CSP, X-Frame-Options, etc.) |
| **Secret Manager** | AES-256-GCM encrypted secret storage |
| **Audit Logger** | Rotating audit trail with PII/secret redaction |
| **Log Sanitizer** | Regex-based redaction of secrets, tokens, passwords |
| **Backup Manager** | Automated SHA-256 verified backups |
| **Integrity Verifier** | File manifest + hash comparison |
| **Security Monitor** | Brute force detection, 4xx spike alerts, rate limit warnings |
| **Security Integration** | Facade that wires all security modules together |

#### 3. 9 Abstract Combo Profiles

Instead of remembering raw model IDs like `cf/@cf/meta/llama-3.1-8b-instruct-fp8-fast`, just pick a profile:

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

#### 4. Performance & Optimization (6 Modules)

| Module | What It Does |
|--------|-------------|
| **Cache** | LRU cache with configurable TTL |
| **Request Scheduler** | Priority queue with concurrency limits |
| **Stream Optimizer** | SSE streaming with backpressure handling |
| **Resource Monitor** | CPU, memory, heap tracking |
| **HTTP Agent** | Connection pooling with keep-alive |
| **Benchmark Harness** | Built-in performance benchmarking |

#### 5. Declarative JSON Configuration System

```
config/
├── providers/providers.json      Provider auth + model lists
├── routing/routing-policy.json   3-tier priority with health conditions
├── health/health-config.json     Circuit breaker thresholds
├── retry/retry-config.json       Backoff multipliers + jitter
├── fallback/fallback-config.json Per-status-code error mapping
├── logging/logging-config.json   Redaction patterns + rotation
├── server/server-config.json     CORS, body size, SSL
└── profiles/default.json         Feature flags + limits
```

All configs support `${ENV_VAR}` interpolation.

#### 6. Enterprise Failover System

Explicit error mapping with health-aware + circuit-breaker-aware fallback:

| HTTP / Error | Action |
|-------------|--------|
| 401 Unauthorized | Skip provider |
| 429 Rate Limited | Retry with exponential backoff |
| 500 Server Error | Retry with jitter |
| 502 Bad Gateway | Skip provider |
| 503 Unavailable | Wait 5s, then retry |
| 504 Timeout | Skip provider |
| Connection Timeout | Skip provider |
| Connection Reset | Retry with jitter |

Failover chain: **OpenRouter → NVIDIA NIM → Cloudflare Workers AI**

#### 7. Production Documentation (17 Documents)

| Document | Purpose |
|----------|---------|
| Architecture & Workflow | Full ASCII flow diagrams of every component |
| Administrator Guide | Startup, monitoring, troubleshooting |
| User Guide | API usage, model selection, configuration |
| Security Guide | Key management, hardening, incident response |
| Backup Guide | Automated backup/restore procedures |
| Maintenance Guide | Updates, cleanup, log rotation |
| Troubleshooting Guide | 200+ common scenarios and fixes |
| Operational Runbook | Incident response playbooks |
| Production Certification | Full 20-section audit report with all fixes documented |
| Claude Desktop Gateway Guide | Step-by-step Claude Desktop setup |
| Claude Code Gateway Guide | Claude Code CLI integration |
| Known Limitations | Current gaps and workarounds |
| Release Package | Build and deployment notes |
| Validation Checklist | Pre-deployment verification |
| Vanilla vs Gateway | Detailed comparison with original 9Router |
| Project Handoff | Complete handoff document for ops team |
| Provider Verification | Provider connectivity test results |

#### 8. Security Improvements Applied

During the production audit, **12 critical/high issues** were found and fixed:

| Issue | Fix Applied |
|-------|------------|
| Live API keys in `.env` | Removed, file gitignored |
| `timingSafeEqual` crash on mismatched buffers | Added length guard + try/catch |
| No graceful shutdown on any server | Added SIGTERM/SIGINT handlers |
| CORS wildcard `*` allowed all origins | Restricted to localhost |
| Servers bound to `0.0.0.0` | Changed to `127.0.0.1` |
| CPU calculation returned 0 | Fixed `_lastCpu` not stored |
| `createSSEStream` pushed no data | Added proper data callbacks |
| No security headers on engines | Added SecurityHeaders middleware |
| No rate limiting on engines | Added RateLimiter middleware |
| Weak default admin password | Documented as generate-random |
| Auth disabled by default | Documented production requirement |
| Secrets in git commit history | Rewritten history, purged from all commits |

#### 9. Automated Test Suite (33 Tests)

```
16 acceptance tests    — Provider routing, model listing, error responses
17 failover tests      — Provider failure, chain transitions, circuit breaker
5 Anthropic API tests  — Native /v1/messages endpoint compatibility
```

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
cd health-engine && npm install && cd ..
cd routing-engine && npm install && cd ..
cd observability-engine && npm install && cd ..
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
4. For production: set `REQUIRE_API_KEY=true`, `HOST=127.0.0.1`

### Run

```bash
# Start all engines + gateway (recommended)
npm run start:all

# Or individually:
npm start                                   # Main gateway on :20128
node health-engine/server.js                # Health engine on :20129
node routing-engine/server.js               # Routing engine on :20130
node observability-engine/server.js         # Observability engine on :20131
```

The gateway starts on **http://localhost:20128**.

### Production Deployment (PM2)

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/v1/models` | List available models (30+ models + 9 combo profiles) |
| `POST` | `/v1/chat/completions` | OpenAI-compatible chat completions |
| `POST` | `/v1/messages` | Anthropic-compatible messages (Claude Desktop) |
| `GET` | `/api/health` | Gateway health status |

### Chat Completions Example

```json
{
  "model": "Coding",
  "messages": [{"role": "user", "content": "Write a fibonacci function"}],
  "max_tokens": 500
}
```

### Claude Desktop Gateway Setup

1. Claude Desktop → **Help → Troubleshooting → Enable Developer Mode**
2. **Developer → Configure Third-Party Inference**
3. Set **Inference provider** → **Gateway**
4. Set **Gateway base URL** → `http://localhost:20128`
5. Apply and create a conversation

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                9Router Gateway (port 20128)                │
│    OpenAI API  │  Anthropic API  │  Model Routing         │
│    Auth  │  Rate Limiting  │  Provider Dispatch           │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ Health Engine│  │Routing Engine│  │ Observability  │  │
│  │   :20129     │  │   :20130     │  │  Engine :20131 │  │
│  │ Provider     │  │ Policy API   │  │  Metrics       │  │
│  │ Health       │  │ Chain Res.   │  │  Latency %tile │  │
│  │ Circuit Brkr │  │ Reload       │  │  Event Store   │  │
│  └──────────────┘  └──────────────┘  └────────────────┘  │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  Shared Modules                                           │
│  ┌─────────────────────┐  ┌──────────────────────────┐   │
│  │ AUTH  │ RATE LIMIT  │  │ SECURITY MONITOR         │   │
│  │ AUDIT │ SANITIZER   │  │ BACKUP / INTEGRITY       │   │
│  │ SECRETS │ HEADERS   │  │ SECURITY INTEGRATION     │   │
│  └─────────────────────┘  └──────────────────────────┘   │
│  ┌─────────────────────┐  ┌──────────────────────────┐   │
│  │ CACHE │ SCHEDULER   │  │ STREAM OPT / BENCHMARK   │   │
│  │ HTTP AGENT │ RSRC   │  │ RESOURCE MONITOR         │   │
│  └─────────────────────┘  └──────────────────────────┘   │
├──────────────────────────────────────────────────────────┤
│  Config: providers │ routing │ health │ retry │ fallback  │
│          logging │ profiles │ server                     │
└──────────────────────────────────────────────────────────┘
```

See [docs/ARCHITECTURE_AND_WORKFLOW.md](docs/ARCHITECTURE_AND_WORKFLOW.md) for detailed flow diagrams.

---

## Project Structure

```
├── server.js                     Gateway entry point (port 20128)
├── package.json                  Dependencies (9router + express)
├── ecosystem.config.cjs          PM2 deployment config
│
├── health-engine/                Micro-engine #1 — Health monitoring
│   └── server.js                 Express server on port 20129
│
├── routing-engine/               Micro-engine #2 — Routing policy
│   └── server.js                 Express server on port 20130
│
├── observability-engine/         Micro-engine #3 — Observability
│   └── server.js                 Express server on port 20131
│
├── shared/
│   ├── performance/              Performance modules (6)
│   │   ├── cache.js              LRU cache with TTL
│   │   ├── request-scheduler.js  Priority queue + concurrency
│   │   ├── stream-optimizer.js   SSE backpressure
│   │   ├── resource-monitor.js   CPU/memory tracking
│   │   ├── http-agent.js         Connection pooling
│   │   └── benchmark.js          Performance harness
│   └── security/                 Security modules (14)
│       ├── auth-middleware.js    API key + JWT auth
│       ├── rate-limiter.js       Sliding window rate limiter
│       ├── security-headers.js   OWASP security headers
│       ├── secret-manager.js     AES-256-GCM encryption
│       ├── audit-logger.js       Rotating audit trail
│       ├── log-sanitizer.js      PII/secret redaction
│       ├── backup-manager.js     SHA-256 verified backups
│       ├── integrity-verifier.js File manifest + hashes
│       ├── security-monitor.js   Brute force + anomaly detection
│       └── integration.js        Security facade
│
├── config/                       Declarative JSON configs (8)
│   ├── providers/providers.json
│   ├── routing/routing-policy.json
│   ├── health/health-config.json
│   ├── retry/retry-config.json
│   ├── fallback/fallback-config.json
│   ├── logging/logging-config.json
│   ├── server/server-config.json
│   └── profiles/default.json
│
├── tests/                        Test suite (33 tests)
│   ├── acceptance-test.js        16 acceptance tests
│   ├── final-failover-test.js    17 failover tests
│   ├── anthropic-api-test.js     Anthropic API tests
│   ├── routing-verification.cjs  Routing integration
│   └── verify-completions.js     Chat completion tests
│
├── docs/                         Documentation (17 documents)
│   ├── ARCHITECTURE_AND_WORKFLOW.md
│   ├── ADMINISTRATOR_GUIDE.md
│   ├── SECURITY_GUIDE.md
│   ├── CLAUDE_DESKTOP_GATEWAY_GUIDE.md
│   ├── CLAUDE_CODE_GATEWAY_GUIDE.md
│   ├── VANILLA_9ROUTER_VS_GATEWAY.md
│   ├── PRODUCTION_CERTIFICATION_REPORT.md
│   └── ... (10 more)
│
├── scripts/
│   └── backup.js                 Automated backup script
│
├── .env.example                  Environment template (gitignored .env)
├── .gitignore                    165-pattern production gitignore
├── CHANGELOG.md
└── RELEASE_NOTES.md
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
# All tests (33 total: 16 acceptance + 17 failover)
npm test

# Individual test suites
npm run test:acceptance            # 16 acceptance tests
npm run test:failover              # 17 failover tests
node tests/anthropic-api-test.js   # Anthropic compatibility
node tests/verify-completions.js   # Chat completion verification
```

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

## Documentation

| Guide | Description |
|-------|-------------|
| [Architecture & Workflow](docs/ARCHITECTURE_AND_WORKFLOW.md) | Full ASCII flow diagrams |
| [Administrator Guide](docs/ADMINISTRATOR_GUIDE.md) | Startup, monitoring, troubleshooting |
| [Security Guide](docs/SECURITY_GUIDE.md) | Key management, hardening |
| [User Guide](docs/USER_GUIDE.md) | API usage, model selection |
| [Backup Guide](docs/BACKUP_GUIDE.md) | Automated backup/restore |
| [Troubleshooting Guide](docs/TROUBLESHOOTING_GUIDE.md) | 200+ scenarios |
| [Operational Runbook](docs/OPERATIONAL_RUNBOOK.md) | Incident response |
| [Maintenance Guide](docs/MAINTENANCE_GUIDE.md) | Updates, cleanup |
| [Production Certification](docs/PRODUCTION_CERTIFICATION_REPORT.md) | Full 20-section audit |
| [Vanilla 9Router vs Gateway](docs/VANILLA_9ROUTER_VS_GATEWAY.md) | Feature comparison |
| [Claude Desktop Guide](docs/CLAUDE_DESKTOP_GATEWAY_GUIDE.md) | Desktop setup |
| [Claude Code Guide](docs/CLAUDE_CODE_GATEWAY_GUIDE.md) | CLI integration |
| [Validation Checklist](docs/VALIDATION_CHECKLIST.md) | Pre-deployment |
| [Release Package](docs/RELEASE_PACKAGE.md) | Build and deploy |
| [Known Limitations](docs/KNOWN_LIMITATIONS.md) | Current gaps |
| [Project Handoff](docs/PROJECT_HANDOFF.md) | Ops handoff |
| [Provider Verification](docs/PROVIDER_VERIFICATION_REPORT.md) | Connectivity report |

---

## License

MIT

---

*Built on [9Router](https://9router.com) v0.5.18 — 3-engine architecture, 14 security modules, 6 performance modules, 9 combo profiles, 33 tests, 17 documents.*