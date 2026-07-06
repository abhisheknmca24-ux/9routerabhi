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
    this._dirReady = false;
    this._initDir();
  }

  _initDir() {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true, mode: 0o700 });
      }
      this._dirReady = true;
    } catch (err) {
      console.error(`AuditLogger: cannot create log directory ${this.logDir}: ${err.message}`);
      this.enabled = false;
    }
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
    if (!this._dirReady) return;
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this._currentDate) {
      this._rotate(today);
    }
    if (this._logStream) {
      const canContinue = this._logStream.write(data);
      if (!canContinue) {
        // Backpressure: log that we're throttling but don't block
        console.warn('AuditLogger: write buffer full, event may be dropped');
      }
      // Attach error handler lazily to avoid missing events
      if (!this._logStream.listenerCount('error')) {
        this._logStream.on('error', (err) => {
          console.error(`AuditLogger: write error: ${err.message}`);
        });
      }
    }
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
      if (!fs.existsSync(this.logDir)) return;
      for (const file of fs.readdirSync(this.logDir)) {
        if (!file.startsWith('audit-')) continue;
        const filePath = path.join(this.logDir, file);
        const stat = fs.statSync(filePath);
        if (stat.mtimeMs < cutoff) fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error(`AuditLogger: cleanup error: ${err.message}`);
    }
  }

  close() { if (this._logStream) { this._logStream.end(); this._logStream = null; } }
}

module.exports = { AuditLogger };
