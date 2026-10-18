import { afterEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "./with-timeout.js";

describe("withTimeout timer lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the deadline when the operation resolves first", async () => {
    vi.useFakeTimers();

    await expect(withTimeout(Promise.resolve("done"), 1_000, new Error("timeout"))).resolves.toBe("done");

    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with the supplied timeout error and clears the fired timer", async () => {
    vi.useFakeTimers();
    const operation = new Promise<never>(() => {});
    const pending = withTimeout(operation, 250, new Error("timeout"));
    const rejection = expect(pending).rejects.toThrow("timeout");

    await vi.advanceTimersByTimeAsync(250);

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
  });
});
