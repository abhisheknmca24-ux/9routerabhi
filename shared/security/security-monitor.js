class SecurityMonitor {
  constructor(options = {}) {
    this.thresholds = {
      maxLoginAttempts: options.maxLoginAttempts || 5,
      loginWindowMs: options.loginWindowMs || 300000,
      maxRequestsPerMinute: options.maxRequestsPerMinute || 100,
      max4xxPerMinute: options.max4xxPerMinute || 20,
    };
    this.events = [];
    this.alerts = [];
    this.loginAttempts = new Map();
    this.requestCounts = new Map();
    this.errorCounts = new Map();
  }

  recordEvent(event) {
    this.events.push({ ...event, timestamp: Date.now() });
    if (this.events.length > 10000) this.events.shift();

    switch (event.type) {
      case 'login_attempt': this._trackLogin(event); break;
      case 'request': this._trackRequest(event); break;
      case 'error': this._trackError(event); break;
    }
  }

  _trackLogin(event) {
    const key = event.ip || event.actor;
    const now = Date.now();
    if (!this.loginAttempts.has(key)) this.loginAttempts.set(key, []);
    const attempts = this.loginAttempts.get(key);
    attempts.push(now);
    const cutoff = now - this.thresholds.loginWindowMs;
    while (attempts.length > 0 && attempts[0] < cutoff) attempts.shift();
    if (attempts.length >= this.thresholds.maxLoginAttempts) {
      this.raiseAlert({ severity: 'high', type: 'brute_force', message: `Brute force attempt detected from ${key}`, key, attempts: attempts.length });
    }
  }

  _trackRequest(event) {
    const key = event.ip || 'global';
    const now = Date.now();
    const windowKey = `${key}:${Math.floor(now / 60000)}`;
    this.requestCounts.set(windowKey, (this.requestCounts.get(windowKey) || 0) + 1);
    if (this.requestCounts.get(windowKey) > this.thresholds.maxRequestsPerMinute) {
      this.raiseAlert({ severity: 'medium', type: 'rate_limit', message: `Rate limit exceeded for ${key}`, key, count: this.requestCounts.get(windowKey) });
    }
  }

  _trackError(event) {
    if (event.statusCode >= 400 && event.statusCode < 500) {
      const key = event.ip || 'global';
      const now = Date.now();
      const windowKey = `${key}:4xx:${Math.floor(now / 60000)}`;
      this.errorCounts.set(windowKey, (this.errorCounts.get(windowKey) || 0) + 1);
      if (this.errorCounts.get(windowKey) > this.thresholds.max4xxPerMinute) {
        this.raiseAlert({ severity: 'high', type: 'error_spike', message: `4xx error spike from ${key}`, key, count: this.errorCounts.get(windowKey) });
      }
    }
  }

  raiseAlert(alert) {
    alert.timestamp = Date.now();
    alert.id = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.alerts.push(alert);
  }

  getAlerts(since) {
    if (since) return this.alerts.filter(a => a.timestamp >= since);
    return this.alerts;
  }

  getEvents(filter) {
    let result = this.events;
    if (filter?.type) result = result.filter(e => e.type === filter.type);
    if (filter?.since) result = result.filter(e => e.timestamp >= filter.since);
    return result.slice(-100);
  }

  getSummary() {
    return {
      totalEvents: this.events.length,
      activeAlerts: this.alerts.filter(a => a.timestamp > Date.now() - 300000).length,
      loginAttempts: this.loginAttempts.size,
      monitoredIPs: new Set([...this.requestCounts.keys()].map(k => k.split(':')[0])).size,
    };
  }

  clearAlerts() { this.alerts = []; }
}

module.exports = { SecurityMonitor };
