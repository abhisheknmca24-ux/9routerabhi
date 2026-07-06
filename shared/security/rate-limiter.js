class RateLimiter {
  constructor(options = {}) {
    this.windowMs = options.windowMs || 60000;
    this.maxRequests = options.maxRequests || 100;
    this.windows = new Map();
    this.blocked = new Map();
    this.blockDuration = options.blockDuration || 300000;
    this._cleanupTimer = null;
    this._startCleanup();
  }

  _startCleanup() {
    // Periodic cleanup every 60s to prevent unbounded memory growth
    this._cleanupTimer = setInterval(() => this._cleanup(), 60000);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }

  check(key) {
    const now = Date.now();

    if (this.blocked.has(key)) {
      const blockUntil = this.blocked.get(key);
      if (now < blockUntil) return { allowed: false, retryAfter: Math.ceil((blockUntil - now) / 1000), blocked: true };
      this.blocked.delete(key);
    }

    if (!this.windows.has(key)) {
      this.windows.set(key, []);
    }

    const window = this.windows.get(key);
    const cutoff = now - this.windowMs;
    while (window.length > 0 && window[0] < cutoff) window.shift();

    if (window.length >= this.maxRequests) {
      this.blocked.set(key, now + this.blockDuration);
      return { allowed: false, retryAfter: Math.ceil(this.blockDuration / 1000), blocked: true };
    }

    window.push(now);
    return { allowed: true, remaining: this.maxRequests - window.length, resetMs: this.windowMs };
  }

  getRemaining(key) {
    if (!this.windows.has(key)) return this.maxRequests;
    const window = this.windows.get(key);
    const cutoff = Date.now() - this.windowMs;
    while (window.length > 0 && window[0] < cutoff) window.shift();
    return Math.max(0, this.maxRequests - window.length);
  }

  reset(key) {
    this.windows.delete(key);
    this.blocked.delete(key);
  }

  _cleanup() {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    // Clean up blocked entries
    for (const [key, blockUntil] of this.blocked) {
      if (now >= blockUntil) this.blocked.delete(key);
    }

    // Clean up windows entries with no activity in the window period
    for (const [key, timestamps] of this.windows) {
      // Remove expired timestamps
      while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();
      // If window is now empty, remove it entirely to free memory
      if (timestamps.length === 0) this.windows.delete(key);
    }
  }

  getStats() {
    return {
      activeWindows: this.windows.size,
      blockedKeys: this.blocked.size,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
    };
  }
}

module.exports = { RateLimiter };
