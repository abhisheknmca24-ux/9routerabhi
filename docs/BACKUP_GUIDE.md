# 9Router AI Gateway - Backup Guide

## Creating Backups

### Automated Backup
```bash
node scripts/backup.js
```
Creates timestamped backup in `backups/` directory with manifest.

### Manual Backup
```powershell
# Copy configuration directory
Copy-Item -Path "D:\AI Agents\ai-gateway\config" -Destination "D:\AI Agents\ai-gateway\backups\manual-$(Get-Date -Format 'yyyyMMdd-HHmmss')" -Recurse
```

## Backup Contents

Each backup includes:
- All configuration files
- Documentation
- Test files and results
- Shared modules
- Extension engine source files
- Manifest with checksum

**Excludes:** `node_modules/`, `logs/`, `audit/`, `.git/`, previous `backups/`

## Restoring Backups

### From Backup Script
```bash
node -e "const {BackupManager}=require('./shared/security/backup-manager');new BackupManager().restore('backup-name')"
```

### Manual Restore
```powershell
# Copy backup back to project
Copy-Item -Path "D:\AI Agents\ai-gateway\backups\<backup-name>\*" -Destination "D:\AI Agents\ai-gateway\" -Recurse -Force
```

## Security Warning

The current backup script copies `.env` with plaintext secrets.
**For production:**
1. Exclude `.env` from backup: add to `excludeDirs` or modify `_copyDir`
2. Encrypt backup archives
3. Store backups in restricted access location
4. Consider using Windows EFS or BitLocker for backup directory

## Schedule

Recommended backup schedule:
- Config changes: immediately after change
- Daily: automated backup via Task Scheduler
- Weekly: full project backup to external media

## Retention

- Latest: always keep
- Daily: 7 days
- Weekly: 4 weeks
- Monthly: 12 months
