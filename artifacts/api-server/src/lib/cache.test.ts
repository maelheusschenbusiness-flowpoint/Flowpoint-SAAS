import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TTLCache } from "./cache.js";

// Sweep interval kept well beyond every simulated advance: the tests exercise
// eviction on write and on read, never the background sweep.
const NO_SWEEP = 3_600_000;

describe("TTLCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("serves a value until its TTL expires, then reports a miss", () => {
    const cache = new TTLCache(NO_SWEEP);

    cache.set("ns", "k", "v", 60);
    expect(cache.get("ns", "k")).toBe("v");

    vi.advanceTimersByTime(59_000);
    expect(cache.get("ns", "k")).toBe("v");

    vi.advanceTimersByTime(1_001);
    expect(cache.get("ns", "k")).toBeNull();
    expect(cache.getStats().size).toBe(0);
    expect(cache.getStats().evictions).toBe(1);

    cache.destroy();
  });

  it("caps the store at maxEntries and evicts the least recently used key", () => {
    const cache = new TTLCache(NO_SWEEP, 3);

    cache.set("ns", "a", "A", 60);
    cache.set("ns", "b", "B", 60);
    cache.set("ns", "c", "C", 60);
    expect(cache.getStats().size).toBe(3);

    // Reading "a" makes "b" the least recently used entry.
    expect(cache.get("ns", "a")).toBe("A");

    cache.set("ns", "d", "D", 60);

    expect(cache.getStats().size).toBe(3);
    expect(cache.get("ns", "b")).toBeNull();
    expect(cache.get("ns", "a")).toBe("A");
    expect(cache.get("ns", "c")).toBe("C");
    expect(cache.get("ns", "d")).toBe("D");
    expect(cache.getStats().evictions).toBe(1);

    cache.destroy();
  });

  it("drops expired entries before touching a live one when making room", () => {
    const cache = new TTLCache(NO_SWEEP, 2);

    cache.set("ns", "short", "S", 1);   // oldest, will expire
    cache.set("ns", "long", "L", 600);  // least recently used but still alive

    vi.advanceTimersByTime(2_000);

    cache.set("ns", "fresh", "F", 600);

    expect(cache.getStats().size).toBe(2);
    expect(cache.get("ns", "long")).toBe("L");
    expect(cache.get("ns", "fresh")).toBe("F");
    expect(cache.get("ns", "short")).toBeNull();
    expect(cache.getStats().evictions).toBe(1);

    cache.destroy();
  });

  it("runs the fetcher once for concurrent getOrSet calls on the same key", async () => {
    const cache = new TTLCache(NO_SWEEP);
    let release: (value: string) => void = () => {};
    const fetcher = vi.fn(() => new Promise<string>(resolve => { release = resolve; }));

    const calls = [
      cache.getOrSet("ns", "k", 60, fetcher),
      cache.getOrSet("ns", "k", 60, fetcher),
      cache.getOrSet("ns", "k", 60, fetcher),
    ];
    expect(fetcher).toHaveBeenCalledTimes(1);

    release("value");
    await expect(Promise.all(calls)).resolves.toEqual(["value", "value", "value"]);

    // Once resolved, the value comes from the store.
    await expect(cache.getOrSet("ns", "k", 60, fetcher)).resolves.toBe("value");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.getStats().sets).toBe(1);

    cache.destroy();
  });

  it("caches nothing when the fetcher rejects and retries on the next call", async () => {
    const cache = new TTLCache(NO_SWEEP);
    let attempt = 0;
    const fetcher = vi.fn(async (): Promise<string> => {
      attempt++;
      if (attempt === 1) throw new Error("boom");
      return "recovered";
    });

    const first = cache.getOrSet("ns", "k", 60, fetcher);
    const second = cache.getOrSet("ns", "k", 60, fetcher);
    const firstRejects = expect(first).rejects.toThrow("boom");
    const secondRejects = expect(second).rejects.toThrow("boom");
    await firstRejects;
    await secondRejects;

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.getStats().size).toBe(0);
    expect(cache.getStats().sets).toBe(0);

    await expect(cache.getOrSet("ns", "k", 60, fetcher)).resolves.toBe("recovered");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(cache.get("ns", "k")).toBe("recovered");

    cache.destroy();
  });

  it("serves a cached null value without calling the fetcher again", async () => {
    const cache = new TTLCache(NO_SWEEP);
    const fetcher = vi.fn(async (): Promise<string | null> => null);

    await expect(cache.getOrSet("ns", "k", 60, fetcher)).resolves.toBeNull();
    await expect(cache.getOrSet("ns", "k", 60, fetcher)).resolves.toBeNull();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.getStats().sets).toBe(1);
    expect(cache.getStats().size).toBe(1);

    cache.destroy();
  });

  it("invalidateNamespace only clears the keys of that namespace", () => {
    const cache = new TTLCache(NO_SWEEP);

    cache.set("alpha", "one", 1, 60);
    cache.set("alpha", "two", 2, 60);
    cache.set("beta", "one", 3, 60);

    cache.invalidateNamespace("alpha");

    expect(cache.get("alpha", "one")).toBeNull();
    expect(cache.get("alpha", "two")).toBeNull();
    expect(cache.get("beta", "one")).toBe(3);
    expect(cache.getStats().size).toBe(1);

    cache.destroy();
  });

  it("counts hits, misses, sets and the hit rate in getStats", () => {
    const cache = new TTLCache(NO_SWEEP);

    expect(cache.getStats()).toMatchObject({ hits: 0, misses: 0, sets: 0, evictions: 0, size: 0, hitRate: "0%" });

    cache.set("ns", "a", "A", 60);
    cache.set("ns", "b", "B", 60);
    expect(cache.get("ns", "a")).toBe("A");
    expect(cache.get("ns", "missing")).toBeNull();

    expect(cache.getStats()).toMatchObject({
      hits: 1,
      misses: 1,
      sets: 2,
      evictions: 0,
      size: 2,
      hitRate: "50.0%",
    });

    cache.destroy();
  });

  it("does not write back a fetch that was invalidated while it ran", async () => {
    const cache = new TTLCache(NO_SWEEP);
    let release!: (v: string) => void;
    const stale = vi.fn(() => new Promise<string>((r) => { release = r; }));

    const first = cache.getOrSet("ns", "k", 60, stale);
    cache.invalidate("ns", "k");
    release("stale");

    // The caller that started the fetch still gets its own result...
    await expect(first).resolves.toBe("stale");
    // ...but the stale value is not cached: the next call fetches fresh data.
    expect(cache.get("ns", "k")).toBeNull();
    const fresh = vi.fn(async () => "fresh");
    await expect(cache.getOrSet("ns", "k", 60, fresh)).resolves.toBe("fresh");
    expect(fresh).toHaveBeenCalledTimes(1);
    expect(cache.get("ns", "k")).toBe("fresh");

    cache.destroy();
  });

  it("starts a new fetch after invalidation instead of joining the stale one, for every invalidation kind", async () => {
    const kinds: Array<(c: TTLCache) => void> = [
      (c) => c.invalidate("ns", "k"),
      (c) => c.invalidateNamespace("ns"),
      (c) => c.invalidatePattern("k"),
      (c) => c.clear(),
    ];
    for (const invalidate of kinds) {
      const cache = new TTLCache(NO_SWEEP);
      let release!: (v: string) => void;
      const slow = vi.fn(() => new Promise<string>((r) => { release = r; }));
      const fresh = vi.fn(async () => "fresh");

      const first = cache.getOrSet("ns", "k", 60, slow);
      invalidate(cache);
      const second = cache.getOrSet("ns", "k", 60, fresh);
      release("stale");

      await expect(first).resolves.toBe("stale");
      await expect(second).resolves.toBe("fresh");
      expect(fresh).toHaveBeenCalledTimes(1);
      expect(cache.get("ns", "k")).toBe("fresh");

      cache.destroy();
    }
  });
});
