const fs = require('fs');
const path = require('path');
const { LogSanitizer } = require('./log-sanitizer');

class AuditLogger {
  constructor(options = {}) {
    this.logDir = options.logDir || path.join(process.env.PROJECT_ROOT || '.', 'audit');
    this.sanitizer = options.sanitizer || new LogSanitizer();
    this.enabled = options.enabled !== false;
    this.retentionDays = options.retentionDays || 90;
    this._logStream = null;
    this._currentDate = null;
  }

  log(event) {
    if (!this.enabled) return;
    const entry = {
      timestamp: new Date().toISOString(),
      eventType: event.eventType,
      actor: event.actor || 'system',
      action: event.action,
      resource: event.resource,
      result: event.result || 'success',
      details: this.sanitizer.sanitize(event.details || {}),
      ip: event.ip,
      userAgent: event.userAgent,
    };

    const formatted = JSON.stringify(entry) + '\n';
    this._write(formatted);
  }

  _write(data) {
    if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this._currentDate) {
      this._rotate(today);
    }
    if (this._logStream) this._logStream.write(data);
  }

  _rotate(date) {
    if (this._logStream) this._logStream.end();
    this._currentDate = date;
    const filePath = path.join(this.logDir, `audit-${date}.log`);
    this._logStream = fs.createWriteStream(filePath, { flags: 'a' });
    this._cleanup();
  }

  _cleanup() {
    const cutoff = Date.now() - this.retentionDays * 86400000;
    try {
      for (const file of fs.readdirSync(this.logDir)) {
        if (!file.startsWith('audit-')) continue;
        const filePath = path.join(this.logDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(filePath);
      }
    } catch {}
  }

  close() { if (this._logStream) { this._logStream.end(); this._logStream = null; } }
}

module.exports = { AuditLogger };
