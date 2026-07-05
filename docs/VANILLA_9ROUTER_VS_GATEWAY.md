# Vanilla 9Router vs. 9Router AI Gateway — Feature Comparison

## What is 9Router?

9Router (v0.5.18) is a **desktop proxy tool** that sits between AI coding tools and their upstream API providers. It intercepts traffic from:

- Claude Desktop / Claude Code
- GitHub Copilot
- Cursor
- Google IDX (antigravity)
- Kiro AI

It maps requests to alternative models/providers, acts as a local MITM proxy, and provides a Next.js admin dashboard. It stores credentials in `~/.9router/` and auto-discovers available models.

---

## Feature Comparison Matrix

| Feature | Vanilla 9Router | 9Router AI Gateway (this project) |
|---------|----------------|-----------------------------------|
| **Core Proxy** | MITM proxy on port 443 | Standalone gateway on port 20128 |
| **API Endpoints** | Internal proxy only | `/v1/chat/completions`, `/v1/messages`, `/v1/models`, `/api/health` |
| **Claude Support** | Via MITM interception | Native gateway mode + direct API |
| **Client Type** | Desktop app (CLI + system tray) | Server service (PM2, Express APIs) |
| **Provider Config** | CLI-based setup | File-based JSON configs with env-var resolution |
| **Model Discovery** | Auto-discovers from providers | Auto-discovers + 9 combo profiles |
| **Combo Profiles** | None | 9 abstract profiles: Coding, Reasoning, Chat, Balanced, Vision, Research, Fast, Long_Context, Planning |
| **Health Monitoring** | None | Dedicated Health Engine (port 20129) with circuit breakers |
| **Routing Engine** | Internal only | Dedicated Routing Engine (port 20130) with policy API |
| **Observability** | Dashboard only | Dedicated Observability Engine (port 20131) with metrics ingestion |
| **Rate Limiting** | None | Sliding window rate limiter on all engines |
| **Auth Middleware** | None | API key + JWT authentication |
| **Security Headers** | None | OWASP headers (HSTS, CSP, X-Frame-Options, etc.) |
| **Secret Manager** | Plain text in config | AES-256-GCM encrypted secrets |
| **Log Sanitization** | None | PII/secret redaction patterns |
| **Audit Logging** | None | Rotating audit trail with sanitization |
| **Backup System** | None | SHA-256 checksum verified backups |
| **Integrity Verification** | None | File manifest + hash comparison |
| **Brute Force Detection** | None | Login attempt tracking + alerts |
| **Cache Layer** | None | LRU cache with configurable TTL |
| **Request Scheduling** | None | Priority queue with concurrency limits |
| **Resource Monitoring** | None | CPU, memory, heap tracking |
| **Benchmarking** | None | Built-in benchmark harness |
| **Stream Optimization** | Native only | Backpressure handling + SSE formatting |
| **Failover Config** | Implicit | Explicit error code mapping (401-504 + network errors) |
| **Retry Config** | Implicit | Exponential backoff with jitter + configurable delays |
| **TLS Termination** | MITM CA only | Configurable SSL (disabled, behind reverse proxy recommended) |
| **Production Config** | None | PM2 ecosystem, server config, logging config |
| **Documentation** | Minimal | 17 documents: Admin, User, Security, Backup, Troubleshooting, Runbook, etc. |

---

## What Makes This Project Unique

### 1. Three-Engine Architecture (Health + Routing + Observability)

Vanilla 9Router handles everything internally. This project splits concerns into three dedicated microservices:

- **Health Engine** — Real-time provider health tracking, circuit breaker state management, latency monitoring
- **Routing Engine** — Exposes routing policies via API, supports dynamic reloading, provides chain resolution
- **Observability Engine** — Metrics ingestion, latency percentile calculations, event store

These engines run independently and can be queried without affecting the main gateway.

### 2. Enterprise Security Layer

Vanilla 9Router has no security model. This project adds:

