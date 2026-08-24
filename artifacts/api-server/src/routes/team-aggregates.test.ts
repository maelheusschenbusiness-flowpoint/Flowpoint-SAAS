/**
 * team-aggregates.test.ts — Task #628 (backend, real aggregates only).
 *
 * Covers the two per-member aggregate endpoints:
 *
 * GET /api/team/contributions
 *   1. Real, correctly attributed counts keyed by canonical user_id, org-scoped.
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

  it("1. returns correctly attributed counts under canonical user IDs only", async () => {
    const capturedOrg: unknown[] = [];
    queryHandler = async (sql, values) => {
      capturedOrg.push(values?.[0]);
      if (/canonical_activity/.test(sql)) {
        return { rows: [
          { user_id: "u-1", audits: 4, missions: 2, reports: 0, monitors: 1 },
          { user_id: "u-2", audits: 0, missions: 0, reports: 1, monitors: 0 },
        ] };
      }
      return { rows: [] };
    };

    const res = await request(makeApp()).get("/api/team/contributions");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // canonical user_id key
    expect(res.body.contributions["u-1"]).toEqual({ audits: 4, missions: 2, reports: 0, monitors: 1 });
    expect(res.body.contributions["u-2"]).toEqual({ audits: 0, missions: 0, reports: 1, monitors: 0 });
    expect(res.body.contributions["alice@example.com"]).toBeUndefined();
    expect(res.body.contributions[ORG_ID]).toBeUndefined();
    expect(capturedOrg.every(o => o === ORG_ID)).toBe(true);
  });

  it("2. genuine zero (tables fulfilled, no rows) → 200 empty contributions", async () => {
    queryHandler = async () => ({ rows: [] });
    const res = await request(makeApp()).get("/api/team/contributions");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.contributions).toEqual({});
  });

  it("3. backend failure → 503, not false-empty", async () => {
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

  it("6. owner uses user_activity_days, matching /api/me/streak", async () => {
    const activityQueries: Array<{ sql: string; values?: unknown[] }> = [];
    queryHandler = async (sql, values) => {
      if (/FROM user_prefs/.test(sql)) return { rows: [{ settings: { timezone: "UTC" } }] };
      if (/FROM organization_members/.test(sql)) {
        return { rows: [
          { user_id: "owner-uuid", email: "owner@example.com", name: "Owner", role: "member" },
          { user_id: "member-uuid", email: "member@example.com", name: "Member", role: "member" },
        ] };
      }
      if (/FROM organizations o/.test(sql)) {
        return { rows: [{ user_id: "owner-uuid", email: "owner@example.com", name: "Owner" }] };
      }
      if (/activity_days/.test(sql)) {
        activityQueries.push({ sql, values });
        return { rows: [] };
      }
      return { rows: [] };
    };

    const res = await request(makeApp()).get("/api/team/streaks");
    expect(res.status).toBe(200);
    expect(res.body.streaks.find((s: Row) => s.userId === "owner-uuid")?.role).toBe("owner");
    expect(activityQueries.find(q => q.values?.[1] === "owner-uuid")?.sql).toContain("FROM user_activity_days");
    expect(activityQueries.find(q => q.values?.[1] === "member-uuid")?.sql).toContain("FROM member_activity_days");
  });
});
