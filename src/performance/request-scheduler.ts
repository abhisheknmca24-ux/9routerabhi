export interface RequestSchedulerConfig {
  maxConcurrent?: number;
}

interface Task<T> {
  fn: () => Promise<T>;
  priority: number;
  timeout: number;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  completed: boolean;
}

export class RequestScheduler {
  private readonly maxConcurrent: number;
  private readonly queue: Array<Task<unknown>> = [];
  private active = 0;
  private readonly stats = { queued: 0, completed: 0, failed: 0, timedOut: 0 };

  constructor(config?: RequestSchedulerConfig) {
    this.maxConcurrent = config?.maxConcurrent ?? 50;
  }

  async add<T>(fn: () => Promise<T>, options?: { priority?: number; timeout?: number }): Promise<T> {
    const priority = options?.priority ?? 0;
    const timeout = options?.timeout ?? 30000;

    return new Promise<T>((resolve, reject) => {
      const task: Task<unknown> = {
        fn: fn as () => Promise<unknown>,
        priority,
        timeout,
        resolve: resolve as (value: unknown) => void,
        reject,
        completed: false,
      };
      this.queue.push(task);
      this.stats.queued++;
      this.queue.sort((a, b) => b.priority - a.priority);
      this.processNext();
    });
  }

  private async processNext(): Promise<void> {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) return;
    const task = this.queue.shift()!;
    this.active++;

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (task.timeout < Infinity) {
      timer = setTimeout(() => {
        if (task.completed) return;
        task.completed = true;
        this.active--;
        this.stats.timedOut++;
        task.reject(new Error('REQUEST_TIMEOUT'));
        this.processNext();
      }, task.timeout);
    }

    try {
      const result = await task.fn();
      if (task.completed) return;
      task.completed = true;
      if (timer) clearTimeout(timer);
      this.stats.completed++;
      this.active--;
      task.resolve(result);
    } catch (err) {
      if (task.completed) return;
      task.completed = true;
      if (timer) clearTimeout(timer);
      this.stats.failed++;
      this.active--;
      task.reject(err instanceof Error ? err : new Error(String(err)));
    }

    this.processNext();
  }

  getStats(): { queued: number; completed: number; failed: number; timedOut: number; active: number; queueLength: number } {
    return { ...this.stats, active: this.active, queueLength: this.queue.length };
  }

  clear(): void {
    this.queue.length = 0;
    this.active = 0;
  }
}
