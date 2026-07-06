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
    // Apply security headers (synchronous — no callback needed)
    this.securityHeaders.apply(req, res, () => {});

    // Rate limiting check
    const clientIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const rateCheck = this.rateLimiter.check(clientIp);
    if (!rateCheck.allowed) {
      res.setHeader('Retry-After', rateCheck.retryAfter);
      if (typeof res.status === 'function') {
        return res.status(429).json({ error: { message: 'Too many requests', type: 'rate_limit_error' } });
      }
      // Fallback for non-Express environments
      res.statusCode = 429;
      return res.end(JSON.stringify({ error: { message: 'Too many requests', type: 'rate_limit_error' } }));
    }

    // Authentication
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
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    this.securityMonitor.recordEvent({
      type: 'request',
      ip,
      method: req.method,
      path: typeof req.path === 'function' ? req.path() : (req.path || req.url),
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
