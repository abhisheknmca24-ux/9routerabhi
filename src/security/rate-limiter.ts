import { type Logger } from '../types/logger.types.js';
import { type RateLimitResult } from '../types/security.types.js';

export interface RateLimiterConfig {
  windowMs?: number;
  maxRequests?: number;
  blockDuration?: number;
}

export class RateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly blockDuration: number;
  private readonly windows = new Map<string, number[]>();
  private readonly blocked = new Map<string, number>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly logger?: Logger,
    config?: RateLimiterConfig,
  ) {
    this.windowMs = config?.windowMs ?? 60000;
    this.maxRequests = config?.maxRequests ?? 100;
    this.blockDuration = config?.blockDuration ?? 300000;
    this._startCleanup();
  }

  check(key: string): RateLimitResult {
    const now = Date.now();

    if (this.blocked.has(key)) {
      const blockUntil = this.blocked.get(key)!;
      if (now < blockUntil) {
        return { allowed: false, retryAfter: Math.ceil((blockUntil - now) / 1000), blocked: true };
      }
      this.blocked.delete(key);
    }

    if (!this.windows.has(key)) {
      this.windows.set(key, []);
    }

    const window = this.windows.get(key)!;
    const cutoff = now - this.windowMs;
    while (window.length > 0 && window[0] < cutoff) window.shift();

    if (window.length >= this.maxRequests) {
      this.blocked.set(key, now + this.blockDuration);
      return { allowed: false, retryAfter: Math.ceil(this.blockDuration / 1000), blocked: true };
    }

    window.push(now);
    return { allowed: true, remaining: this.maxRequests - window.length, resetMs: this.windowMs };
  }

  getRemaining(key: string): number {
    if (!this.windows.has(key)) return this.maxRequests;
    const window = this.windows.get(key)!;
    const cutoff = Date.now() - this.windowMs;
    while (window.length > 0 && window[0] < cutoff) window.shift();
    return Math.max(0, this.maxRequests - window.length);
  }

  reset(key: string): void {
    this.windows.delete(key);
    this.blocked.delete(key);
  }

  getStats(): { activeWindows: number; blockedKeys: number; windowMs: number; maxRequests: number } {
    return {
      activeWindows: this.windows.size,
      blockedKeys: this.blocked.size,
      windowMs: this.windowMs,
      maxRequests: this.maxRequests,
    };
  }

  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private _startCleanup(): void {
    this.cleanupTimer = setInterval(() => this._cleanup(), 60000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  private _cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    for (const [key, blockUntil] of this.blocked) {
      if (now >= blockUntil) this.blocked.delete(key);
    }

    for (const [key, timestamps] of this.windows) {
      while (timestamps.length > 0 && timestamps[0] < cutoff) timestamps.shift();
      if (timestamps.length === 0) this.windows.delete(key);
    }
  }
}
