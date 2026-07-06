import crypto from 'node:crypto';
import { type Logger } from '../types/logger.types.js';
import { type SecurityAlert } from '../types/security.types.js';

export interface SecurityMonitorConfig {
  maxLoginAttempts?: number;
  loginWindowMs?: number;
  maxRequestsPerMinute?: number;
  max4xxPerMinute?: number;
}

interface SecurityEvent {
  timestamp?: number;
  type: string;
  ip?: string;
  actor?: string;
  statusCode?: number;
  [key: string]: unknown;
}

export class SecurityMonitor {
  private readonly thresholds: {
    maxLoginAttempts: number;
    loginWindowMs: number;
    maxRequestsPerMinute: number;
    max4xxPerMinute: number;
  };
  private readonly events: SecurityEvent[] = [];
  private readonly alerts: SecurityAlert[] = [];
  private readonly loginAttempts = new Map<string, number[]>();
  private readonly requestCounts = new Map<string, number>();
  private readonly errorCounts = new Map<string, number>();
  private readonly logger?: Logger;

  constructor(logger?: Logger, config?: SecurityMonitorConfig) {
    this.logger = logger;
    this.thresholds = {
      maxLoginAttempts: config?.maxLoginAttempts ?? 5,
      loginWindowMs: config?.loginWindowMs ?? 300_000,
      maxRequestsPerMinute: config?.maxRequestsPerMinute ?? 100,
      max4xxPerMinute: config?.max4xxPerMinute ?? 20,
    };
  }

  recordEvent(event: SecurityEvent): void {
    this.events.push({ ...event, timestamp: Date.now() });
    if (this.events.length > 10_000) this.events.shift();

    switch (event.type) {
      case 'login_attempt':
        this._trackLogin(event);
        break;
      case 'request':
        this._trackRequest(event);
        break;
      case 'error':
        this._trackError(event);
        break;
    }
  }

  raiseAlert(alert: Omit<SecurityAlert, 'timestamp' | 'id'>): void {
    const fullAlert: SecurityAlert = {
      ...alert,
      timestamp: Date.now(),
      id: `alert-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`,
    };
    this.alerts.push(fullAlert);
    if (this.alerts.length > 1000) this.alerts.splice(0, this.alerts.length - 1000);
    this.logger?.warn(`Security alert: ${fullAlert.message}`, { severity: fullAlert.severity, type: fullAlert.type });
  }

  getAlerts(since?: number): SecurityAlert[] {
    return since ? this.alerts.filter(a => a.timestamp >= since) : this.alerts;
  }

  getEvents(filter?: { type?: string; since?: number }): SecurityEvent[] {
    let result = this.events;
    if (filter?.type) result = result.filter(e => e.type === filter.type);
    if (filter?.since !== undefined) { const since = filter.since!; result = result.filter(e => e.timestamp !== undefined && e.timestamp >= since); }
    return result.slice(-100);
  }

  getSummary(): { totalEvents: number; activeAlerts: number; loginAttempts: number; monitoredIPs: number } {
    return {
      totalEvents: this.events.length,
      activeAlerts: this.alerts.filter(a => a.timestamp > Date.now() - 300_000).length,
      loginAttempts: this.loginAttempts.size,
      monitoredIPs: new Set([...this.requestCounts.keys()].map(k => k.split(':')[0])).size,
    };
  }

  clearAlerts(): void {
    this.alerts.length = 0;
  }

  private _trackLogin(event: SecurityEvent): void {
    const key = event.ip ?? event.actor ?? 'unknown';
    const now = Date.now();
    if (!this.loginAttempts.has(key)) this.loginAttempts.set(key, []);
    const attempts = this.loginAttempts.get(key)!;
    attempts.push(now);
    const cutoff = now - this.thresholds.loginWindowMs;
    while (attempts.length > 0 && attempts[0] < cutoff) attempts.shift();
    if (attempts.length >= this.thresholds.maxLoginAttempts) {
      this.raiseAlert({
        severity: 'high',
        type: 'brute_force',
        message: `Brute force attempt detected from ${key}`,
        key,
      });
    }
  }

  private _trackRequest(event: SecurityEvent): void {
    const key = event.ip ?? 'global';
    const now = Date.now();
    const windowKey = `${key}:${Math.floor(now / 60_000)}`;
    this.requestCounts.set(windowKey, (this.requestCounts.get(windowKey) ?? 0) + 1);
    if (this.requestCounts.get(windowKey)! > this.thresholds.maxRequestsPerMinute) {
      this.raiseAlert({
        severity: 'medium',
        type: 'rate_limit',
        message: `Rate limit exceeded for ${key}`,
        key,
      });
    }
  }

  private _trackError(event: SecurityEvent): void {
    if (event.statusCode && event.statusCode >= 400 && event.statusCode < 500) {
      const key = event.ip ?? 'global';
      const now = Date.now();
      const windowKey = `${key}:4xx:${Math.floor(now / 60_000)}`;
      this.errorCounts.set(windowKey, (this.errorCounts.get(windowKey) ?? 0) + 1);
      if (this.errorCounts.get(windowKey)! > this.thresholds.max4xxPerMinute) {
        this.raiseAlert({
          severity: 'high',
          type: 'error_spike',
          message: `4xx error spike from ${key}`,
          key,
        });
      }
    }
  }
}
