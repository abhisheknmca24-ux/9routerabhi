# 9Router AI Gateway — Architecture & Workflow

## Full Request Flow Diagram

```
                              USER / CLIENT
                    ┌───────────────────────────────┐
                    │  Claude Desktop                │
                    │  Claude Code CLI               │
                    │  OpenAI SDK / HTTP Client      │
                    │  Any OpenAI-compatible client  │
                    └──────────┬────────────────────┘
                               │
                               │ POST /v1/chat/completions
                               │ POST /v1/messages
                               │ GET  /v1/models
                               │
                               ▼
              ┌──────────────────────────────────────┐
              │         9ROUTER GATEWAY              │◄── Port 20128
              │         (Next.js / MITM Proxy)       │
              │                                      │
              │  ┌────────────────────────────────┐  │
              │  │        REQUEST ROUTER           │  │
              │  │  • Model → provider resolution │  │
              │  │  • Priority failover chain     │  │
              │  │  • OpenAI / Anthropic format    │  │
              │  │  • SSE streaming passthrough    │  │
              │  │  • Auth check                   │  │
              │  └──────────┬─────────────────────┘  │
              │             │                         │
              │             ▼                         │
              │  ┌────────────────────────────────┐  │
              │  │      PROVIDER DISPATCH          │  │
              │  │  • Auto-discovers models        │  │
              │  │  • Routes to best provider      │  │
              │  │  • Handles retry logic          │  │
              │  │  • Circuit breaker awareness    │  │
              │  └────────────────────────────────┘  │
              └──────────────────────────────────────┘
                         │              │
           ┌─────────────┼──────────────┼─────────────┐
           │             │              │              │
           ▼             ▼              ▼              ▼
   ┌────────────┐ ┌──────────┐ ┌────────────┐ ┌──────────────┐
   │ OpenRouter │ │ NVIDIA   │ │ Cloudflare │ │ (Future      │
   │ (Priority 1│ │ NIM      │ │ Workers AI │ │  Providers)  │
   │  auth: key) │ │(Priority │ │ (Priority 3│ │              │
   └────────────┘ │ 2)       │ │  auth: key │ └──────────────┘
                  └──────────┘ │  + account) │
                               └────────────┘
           │                    │                    │
           ▼                    ▼                    ▼
   ┌─────────────────────────────────────────────────────┐
   │                   AI PROVIDERS                       │
   │  • OpenRouter API     • NVIDIA NIM API               │
   │  • Cloudflare Workers AI                             │
   │  (Response streamed back through gateway → client)   │
   └─────────────────────────────────────────────────────┘
```

## Sidecar Engine Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                    9ROUTER GATEWAY (port 20128)                    │
│  Primary proxy — handles all user-facing API traffic              │
│  Built on Next.js 16.2.1 with MITM proxy capabilities             │
│  Auto-discovers models from providers                             │
└────────────────┬─────────────────────────────────────────────────┘
                 │  Internal communication
    ┌────────────┼────────────┬────────────────────┐
    │            │            │                    │
    ▼            ▼            ▼                    ▼
┌────────┐ ┌────────┐ ┌────────────┐ ┌────────────────────┐
│ HEALTH │ │ROUTING │ │OBSERVABILITY│ │    SECURITY        │
│ ENGINE │ │ ENGINE │ │  ENGINE     │ │    MODULES         │
│ :20129 │ │ :20130 │ │  :20131     │ │  (Shared Library)  │
├────────┤ ├────────┤ ├────────────┤ ├────────────────────┤
│Provider│ │Routing │ │Metrics     │ │• AuthMiddleware    │
│ health │ │policy  │ │ingestion   │ │• RateLimiter       │
│ status │ │resolve │ │Latency     │ │• LogSanitizer      │
│Circuit │ │chain   │ │tracking    │ │• SecretManager     │
│breaker │ │reload  │ │Events      │ │• AuditLogger       │
│state   │ │providers││store       │ │• SecurityMonitor   │
└────────┘ └────────┘ └────────────┘ │• BackupManager     │
                                     │• IntegrityVerifier │
                                     │• SecurityHeaders   │
                                     └────────────────────┘
