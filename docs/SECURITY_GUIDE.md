# 9Router AI Gateway - Security Guide

## Overview
This guide covers security configuration, secret management, and hardening for the 9Router AI Gateway.

## Critical Security Settings

### 1. Enable Authentication
```bash
# In .env - SET THIS BEFORE NETWORK EXPOSURE
REQUIRE_API_KEY=true
API_KEY_SECRET=<generate-random-64-char-hex>
JWT_SECRET=<generate-random-64-char-hex>
INITIAL_PASSWORD=<generate-random-16-char-password>
```

### 2. Configure TLS
Deploy behind a reverse proxy:
- nginx with Let's Encrypt SSL
- Caddy (auto HTTPS)
- HAProxy with cert

### 3. Secure Backups
Modify `scripts/backup.js` to:
- Exclude `.env` from backup
- Encrypt backup archive
- Store backups in access-controlled location

## Secret Management

All sensitive values are stored in `.env` (gitignored):
- Provider API keys
- Authentication secrets
- Encryption keys

The shared `secret-manager.js` module provides:
- AES-256-GCM encryption for stored secrets
- Environment variable resolution (`${VAR_NAME}`)
- In-memory caching with TTL

## Log Security

The `log-sanitizer.js` module automatically redacts:
- API keys (patterns: `api_key`, `apiKey`, `x-api-key`)
- Secrets and passwords
- Auth tokens and bearer tokens
- Long hex strings (potential keys)

## Rate Limiting

Default: 100 requests per 60-second window per IP
Configure in `config/server/server-config.json` or `shared/security/rate-limiter.js`

## Audit Logging

All administrative actions are logged to `audit/` directory with 90-day retention.
Includes: actor, action, resource, result, IP, user agent.

## Security Headers

Every response includes:
```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000
Content-Security-Policy: default-src 'self'
Referrer-Policy: strict-origin-when-cross-origin
```

## Integrity Verification

Run to detect unauthorized file changes:
```bash
node -e "const iv=require('./shared/security/integrity-verifier');new iv.IntegrityVerifier().generateManifest()"  # Create baseline
node -e "const iv=require('./shared/security/integrity-verifier');const r=new iv.IntegrityVerifier().loadManifest()||new iv.IntegrityVerifier().verify();console.log(r)"
```
