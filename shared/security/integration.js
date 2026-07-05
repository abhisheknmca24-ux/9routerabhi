const { LogSanitizer } = require('./log-sanitizer');
const { SecretManager } = require('./secret-manager');
const { AuthMiddleware } = require('./auth-middleware');
const { SecurityHeaders } = require('./security-headers');
const { RateLimiter } = require('./rate-limiter');
const { AuditLogger } = require('./audit-logger');
const { BackupManager } = require('./backup-manager');
const { IntegrityVerifier } = require('./integrity-verifier');
const { SecurityMonitor } = require('./security-monitor');

class SecurityIntegration {
  constructor(config = {}) {
    this.sanitizer = new LogSanitizer(config.sanitizerPatterns);
    this.secretManager = new SecretManager({ encryptionKey: config.encryptionKey, secretsDir: config.secretsDir });
    this.authMiddleware = new AuthMiddleware({ requireAuth: config.requireAuth, apiKeySecret: config.apiKeySecret, jwtSecret: config.jwtSecret });
    this.securityHeaders = new SecurityHeaders({ customHeaders: config.customHeaders });
    this.rateLimiter = new RateLimiter({ windowMs: config.rateLimitWindowMs || 60000, maxRequests: config.rateLimitMaxRequests || 100 });
    this.auditLogger = new AuditLogger({ logDir: config.auditLogDir, enabled: config.auditLogEnabled });
    this.backupManager = new BackupManager({ backupDir: config.backupDir, retentionDays: config.backupRetentionDays });
    this.integrityVerifier = new IntegrityVerifier({ projectRoot: config.projectRoot });
    this.securityMonitor = new SecurityMonitor({
      maxLoginAttempts: config.maxLoginAttempts || 5,
      maxRequestsPerMinute: config.rateLimitMaxRequests || 100,
    });
  }

  middleware(req, res, next) {
    this.securityHeaders.apply(req, res, () => {});
    const rateCheck = this.rateLimiter.check(req.ip || req.connection.remoteAddress);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfter);
      return res.status(429).json({ error: { message: 'Too many requests', type: 'rate_limit_error' } });
    }
    this.authMiddleware.authenticate(req, res, next);
  }

  async createBackup() {
    return this.backupManager.createBackup();
  }

  async verifyIntegrity() {
    return this.integrityVerifier.verify();
  }

  logAuditEvent(event) {
    this.auditLogger.log(event);
    this.securityMonitor.recordEvent({
      type: 'audit',
      eventType: event.eventType,
      actor: event.actor,
      action: event.action,
      result: event.result,
    });
  }

  recordRequest(req, statusCode) {
    this.securityMonitor.recordEvent({
      type: 'request',
      ip: req.ip,
      method: req.method,
      path: req.path,
      statusCode,
    });
    if (statusCode >= 400) {
      this.securityMonitor.recordEvent({ type: 'error', ip: req.ip, statusCode });
    }
  }

  getSecurityAlerts() { return this.securityMonitor.getAlerts(); }
  getSanitizer() { return this.sanitizer; }
  getSecretManager() { return this.secretManager; }
  getAuditLogger() { return this.auditLogger; }
  getMonitor() { return this.securityMonitor; }
}

module.exports = { SecurityIntegration };
