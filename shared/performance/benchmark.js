class Benchmark {
  constructor(options = {}) {
    this.results = [];
    this.running = false;
    this.options = { concurrency: 1, iterations: 10, timeout: 30000, ...options };
  }

  async run(name, fn, options = {}) {
    const concurrency = options.concurrency || this.options.concurrency;
    const iterations = options.iterations || this.options.iterations;
    const timeout = options.timeout || this.options.timeout;
    const startTime = Date.now();
    const latencies = [];
    let errors = 0;

    this.running = true;

    const runBatch = async () => {
      const batch = [];
      for (let i = 0; i < concurrency; i++) {
        const iterIdx = completedCount; // capture iteration index before increment
        completedCount++;
        batch.push((async () => {
          const t0 = Date.now();
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), timeout);
            await fn({ signal: controller.signal, iteration: iterIdx });
            clearTimeout(timer);
            latencies.push(Date.now() - t0);
          } catch (err) {
            errors++;
            latencies.push(Date.now() - t0);
          }
        })());
      }
      await Promise.all(batch);
    };

    const batches = Math.ceil(iterations / concurrency);
    let completedCount = 0;
    for (let i = 0; i < batches && this.running; i++) {
      await runBatch();
    }

    const elapsed = Date.now() - startTime;
    const sorted = [...latencies].sort((a, b) => a - b);
    const total = latencies.length;
    const avg = total > 0 ? latencies.reduce((a, b) => a + b, 0) / total : 0;

    const result = {
      name,
      timestamp: new Date().toISOString(),
      totalRequests: total,
      errors,
      errorRate: total > 0 ? errors / total : 0,
      elapsed,
      throughput: elapsed > 0 ? (total / elapsed) * 1000 : 0,
      latency: {
        min: sorted[0] || 0,
        max: sorted[sorted.length - 1] || 0,
        avg,
        p50: this._percentile(sorted, 50),
        p90: this._percentile(sorted, 90),
        p95: this._percentile(sorted, 95),
        p99: this._percentile(sorted, 99),
      },
      config: { concurrency, iterations, timeout },
    };

    this.results.push(result);
    this.running = false;
    return result;
  }

  stop() { this.running = false; }

  _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const i = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(i, sorted.length - 1))];
  }

  getResults() { return this.results; }

  getSummary() {
    if (this.results.length === 0) return null;
    const last = this.results[this.results.length - 1];
    return {
      name: last.name,
      totalRequests: last.totalRequests,
      errors: last.errors,
      errorRate: last.errorRate,
      avgLatency: last.latency.avg,
      p95Latency: last.latency.p95,
      throughput: last.throughput,
      elapsed: last.elapsed,
    };
  }
}

module.exports = { Benchmark };
