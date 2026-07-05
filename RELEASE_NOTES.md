# 9Router AI Gateway - Release Notes

## Version 1.0.0 — Production Release

**Release Date:** 2026-07-05

---

### Overview

Production-ready AI Gateway built on 9Router with multi-provider failover, health monitoring, observability, and Claude Desktop/Code integration. Routes inference across OpenRouter, NVIDIA NIM, and Cloudflare Workers AI with automatic failover.

### Features

**Core Gateway**
- OpenAI-compatible `/v1/chat/completions` endpoint with streaming
- Anthropic Messages API `/v1/messages` endpoint for Claude Desktop
- Model discovery via `/v1/models` (30 models across 3 providers)
- 9 combo profiles for automatic multi-model routing

**Provider Management**
- 3 active providers: OpenRouter (P1), NVIDIA NIM (P2), Cloudflare Workers AI (P3)
- Priority-based failover with health-aware circuit breaking
- Automatic provider discovery and health checks
- Exponential backoff retry with jitter

**Sub-Engines**
- Health Engine (port 20129) — Provider health monitoring, circuit breaker management
- Routing Engine (port 20130) — Routing policy resolution and chain management
- Observability Engine (port 20131) — Metrics ingestion, latency tracking, event logging

**Security**
- API key and JWT authentication
- PII/secret redaction in logs
- Rate limiting (sliding window)
- AES-256-GCM encrypted secret storage
- File integrity verification (SHA-256)
- Brute force and error spike detection
- HTTP security headers (CSP, HSTS, XSS)

**Operations**
- Automated backup/restore with checksum verification
- JSON structured logging with file rotation (100MB, 30-day retention)
- Resource monitoring (CPU, memory, OS metrics)
- Benchmark and latency testing

**Claude Integration**
- Claude Desktop Gateway Mode configuration
- Claude Code CLI integration via `claude.jsonc`
- System environment variables for automatic discovery

### Provider Models

| Provider | Models | Notes |
|----------|--------|-------|
| NVIDIA NIM | 8 models | Includes DeepSeek, Moonshot, Nemotron, GLM |
| Cloudflare Workers AI | 13 models | Includes Llama, Mistral, Qwen, DeepSeek, Moonshot |
| OpenRouter | 0 discovered | Free tier models configured |

### Combo Profiles

Coding, Reasoning, Chat, Balanced, Vision, Research, Fast, Long_Context, Planning

### Test Results

| Suite | Tests | Result |
|-------|-------|--------|
| Acceptance Tests | 16 | ✅ 16/16 passed |
| Failover Tests | 17 | ✅ 17/17 passed |
| Anthropic API Tests | 5 groups | ✅ All passed |
| Chat Completion Verification | 4 models | ✅ 4/4 passed |

### Known Limitations

1. **OpenRouter model discovery** — Returns 0 models via API discovery (free tier models configured but not auto-discovered)
2. **NVIDIA API latency** — Intermittent 400/503 responses under load (upstream rate limiting)
3. **Sub-engine persistence** — Metrics are in-memory only (no persistent storage)
4. **No TypeScript** — All source is plain JavaScript (CommonJS)
5. **No test framework** — Tests use raw `http` module without Jest/Mocha

### Quick Start

```bash
# Install and start
npm install
npm start

# Run validation
node tests/acceptance-test.js
node tests/final-failover-test.js

# Start sub-engines
node health-engine/server.js &
node routing-engine/server.js &
node observability-engine/server.js &
```
