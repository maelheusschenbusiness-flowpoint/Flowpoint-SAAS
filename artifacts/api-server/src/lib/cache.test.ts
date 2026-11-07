/**
 * getOrSet coalescing: concurrent misses on the same namespace+key must share
 * a single fetcher call. Measured defect: three concurrent calls started three
 * loads, so a cold cache multiplied the cost of every upstream call.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cache, CacheNS } from "./cache.js";

/** A promise whose settlement is driven by the test. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("cache.getOrSet concurrency", () => {
  afterEach(() => {
    cache.invalidateNamespace(CacheNS.OVERVIEW);
  });

  it("runs the fetcher once for three concurrent calls and gives them the same value", async () => {
    const gate = deferred<string>();
    const fetcher = vi.fn(() => gate.promise);

    const calls = [
      cache.getOrSet(CacheNS.OVERVIEW, "coalesce", 60, fetcher),
      cache.getOrSet(CacheNS.OVERVIEW, "coalesce", 60, fetcher),
      cache.getOrSet(CacheNS.OVERVIEW, "coalesce", 60, fetcher),
    ];
    gate.resolve("loaded-once");

    await expect(Promise.all(calls)).resolves.toEqual(["loaded-once", "loaded-once", "loaded-once"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.get<string>(CacheNS.OVERVIEW, "coalesce")).toBe("loaded-once");
  });

  it("rejects every concurrent caller with the same error, caches nothing, and refetches next time", async () => {
    const gate = deferred<string>();
    const failure = new Error("upstream down");
    const failing = vi.fn(() => gate.promise);

    const calls = [
      cache.getOrSet(CacheNS.OVERVIEW, "shared-failure", 60, failing),
      cache.getOrSet(CacheNS.OVERVIEW, "shared-failure", 60, failing),
      cache.getOrSet(CacheNS.OVERVIEW, "shared-failure", 60, failing),
    ];
    const settled = Promise.allSettled(calls);
    gate.reject(failure);

    const results = await settled;
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    for (const result of results) {
      expect(result.status === "rejected" && result.reason).toBe(failure);
    }
    expect(failing).toHaveBeenCalledTimes(1);
    expect(cache.get<string>(CacheNS.OVERVIEW, "shared-failure")).toBeNull();

    const recovered = vi.fn(async () => "second-attempt");
    await expect(cache.getOrSet(CacheNS.OVERVIEW, "shared-failure", 60, recovered)).resolves.toBe("second-attempt");
    expect(recovered).toHaveBeenCalledTimes(1);
  });

  it("loads two different keys independently, one fetcher call each", async () => {
    const gateA = deferred<string>();
    const gateB = deferred<string>();
    const fetcherA = vi.fn(() => gateA.promise);
    const fetcherB = vi.fn(() => gateB.promise);

    const pending = Promise.all([
      cache.getOrSet(CacheNS.OVERVIEW, "key-a", 60, fetcherA),
      cache.getOrSet(CacheNS.OVERVIEW, "key-b", 60, fetcherB),
    ]);
    gateA.resolve("value-a");
    gateB.resolve("value-b");

    await expect(pending).resolves.toEqual(["value-a", "value-b"]);
    expect(fetcherA).toHaveBeenCalledTimes(1);
    expect(fetcherB).toHaveBeenCalledTimes(1);
  });

  it("does not call the fetcher when the value is already cached", async () => {
    cache.set(CacheNS.OVERVIEW, "already-there", "cached-value", 60);
    const fetcher = vi.fn(async () => "fresh-value");

    await expect(cache.getOrSet(CacheNS.OVERVIEW, "already-there", 60, fetcher)).resolves.toBe("cached-value");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
