export interface BenchmarkConfig {
  concurrency?: number;
  iterations?: number;
  timeout?: number;
}

export interface BenchmarkResult {
  name: string;
  timestamp: string;
  totalRequests: number;
  errors: number;
  errorRate: number;
  elapsed: number;
  throughput: number;
  latency: {
    min: number;
    max: number;
    avg: number;
    p50: number;
    p90: number;
    p95: number;
    p99: number;
  };
  config: { concurrency: number; iterations: number; timeout: number };
}

export class Benchmark {
  private readonly results: BenchmarkResult[] = [];
  private readonly options: Required<BenchmarkConfig>;
  private running = false;

  constructor(config?: BenchmarkConfig) {
    this.options = {
      concurrency: config?.concurrency ?? 1,
      iterations: config?.iterations ?? 10,
      timeout: config?.timeout ?? 30000,
    };
  }

  async run(name: string, fn: (opts: { signal: AbortSignal; iteration: number }) => Promise<void>, options?: BenchmarkConfig): Promise<BenchmarkResult> {
    const concurrency = options?.concurrency ?? this.options.concurrency;
    const iterations = options?.iterations ?? this.options.iterations;
    const timeout = options?.timeout ?? this.options.timeout;
    const startTime = Date.now();
    const latencies: number[] = [];
    let errors = 0;
    let completedCount = 0;

    this.running = true;

    const runBatch = async () => {
      const batch: Array<Promise<void>> = [];
      for (let i = 0; i < concurrency; i++) {
        const iterIdx = completedCount;
        completedCount++;
        batch.push(
          (async () => {
            const t0 = Date.now();
            try {
              const controller = new AbortController();
              const timer = setTimeout(() => controller.abort(), timeout);
              await fn({ signal: controller.signal, iteration: iterIdx });
              clearTimeout(timer);
              latencies.push(Date.now() - t0);
            } catch {
              errors++;
              latencies.push(Date.now() - t0);
            }
          })(),
        );
      }
      await Promise.all(batch);
    };

    const batches = Math.ceil(iterations / concurrency);
    for (let i = 0; i < batches && this.running; i++) {
      await runBatch();
    }

    const elapsed = Date.now() - startTime;
    const sorted = [...latencies].sort((a, b) => a - b);
    const total = latencies.length;
    const avg = total > 0 ? latencies.reduce((a, b) => a + b, 0) / total : 0;

    const result: BenchmarkResult = {
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

  stop(): void {
    this.running = false;
  }

  getResults(): BenchmarkResult[] {
    return this.results;
  }

  getSummary(): BenchmarkResult | null {
    if (this.results.length === 0) return null;
    return this.results[this.results.length - 1];
  }

  private _percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const i = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(i, sorted.length - 1))];
  }
}
