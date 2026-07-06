class RequestScheduler {
  constructor(options = {}) {
    this.maxConcurrent = options.maxConcurrent || 50;
    this.queue = [];
    this.active = 0;
    this.stats = { queued: 0, completed: 0, failed: 0, timedOut: 0 };
  }

  async add(fn, options = {}) {
    const priority = options.priority || 0;
    const timeout = options.timeout || 30000;

    return new Promise((resolve, reject) => {
      const task = { fn, priority, timeout, resolve, reject, startTime: null, completed: false };
      this.queue.push(task);
      this.stats.queued++;
      this.queue.sort((a, b) => b.priority - a.priority);
      this.processNext();
    });
  }

  async processNext() {
    if (this.active >= this.maxConcurrent || this.queue.length === 0) return;
    const task = this.queue.shift();
    this.active++;
    task.startTime = Date.now();

    let timer = null;
    if (task.timeout < Infinity) {
      timer = setTimeout(() => {
        // Guard against double-completion: if task already finished, timer does nothing
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
      // Guard against double-completion: if timeout already fired, do nothing
      if (task.completed) return;
      task.completed = true;
      clearTimeout(timer);
      this.stats.completed++;
      this.active--;
      task.resolve(result);
    } catch (err) {
      if (task.completed) return;
      task.completed = true;
      clearTimeout(timer);
      this.stats.failed++;
      this.active--;
      task.reject(err);
    }

    this.processNext();
  }

  getStats() {
    return { ...this.stats, active: this.active, queued: this.queue.length };
  }

  clear() {
    this.queue = [];
    this.active = 0;
  }
}

module.exports = { RequestScheduler };