```

## Retry & Failover Flow

```
                    ┌────────────┐
                    │  CLIENT    │
                    │  REQUEST   │
                    └─────┬──────┘
                          │
                          ▼
               ┌─────────────────────┐
               │   Try Provider #1   │◄── OpenRouter (Priority 1)
               │   (OpenRouter)      │
               └─────────┬───────────┘
                    │          │
               SUCCESS     FAILURE
                    │          │
                    │          ▼
                    │   ┌─────────────────────┐
                    │   │  Check error type   │
                    │   │                     │
                    │   │  401 → skip     ────┼──→ skip provider
                    │   │  429 → retry+backoff│──→ retry with delay
                    │   │  500 → retry        │──→ retry immediately
                    │   │  502 → skip         │──→ skip provider
                    │   │  503 → wait+retry   │──→ wait 5s then retry
                    │   │  504 → skip         │──→ skip provider
                    │   │  timeout → skip     │──→ skip provider
                    │   └──────────┬──────────┘
                    │              │
                    │         RETRY LIMIT
                    │         REACHED (3)?
                    │              │
                    │         YES  │  NO
                    │              │  └──→ retry same provider
                    │              ▼
                    │   ┌─────────────────────┐
                    │   │   Try Provider #2   │◄── NVIDIA (Priority 2)
                    │   │   (NVIDIA)          │
                    │   └─────────┬───────────┘
                    │        │         │
                    │   SUCCESS    FAILURE → Try Provider #3 (Cloudflare)
                    │        │
                    │        ▼
                    │   ┌─────────────────────┐
                    │   │   Try Provider #3   │◄── Cloudflare (Priority 3)
                    │   │   (Cloudflare)      │
                    │   └─────────┬───────────┘
                    │        │         │
                    │   SUCCESS    ALL FAILED
                    │        │         │
                    │        ▼         ▼
                    │   ┌─────────────────────┐
                    │   │   Return Response   │   Return Error
                    │   │   to Client         │   to Client
                    │   └─────────────────────┘
                    │
                    └──── ALL PATHS RETURN TO CLIENT
```

## Model Routing (Combo Profiles)

```
                    ┌─────────────────────────────┐
                    │   9 COMBO PROFILES           │
                    │  (Abstract model selectors)  │
                    ├─────────────────────────────┤
                    │  Coding      → best code AI │
                    │  Reasoning   → best logic AI│
                    │  Chat        → best chat AI │
                    │  Balanced    → best overall │
                    │  Vision      → multimodal   │
                    │  Research    → deep reasoning│
                    │  Fast        → low latency  │
                    │  Long_Context→ large context│
                    │  Planning    → structured   │
                    └──────────────┬──────────────┘
                                   │
                                   ▼
                         ┌──────────────────┐
                         │  9Router resolves │
                         │  combo → actual   │
                         │  model per tier   │
                         └──────────────────┘
```

## Provider Tier Priority

```
                    ┌────────────────────────────────────┐
                    │          TIER 1: PRIMARY           │
                    │  ┌──────────────────────────────┐  │
                    │  │  OpenRouter  (Priority 1)     │  │
                    │  │  Condition: health ≥ 0.8     │  │
                    │  │  Condition: latency ≤ 10s    │  │
                    │  └──────────────────────────────┘  │
                    ├────────────────────────────────────┤
                    │          TIER 2: SECONDARY         │
                    │  ┌──────────────────────────────┐  │
                    │  │  NVIDIA NIM  (Priority 2)     │  │
                    │  │  Condition: health ≥ 0.7     │  │
                    │  │  Condition: latency ≤ 15s    │  │
                    │  └──────────────────────────────┘  │
                    ├────────────────────────────────────┤
                    │          TIER 3: FALLBACK          │
                    │  ┌──────────────────────────────┐  │
                    │  │  Cloudflare  (Priority 3)     │  │
                    │  │  Condition: health ≥ 0.5     │  │
                    │  │  Condition: latency ≤ 30s    │  │
                    │  └──────────────────────────────┘  │
                    └────────────────────────────────────┘
