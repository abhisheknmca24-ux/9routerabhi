# 9Router AI Gateway - Troubleshooting Guide

## Common Issues

### Gateway won't start
```
Error: listen EADDRINUSE :::20128
```
Port already in use. Kill the existing process:
```powershell
Get-Process -Id (Get-NetTCPConnection -LocalPort 20128 -ErrorAction SilentlyContinue).OwningProcess | Stop-Process -Force
```

### /v1/chat/completions returns 404
The model name is not recognized. Use a model that exists in `/v1/models`:
- `glm/glm-4.7`, `glm/glm-5`, `glm/glm-4.6v`
- `Chat`, `Fast`

### All providers return 401
**Cause:** Expired or invalid API keys in `.env`
**Fix:** Update API keys in `.env` and restart gateway

### /v1/chat/completions returns 405
**Cause:** Using GET instead of POST. Use `POST` method.

### High memory usage
**Check:**
- Log file size in `logs/` directory
- Number of concurrent connections
- Memory leaks from provider connections

**Fix:**
```bash
# Clear logs
npm run clean
# Restart gateway
npm start
```

### Circuit breaker open
All providers are marked unhealthy. Check:
1. Provider API key validity
2. Network connectivity to provider endpoints
3. Provider service status

Circuit breaker auto-resets after cooldown period (5 minutes by default).

### Tests fail
```powershell
# Check gateway is running
curl http://localhost:20128/api/health

# Verify correct model names
curl http://localhost:20128/v1/models

# Run single test manually
node -e "require('http').request({hostname:'localhost',port:20128,path:'/v1/models',method:'GET'},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>console.log(r.statusCode,d.slice(0,200)))}).end()"
```

## Debug Mode

Enable verbose logging:
```json
// config/logging/logging-config.json
{ "level": "debug" }
```

## Getting Help

If issues persist:
1. Check `docs/` for detailed guides
2. Review logs in `logs/` directory
3. Run test suite to identify specific failures
4. Verify all configuration files are valid JSON
