import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { type Logger } from '../types/logger.types.js';

export interface SecretManagerConfig {
  secretsDir?: string;
  encryptionKey?: string;
  cacheTTL?: number;
  projectRoot?: string;
  logger?: Logger;
}

export class SecretManager {
  private readonly secretsDir: string;
  private readonly cache = new Map<string, { value: string; expires: number }>();
  private readonly cacheTTL: number;
  private readonly encryptionKey: string | undefined;
  private readonly salt: string;
  private readonly logger?: Logger;

  constructor(config?: SecretManagerConfig) {
    const projectRoot = config?.projectRoot ?? process.env.PROJECT_ROOT ?? '.';
    this.secretsDir = config?.secretsDir ?? path.join(projectRoot, 'config', 'secrets');
    this.cacheTTL = config?.cacheTTL ?? 60000;
    this.encryptionKey = config?.encryptionKey ?? process.env.ENCRYPTION_KEY;
    this.logger = config?.logger;
    this.salt = projectRoot.replace(/[^a-zA-Z0-9]/g, '') + '-v1';

    if (!this.encryptionKey) {
      this.logger?.error('ENCRYPTION_KEY is not set. Set a 64-char hex key in .env file.');
    }
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', this._getCipherKey(), iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return JSON.stringify({ iv: iv.toString('hex'), data: encrypted, authTag: authTag.toString('hex') });
  }

  decrypt(ciphertext: string): string {
    const { iv, data, authTag } = JSON.parse(ciphertext);
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      this._getCipherKey(),
      Buffer.from(iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));
    let decrypted = decipher.update(data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  getSecret(name: string): string | null {
    const cacheKey = `secret:${name}`;
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() < cached.expires) return cached.value;

    const filePath = path.join(this.secretsDir, `${name}.enc`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const ciphertext = fs.readFileSync(filePath, 'utf-8');
      const value = this.decrypt(ciphertext);
      this.cache.set(cacheKey, { value, expires: Date.now() + this.cacheTTL });
      return value;
    } catch (err) {
      this.logger?.error(`Failed to decrypt secret: ${name}`, { error: (err as Error).message });
      return null;
    }
  }

  setSecret(name: string, value: string): void {
    const filePath = path.join(this.secretsDir, `${name}.enc`);
    if (!fs.existsSync(this.secretsDir)) {
      fs.mkdirSync(this.secretsDir, { recursive: true, mode: 0o700 });
    }
    const ciphertext = this.encrypt(value);
    fs.writeFileSync(filePath, ciphertext, { mode: 0o600 });
    this.cache.set(`secret:${name}`, { value, expires: Date.now() + this.cacheTTL });
  }

  deleteSecret(name: string): void {
    const filePath = path.join(this.secretsDir, `${name}.enc`);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    this.cache.delete(`secret:${name}`);
  }

  listSecrets(): string[] {
    if (!fs.existsSync(this.secretsDir)) return [];
    return fs.readdirSync(this.secretsDir)
      .filter(f => f.endsWith('.enc'))
      .map(f => f.replace('.enc', ''));
  }

  resolveEnvVars<T>(obj: T): T {
    if (typeof obj === 'string') {
      const match = obj.match(/^\$\{([^:}]+)(?::([^}]+))?\}$/);
      if (match) {
        return (process.env[match[1]] ?? match[2] ?? '') as T;
      }
      return obj;
    }
    if (Array.isArray(obj)) return obj.map(item => this.resolveEnvVars(item)) as T;
    if (obj !== null && typeof obj === 'object') {
      const resolved: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        resolved[key] = this.resolveEnvVars(value);
      }
      return resolved as T;
    }
    return obj;
  }

  clearCache(): void {
    this.cache.clear();
  }

  private _getCipherKey(): Buffer {
    if (!this.encryptionKey) {
      throw new Error('ENCRYPTION_KEY is not configured. Set it in .env or pass encryptionKey option.');
    }
    return crypto.scryptSync(this.encryptionKey, this.salt, 32);
  }
}
