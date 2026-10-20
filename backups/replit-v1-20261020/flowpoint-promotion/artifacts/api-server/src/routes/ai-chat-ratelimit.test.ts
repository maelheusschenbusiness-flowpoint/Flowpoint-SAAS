/**
 * ai-chat-ratelimit.test.ts — Task #614
 *
 * Documents the root cause of the premature 429 on POST /ai/chat and locks in
 * the structural fix. Two independent causes were reproduced live:
 *
 *  CAUSE 1 — hidden per-IP limiter in chatHandler (30 req/min per client IP).
 *    It duplicated the org limiter with the wrong key: /ai/chat runs
 *    post-auth, so a shared office/NAT/proxy IP tripped 429 at request #31
 *    even for pro (60/min) or ultra (200/min) orgs. FIX: removed — abuse
 *    control for an authenticated endpoint belongs to the org (plan-aware
 *    aiChatRateLimit) + the AI credit quota + the per-conversation lock.
 *
 *  CAUSE 2 — a single `ai:${orgId}` bucket shared by /ai/chat AND ~11 batch
 *    AI endpoints (summary, audit, pagespeed-insights, missions, generate…).
 *    Background dashboard AI features silently drained the interactive chat
 *    budget: on the standard plan (10/min) a normal conversation could 429
 *    without the user ever exceeding the chat limit itself. FIX: /ai/chat
 *    now has its own `ai:chat:${orgId}` bucket. Plan thresholds are
 *    UNCHANGED (nothing was raised) — anti-abuse stays fully active.
 */
import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

const state = vi.hoisted(() => ({
  plan: "standard",
}));

