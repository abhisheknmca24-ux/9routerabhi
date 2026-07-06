const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class SecretManager {
  constructor(options = {}) {
    this.secretsDir = options.secretsDir || path.join(process.env.PROJECT_ROOT || '.', 'config', 'secrets');
    this.cache = new Map();
    this.cacheTTL = options.cacheTTL || 60000;

    // Encryption key MUST come from environment or options. No fallback — if missing, operations throw.
    this.encryptionKey = options.encryptionKey || process.env.ENCRYPTION_KEY;
    if (!this.encryptionKey) {
      console.error('CRITICAL: ENCRYPTION_KEY is not set. Set a 64-char hex key in .env file.');
      // Still create the instance so the app can start and guide the user, but crypto ops will fail
    }

    // Use a persistent per-project derived salt instead of hardcoded
    const projectRoot = process.env.PROJECT_ROOT || '.';
    this._salt = projectRoot.replace(/[^a-zA-Z0-9]/g, '') + '-v1';
  }

  _getCipherKey() {
    if (!this.encryptionKey) {
      throw new Error('ENCRYPTION_KEY is not configured. Set it in .env or pass encryptionKey option.');
    }
    return crypto.scryptSync(this.encryptionKey, this._salt, 32);
  }

  encrypt(plaintext) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._getCipherKey(), iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return JSON.stringify({ iv: iv.toString('hex'), data: encrypted, authTag: authTag.toString('hex') });
  }

  decrypt(ciphertext) {
    const { iv, data, authTag } = JSON.parse(ciphertext);
    const decipher = crypto.createDecipheriv('aes-256-gcm', this._getCipherKey(), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  getSecret(name) {
    const cacheKey = `secret:${name}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expires) return cached.value;

    const filePath = path.join(this.secretsDir, `${name}.enc`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const ciphertext = fs.readFileSync(filePath, 'utf8');
      const value = this.decrypt(ciphertext);
      this.cache.set(cacheKey, { value, expires: Date.now() + this.cacheTTL });
      return value;
    } catch { return null; }
  }

  setSecret(name, value) {
    const filePath = path.join(this.secretsDir, `${name}.enc`);
    if (!fs.existsSync(this.secretsDir)) fs.mkdirSync(this.secretsDir, { recursive: true });
    const ciphertext = this.encrypt(value);
    fs.writeFileSync(filePath, ciphertext, { mode: 0o600 });
    this.cache.set(`secret:${name}`, { value, expires: Date.now() + this.cacheTTL });
  }

  deleteSecret(name) {
    const filePath = path.join(this.secretsDir, `${name}.enc`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    this.cache.delete(`secret:${name}`);
  }

  listSecrets() {
    if (!fs.existsSync(this.secretsDir)) return [];
    return fs.readdirSync(this.secretsDir)
      .filter(f => f.endsWith('.enc'))
      .map(f => f.replace('.enc', ''));
  }

  resolveEnvVars(obj) {
    if (typeof obj === 'string') {
      const match = obj.match(/^\$\{([^:}]+)(?::([^}]+))?\}$/);
      if (match) {
        const envVal = process.env[match[1]];
        return envVal !== undefined ? envVal : (match[2] || '');
      }
      return obj;
    }
    if (Array.isArray(obj)) return obj.map(item => this.resolveEnvVars(item));
    if (obj && typeof obj === 'object') {
      const resolved = {};
      for (const [key, value] of Object.entries(obj)) {
        resolved[key] = this.resolveEnvVars(value);
      }
      return resolved;
    }
    return obj;
  }

  clearCache() { this.cache.clear(); }
}

module.exports = { SecretManager };
