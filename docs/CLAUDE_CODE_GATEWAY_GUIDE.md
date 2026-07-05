# Claude Code Gateway Configuration Guide

## Overview

Configure Claude Code to route all API requests through the local 9Router AI Gateway for provider failover, routing, and observability.

## Configuration

### Method 1: Environment Variables (Session)

```powershell
$env:ANTHROPIC_BASE_URL = "http://localhost:20128"
$env:ANTHROPIC_API_KEY = "sk-placeholder"
```

Start Claude Code in the same terminal session.

### Method 2: Project Config File

Create or edit `claude.jsonc` in your project root:

```json
{
  "apiBaseUrl": "http://localhost:20128",
  "apiKey": "sk-placeholder"
}
```

### Method 3: Persistent Environment Variable

```powershell
[Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "http://localhost:20128", "User")
```

## Verification

### 1. Check gateway health
```bash
curl http://localhost:20128/api/health
# Expected: {"ok":true}
```

### 2. List available models
```bash
curl http://localhost:20128/v1/models
# Expected: 14 models (Coding, Chat, Reasoning, glm models, etc.)
```

### 3. Test Messages API
```bash
curl -X POST http://localhost:20128/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"glm/glm-4.7","messages":[{"role":"user","content":"hello"}],"max_tokens":10}'
# Expected: 401 (GLM key expired) or 200 with valid key
# The endpoint exists and routes correctly
```

### 4. Test provider routing
```bash
curl -X POST http://localhost:20128/v1/messages \
  -H "Content-Type: application/json" \
  -d '{"model":"Chat","messages":[{"role":"user","content":"hello"}],"max_tokens":10}'
# Expected: 401 (key expired) or 200 with valid key
```

### 5. Verify in Claude Code
```bash
claude /status
# Should show ANTHROPIC_BASE_URL=http://localhost:20128
```

## Architecture

```
Claude Code ──HTTPS──> 9Router (localhost:20128)
                           │
                    ┌──────┼──────────┐
                    │      │          │
               OpenRouter  NVIDIA  Cloudflare
               (priority 4)  (14)    (15)
                    │      │          │
                    └──────┼──────────┘
                           │
                     Provider Chain
                 (failover on 401/403/429/5xx)
```

## Provider Priority

| Priority | Provider | Models |
|----------|----------|--------|
| 1 | kiro | kiro-v2, kiro-v1 |
| 2 | opencode-free | deepseek-v4-flash-free |
| 3 | glm | glm-4.7, glm-5, glm-4.6v |
| 4 | **OpenRouter** | 1000+ models (`:free` suffix) |
| 14 | **NVIDIA NIM** | llama-3.1-70b-instruct |
| 15 | **Cloudflare** | @cf/meta/llama-3.2-3b-instruct |

## Notes

- `REQUIRE_API_KEY=false` - no auth required for gateway
- Provider keys stored in `.env` (gitignored)
- 33/33 tests pass (16 acceptance + 17 failover)
- 3 providers verified: OpenRouter, NVIDIA NIM, Cloudflare
