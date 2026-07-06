import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { type Logger } from '../types/logger.types.js';

export interface IntegrityVerifierConfig {
  projectRoot?: string;
  manifestPath?: string;
  logger?: Logger;
}

export interface IntegrityResult {
  valid: boolean;
  generatedAt?: string;
  verifiedAt?: string;
  changed: string[];
  added: string[];
  removed: string[];
  totalFiles: number;
}

const DEFAULT_EXCLUDES = ['node_modules', 'backups', '.git', 'logs', 'audit'];

export class IntegrityVerifier {
  private readonly projectRoot: string;
  private readonly manifestPath: string;
  private readonly logger?: Logger;
  private manifest: { generatedAt: string; files: Record<string, string> } = { generatedAt: '', files: {} };

  constructor(config?: IntegrityVerifierConfig) {
    this.projectRoot = config?.projectRoot ?? process.env.PROJECT_ROOT ?? '.';
    this.manifestPath = config?.manifestPath ?? path.join(this.projectRoot, 'config', 'integrity-manifest.json');
    this.logger = config?.logger;
  }

  generateManifest(): { generatedAt: string; files: Record<string, string> } {
    const manifest: { generatedAt: string; files: Record<string, string> } = {
      generatedAt: new Date().toISOString(),
      files: {},
    };
    this._hashDir(this.projectRoot, manifest, DEFAULT_EXCLUDES);
    this.manifest = manifest;
    return manifest;
  }

  saveManifest(): void {
    if (!this.manifest.generatedAt) this.generateManifest();
    fs.mkdirSync(path.dirname(this.manifestPath), { recursive: true });
    fs.writeFileSync(this.manifestPath, JSON.stringify(this.manifest, null, 2));
  }

  loadManifest(): { generatedAt: string; files: Record<string, string> } | null {
    if (!fs.existsSync(this.manifestPath)) return null;
    const data = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'));
    this.manifest = data;
    return data;
  }

  verify(): IntegrityResult {
    if (!this.manifest.generatedAt) this.loadManifest();
    if (!this.manifest.generatedAt) {
      return { valid: false, changed: [], added: [], removed: [], totalFiles: 0, error: 'No manifest found' } as IntegrityResult & { error: string };
    }

    const current = this.generateManifest();
    const changed: string[] = [];
    const added: string[] = [];
    const removed: string[] = [];

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

  private _hashDir(dir: string, manifest: { files: Record<string, string> }, exclude: string[]): void {
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
    } catch (err) {
      this.logger?.error(`Integrity check error reading ${dir}: ${(err as Error).message}`);
    }
  }
}
