import type { IncomingMessage, ServerResponse } from 'node:http';
import { type Logger } from '../types/logger.types.js';
import { type AuditEvent } from '../types/security.types.js';
import { LogSanitizer } from './log-sanitizer.js';
import { SecretManager } from './secret-manager.js';
import { AuthMiddleware } from './auth-middleware.js';
import { SecurityHeaders } from './security-headers.js';
import { RateLimiter } from './rate-limiter.js';
import { AuditLogger } from './audit-logger.js';
import { BackupManager } from './backup-manager.js';
import { IntegrityVerifier } from './integrity-verifier.js';
import { SecurityMonitor } from './security-monitor.js';

export interface SecurityIntegrationConfig {
  sanitizerPatterns?: Array<{ regex: RegExp; replacement: string }>;
  encryptionKey?: string;
  secretsDir?: string;
  requireAuth?: boolean;
  apiKeySecret?: string;
  jwtSecret?: string;
  customHeaders?: Record<string, string>;
  rateLimitWindowMs?: number;
  rateLimitMaxRequests?: number;
  auditLogDir?: string;
  auditLogEnabled?: boolean;
  backupDir?: string;
  backupRetentionDays?: number;
  projectRoot?: string;
  maxLoginAttempts?: number;
  logger: Logger;
}

export class SecurityIntegration {
  public readonly sanitizer: LogSanitizer;
  public readonly secretManager: SecretManager;
  public readonly authMiddleware: AuthMiddleware;
  public readonly securityHeaders: SecurityHeaders;
  public readonly rateLimiter: RateLimiter;
  public readonly auditLogger: AuditLogger;
  public readonly backupManager: BackupManager;
  public readonly integrityVerifier: IntegrityVerifier;
  public readonly securityMonitor: SecurityMonitor;

  constructor(config: SecurityIntegrationConfig) {
    this.sanitizer = new LogSanitizer(config.logger, config.sanitizerPatterns);
    this.secretManager = new SecretManager({ encryptionKey: config.encryptionKey, secretsDir: config.secretsDir, logger: config.logger });
    this.authMiddleware = new AuthMiddleware({
      requireAuth: config.requireAuth,
      apiKeySecret: config.apiKeySecret,
      jwtSecret: config.jwtSecret,
      logger: config.logger,
    });
    this.securityHeaders = new SecurityHeaders({ customHeaders: config.customHeaders });
    this.rateLimiter = new RateLimiter(config.logger, {
      windowMs: config.rateLimitWindowMs ?? 60000,
      maxRequests: config.rateLimitMaxRequests ?? 100,
    });
    this.auditLogger = new AuditLogger({ logDir: config.auditLogDir, enabled: config.auditLogEnabled, logger: config.logger });
    this.backupManager = new BackupManager({ backupDir: config.backupDir, retentionDays: config.backupRetentionDays, projectRoot: config.projectRoot, logger: config.logger });
    this.integrityVerifier = new IntegrityVerifier({ projectRoot: config.projectRoot, logger: config.logger });
    this.securityMonitor = new SecurityMonitor(config.logger, {
      maxLoginAttempts: config.maxLoginAttempts ?? 5,
      maxRequestsPerMinute: config.rateLimitMaxRequests ?? 100,
    });
  }

  middleware(req: IncomingMessage & { ip?: string; connection?: { remoteAddress?: string } }, res: ServerResponse & { status?: (code: number) => { json: (data: unknown) => void }; json?: (data: unknown) => void }, next: () => void): void {
    this.securityHeaders.apply(req, res, () => {});

    const clientIp = req.ip ?? req.connection?.remoteAddress ?? 'unknown';
    const rateCheck = this.rateLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', String(rateCheck.retryAfter));
      if (typeof res.status === 'function' && typeof res.json === 'function') {
        res.status(429).json({ error: { message: 'Too many requests', type: 'rate_limit_error' } });
      } else {
        res.statusCode = 429;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: { message: 'Too many requests', type: 'rate_limit_error' } }));
      }
      return;
    }

    this.authMiddleware.authenticate(req as Parameters<AuthMiddleware['authenticate']>[0], res as Parameters<AuthMiddleware['authenticate']>[1], next);
  }

  async createBackup(): Promise<ReturnType<BackupManager['createBackup']>> {
    return this.backupManager.createBackup();
  }

  async verifyIntegrity(): Promise<ReturnType<IntegrityVerifier['verify']>> {
    return this.integrityVerifier.verify();
  }

  logAuditEvent(event: AuditEvent): void {
    this.auditLogger.log(event);
    this.securityMonitor.recordEvent({
      type: 'audit' as const,
      eventType: event.eventType,
      actor: event.actor,
      action: event.action,
      result: event.result,
    });
  }

  recordRequest(req: { ip?: string; connection?: { remoteAddress?: string }; method?: string; url?: string; path?: string }, statusCode: number): void {
    const ip = req.ip ?? req.connection?.remoteAddress ?? 'unknown';
    this.securityMonitor.recordEvent({
      type: 'request' as const,
      ip,
      method: req.method,
      path: req.path ?? req.url,
      statusCode,
    });
    if (statusCode >= 400) {
      this.securityMonitor.recordEvent({ type: 'error' as const, ip, statusCode });
    }
  }

  getSecurityAlerts(): ReturnType<SecurityMonitor['getAlerts']> {
    return this.securityMonitor.getAlerts();
  }

  getSanitizer(): LogSanitizer { return this.sanitizer; }
  getSecretManager(): SecretManager { return this.secretManager; }
  getAuditLogger(): AuditLogger { return this.auditLogger; }
  getMonitor(): SecurityMonitor { return this.securityMonitor; }
}
