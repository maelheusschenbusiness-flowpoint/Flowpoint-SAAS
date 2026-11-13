import { afterEach, describe, expect, it, vi } from "vitest";
import { probeDatabase, type Queryable } from "./readiness.js";

describe("probeDatabase timeout lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the timeout when PostgreSQL responds before the deadline", async () => {
    vi.useFakeTimers();
    const db: Queryable = {
      query: async () => ({ rows: [], rowCount: 0 }),
    };

    const result = await probeDatabase(db, 1_000);

    expect(result.ok).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the timer after the timeout wins the race", async () => {
    vi.useFakeTimers();
    const db: Queryable = {
      query: () => new Promise(() => {}),
    };

    const pending = probeDatabase(db, 250);
    await vi.advanceTimersByTimeAsync(250);
    const result = await pending;

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("timeout");
    expect(vi.getTimerCount()).toBe(0);
  });
});
