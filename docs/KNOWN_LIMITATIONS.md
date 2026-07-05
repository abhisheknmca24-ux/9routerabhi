# 9Router AI Gateway - Known Limitations

## Critical

1. **No API Key Authentication** - `REQUIRE_API_KEY=false`. Anyone who can reach the gateway can use any configured provider. Set to `true` and configure a strong `API_KEY_SECRET` before exposing to a network.

2. **Backup Contains Secrets** - `scripts/backup.js` copies `.env` containing plaintext API keys and secrets. Modify to exclude `.env` or encrypt backups before storing.

3. **No TLS/HTTPS** - Gateway listens on plain HTTP. All traffic (including API keys) is sent in cleartext. Deploy behind a TLS-terminating reverse proxy (nginx, Caddy, HAProxy).

## Providers

4. **Zero Valid Provider API Keys** - None of the 11 API-key-based providers have valid credentials installed. Only `kiro` (OAuth) and `opencode-free` (no-auth) can work without valid keys, and their keys may be placeholder values. Provider-level errors (401) are expected.

5. **GLM Key Expired** - The GLM API key is expired. All GLM model requests return 401 errors.

6. **Combo Model Support** - Only `Chat` and `Fast` combo models respond to `/v1/chat/completions`. Other combos (Coding, Reasoning, Balanced, etc.) are listed in `/v1/models` but return 404 on direct chat requests.

## Performance

7. **4-Core CPU Limitation** - Running on Intel i3-1115G4 (4 cores). Peak throughput plateaus at ~450 req/s. Upgrade to 8+ cores for higher throughput.

8. **No Horizontal Scaling** - Single-process, single-machine deployment. No load balancing or cluster support.

## Operational

9. **No Monitoring Alerts** - No email/SMS/webhook alerting configured for health endpoint failures or circuit breaker trips.

10. **No Automated Backups** - Backups must be triggered manually via `node scripts/backup.js`. No scheduled backup automation.

11. **No CI/CD** - No automated deployment pipeline. Manual deployment only.

## Testing

12. **Streaming Not Fully Validated** - Streaming endpoint exists but full SSE integration testing requires valid provider API keys.

13. **Extension Engines Not Running** - Health Engine (20129), Routing Engine (20130), and Observability Engine (20131) are not started by default. Start them manually when needed.
