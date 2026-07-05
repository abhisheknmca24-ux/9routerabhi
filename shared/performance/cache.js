class Cache {
  constructor(options = {}) {
    this.maxSize = options.maxSize || 1000;
    this.ttl = options.ttl || 60000;
    this.cache = new Map();
    this.stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) { this.stats.misses++; return null; }
    if (Date.now() > entry.expires) { this.cache.delete(key); this.stats.misses++; return null; }
    entry.lastAccess = Date.now();
    this.stats.hits++;
    return entry.value;
  }

  set(key, value, ttl) {
    if (this.cache.size >= this.maxSize) this.evictLRU();
    this.cache.set(key, {
      value,
      expires: Date.now() + (ttl || this.ttl),
      lastAccess: Date.now(),
    });
    this.stats.sets++;
  }

  delete(key) {
    return this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  evictLRU() {
    let oldest = null;
    let oldestKey = null;
    for (const [key, entry] of this.cache) {
      if (!oldest || entry.lastAccess < oldest) {
        oldest = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey) { this.cache.delete(oldestKey); this.stats.evictions++; }
  }

  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return { ...this.stats, hitRate: total > 0 ? this.stats.hits / total : 0, size: this.cache.size };
  }
}

module.exports = { Cache };
