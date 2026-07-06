export interface CacheConfig {
  maxSize?: number;
  ttl?: number;
}

interface CacheEntry<V> {
  value: V;
  expires: number;
}

export class Cache<V> {
  private readonly maxSize: number;
  private readonly ttl: number;
  private readonly cache = new Map<string, CacheEntry<V>>();
  private readonly stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };

  constructor(config?: CacheConfig) {
    this.maxSize = config?.maxSize ?? 1000;
    this.ttl = config?.ttl ?? 60000;
  }

  get(key: string): V | null {
    const entry = this.cache.get(key);
    if (!entry) { this.stats.misses++; return null; }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.stats.misses++;
      return null;
    }
    // Move to end for LRU ordering
    this.cache.delete(key);
    this.cache.set(key, entry);
    this.stats.hits++;
    return entry.value;
  }

  set(key: string, value: V, ttl?: number): void {
    if (this.cache.has(key)) this.cache.delete(key);
    while (this.cache.size >= this.maxSize) {
      this._evictOldest();
    }
    this.cache.set(key, {
      value,
      expires: Date.now() + (ttl ?? this.ttl),
    });
    this.stats.sets++;
  }

  delete(key: string): boolean {
    return this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  getStats(): { hits: number; misses: number; sets: number; evictions: number; hitRate: number; size: number } {
    const total = this.stats.hits + this.stats.misses;
    return { ...this.stats, hitRate: total > 0 ? this.stats.hits / total : 0, size: this.cache.size };
  }

  private _evictOldest(): void {
    const oldestKey = this.cache.keys().next().value;
    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
      this.stats.evictions++;
    }
  }
}
