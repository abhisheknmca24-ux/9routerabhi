const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class BackupManager {
  constructor(options = {}) {
    this.backupDir = options.backupDir || path.join(process.env.PROJECT_ROOT || '.', 'backups');
    this.projectRoot = options.projectRoot || process.env.PROJECT_ROOT || '.';
    this.retentionDays = options.retentionDays || 30;
    this.excludeDirs = options.excludeDirs || ['node_modules', 'backups', '.git', 'logs', 'audit'];
  }

  createBackup(name) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = name || `config-${timestamp}`;
    const backupPath = path.join(this.backupDir, backupName);

    if (!fs.existsSync(backupPath)) fs.mkdirSync(backupPath, { recursive: true });

    const manifest = { name: backupName, createdAt: new Date().toISOString(), files: [] };

    this._copyDir(this.projectRoot, backupPath, this.excludeDirs, manifest);

    manifest.checksum = this._hashDir(backupPath);
    manifest.fileCount = manifest.files.length;

    fs.writeFileSync(path.join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(this.backupDir, 'latest.txt'), backupName);

    this._cleanup();
    return { name: backupName, path: backupPath, fileCount: manifest.fileCount };
  }

  _copyDir(src, dest, exclude, manifest) {
    try {
      const entries = fs.readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        if (exclude.includes(entry.name)) continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          fs.mkdirSync(destPath, { recursive: true });
          this._copyDir(srcPath, destPath, exclude, manifest);
        } else if (entry.isFile()) {
          fs.copyFileSync(srcPath, destPath);
          manifest.files.push(srcPath.replace(this.projectRoot + path.sep, ''));
        }
      }
    } catch {}
  }

  _hashDir(dir) {
    const hash = crypto.createHash('sha256');
    const files = fs.readdirSync(dir).sort();
    for (const file of files) {
      if (file === 'manifest.json') continue;
      const filePath = path.join(dir, file);
      try {
        hash.update(fs.readFileSync(filePath));
      } catch {}
    }
    return hash.digest('hex');
  }

  _cleanup() {
    const cutoff = Date.now() - this.retentionDays * 86400000;
    try {
      for (const entry of fs.readdirSync(this.backupDir)) {
        if (entry === 'latest.txt') continue;
        const entryPath = path.join(this.backupDir, entry);
        const stat = fs.statSync(entryPath);
        if (stat.isDirectory() || stat.isFile()) {
          if (stat.mtimeMs < cutoff) {
            fs.rmSync(entryPath, { recursive: true, force: true });
          }
        }
      }
    } catch {}
  }

  restore(backupName) {
    const backupPath = path.isAbsolute(backupName) ? backupName : path.join(this.backupDir, backupName);
    if (!fs.existsSync(backupPath)) throw new Error(`Backup not found: ${backupName}`);

    const manifestPath = path.join(backupPath, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const file of manifest.files) {
        const src = path.join(backupPath, file);
        const dest = path.join(this.projectRoot, file);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      }
      return { restored: manifest.fileCount, from: backupName };
    }

    throw new Error('Invalid backup: no manifest.json');
  }

  listBackups() {
    if (!fs.existsSync(this.backupDir)) return [];
    const items = fs.readdirSync(this.backupDir)
      .filter(f => f !== 'latest.txt')
      .map(f => {
        const fPath = path.join(this.backupDir, f);
        const stat = fs.statSync(fPath);
        const manifestPath = path.join(fPath, 'manifest.json');
        const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
        return { name: f, createdAt: stat.mtime, fileCount: manifest.fileCount || 0, checksum: manifest.checksum };
      })
      .sort((a, b) => b.createdAt - a.createdAt);
    return items;
  }
}

module.exports = { BackupManager };
