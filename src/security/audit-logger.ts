import fs from 'node:fs';
import path from 'node:path';
import { type Logger } from '../types/logger.types.js';
import { type AuditEvent } from '../types/security.types.js';
import { LogSanitizer } from './log-sanitizer.js';

export interface AuditLoggerConfig {
  logDir?: string;
  enabled?: boolean;
  retentionDays?: number;
  logger?: Logger;
}

const DEFAULT_RETENTION_DAYS = 90;

export class AuditLogger {
  private readonly logDir: string;
  private readonly sanitizer: LogSanitizer;
  public readonly enabled: boolean;
  private readonly retentionDays: number;
  private readonly logger?: Logger;
  private logStream: fs.WriteStream | null = null;
  private currentDate: string | null = null;
  private dirReady = false;

  constructor(config?: AuditLoggerConfig) {
    this.logDir = config?.logDir ?? path.join(process.env.PROJECT_ROOT ?? '.', 'audit');
    this.sanitizer = new LogSanitizer(config?.logger);
    this.enabled = config?.enabled !== false;
    this.retentionDays = config?.retentionDays ?? DEFAULT_RETENTION_DAYS;
    this.logger = config?.logger;
    this._initDir();
  }

  log(event: AuditEvent): void {
    if (!this.enabled) return;
    const entry = {
      timestamp: new Date().toISOString(),
      eventType: event.eventType,
      actor: event.actor || 'system',
      action: event.action,
      resource: event.resource,
      result: event.result || 'success',
      details: this.sanitizer.sanitize(event.details ?? {}) as Record<string, unknown>,
      ip: event.ip,
      userAgent: event.userAgent,
    };

    const formatted = JSON.stringify(entry) + '\n';
    this._write(formatted);
  }

  close(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  private _initDir(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
      }
      this.dirReady = true;
    } catch (err) {
      this.logger?.error(`Cannot create audit log directory: ${this.logDir}`, { error: (err as Error).message });
      (this as { enabled: boolean }).enabled = false;
    }
  }

  private _write(data: string): void {
    if (!this.dirReady) return;
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.currentDate) {
      this._rotate(today);
    }
    if (this.logStream) {
      const canContinue = this.logStream.write(data);
      if (!canContinue) {
        this.logger?.warn('Audit log write buffer full, event may be dropped');
      }
      if (this.logStream.listenerCount('error') === 0) {
        this.logStream.on('error', (err: Error) => {
          this.logger?.error(`Audit log write error: ${err.message}`);
        });
      }
    }
  }

  private _rotate(date: string): void {
    if (this.logStream) this.logStream.end();
    this.currentDate = date;
    const filePath = path.join(this.logDir, `audit-${date}.log`);
    this.logStream = fs.createWriteStream(filePath, { flags: 'a' });
    this._cleanup();
  }

  private _cleanup(): void {
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    try {
      if (!fs.existsSync(this.logDir)) return;
      for (const file of fs.readdirSync(this.logDir)) {
        if (!file.startsWith('audit-')) continue;
        const filePath = path.join(this.logDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(filePath);
      }
    } catch (err) {
      this.logger?.error(`Audit log cleanup error: ${(err as Error).message}`);
    }
  }
}