```
┌─────────────────────────────────────────────┐
│           SecurityIntegration                 │
│  ┌──────────┐ ┌──────────┐ ┌─────────────┐  │
│  │  Auth    │ │  Rate    │ │  Security    │  │
│  │Middleware│ │  Limiter │ │  Headers    │  │
│  ├──────────┤ ├──────────┤ ├─────────────┤  │
│  │  Audit   │ │  Secret  │ │  Log         │  │
│  │  Logger  │ │  Manager │ │  Sanitizer  │  │
│  ├──────────┤ ├──────────┤ ├─────────────┤  │
│  │  Backup  │ │Integrity │ │  Security   │  │
│  │  Manager │ │ Verifier │ │  Monitor    │  │
│  └──────────┘ └──────────┘ └─────────────┘  │
└─────────────────────────────────────────────┘
```

All wired via a single `SecurityIntegration` facade class.

### 3. Combo Profile Abstraction

Instead of requiring users to know specific model IDs (`cf/@cf/meta/llama-3.1-8b-instruct-fp8-fast`), the gateway provides **9 abstract profiles**:

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

Users just say `model: "Coding"` and the gateway routes to the best provider+model for coding.

### 4. Declarative Configuration System

Vanilla 9Router uses CLI prompts and a file-based config in `~/.9router/`. This project uses **version-controllable JSON configs**:

```
config/
├── providers/providers.json      ← Provider auth + model lists
├── routing/routing-policy.json   ← 3-tier priority with health conditions
├── health/health-config.json     ← Circuit breaker thresholds
├── retry/retry-config.json       ← Backoff multipliers + jitter
├── fallback/fallback-config.json ← Per-status-code error mapping
├── logging/logging-config.json   ← Redaction patterns + rotation
├── server/server-config.json     ← CORS, body size, SSL
└── profiles/default.json         ← Feature flags + limits
```

Every config supports `${ENV_VAR}` interpolation and has env-var fallbacks.

### 5. Enterprise-Grade Failover

Vanilla 9Router fails over implicitly. This project has an **explicit error mapping table**:

```json
{
  "401": { "action": "skip_provider" },
  "429": { "action": "retry_with_backoff" },
  "503": { "action": "wait_and_retry", "waitMs": 5000 },
  "ETIMEDOUT": { "action": "skip_provider" },
  "ECONNRESET": { "action": "retry" }
}
```

Health-aware + circuit-breaker-aware fallback.

### 6. Production Documentation

Vanilla 9Router has a README. This project has **17 documents** covering:
- Administrator guide (startup, monitoring, troubleshooting)
- User guide (API usage, model selection)
- Security guide (key management, hardening)
- Backup guide (automated backup/restore)
- Maintenance guide (updates, cleanup)
- Troubleshooting guide (200+ scenarios)
- Operational runbook (incident response)
- Claude Desktop/Code gateway guides
- Production certification report

### 7. Security-Observability Loop

```
Request → Auth → Rate Limit → Audit Log → Sanitize Log → Security Monitor
    │                                                        │
    └────────────────── Alert on anomalies ←─────────────────┘
```

Brute force detection, 4xx error spike detection, and rate limit warnings are automatically tracked by the SecurityMonitor.

---

## When to Use Which

| Use Case | Vanilla 9Router | 9Router AI Gateway |
|----------|----------------|-------------------|
| Personal dev machine proxy | ✅ Best choice | ❌ Overkill |
| Team production deployment | ❌ No security | ✅ Enterprise ready |
| Claude Desktop interception | ✅ Native | ✅ Gateway mode |
| OpenAI-compatible API | ❌ MITM only | ✅ Native endpoints |
| Multi-provider failover | ❌ Implicit | ✅ Explicit + configurable |
| Production observability | ❌ None | ✅ 3 engines |
| Enterprise security audit | ❌ None | ✅ 14 security modules |
| Need combo profiles | ❌ None | ✅ 9 abstract profiles |
| Need dashboard UI | ✅ Built-in | ✅ Via 9Router |
| Need HTTPS termination | ✅ MITM CA | ❌ Behind reverse proxy |

---

## Summary

**Vanilla 9Router** is a desktop MITM proxy for routing AI tool traffic through alternative models. It's designed for a single developer's machine.

**9Router AI Gateway** wraps 9Router with a complete enterprise production layer: three dedicated micro-engines, 14 security modules, 6 performance modules, declarative JSON configs, combo profile abstractions, explicit failover policies, and 17 production documents. It exposes OpenAI-compatible and Anthropic-compatible API endpoints so any client can use it.

The gateway is what you'd get if you took 9Router and built a production-grade AI gateway around it — keeping the model routing/proxy core while adding everything needed for team-scale, security-audited, observable deployment.
