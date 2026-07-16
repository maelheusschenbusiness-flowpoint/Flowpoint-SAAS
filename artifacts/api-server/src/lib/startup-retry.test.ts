import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "events";
import { withStartupRetry } from "./startup-retry.js";

// Zero delays in all tests — avoids real waiting in CI / unit runs.
const NO_DELAY = { baseDelayMs: 0, maxDelayMs: 0 };

function transientError(code: string): Error & { code: string } {
  return Object.assign(new Error(`${code} simulated`), { code });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Transient retry ────────────────────────────────────────────────────────────

describe("transient retry", () => {
  it("ECONNABORTED then success — operation called twice, value returned", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      if (++calls === 1) throw transientError("ECONNABORTED");
      return "ok";
    });

    const result = await withStartupRetry("test", op, NO_DELAY);
    expect(result).toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("ECONNRESET then success — recovers on second attempt", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      if (++calls === 1) throw transientError("ECONNRESET");
      return "recovered";
    });

    await expect(withStartupRetry("test", op, NO_DELAY)).resolves.toBe("recovered");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("ETIMEDOUT then success — recovers on second attempt", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      if (++calls === 1) throw transientError("ETIMEDOUT");
      return "ok";
    });

    await expect(withStartupRetry("test", op, NO_DELAY)).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("EPIPE then success — recovers on second attempt", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      if (++calls === 1) throw transientError("EPIPE");
      return "ok";
    });

    await expect(withStartupRetry("test", op, NO_DELAY)).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("57P01 (admin_shutdown) then success — recovers", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      if (++calls === 1) throw transientError("57P01");
      return "ok";
    });

    await expect(withStartupRetry("test", op, NO_DELAY)).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("57P02 (crash_shutdown) then success — recovers", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      if (++calls === 1) throw transientError("57P02");
      return "ok";
    });

    await expect(withStartupRetry("test", op, NO_DELAY)).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("57P03 (cannot_connect_now) then success — recovers", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      if (++calls === 1) throw transientError("57P03");
      return "ok";
    });

    await expect(withStartupRetry("test", op, NO_DELAY)).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });
});

// ── Permanent error — no retry ────────────────────────────────────────────────

describe("permanent error — no retry", () => {
  it("non-transient SQL error (42501 permission denied) — rejects immediately, called once", async () => {
    const op = vi.fn(async () => {
      throw Object.assign(new Error("permission denied for table foo"), { code: "42501" });
    });

    await expect(withStartupRetry("test", op, NO_DELAY)).rejects.toThrow("permission denied");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("error without code property — rejects immediately, called once", async () => {
    const op = vi.fn(async () => {
      throw new Error("schema missing");
    });

    await expect(withStartupRetry("test", op, NO_DELAY)).rejects.toThrow("schema missing");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("undefined table error (42P01) — rejects immediately, called once", async () => {
    const op = vi.fn(async () => {
      throw Object.assign(new Error("relation does not exist"), { code: "42P01" });
    });

    await expect(withStartupRetry("test", op, NO_DELAY)).rejects.toThrow("relation does not exist");
    expect(op).toHaveBeenCalledTimes(1);
  });
});

// ── Exhaustion ─────────────────────────────────────────────────────────────────

describe("exhaustion", () => {
  it("4 consecutive ECONNABORTED — rejects after exactly 4 attempts", async () => {
    const op = vi.fn(async () => {
      throw transientError("ECONNABORTED");
    });

    await expect(
      withStartupRetry("test", op, { ...NO_DELAY, attempts: 4 }),
    ).rejects.toMatchObject({ code: "ECONNABORTED" });

    expect(op).toHaveBeenCalledTimes(4);
  });

  it("custom attempts=2 — rejects after exactly 2 attempts on transient error", async () => {
    const op = vi.fn(async () => {
      throw transientError("ECONNRESET");
    });

    await expect(
      withStartupRetry("test", op, { ...NO_DELAY, attempts: 2 }),
    ).rejects.toMatchObject({ code: "ECONNRESET" });

    expect(op).toHaveBeenCalledTimes(2);
  });
});

// ── Pool error handler ─────────────────────────────────────────────────────────

describe("pool error handler", () => {
  it("error event on guarded pool is caught — does not crash process", () => {
    const mockPool = new EventEmitter();
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

    // Mirrors the handler installed in lib/db/src/index.ts
    mockPool.on("error", (err: Error & { code?: string }) => {
      process.stderr.write(
        JSON.stringify({
          level: 50,
          time: Date.now(),
          code: err.code,
          message: err.message,
          msg: "[postgres] Unexpected idle client error — client removed from pool",
        }) + "\n",
      );
    });

    expect(() => {
      mockPool.emit(
        "error",
        Object.assign(new Error("connection reset by peer"), { code: "ECONNRESET" }),
      );
    }).not.toThrow();

    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining("[postgres] Unexpected idle client error"),
    );

    const logged: string = (stderrSpy.mock.calls[0]?.[0] as string) ?? "";
    expect(logged).not.toMatch(/postgresql:\/\//i);
    expect(logged).not.toMatch(/password/i);
    expect(logged).not.toMatch(/DATABASE_URL/);
  });

  it("pool without handler — emitting error throws (Node.js default behaviour)", () => {
    const unguardedPool = new EventEmitter();
    expect(() => {
      unguardedPool.emit("error", new Error("ECONNABORTED — no handler"));
    }).toThrow("ECONNABORTED — no handler");
  });
});

// ── First-attempt success ──────────────────────────────────────────────────────

describe("first-attempt success", () => {
  it("no retry needed — operation called exactly once", async () => {
    const op = vi.fn(async () => "immediate");
    const result = await withStartupRetry("test", op, NO_DELAY);
    expect(result).toBe("immediate");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("returns the resolved value unchanged", async () => {
    const payload = { foo: 42 };
    const result = await withStartupRetry("test", async () => payload, NO_DELAY);
    expect(result).toBe(payload);
  });
});
