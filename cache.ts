/**
 * FlowPoint — In-memory TTL cache
 * Namespace-aware, type-safe, zero-dependency.
 * Drop-in replacement for Redis when Redis is unavailable.
 */

import { logger } from "./logger.js";

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  hits: number;
}

class TTLCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private stats = { hits: 0, misses: 0, sets: 0, evictions: 0 };
  private sweepInterval: ReturnType<typeof setInterval> | null = null;

  constructor(sweepIntervalMs = 60_000) {
    this.sweepInterval = setInterval(() => this.sweep(), sweepIntervalMs);
    if (this.sweepInterval?.unref) this.sweepInterval.unref();
  }

  /** Set a value with TTL in seconds */
  set<T>(namespace: string, key: string, value: T, ttlSeconds: number): void {
    const cacheKey = `${namespace}:${key}`;
    this.store.set(cacheKey, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
      hits: 0,
    });
    this.stats.sets++;
  }

  /** Get a cached value, or null if missing/expired */
  get<T>(namespace: string, key: string): T | null {
    const cacheKey = `${namespace}:${key}`;
    const entry = this.store.get(cacheKey) as CacheEntry<T> | undefined;
    if (!entry) { this.stats.misses++; return null; }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(cacheKey);
      this.stats.misses++;
      this.stats.evictions++;
      return null;
    }
    entry.hits++;
    this.stats.hits++;
    return entry.value;
  }

  /** Get-or-set pattern: fetch from cache or compute and cache */
  async getOrSet<T>(
    namespace: string, key: string,
    ttlSeconds: number,
    fetcher: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(namespace, key);
    if (cached !== null) return cached;
    const value = await fetcher();
    this.set(namespace, key, value, ttlSeconds);
    return value;
  }

  /** Invalidate a specific key */
  invalidate(namespace: string, key: string): void {
    this.store.delete(`${namespace}:${key}`);
  }

  /** Invalidate all keys in a namespace */
  invalidateNamespace(namespace: string): void {
    const prefix = `${namespace}:`;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) this.store.delete(k);
    }
  }

  /** Invalidate all keys containing a pattern */
  invalidatePattern(pattern: string): void {
    for (const k of this.store.keys()) {
      if (k.includes(pattern)) this.store.delete(k);
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

  clear(): void { this.store.clear(); }
  destroy(): void { if (this.sweepInterval) clearInterval(this.sweepInterval); this.store.clear(); }
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
