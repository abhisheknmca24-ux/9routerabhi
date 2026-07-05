const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class IntegrityVerifier {
  constructor(options = {}) {
    this.projectRoot = options.projectRoot || process.env.PROJECT_ROOT || '.';
    this.manifestPath = options.manifestPath || path.join(this.projectRoot, 'config', 'integrity-manifest.json');
    this.manifest = {};
  }

  generateManifest() {
    const manifest = { generatedAt: new Date().toISOString(), files: {} };
    this._hashDir(this.projectRoot, manifest, ['node_modules', 'backups', '.git', 'logs', 'audit']);
    this.manifest = manifest;
    return manifest;
  }

  _hashDir(dir, manifest, exclude) {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (exclude.includes(entry.name)) continue;
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          this._hashDir(fullPath, manifest, exclude);
        } else if (entry.isFile()) {
          const relativePath = fullPath.replace(this.projectRoot + path.sep, '');
          const content = fs.readFileSync(fullPath);
          manifest.files[relativePath] = crypto.createHash('sha256').update(content).digest('hex');
        }
      }
    } catch {}
  }

  saveManifest() {
    if (!this.manifest.generatedAt) this.generateManifest();
    fs.mkdirSync(path.dirname(this.manifestPath), { recursive: true });
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  loadManifest() {
    if (!fs.existsSync(this.manifestPath)) return null;
    this.manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
    return this.manifest;
  }

  verify() {
    if (!this.manifest.generatedAt) this.loadManifest();
    if (!this.manifest.generatedAt) return { valid: false, error: 'No manifest found' };

    const current = this.generateManifest();
    const changed = [];
    const added = [];
    const removed = [];

    const allKeys = new Set([...Object.keys(this.manifest.files), ...Object.keys(current.files)]);

    for (const key of allKeys) {
      if (!this.manifest.files[key]) { added.push(key); continue; }
      if (!current.files[key]) { removed.push(key); continue; }
      if (this.manifest.files[key] !== current.files[key]) changed.push(key);
    }

    return {
      valid: changed.length === 0 && added.length === 0 && removed.length === 0,
      generatedAt: this.manifest.generatedAt,
      verifiedAt: current.generatedAt,
      changed,
      added,
      removed,
      totalFiles: Object.keys(current.files).length,
    };
  }
}

module.exports = { IntegrityVerifier };
