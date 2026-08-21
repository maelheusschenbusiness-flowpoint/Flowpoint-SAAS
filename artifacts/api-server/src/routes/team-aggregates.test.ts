/**
 * team-aggregates.test.ts — Task #628 (backend, real aggregates only).
 *
 * Covers the two per-member aggregate endpoints:
 *
 * GET /api/team/contributions
 *   1. Real counts keyed by BOTH canonical user_id and email alias, org-scoped.
 *   2. A genuine zero (some tables fulfilled, member has no rows) is a normal 200.
 *   3. Total backend failure (ALL count queries reject) → 503 error, NOT a
 *      false-empty {} that would show every member as idle.
 *
 * GET /api/team/streaks
 *   4. Member identity selection has NO LIMIT (all active members computed).
 *   5. A per-member query error is flagged error:true (not a fabricated zero),
 *      while a member with no rows is a genuine zero (no error flag).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "fs";
import path from "path";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/sessions.js", () => ({
  SESSION_TTL_MS:        604_800_000,
  createSession:         vi.fn(async () => "sess_x"),
  invalidateAllSessions: vi.fn(async () => {}),
}));
vi.mock("../services/seat-entitlement.js", () => ({
  resolveSeatEntitlement: vi.fn(async () => ({ limit: 5, plan: "pro" })),
  SeatEntitlementUnavailableError: class extends Error {},
}));

type Row = Record<string, unknown>;
// Test-controlled query handler; each test swaps in its own SQL router.
let queryHandler: (sql: string, values?: unknown[]) => Promise<{ rows: Row[] }>;

vi.mock("@workspace/db", () => ({
  pool: {
    connect: vi.fn(),
    query: (sql: string, values?: unknown[]) => queryHandler(sql, values),
  },
  withOrgDb: vi.fn(),
}));

import teamRouter from "../routes/team.js";

const ORG_ID = "org-uuid-aggr";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { orgId: string }).orgId = ORG_ID;
    (req as unknown as { orgContext: { email: string; role: string } }).orgContext = {
      email: "owner@example.com", role: "owner",
    };
    next();
  });
  app.use("/api", teamRouter);
  return app;
}

describe("GET /api/team/contributions — real per-member counts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("1. keys counts by canonical user_id AND email alias, org-scoped", async () => {
    const capturedOrg: unknown[] = [];
    queryHandler = async (sql, values) => {
      capturedOrg.push(values?.[0]);
      if (/FROM audits/.test(sql)) {
        return { rows: [{ user_id: "u-1", email: "alice@example.com", cnt: 4 }] };
      }
      if (/FROM missions/.test(sql)) {
        return { rows: [{ user_id: "u-1", email: "alice@example.com", cnt: 2 }] };
      }
      if (/FROM reports/.test(sql)) {
        return { rows: [{ user_id: "u-2", email: "bob@example.com", cnt: 1 }] };
      }
      return { rows: [] };
    };

    const res = await request(makeApp()).get("/api/team/contributions");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // canonical user_id key
    expect(res.body.contributions["u-1"]).toEqual({ audits: 4, missions: 2, reports: 0 });
    // email alias key mirrors the same member
    expect(res.body.contributions["alice@example.com"]).toEqual({ audits: 4, missions: 2, reports: 0 });
    expect(res.body.contributions["u-2"]).toEqual({ audits: 0, missions: 0, reports: 1 });
    expect(res.body.contributions["bob@example.com"]).toEqual({ audits: 0, missions: 0, reports: 1 });
    // org isolation: every count query filtered by ORG_ID as $1
    expect(capturedOrg.every(o => o === ORG_ID)).toBe(true);
  });

  it("2. genuine zero (tables fulfilled, no rows) → 200 empty contributions", async () => {
    queryHandler = async () => ({ rows: [] });
    const res = await request(makeApp()).get("/api/team/contributions");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.contributions).toEqual({});
  });

  it("3. total backend failure (all queries reject) → 503, not false-empty", async () => {
    queryHandler = async () => { throw new Error("db down"); };
    const res = await request(makeApp()).get("/api/team/contributions");
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("contributions_unavailable");
  });
});

describe("GET /api/team/streaks — all members, error vs genuine zero", () => {
  beforeEach(() => vi.clearAllMocks());

  it("4. member identity selection has NO LIMIT clause (static guard)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/routes/team.ts"), "utf8");
    // Isolate the member-identity SELECT (from `SELECT DISTINCT om.user_id` up
    // to its closing backtick) — the streaks per-member selection must be
    // uncapped so no active member is dropped from the leaderboard.
    const block = src.match(/`SELECT DISTINCT om\.user_id[\s\S]*?om\.status = 'active'[^`]*`/);
    expect(block, "streaks member-select block not found").toBeTruthy();
    expect(/LIMIT\s+\d+/.test(block![0])).toBe(false);
  });

  it("5. per-member query error flagged error:true; empty rows = genuine zero", async () => {
    queryHandler = async (sql, values) => {
      if (/FROM user_prefs/.test(sql)) return { rows: [{ settings: { timezone: "UTC" } }] };
      if (/FROM organization_members/.test(sql)) {
        return { rows: [
          { user_id: "u-ok",  email: "ok@example.com",  name: "Ok User",  role: "member" },
          { user_id: "u-err", email: "err@example.com", name: "Err User", role: "member" },
          { user_id: "u-zero",email: "z@example.com",   name: "Zero User",role: "member" },
        ] };
      }
      if (/FROM member_activity_days/.test(sql)) {
        const uid = values?.[1];
        if (uid === "u-err") throw new Error("activity read failed");
        if (uid === "u-ok") {
          const today = new Date().toLocaleString("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).slice(0, 10);
          return { rows: [{ d: today }] };
        }
        return { rows: [] }; // u-zero → genuine zero
      }
      return { rows: [] };
    };

    const res = await request(makeApp()).get("/api/team/streaks");
    expect(res.status).toBe(200);
    const byUser = Object.fromEntries(
      (res.body.streaks as Array<Record<string, unknown>>).map(s => [s.userId, s])
    );
    // all three members present (no LIMIT drop)
    expect(Object.keys(byUser)).toHaveLength(3);
    // genuine data
    expect(byUser["u-ok"].current).toBe(1);
    expect(byUser["u-ok"].error).toBeUndefined();
    // genuine zero — NO error flag
    expect(byUser["u-zero"].current).toBe(0);
    expect(byUser["u-zero"].error).toBeUndefined();
    // query error — flagged, not fabricated zero
    expect(byUser["u-err"].error).toBe(true);
  });
});
