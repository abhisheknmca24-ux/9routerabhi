import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { type Logger } from '../types/logger.types.js';

export interface BackupManagerConfig {
  backupDir?: string;
  projectRoot?: string;
  retentionDays?: number;
  excludeDirs?: string[];
  logger?: Logger;
}

export interface BackupResult {
  name: string;
  path: string;
  fileCount: number;
}

export interface BackupInfo {
  name: string;
  createdAt: Date;
  fileCount: number;
  checksum?: string;
}

export class BackupManager {
  private readonly backupDir: string;
  private readonly projectRoot: string;
  private readonly retentionDays: number;
  private readonly excludeDirs: string[];
  private readonly logger?: Logger;

  constructor(config?: BackupManagerConfig) {
    this.projectRoot = config?.projectRoot ?? process.env.PROJECT_ROOT ?? '.';
    this.backupDir = config?.backupDir ?? path.join(this.projectRoot, 'backups');
    this.retentionDays = config?.retentionDays ?? 30;
    this.excludeDirs = config?.excludeDirs ?? ['node_modules', 'backups', '.git', 'logs', 'audit'];
    this.logger = config?.logger;
  }

  createBackup(name?: string): BackupResult {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = name || `config-${timestamp}`;
    const backupPath = path.join(this.backupDir, backupName);

    if (!fs.existsSync(backupPath)) fs.mkdirSync(backupPath, { recursive: true });

    const manifest: { name: string; createdAt: string; files: string[]; checksum?: string; fileCount?: number } = {
      name: backupName,
      createdAt: new Date().toISOString(),
      files: [],
    };

    this._copyDir(this.projectRoot, backupPath, this.excludeDirs, manifest);

    manifest.checksum = this._hashDir(backupPath);
    manifest.fileCount = manifest.files.length;

    fs.writeFileSync(path.join(backupPath, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(this.backupDir, 'latest.txt'), backupName);

    this._cleanup();
    this.logger?.info(`Backup created: ${backupName}`, { fileCount: manifest.fileCount });
    return { name: backupName, path: backupPath, fileCount: manifest.fileCount };
  }

  restore(backupName: string): { restored: number; from: string } {
    const backupPath = path.isAbsolute(backupName) ? backupName : path.join(this.backupDir, backupName);
    if (!fs.existsSync(backupPath)) throw new Error(`Backup not found: ${backupName}`);

    const manifestPath = path.join(backupPath, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { files: string[] };
      for (const file of manifest.files) {
        const src = path.join(backupPath, file);
        const dest = path.join(this.projectRoot, file);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      }
      this.logger?.info(`Restored ${manifest.files.length} files from ${backupName}`);
      return { restored: manifest.files.length, from: backupName };
    }

    throw new Error('Invalid backup: no manifest.json');
  }

  listBackups(): BackupInfo[] {
    if (!fs.existsSync(this.backupDir)) return [];
    const items = fs.readdirSync(this.backupDir)
      .filter(f => f !== 'latest.txt')
      .map(f => {
        const fPath = path.join(this.backupDir, f);
        const stat = fs.statSync(fPath);
        const manifestPath = path.join(fPath, 'manifest.json');
        const manifest: { fileCount?: number; checksum?: string } = {};
        if (fs.existsSync(manifestPath)) {
          const m = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
          manifest.fileCount = m.fileCount;
          manifest.checksum = m.checksum;
        }
        return {
          name: f,
          createdAt: stat.mtime,
          fileCount: manifest.fileCount || 0,
          checksum: manifest.checksum,
        };
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return items;
  }

  private _copyDir(src: string, dest: string, exclude: string[], manifest: { files: string[] }): void {
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
    } catch (err) {
      this.logger?.error(`Backup copy error in ${src}: ${(err as Error).message}`);
    }
  }

  private _hashDir(dir: string): string {
    const hash = crypto.createHash('sha256');
    const entries: string[] = [];
    this._collectFiles(dir, entries, ['manifest.json']);
    for (const filePath of entries.sort()) {
      try {
        hash.update(fs.readFileSync(filePath));
      } catch {
        // Skip files that can't be read
      }
    }
    return hash.digest('hex');
  }

  private _collectFiles(dir: string, entries: string[], exclude: string[]): void {
    try {
      const items = fs.readdirSync(dir, { withFileTypes: true });
      for (const item of items) {
        if (exclude.includes(item.name)) continue;
        const fullPath = path.join(dir, item.name);
        if (item.isDirectory()) {
          this._collectFiles(fullPath, entries, exclude);
        } else if (item.isFile()) {
          entries.push(fullPath);
        }
      }
    } catch {
      // Skip unreadable directories
    }
  }

  private _cleanup(): void {
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    try {
      for (const entry of fs.readdirSync(this.backupDir)) {
        if (entry === 'latest.txt') continue;
        const entryPath = path.join(this.backupDir, entry);
        const stat = fs.statSync(entryPath);
        if ((stat.isDirectory() || stat.isFile()) && stat.mtimeMs < cutoff) {
          fs.rmSync(entryPath, { recursive: true, force: true });
          this.logger?.info(`Cleaned up old backup: ${entry}`);
        }
      }
    } catch (err) {
      this.logger?.error(`Backup cleanup error: ${(err as Error).message}`);
    }
  }
}
