# Maintenance Guide

## Routine Maintenance

### Daily

1. **Check gateway health**
   ```bash
   curl http://localhost:20128/api/health
   ```

2. **Verify sub-engines**
   ```bash
   curl http://localhost:20129/health
   curl http://localhost:20130/routing/status
   curl http://localhost:20131/health
   ```

3. **Review logs**
   ```bash
   tail -f logs/*.log
   ```

### Weekly

1. **Run test suites**
   ```bash
   node tests/acceptance-test.js
   node tests/final-failover-test.js
   ```

2. **Check provider health**
   ```bash
   curl http://localhost:20129/health/providers
   ```

3. **Review metrics**
   ```bash
   curl http://localhost:20131/metrics
   ```

4. **Create backup**
   ```bash
   npm run backup
   ```

### Monthly

1. **Review circuit breaker status**
   ```bash
   curl http://localhost:20129/health/circuit-breakers
   ```

2. **Audit logs**
   - Check `logs/` directory for rotated files
   - Verify log retention (30 days default)

3. **Verify backup integrity**
   ```bash
   # Check backup manifests
   ls backups/
   cat backups/latest.txt
   ```

4. **Update provider API keys** if nearing expiration

5. **Review and rotate secrets**
   - API keys
   - JWT secrets
   - Encryption keys

## Troubleshooting

### Gateway won't start
```bash
# Verify 9Router dependency
npm install

# Check port availability
netstat -ano | findstr :20128

# Check for startup errors
node server.js
```

### Provider not responding
```bash
# Check provider health
curl http://localhost:20129/health/provider/nvidia

# Check circuit breaker status
curl http://localhost:20129/health/circuit-breakers

# Reset circuit breaker if needed
curl http://localhost:20129/health/reset/nvidia
```

### High latency
```bash
# Check metrics
curl http://localhost:20131/metrics

# Run benchmark
node -e "require('./shared/performance/benchmark').runBenchmark()"
```

### Claude Desktop not connecting
1. Verify gateway is running on port 20128
2. Check `%LOCALAPPDATA%\Claude-3p\configLibrary\_meta.json`
3. Re-apply config in Developer → Configure Third-Party Inference
4. Restart Claude Desktop

## Backup and Restore

### Create backup
```bash
npm run backup
```

### List backups
```bash
ls backups/
```

### Restore from backup
```bash
# Use BackupManager
node -e "
const { BackupManager } = require('./shared/security/backup-manager');
const bm = new BackupManager({ backupDir: './backups' });
bm.restore('config-2026-07-05T13-20-09-381Z');
"
```

## Updating Providers

### Add a new provider
1. Edit `config/providers/providers.json`
2. Add provider configuration with API key reference
3. Update `.env` with the API key
4. Update `config/routing/routing-policy.json` to include in appropriate tier
5. Update `config/fallback/fallback-config.json` chain order
6. Restart gateway

### Remove a provider
1. Remove from `config/providers/providers.json`
2. Remove from all tiers in `config/routing/routing-policy.json`
3. Remove from `config/fallback/fallback-config.json`
4. Remove API key from `.env`
5. Restart gateway

## Scaling

### Horizontal scaling
The gateway is stateless and can be scaled behind a load balancer. The sub-engines (health, routing, observability) should be co-located with each gateway instance.

### Performance tuning
- Adjust `RATE_LIMIT_MAX_REQUESTS` in `.env`
- Adjust circuit breaker thresholds in `config/health/health-config.json`
- Adjust retry parameters in `config/retry/retry-config.json`
- Tune connection pool in `config/server/server-config.json`
