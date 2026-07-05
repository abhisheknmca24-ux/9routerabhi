# Claude Desktop Gateway Report

**Generated:** 2026-07-05 20:18  
**Gateway URL:** http://localhost:20128  
**Gateway Status:** Running (PID: multiple Claude processes)  
**9Router Status:** Running (PID: 776)

---

## Configuration Summary

### 1. Claude Desktop 3P Config Library
| Setting | Value |
|---------|-------|
| Config ID | `9fe76f2d-1111-4444-8888-123456789abc` |
| Config Name | `9Router Gateway` |
| Provider | `gateway` |
| Base URL | `http://localhost:20128` |
| Auth Type | `bearer` |
| API Key | `sk-placeholder` |
| **Location** | `%LOCALAPPDATA%\Claude-3p\configLibrary\` |

### 2. Claude Code CLI (`~/.claude/settings.json`)
| Setting | Value |
|---------|-------|
| Model | `Balanced` |
| `ANTHROPIC_BASE_URL` | `http://localhost:20128` |
| `ANTHROPIC_API_KEY` | `sk-placeholder` |
| **Location** | `%USERPROFILE%\.claude\settings.json` |

### 3. Project-level Claude Code (`claude.jsonc`)
| Setting | Value |
|---------|-------|
| `apiBaseUrl` | `http://localhost:20128` |
| `apiKey` | `sk-placeholder` |
| **Location** | `D:\AI Agents\ai-gateway\claude.jsonc` |

### 4. System Environment Variables (User-level)
| Variable | Value |
|----------|-------|
| `ANTHROPIC_BASE_URL` | `http://localhost:20128` |
| `ANTHROPIC_AUTH_TOKEN` | `sk-placeholder` |

---

## Verification Results

### Anthropic Messages API (`POST /v1/messages`)

| Test | Result | Details |
|------|--------|---------|
| Chat completion (default stream) | ✅ PASS | Returns SSE with `message_stop` event |
| Multi-turn conversation | ✅ PASS | Correctly remembers context ("Your name is Alice") |
| System prompt support | ✅ PASS | `system` parameter accepted |
| Max tokens support | ✅ PASS | Respects `max_tokens` limit |
| SSE streaming | ✅ PASS | Returns `content_block_delta` events |

### Model Discovery (`GET /v1/models`)

| Metric | Value |
|--------|-------|
| Total models | 30 |
| Combo profiles | 9 (Coding, Reasoning, Chat, Balanced, Vision, Research, Fast, Long_Context, Planning) |
| NVIDIA models | 8 |
| Cloudflare models | 13 |
| OpenRouter models | 0 |

### Model Routing

| Model | Route | Result |
|-------|-------|--------|
| `Balanced` | Combo → Cloudflare | ✅ PASS |
| `Coding` | Combo → Cloudflare | ✅ PASS |
| `cf/@cf/qwen/qwen2.5-coder-32b-instruct` | Cloudflare direct | ✅ PASS |

### Provider Failover Chain

| Priority | Provider | Status |
|----------|----------|--------|
| 1 | OpenRouter | Active (0 discovered models) |
| 2 | NVIDIA NIM | Active (8 models) |
| 3 | Cloudflare Workers AI | Active (13 models) |

---

## Claude Desktop Configuration Steps

### If configLibrary is not picked up automatically:

1. Open Claude Desktop
2. Go to **Help → Troubleshooting → Enable Developer Mode**
3. Go to **Developer → Configure Third-Party Inference**
4. In the Connection section:
   - **Inference provider**: `Gateway`
   - **Gateway base URL**: `http://localhost:20128`
   - **Gateway API key**: `sk-placeholder`
   - **Gateway auth scheme**: `bearer`
5. Click **Apply**
6. Start a new conversation

### Or apply via registry (Windows):

```powershell
# Create registry path
New-Item -Path "HKCU:\SOFTWARE\Policies\Claude" -Force

# Set values
Set-ItemProperty -Path "HKCU:\SOFTWARE\Policies\Claude" -Name "inferenceProvider" -Value "gateway"
Set-ItemProperty -Path "HKCU:\SOFTWARE\Policies\Claude" -Name "inferenceBaseUrl" -Value "http://localhost:20128"
Set-ItemProperty -Path "HKCU:\SOFTWARE\Policies\Claude" -Name "inferenceApiKey" -Value "sk-placeholder"
Set-ItemProperty -Path "HKCU:\SOFTWARE\Policies\Claude" -Name "inferenceAuthType" -Value "bearer"
```

---

## Files Modified

| File | Change |
|------|--------|
| `%LOCALAPPDATA%\Claude-3p\configLibrary\_meta.json` | Added "9Router Gateway" config entry, set as active |
| `%LOCALAPPDATA%\Claude-3p\configLibrary\9fe76f2d-1111-4444-8888-123456789abc.json` | Created with gateway provider config |
| `%USERPROFILE%\.claude\settings.json` | Added `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` env vars |
| User environment variables | Added `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` |

---

## Notes

- The 9Router gateway at `localhost:20128` implements the **Anthropic Messages API** natively (`POST /v1/messages`) with SSE streaming
- Claude Desktop reads Gateway config from `%LOCALAPPDATA%\Claude-3p\configLibrary\`
- Claude Code CLI reads settings from `~/.claude/settings.json` (user-level) and `./claude.jsonc` (project-level)
- Gateway authentication is disabled (`REQUIRE_API_KEY=false`) so any API key works
- The `stream` parameter defaults to `true` for `/v1/messages`, returning SSE events
- Claude Desktop should now route all inference through the local gateway