```

## Configuration & Secret Resolution

```
                    ┌──────────────────────────────┐
                    │      .env                     │
                    │  OPENROUTER_API_KEY=...       │
                    │  NVIDIA_API_KEY=...          │
                    │  CLOUDFLARE_API_KEY=...      │
                    │  CLOUDFLARE_ACCOUNT_ID=...   │
                    └──────────┬───────────────────┘
                               │ process.env
                               ▼
                    ┌──────────────────────────────┐
                    │  providers.json               │
                    │  ├── auth.apiKey: "${VAR}"   │◄── env var resolution
                    │  ├── auth.endpoint: "..."     │
                    │  └── models: [...]            │
                    │                               │
                    │  routing-policy.json          │
                    │  fallback-config.json         │
                    │  health-config.json           │
                    │  retry-config.json            │
                    │  logging-config.json          │
                    │  server-config.json           │
                    └──────────────────────────────┘
                               │
                               ▼
                    ┌──────────────────────────────┐
                    │  SecretManager (AES-256-GCM)  │
                    │  ┌────────────────────────┐  │
                    │  │  Encrypted secrets in  │  │
                    │  │  config/secrets/*.enc  │  │
                    │  │  with LRU cache        │  │
                    │  └────────────────────────┘  │
                    └──────────────────────────────┘
```

## Complete File Map

```
D:\AI Agents\ai-gateway\
│
├── server.js                          ◄── Gateway entrypoint
├── package.json                       ◄── Dependencies (9router, express)
├── ecosystem.config.cjs               ◄── PM2 production config
├── .env                               ◄── Environment variables
├── .env.example                       ◄── Environment template
├── claude.jsonc                       ◄── Claude Code gateway config
│
├── config/
│   ├── providers/providers.json       ◄── Provider definitions + auth
│   ├── routing/routing-policy.json    ◄── 3-tier priority failover
│   ├── health/health-config.json      ◄── Circuit breaker + health checks
│   ├── retry/retry-config.json        ◄── Exponential backoff with jitter
│   ├── fallback/fallback-config.json  ◄── Error code → action mapping
│   ├── logging/logging-config.json    ◄── JSON logging, PII redaction
│   ├── server/server-config.json      ◄── CORS, body parser, SSL
│   ├── profiles/default.json          ◄── Default feature profile
│   └── secrets/                       ◄── Encrypted secret storage
│
├── health-engine/server.js            ◄── Provider health monitoring
├── routing-engine/server.js           ◄── Routing policy engine
├── observability-engine/server.js     ◄── Metrics & analytics
│
├── shared/
│   ├── security/
│   │   ├── auth-middleware.js         ◄── API key + JWT validation
│   │   ├── rate-limiter.js            ◄── Sliding window rate limiter
│   │   ├── log-sanitizer.js           ◄── PII/secret redaction
│   │   ├── secret-manager.js          ◄── AES-256-GCM encryption
│   │   ├── audit-logger.js            ◄── Rotating audit trail
│   │   ├── security-headers.js        ◄── OWASP recommended headers
│   │   ├── security-monitor.js        ◄── Brute force + anomaly detection
│   │   ├── backup-manager.js          ◄── SHA-256 verified backups
│   │   ├── integrity-verifier.js      ◄── File integrity manifest
│   │   └── integration.js             ◄── Unified security facade
│   │
│   └── performance/
│       ├── cache.js                   ◄── LRU cache with TTL
│       ├── request-scheduler.js       ◄── Priority queue + concurrency limit
│       ├── stream-optimizer.js        ◄── SSE streaming with backpressure
│       ├── http-agent.js              ◄── HTTP client with retry
│       ├── resource-monitor.js        ◄── CPU/memory tracking
│       └── benchmark.js               ◄── Performance benchmarking
│
├── tests/
│   ├── acceptance-test.js             ◄── 16 API tests
│   ├── final-failover-test.js         ◄── 17 failover tests
│   ├── anthropic-api-test.js          ◄── 5 Anthropic API groups
│   └── verify-completions.js          ◄── 4-model completion check
│
└── docs/
    ├── ARCHITECTURE_AND_WORKFLOW.md   ◄── This file
    ├── PRODUCTION_CERTIFICATION_REPORT.md
    ├── OPERATIONAL_READINESS_REPORT.md
    ├── SECURITY_GUIDE.md
    ├── BACKUP_GUIDE.md
    ├── TROUBLESHOOTING_GUIDE.md
    ├── CLAUDE_DESKTOP_GATEWAY_GUIDE.md
    ├── CLAUDE_CODE_GATEWAY_GUIDE.md
    ├── ADMINISTRATOR_GUIDE.md
    ├── USER_GUIDE.md
    ├── MAINTENANCE_GUIDE.md
    ├── KNOWN_LIMITATIONS.md
    └── ... more docs
```
