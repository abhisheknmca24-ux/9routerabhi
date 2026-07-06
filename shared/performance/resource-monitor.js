const os = require('os');
const process = require('process');

class ResourceMonitor {
  constructor(options = {}) {
    this.interval = options.interval || 60000;
    this.maxHistory = options.maxHistory || 60;
    this.warningThresholds = {
      cpuPercent: options.cpuWarningThreshold || 80,
      memoryPercent: options.memoryWarningThreshold || 85,
      heapPercent: options.heapWarningThreshold || 80,
    };
    this.history = [];
    this.warnings = [];
    this.timer = null;
  }

  start() {
    this.check();
    this.timer = setInterval(() => this.check(), this.interval);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  check() {
    const usage = process.cpuUsage();
    const mem = process.memoryUsage();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();

    const cpuPercent = this._calcCpuPercent(usage);
    this._lastCpu = { user: usage.user, system: usage.system };
    this._lastCheckTime = Date.now();

    const snapshot = {
      timestamp: Date.now(),
      cpu: {
        user: usage.user,
        system: usage.system,
        percent: cpuPercent,
      },
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
      process: {
        pid: process.pid,
        uptime: process.uptime(),
      },
    };

    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) this.history.shift();
    this._checkWarnings(snapshot);
    return snapshot;
  }

  _calcCpuPercent(usage) {
    const total = usage.user + usage.system;
    if (!this._lastCpu) return 0;
    const delta = total - (this._lastCpu.user + this._lastCpu.system);
    const elapsed = this._lastCheckTime ? (Date.now() - this._lastCheckTime) / 1000 : this.interval / 1000;
    if (elapsed <= 0) return 0;
    return (delta / elapsed) / os.cpus().length;
  }

  _checkWarnings(snapshot) {
    if (snapshot.cpu.percent > this.warningThresholds.cpuPercent) {
      this.warnings.push({ type: 'cpu', value: snapshot.cpu.percent, threshold: this.warningThresholds.cpuPercent, timestamp: snapshot.timestamp });
    }
    if (snapshot.memory.percentUsed > this.warningThresholds.heapPercent) {
      this.warnings.push({ type: 'heap', value: snapshot.memory.percentUsed, threshold: this.warningThresholds.heapPercent, timestamp: snapshot.timestamp });
    }
    if (snapshot.os.memUsedPercent > this.warningThresholds.memoryPercent) {
      this.warnings.push({ type: 'os_memory', value: snapshot.os.memUsedPercent, threshold: this.warningThresholds.memoryPercent, timestamp: snapshot.timestamp });
    }
    // Keep warnings bounded at 1000 entries
    if (this.warnings.length > 1000) this.warnings.splice(0, this.warnings.length - 1000);
  }

  getHistory(count) {
    return count ? this.history.slice(-count) : this.history;
  }

  getLatest() {
    return this.history.length > 0 ? this.history[this.history.length - 1] : null;
  }

  getWarnings() {
    return this.warnings;
  }
}

module.exports = { ResourceMonitor };
