import os from 'node:os';
import process from 'node:process';

export interface ResourceMonitorConfig {
  interval?: number;
  maxHistory?: number;
  cpuWarningThreshold?: number;
  memoryWarningThreshold?: number;
  heapWarningThreshold?: number;
}

export interface ResourceSnapshot {
  timestamp: number;
  cpu: { user: number; system: number; percent: number };
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number; percentUsed: number };
  os: { totalMem: number; freeMem: number; memUsedPercent: number; loadAvg: number[]; uptime: number };
  process: { pid: number; uptime: number };
}

export interface ResourceWarning {
  type: 'cpu' | 'heap' | 'os_memory';
  value: number;
  threshold: number;
  timestamp: number;
}

export class ResourceMonitor {
  private readonly interval: number;
  private readonly maxHistory: number;
  private readonly warningThresholds: { cpuPercent: number; memoryPercent: number; heapPercent: number };
  private readonly history: ResourceSnapshot[] = [];
  private readonly warnings: ResourceWarning[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastCpu: { user: number; system: number } | null = null;
  private lastCheckTime: number | null = null;

  constructor(config?: ResourceMonitorConfig) {
    this.interval = config?.interval ?? 60000;
    this.maxHistory = config?.maxHistory ?? 60;
    this.warningThresholds = {
      cpuPercent: config?.cpuWarningThreshold ?? 80,
      memoryPercent: config?.memoryWarningThreshold ?? 85,
      heapPercent: config?.heapWarningThreshold ?? 80,
    };
  }

  start(): void {
    this.check();
    this.timer = setInterval(() => this.check(), this.interval);
    if (this.timer.unref) this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  check(): ResourceSnapshot {
    const usage = process.cpuUsage();
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    const cpuPercent = this._calcCpuPercent(usage);
    this.lastCpu = { user: usage.user, system: usage.system };
    this.lastCheckTime = Date.now();

    const snapshot: ResourceSnapshot = {
      timestamp: Date.now(),
      cpu: { user: usage.user, system: usage.system, percent: cpuPercent },
      memory: {
        rss: mem.rss,
        heapTotal: mem.heapTotal,
        heapUsed: mem.heapUsed,
        external: mem.external || 0,
        percentUsed: (mem.heapUsed / mem.heapTotal) * 100,
      },
      os: {
        totalMem,
        freeMem,
        memUsedPercent: ((totalMem - freeMem) / totalMem) * 100,
        loadAvg: os.loadavg(),
        uptime: os.uptime(),
      },
      process: { pid: process.pid, uptime: process.uptime() },
    };

    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) this.history.shift();
    this._checkWarnings(snapshot);
    return snapshot;
  }

  getHistory(count?: number): ResourceSnapshot[] {
    return count ? this.history.slice(-count) : this.history;
  }

  getLatest(): ResourceSnapshot | null {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  getWarnings(): ResourceWarning[] {
    return this.warnings;
  }

  private _calcCpuPercent(usage: { user: number; system: number }): number {
    const total = usage.user + usage.system;
    if (!this.lastCpu) return 0;
    const delta = total - (this.lastCpu.user + this.lastCpu.system);
    const elapsed = this.lastCheckTime ? (Date.now() - this.lastCheckTime) / 1000 : this.interval / 1000;
    if (elapsed <= 0) return 0;
    return (delta / elapsed) / os.cpus().length;
  }

  private _checkWarnings(snapshot: ResourceSnapshot): void {
    if (snapshot.cpu.percent > this.warningThresholds.cpuPercent) {
      this.warnings.push({ type: 'cpu', value: snapshot.cpu.percent, threshold: this.warningThresholds.cpuPercent, timestamp: snapshot.timestamp });
    }
    if (snapshot.memory.percentUsed > this.warningThresholds.heapPercent) {
      this.warnings.push({ type: 'heap', value: snapshot.memory.percentUsed, threshold: this.warningThresholds.heapPercent, timestamp: snapshot.timestamp });
    }
    if (snapshot.os.memUsedPercent > this.warningThresholds.memoryPercent) {
      this.warnings.push({ type: 'os_memory', value: snapshot.os.memUsedPercent, threshold: this.warningThresholds.memoryPercent, timestamp: snapshot.timestamp });
    }
    if (this.warnings.length > 1000) this.warnings.splice(0, this.warnings.length - 1000);
  }
}
