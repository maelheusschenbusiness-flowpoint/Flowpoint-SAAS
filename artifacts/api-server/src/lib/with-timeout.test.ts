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

  it("rejects with the supplied timeout error after 500 simulated ms and not at 499", async () => {
    vi.useFakeTimers();
    const timeoutError = new Error("timeout");
    const pending = withTimeout(new Promise<never>(() => {}), 500, timeoutError);
    const rejection = expect(pending).rejects.toBe(timeoutError);
    let settled = false;
    void pending.catch(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(499);

    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1);

    await rejection;
    expect(settled).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("arms no deadline when timeoutMs is Infinity", async () => {
    vi.useFakeTimers();

    await expect(
      withTimeout(Promise.resolve("done"), Number.POSITIVE_INFINITY, new Error("timeout")),
    ).resolves.toBe("done");

    expect(vi.getTimerCount()).toBe(0);

    const failure = new Error("operation failed");

    await expect(
      withTimeout(Promise.reject(failure), Number.POSITIVE_INFINITY, new Error("timeout")),
    ).rejects.toBe(failure);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("caps a delay above the platform maximum instead of firing after 1ms", async () => {
    vi.useFakeTimers();
    let resolveOperation: (value: string) => void = () => {};
    const operation = new Promise<string>((resolve) => {
      resolveOperation = resolve;
    });
    const pending = withTimeout(operation, 2_147_483_648, new Error("timeout"));
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await vi.advanceTimersByTimeAsync(1_000);

    expect(settled).toBe(false);
    expect(vi.getTimerCount()).toBe(1);

    resolveOperation("done");

    await expect(pending).resolves.toBe("done");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects immediately without arming a deadline when timeoutMs is 0", async () => {
    vi.useFakeTimers();
    const timeoutError = new Error("timeout");

    await expect(withTimeout(new Promise<never>(() => {}), 0, timeoutError)).rejects.toBe(timeoutError);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects immediately without arming a deadline when timeoutMs is negative", async () => {
    vi.useFakeTimers();
    const timeoutError = new Error("timeout");

    await expect(withTimeout(new Promise<never>(() => {}), -5, timeoutError)).rejects.toBe(timeoutError);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with a TypeError mentioning timeoutMs when timeoutMs is NaN", async () => {
    vi.useFakeTimers();

    await expect(withTimeout(new Promise<never>(() => {}), Number.NaN, new Error("timeout"))).rejects.toThrow(
      TypeError,
    );
    await expect(withTimeout(new Promise<never>(() => {}), Number.NaN, new Error("timeout"))).rejects.toThrow(
      /timeoutMs/,
    );

    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects with a TypeError mentioning timeoutMs when timeoutMs is not a number", async () => {
    vi.useFakeTimers();
    const notANumber = "500" as unknown as number;

    await expect(withTimeout(new Promise<never>(() => {}), notANumber, new Error("timeout"))).rejects.toThrow(
      TypeError,
    );
    await expect(withTimeout(new Promise<never>(() => {}), notANumber, new Error("timeout"))).rejects.toThrow(
      /timeoutMs/,
    );

    expect(vi.getTimerCount()).toBe(0);
  });
});
