/**
 * FlowPoint — In-memory TTL cache
 * Namespace-aware, type-safe, zero-dependency.
 * Drop-in replacement for Redis when Redis is unavailable.
 * Bounded (LRU eviction) and dedup-safe: concurrent getOrSet on the same key
 * share a single fetcher call.
 */

import { logger } from "./logger.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  hits: number;
}

export class TTLCache {
  private store = new Map<string, CacheEntry<unknown>>();
  /** Fetches currently running, keyed like the store — used to dedupe getOrSet */
  private inFlight = new Map<string, Promise<unknown>>();
  private stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  private sweepInterval: ReturnType<typeof setInterval> | null = null;
  private readonly maxEntries: number;

  constructor(sweepIntervalMs = 60_000, maxEntries = 5000) {
    this.maxEntries = maxEntries;
    this.sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs);
    if (this.sweepInterval?.unref) this.sweepInterval.unref();
  }

  /** Set a value with TTL in seconds */
  set<T>(namespace: string, key: string, value: T, ttlSeconds: number): void {
    const cacheKey = `${namespace}:${key}`;
    // Deleting first keeps Map iteration order aligned with recency:
    // the most recently written key always ends up last.
    if (!this.store.delete(cacheKey)) this.makeRoomForNewKey();
    this.store.set(cacheKey, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
      hits: 0,
    });
    this.stats.sets++;
  }

  /** Get a cached value, or null if missing/expired */
  get<T>(namespace: string, key: string): T | null {
    const entry = this.lookup<T>(`${namespace}:${key}`);
    return entry ? entry.value : null;
  }

  /**
   * Look up a live entry and account for it in the stats.
   * Returns undefined when missing or expired — unlike get(), this tells a
   * cached null value apart from a cache miss.
   */
  private lookup<T>(cacheKey: string): CacheEntry<T> | undefined {
    const entry = this.store.get(cacheKey) as CacheEntry<T> | undefined;
    if (!entry) { this.stats.misses++; return undefined; }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(cacheKey);
      this.stats.misses++;
      this.stats.evictions++;
      return undefined;
    }
    entry.hits++;
    this.stats.hits++;
    // A successful read refreshes recency: move the key to the end.
    this.store.delete(cacheKey);
    this.store.set(cacheKey, entry);
    return entry;
  }

  /**
   * Make room before inserting a brand new key: drop expired entries first,
   * then the least recently used ones until the capacity holds.
   */
  private makeRoomForNewKey(): void {
    if (this.store.size < this.maxEntries) return;
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) { this.store.delete(key); this.stats.evictions++; }
    }
    while (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next();
      if (oldest.done) break;
      this.store.delete(oldest.value);
      this.stats.evictions++;
    }
  }

  /** Get-or-set pattern: fetch from cache or compute and cache */
  async getOrSet<T>(
    namespace: string, key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const cacheKey = `${namespace}:${key}`;
    const entry = this.lookup<T>(cacheKey);
    if (entry) return entry.value;

    // Another caller is already fetching this key: share its promise.
    const running = this.inFlight.get(cacheKey) as Promise<T> | undefined;
    if (running) return running;

    // Declared first so the fetch can check, once resolved, that it is still the current one.
    let pending: Promise<T> | undefined = undefined;
    pending = (async () => {
      const value = await fetcher();
      // Only cache the result if this fetch is still the current one: an invalidate()
      // (or clear) issued while it ran forgets it, so a value computed from stale data
      // is returned to its own callers but never written back into the cache.
      if (this.inFlight.get(cacheKey) === pending) this.set(namespace, key, value, ttlSeconds);
      return value;
    })();
    this.inFlight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      // A rejected fetch caches nothing and is forgotten: the next call retries.
      if (this.inFlight.get(cacheKey) === pending) this.inFlight.delete(cacheKey);
    }
  }

  /** Invalidate a specific key */
  invalidate(namespace: string, key: string): void {
    const cacheKey = `${namespace}:${key}`;
    this.store.delete(cacheKey);
    this.inFlight.delete(cacheKey);
  }

  /** Invalidate all keys in a namespace */
  invalidateNamespace(namespace: string): void {
    const prefix = `${namespace}:`;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
    for (const k of this.inFlight.keys()) {
      if (k.startsWith(prefix)) this.inFlight.delete(k);
    }
  }

  /** Invalidate all keys containing a pattern */
  invalidatePattern(pattern: string): void {
    for (const k of this.store.keys()) {
      if (k.includes(pattern)) this.store.delete(k);
    }
    for (const k of this.inFlight.keys()) {
      if (k.includes(pattern)) this.inFlight.delete(k);
    }
  }

  /** Remove all expired entries */
  private sweep(): void {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) { this.store.delete(key); removed++; this.stats.evictions++; }
    }
    if (removed > 0) logger.debug({ removed, size: this.store.size }, "[Cache] Swept expired entries");
  }

  getStats(): { hits: number; misses: number; sets: number; evictions: number; size: number; hitRate: string } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      size: this.store.size,
      hitRate: total > 0 ? `${((this.stats.hits / total) * 100).toFixed(1)}%` : '0%',
    };
  }

  clear(): void { this.store.clear(); this.inFlight.clear(); }
  destroy(): void {
    if (this.sweepInterval) clearInterval(this.sweepInterval);
    this.store.clear();
    this.inFlight.clear();
  }
}

export const cache = new TTLCache();

// ── Typed namespace helpers ───────────────────────────────────────────────────
export const CacheNS = {
  ME:           'me',
  OVERVIEW:     'overview',
  KEYWORDS:     'kw',
  COMPETITORS:  'comp',
  MARKET_INTEL: 'mktintel',
  LOCAL_MAPS:   'localmaps',
  REPORTS:      'reports',
  PERMISSIONS:  'perms',
  SSO:          'sso',
  CRM:          'crm',
  GBP:          'gbp',
  AUDITS:       'audits',
  MONITORS:     'monitors',
  AI:           'ai',
} as const;
