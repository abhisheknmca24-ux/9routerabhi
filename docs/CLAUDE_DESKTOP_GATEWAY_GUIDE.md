# Claude Desktop Gateway Configuration Guide

## Overview

Configure Claude Desktop to use the local 9Router AI Gateway as a third-party inference provider. This enables provider failover, routing, and observability through the gateway while keeping the Claude Desktop UI.

## Prerequisites

- Claude Desktop installed (latest version with Developer Mode)
- 9Router running on `http://localhost:20128`
- Valid provider API keys in `.env`

## Configuration Steps

### 1. Enable Developer Mode

1. Open Claude Desktop
2. Go to `Help` → `Troubleshooting`
3. Click `Enable Developer Mode`
4. Confirm the warning prompt
5. Wait for Claude Desktop to restart

### 2. Open Third-Party Inference Configuration

1. Click `Developer` in the top menu
2. Select `Configure Third-Party Inference...`

### 3. Fill in Gateway Settings

| Field | Value |
|-------|-------|
| Gateway base URL | `http://localhost:20128` |
| Gateway API key | `sk-placeholder` |
| Gateway auth scheme | `bearer` |
| Extra headers | (leave blank) |

> **Note:** The gateway does not require authentication (`REQUIRE_API_KEY=false`). Any value for API key will work.

### 4. Apply Configuration

1. Click `Apply locally`
2. Fully quit Claude Desktop (verify process is stopped)
3. Reopen Claude Desktop
4. Send a test message

## Verification

### 1. Gateway Health Check

```powershell
curl http://localhost:20128/api/health
# Expected: {"ok":true}
```

### 2. Model Discovery

Claude Desktop will show Claude-family models. The gateway serves 14 models internally.

### 3. Chat Test

Send any message in Claude Desktop. The gateway will route through:
- Primary → kiro (if configured)
- Secondary → opencode-free
- Fallback → glm → OpenRouter → NVIDIA → Cloudflare

## Architecture

```
Claude Desktop ──HTTPS──> 9Router (localhost:20128)
                              │
                    ┌─────────┼────────────┐
                    │         │            │
               OpenAI Completions  Anthropic Messages
               (/v1/chat/completions)  (/v1/messages)
                    │         │            │
                    └─────────┼────────────┘
                              │
                         Provider Chain
```

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Could not connect to gateway" | Verify 9Router is running: `curl http://localhost:20128/api/health` |
| 401 Unauthorized | GLM API key expired. Use OpenRouter/NVIDIA/Cloudflare instead |
| Developer menu not visible | Enable Developer Mode first in Help → Troubleshooting |
| Config not saving | Fully quit Claude Desktop (check Task Manager) and restart |
| Only Claude models shown | Expected - Claude Desktop hides non-Claude models from gateway response |

## Windows Registry Export

If `Apply locally` fails, export the configuration:
1. In the config window, click `Export`
2. Choose `Windows registry (.reg)`
3. Run the exported `.reg` file
4. Restart Claude Desktop

## Files

- Gateway config: `D:\AI Agents\ai-gateway\config\providers\providers.json`
- Environment: `D:\AI Agents\ai-gateway\.env` (gitignored)
- Claude Code config: `D:\AI Agents\ai-gateway\claude.jsonc`
