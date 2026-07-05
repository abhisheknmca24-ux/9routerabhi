# 9Router AI Gateway - Release Package v1.0.0

## Contents

```
ai-gateway/
├── server.js              # Gateway entry point
├── package.json           # Project manifest
├── claude.jsonc           # Claude Desktop configuration
├── .env.example           # Environment template
├── .env.production.example # Hardened production template
├── .gitignore
├── config/
│   ├── providers/providers.json    # 13 provider definitions
│   ├── routing/routing-policy.json # 3-tier failover routing
│   ├── health/health-config.json   # Health check & circuit breaker
│   ├── retry/retry-config.json     # Exponential backoff
│   ├── fallback/fallback-config.json # Failover chain
│   ├── logging/logging-config.json # JSON logging with redaction
│   ├── profiles/default.json       # Default profile
│   └── server/server-config.json   # Server settings
├── shared/
│   ├── performance/ (6 modules)    # HTTP agent, cache, scheduler, monitor, stream, benchmark
│   └── security/ (10 modules)      # Sanitizer, secrets, auth, headers, rate limiter, audit, backup, integrity, monitor, integration
├── health-engine/        # Health monitoring (port 20129)
├── routing-engine/       # Dynamic routing (port 20130)
├── observability-engine/ # Metrics & logging (port 20131)
├── tests/
│   ├── acceptance-test.js     # 16-test acceptance suite
│   └── final-failover-test.js # 17-test failover suite
├── scripts/
│   └── backup.js             # Configuration backup
├── docs/
│   ├── OPERATIONAL_READINESS_REPORT.md
│   ├── SECURITY_GUIDE.md
│   ├── BACKUP_GUIDE.md
│   └── TROUBLESHOOTING_GUIDE.md
└── backups/
```

## Prerequisites

- Node.js >= 18.0.0
- 9Router (global install): `npm install -g 9router`

## Installation

```bash
# Install global dependency
npm install -g 9router

# Install local dependencies
npm install
cd health-engine && npm install && cd ..
cd routing-engine && npm install && cd ..
cd observability-engine && npm install && cd ..

# Start gateway
npm start
```

## Verification

```bash
# Run test suites
npm test           # 16 acceptance tests
npm run test:failover  # 17 failover tests

# Health check
curl http://localhost:20128/api/health
curl http://localhost:20128/v1/models
```

## Version

**v1.0.0** - Initial production release