vi.mock("@workspace/db", () => ({
  pool: {
    connect: vi.fn().mockImplementation(() => Promise.resolve({
      query: vi.fn().mockImplementation(() => Promise.resolve({ rows: [{ plan: state.plan }] })),
      release: vi.fn(),
    })),
    query: vi.fn().mockResolvedValue({ rows: [] }),
  },
  withOrgDb: vi.fn().mockImplementation(async (_orgId: string, callback: (client: { query: (sql: string) => Promise<{ rows: Array<{ plan?: string; request_count?: number; reset_ms?: number }> }> }) => Promise<unknown>) => {
    return callback({
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes("INSERT INTO ai_rate_limit_windows")) {
          return { rows: [{ request_count: 1, reset_ms: 60_000 }] };
        }
        return { rows: [{ plan: state.plan }] };
      }),
    });
  }),
  db: {},
}));
vi.mock("../services/store.js", () => ({
  store: { me: { plan: null } },
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { aiRateLimit, aiChatRateLimit } from "../middlewares/rateLimiter.js";

type Mw = (req: Request, res: Response, next: NextFunction) => void;

/** Drives a middleware once and resolves with the outcome. */
function run(mw: Mw, orgId: string): Promise<{ status: number | null; body: unknown }> {
  return new Promise((resolvePromise) => {
    const req = { orgId, path: "/ai/chat", method: "POST" } as unknown as Request;
    const result: { status: number | null; body: unknown } = { status: null, body: null };
    const res = {
      setHeader: vi.fn(),
      status: (code: number) => ({
        json: (body: unknown) => {
          result.status = code;
          result.body = body;
          resolvePromise(result);
        },
      }),
    } as unknown as Response;
    const next = () => resolvePromise(result); // status stays null = allowed
    mw(req, res, next);
  });
}

let orgCounter = 0;
/** Fresh org per test — the limiter windows Map is module-global. */
function freshOrg(): string {
  orgCounter++;
  return `00000000-0000-4000-8000-${String(orgCounter).padStart(12, "0")}`;
}

beforeEach(() => {
  state.plan = "standard";
  vi.useRealTimers();
});

describe("CAUSE 1 — per-IP duplicate limiter removed from chatHandler", () => {
  it("ai.ts no longer contains an in-handler per-IP rate limiter", async () => {
    // The old limiter capped ALL clients behind one IP at 30 req/min,
    // regardless of plan. It must not come back.
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const src = readFileSync(resolve(__dirname, "./ai.ts"), "utf8");
    expect(src).not.toMatch(/checkRateLimit\s*\(/);
    expect(src).not.toMatch(/rateLimitMap/);
    expect(src).not.toMatch(/Trop de requêtes — attendez avant d'envoyer un autre message/);
    // The route must be limited by the dedicated chat middleware instead.
    expect(src).toMatch(/router\.post\("\/ai\/chat",\s*aiChatRateLimit,\s*chatHandler\)/);
  });

  it("a pro org can send more than 30 chat messages in one minute window (old per-IP cap)", async () => {
    state.plan = "pro"; // 60/min
    const org = freshOrg();
    for (let i = 1; i <= 35; i++) {
      const { status } = await run(aiChatRateLimit, org);
      expect(status, `message #${i} must not be rate-limited`).toBeNull();
    }
  });
});

describe("CAUSE 2 — interactive chat bucket is isolated from batch AI endpoints", () => {
  it("draining the batch bucket does NOT 429 the chat endpoint (same org)", async () => {
    const org = freshOrg(); // standard = 10/min
    // Simulate background dashboard AI features consuming the whole batch budget.
    for (let i = 1; i <= 10; i++) {
      const { status } = await run(aiRateLimit, org);
      expect(status).toBeNull();
    }
    const batchOverflow = await run(aiRateLimit, org);
    expect(batchOverflow.status).toBe(429); // batch bucket exhausted

    // The interactive conversation must still work: its own bucket is full.
    for (let i = 1; i <= 10; i++) {
      const { status } = await run(aiChatRateLimit, org);
      expect(status, `chat message #${i} after batch exhaustion`).toBeNull();
    }
  });

  it("a normal 15–20 message conversation at human pacing never hits 429 (standard plan)", async () => {
    vi.useFakeTimers();
    const org = freshOrg();
    // 20 messages, one every 10 seconds (a fast but human conversation, incl.
    // tool rounds — tools run inside ONE request and consume no extra hits).
    for (let i = 1; i <= 20; i++) {
      const { status } = await run(aiChatRateLimit, org);
      expect(status, `message #${i} of the conversation`).toBeNull();
      vi.advanceTimersByTime(10_000);
    }
  });
});

describe("anti-abuse protections remain active (thresholds unchanged)", () => {
  it("standard plan still gets 429 AI_RATE_LIMIT on the 11th burst chat message", async () => {
    const org = freshOrg();
    for (let i = 1; i <= 10; i++) {
      const { status } = await run(aiChatRateLimit, org);
      expect(status).toBeNull();
    }
    const { status, body } = await run(aiChatRateLimit, org);
    expect(status).toBe(429);
    const b = body as { code: string; details: { plan: string; limit: number; source: string } };
    expect(b.code).toBe("AI_RATE_LIMIT");
    expect(b.details.plan).toBe("standard");
    expect(b.details.limit).toBe(10); // threshold NOT raised
    // 429s are attributable: the source bucket is part of the response.
    expect(b.details.source).toBe("ai_chat");
  });

  it("batch AI endpoints keep their own 429 with source attribution", async () => {
    const org = freshOrg();
    for (let i = 1; i <= 10; i++) await run(aiRateLimit, org);
    const { status, body } = await run(aiRateLimit, org);
    expect(status).toBe(429);
    expect((body as { details: { source: string } }).details.source).toBe("ai_batch");
  });

  it("the window resets after one minute — blocked org can chat again", async () => {
    vi.useFakeTimers();
    const org = freshOrg();
    for (let i = 1; i <= 10; i++) await run(aiChatRateLimit, org);
    expect((await run(aiChatRateLimit, org)).status).toBe(429);
    vi.advanceTimersByTime(61_000);
    expect((await run(aiChatRateLimit, org)).status).toBeNull();
  });
});
