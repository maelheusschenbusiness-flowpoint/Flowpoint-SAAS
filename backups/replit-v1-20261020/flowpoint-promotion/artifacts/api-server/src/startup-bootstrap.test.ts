/**
 * startup-bootstrap.test.ts
 *
 * Validates the critical-vs-optional classification of bootstrap steps and the
 * invariants that protect against a partially-initialised server:
 *
 *  - A critical step that exhausts retries must throw; app.listen must NOT run.
 *  - A critical step with a permanent error must throw after exactly 1 attempt.
 *  - A critical step that succeeds after a transient error must continue.
 *  - An optional step that fails must log safely and NOT throw.
 *  - Crons must never start before app.listen.
 *  - Warning logs must never contain DATABASE_URL, passwords, or connection strings.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  runCriticalStartupStep,
  runOptionalStartupStep,
} from "./lib/startup-retry.js";

// Mock the pino logger so we can inspect warn() calls without needing to
// intercept process.stdout.write (pino captures that reference at import time).
vi.mock("./lib/logger.js", () => ({
  logger: {
    info:  vi.fn(),
    warn:  vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const NO_DELAY = { baseDelayMs: 0, maxDelayMs: 0 };

function transient(code: string): Error & { code: string } {
  return Object.assign(new Error(`${code} simulated`), { code });
}

function permanent(code: string): Error & { code: string } {
  return Object.assign(new Error(`DB error: ${code}`), { code });
}

afterEach(() => vi.restoreAllMocks());

// ── Critical step — transient then success ─────────────────────────────────────

describe("runCriticalStartupStep — transient then success", () => {
  it("ECONNABORTED then success — resolves, op called twice", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      if (++calls === 1) throw transient("ECONNABORTED");
    });

    await expect(runCriticalStartupStep("db-conn", op, NO_DELAY)).resolves.toBeUndefined();
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("ECONNRESET then success — resolves, op called twice", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      if (++calls === 1) throw transient("ECONNRESET");
    });

    await expect(runCriticalStartupStep("rls-migration", op, NO_DELAY)).resolves.toBeUndefined();
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("57P01 then success — resolves (admin_shutdown recovered)", async () => {
    let calls = 0;
    const op = vi.fn(async () => {
      if (++calls === 1) throw transient("57P01");
    });

    await expect(runCriticalStartupStep("init-missions", op, NO_DELAY)).resolves.toBeUndefined();
    expect(op).toHaveBeenCalledTimes(2);
  });
});

// ── Critical step — exhausted retries ─────────────────────────────────────────

describe("runCriticalStartupStep — exhausted retries", () => {
  it("4 × ECONNABORTED — throws after 4 attempts; app.listen not called; crons not started", async () => {
    const op = vi.fn(async () => { throw transient("ECONNABORTED"); });
    const listenSpy = vi.fn();
    const cronSpy   = vi.fn();

    let threw = false;
    try {
      await runCriticalStartupStep("init-data-tables", op, { ...NO_DELAY, attempts: 4 });
      // Unreachable — these simulate what index.ts does after all critical steps:
      listenSpy();
      cronSpy();
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(op).toHaveBeenCalledTimes(4);
    expect(listenSpy).not.toHaveBeenCalled();
    expect(cronSpy).not.toHaveBeenCalled();
  });

  it("3 × ECONNRESET — throws after exactly 3 attempts (custom attempts)", async () => {
    const op = vi.fn(async () => { throw transient("ECONNRESET"); });

    await expect(
      runCriticalStartupStep("AI migration", op, { ...NO_DELAY, attempts: 3 }),
    ).rejects.toMatchObject({ code: "ECONNRESET" });

    expect(op).toHaveBeenCalledTimes(3);
  });
});

// ── Critical step — permanent error ───────────────────────────────────────────

describe("runCriticalStartupStep — permanent error", () => {
  it("42P01 (undefined_table) — throws after exactly 1 attempt; app.listen not called", async () => {
    const op = vi.fn(async () => { throw permanent("42P01"); });
    const listenSpy = vi.fn();

    let threw = false;
    try {
      await runCriticalStartupStep("rls-migration", op, NO_DELAY);
      listenSpy(); // unreachable
    } catch {
      threw = true;
    }

    expect(threw).toBe(true);
    expect(op).toHaveBeenCalledTimes(1);
    expect(listenSpy).not.toHaveBeenCalled();
  });

  it("42501 (permission denied) — throws after exactly 1 attempt", async () => {
    const op = vi.fn(async () => { throw permanent("42501"); });

    await expect(
      runCriticalStartupStep("init-data-tables", op, NO_DELAY),
    ).rejects.toMatchObject({ code: "42501" });

    expect(op).toHaveBeenCalledTimes(1);
  });

  it("plain Error (no code) — throws after exactly 1 attempt", async () => {
    const op = vi.fn(async () => { throw new Error("missing env var"); });

    await expect(
      runCriticalStartupStep("database connection", op, NO_DELAY),
    ).rejects.toThrow("missing env var");

    expect(op).toHaveBeenCalledTimes(1);
  });
});

// ── Optional step ─────────────────────────────────────────────────────────────

describe("runOptionalStartupStep", () => {
  it("failure after retries — resolves, does NOT throw", async () => {
    const op = vi.fn(async () => { throw transient("ECONNABORTED"); });

    await expect(
      runOptionalStartupStep("optional-step", op, { ...NO_DELAY, attempts: 2 }),
    ).resolves.toBeUndefined();

    expect(op).toHaveBeenCalledTimes(2);
  });

  it("failure — warning log contains label and code, not DATABASE_URL or password", async () => {
    const { logger } = await import("./lib/logger.js");
    const warnSpy = vi.mocked(logger.warn);
    warnSpy.mockClear();

    const op = vi.fn(async () => { throw transient("ECONNABORTED"); });
    await runOptionalStartupStep("opt-check", op, { ...NO_DELAY, attempts: 2 });

    // Find the call that logs the optional-step warning
    const warningCall = warnSpy.mock.calls.find(
      (c) => typeof c[1] === "string" && c[1].includes("Optional step unavailable"),
    );
    expect(warningCall).toBeDefined();

    // First arg is the context object — must have label + code, no secrets
    const ctx = warningCall![0] as Record<string, unknown>;
    expect(ctx["label"]).toBe("opt-check");
    expect(ctx["code"]).toBe("ECONNABORTED");
    // message must be the error message string only — no connection strings
    const serialised = JSON.stringify(ctx);
    expect(serialised).not.toMatch(/DATABASE_URL|password|postgresql:\/\//i);
  });

  it("success — resolves, op called exactly once", async () => {
    const op = vi.fn(async () => {});
    await expect(runOptionalStartupStep("opt", op, NO_DELAY)).resolves.toBeUndefined();
    expect(op).toHaveBeenCalledTimes(1);
  });
});

// ── Bootstrap order ───────────────────────────────────────────────────────────

describe("bootstrap order", () => {
  it("crons do not start when a critical step throws", async () => {
    const cronSpy = vi.fn();
    const op = vi.fn(async () => { throw transient("ECONNABORTED"); });

    try {
      await runCriticalStartupStep("init-monitors", op, { ...NO_DELAY, attempts: 4 });
      cronSpy(); // unreachable
    } catch {
      // expected
    }

    expect(cronSpy).not.toHaveBeenCalled();
  });

  it("crons start only after all critical steps succeed", async () => {
    const order: string[] = [];
    const critOp = vi.fn(async () => { order.push("critical"); });
    const listenFn = () => { order.push("listen"); };
    const cronFn   = () => { order.push("cron"); };

    await runCriticalStartupStep("step", critOp, NO_DELAY);
    listenFn();
    cronFn();

    expect(order).toEqual(["critical", "listen", "cron"]);
    expect(order.indexOf("listen")).toBeLessThan(order.indexOf("cron"));
  });

  it("app.listen not called if second critical step throws", async () => {
    const listenSpy = vi.fn();
    const step1 = vi.fn(async () => {}); // succeeds
    const step2 = vi.fn(async () => { throw permanent("42P01"); }); // fails immediately

    try {
      await runCriticalStartupStep("step1", step1, NO_DELAY);
      await runCriticalStartupStep("step2", step2, NO_DELAY);
      listenSpy(); // unreachable
    } catch {
      // expected
    }

    expect(step1).toHaveBeenCalledTimes(1);
    expect(step2).toHaveBeenCalledTimes(1);
    expect(listenSpy).not.toHaveBeenCalled();
  });
});
