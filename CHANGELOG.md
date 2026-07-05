# Changelog

## 1.0.0 (2026-07-05)

### Initial Production Release

#### Features

- **Gateway**: OpenAI-compatible `/v1/chat/completions` and Anthropic `/v1/messages` endpoints
- **Providers**: OpenRouter (P1), NVIDIA NIM (P2), Cloudflare Workers AI (P3) — 30 total models
- **Combo Profiles**: 9 multi-model routing profiles with automatic failover
- **Health Engine**: Provider health monitoring with circuit breaker auto-recovery
- **Routing Engine**: Priority-failover strategy with 3-tier routing policy
- **Observability Engine**: Real-time metrics, latency tracking, event logging
- **Backup/Restore**: Automated backup with SHA-256 checksum verification
- **Security**: API key auth, JWT auth, rate limiting, secret encryption, audit logging
- **Performance**: LRU cache, request scheduler, stream optimizer, resource monitor
- **Claude Desktop**: Full Gateway Mode configuration (configLibrary, registry, env vars)
- **Claude Code**: Project-level `claude.jsonc` and user-level `settings.json` integration

#### Changed

- Replaced expired GLM provider with OpenRouter, NVIDIA, and Cloudflare
- Updated `.env.example` and `.env.production.example` to match active providers
- Updated `providers.json` from 13 placeholder providers to 3 active providers
- Updated `routing-policy.json` with correct 3-tier priority failover
- Updated `fallback-config.json` with OpenRouter → NVIDIA → Cloudflare chain
- Updated all test files to use current provider models
- Initialized git repository with `.gitignore`

#### Removed

- Empty directories: `dashboard/`, `data/`, `env/`, `health/`, `providers/`, `router/`
- Empty subdirectories in engine directories (`src/`, `config/`, `docs/`, `tests/`)
- Old test result artifacts (kept latest acceptance and failover results)
- Expired GLM provider and placeholder provider definitions
- Stale `.env` keys for kiro, opencode-free, glm, anthropic, openai, gemini, etc.

#### Fixed

- Test model references updated from deleted GLM models to active NVIDIA models
- Test timeout increased from 10s to 30s for NVIDIA API latency
- Test status code expectations adjusted for provider-side error responses

#### Documentation

- README.md updated with current architecture, providers, and endpoints
- RELEASE_NOTES.md created
- CHANGELOG.md created
- MAINTENANCE_GUIDE.md created
- ADMINISTRATOR_GUIDE.md created
- USER_GUIDE.md created
- Updated `.env.example` and `.env.production.example` for 3 active providers
