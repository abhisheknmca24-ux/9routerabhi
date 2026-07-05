# 9Router AI Gateway - Operational Runbook

## Service Management

### Start Gateway
```bash
cd D:\AI Agents\ai-gateway
npm start
```
Gateway starts on `http://0.0.0.0:20128`

### Stop Gateway
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 20128).OwningProcess | Stop-Process -Force
```

### Restart Gateway
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 20128).OwningProcess | Stop-Process -Force
# Wait 2 seconds
npm start
```

### Status Check
```bash
curl http://localhost:20128/api/health
curl http://localhost:20128/v1/models
```

### Start Extension Engines
```powershell
# Health Engine (port 20129)
cd D:\AI Agents\ai-gateway\health-engine && npm start

# Routing Engine (port 20130)
cd D:\AI Agents\ai-gateway\routing-engine && npm start

# Observability Engine (port 20131)
cd D:\AI Agents\ai-gateway\observability-engine && npm start
```

## Configuration

### Add a Provider
Edit `config/providers/providers.json` and set `"enabled": true` for the desired provider. Add the API key to `.env`.

### Change Routing Policy
Edit `config/routing/routing-policy.json` to modify tier priorities, failover chains, or circuit breaker settings.

### Update Logging Level
Edit `config/logging/logging-config.json` - change `"level"` to `"debug"`, `"info"`, `"warn"`, or `"error"`.

## Backup & Recovery

### Create Backup
```bash
node scripts/backup.js
```

### Restore from Backup
```bash
node -e "require('./shared/security/backup-manager').BackupManager.prototype.restore('backup-name')"
```

### List Backups
```bash
node -e "const b=require('./shared/security/backup-manager').BackupManager;new b({backupDir:'backups'}).listBackups().forEach(b=>console.log(b.name,b.createdAt,b.fileCount+' files'))"
```

## Troubleshooting

### Gateway Not Starting
1. Check port availability: `Get-NetTCPConnection -LocalPort 20128`
2. Check Node.js version: `node --version` (requires >= 18)
3. Check 9Router global install: `npm list -g 9router`

### High Error Rate
1. Check provider API keys in `.env`
2. Verify provider endpoints are reachable
3. Check circuit breaker status at `/api/health`
4. Review logs in `logs/` directory

### Slow Responses
1. Check system resources: CPU, memory, disk I/O
2. Verify provider endpoint latency
3. Check for rate limiting on provider side
4. Consider upgrading CPU

### Health Check Failing
1. Restart gateway
2. Check `/api/health` endpoint directly
3. Review health engine config at `config/health/health-config.json`

## Recovery Procedures

### Full System Recovery
1. Stop all processes
2. Restore from latest backup: `node scripts/backup.js` (already created a backup first)
3. Reinstall dependencies: `npm install` in each engine directory
4. Start gateway: `npm start`
5. Run tests: `npm test && npm run test:failover`
6. Verify: `curl http://localhost:20128/api/health`
