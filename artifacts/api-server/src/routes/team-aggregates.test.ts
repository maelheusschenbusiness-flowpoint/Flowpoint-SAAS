/**
 * team-aggregates.test.ts
 *
 * Covers GET /api/team/contributions and GET /api/team/streaks.
 *
 * New coverage (audit/report owner attribution fix):
 *   A1–A9  Audit created_by attribution (UUID / email / NULL / '' / 'system' /
 *          legacy / other member / cross-org / previous month excluded)
 *   R1–R9  Same for reports
 *   S1     UUID + email + NULL from same owner are SUMMED (not capped)
 *   S2     No double attribution when same owner appears with UUID and email
 *   S3     Cross-org isolation (org_id filter)
 *   S4     Missions unchanged (regression guard)
 *   S5     No mock/fallback: frontend source contract
 *
 * Pre-existing coverage retained:
 *   1–5    GET /api/team/contributions happy/error paths
 *   6      team metric source contract (dashboard.js)
 *   4–6    GET /api/team/streaks
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

const ORG_ID  = "org-uuid-aggr";
const ORG2_ID = "org-uuid-other";

function makeApp(orgId = ORG_ID) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { orgId: string }).orgId = orgId;
    (req as unknown as { orgContext: { email: string; role: string } }).orgContext = {
      email: "owner@example.com", role: "owner",
    };
    next();
  });
  app.use("/api", teamRouter);
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: build a queryHandler that routes on table name.
// principals: array of { canonical_uid, email, is_owner }
// auditRows / missionRows / reportRows: raw DB rows for each table
// ─────────────────────────────────────────────────────────────────────────────
function makeHandler(opts: {
  principals: { canonical_uid: string; email: string; is_owner?: boolean }[];
  auditRows?: { created_by: string | null; cnt: number }[];
  missionRows?: { created_by: string | null; cnt: number }[];
  reportRows?: { created_by: string | null; cnt: number }[];
}) {
  return async (sql: string) => {
    if (/canonical_uid/.test(sql) && /FROM team_members tm/.test(sql)) {
      return { rows: opts.principals.map(p => ({ ...p, is_owner: p.is_owner ?? false })) };
    }
    if (/FROM audits/.test(sql))   return { rows: opts.auditRows   ?? [] };
    if (/FROM missions/.test(sql)) return { rows: opts.missionRows ?? [] };
    if (/FROM reports/.test(sql))  return { rows: opts.reportRows  ?? [] };
    return { rows: [] };
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PRE-EXISTING SUITE 1-5 (unchanged)
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/team/contributions — real per-member counts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("1. returns correctly attributed counts under canonical user IDs only", async () => {
    const capturedOrg: unknown[] = [];
    queryHandler = async (sql, values) => {
      capturedOrg.push(values?.[0]);
      if (/canonical_uid/.test(sql) && /FROM team_members tm/.test(sql)) {
        return { rows: [
          { canonical_uid: "u-1", email: "alice@example.com" },
          { canonical_uid: "u-2", email: "bob@example.com" },
        ] };
      }
      if (/FROM audits/.test(sql))   return { rows: [{ created_by: "u-1", cnt: 4 }] };
      if (/FROM missions/.test(sql)) return { rows: [{ created_by: "u-1", cnt: 2 }] };
      if (/FROM reports/.test(sql))  return { rows: [{ created_by: "u-2", cnt: 1 }] };
      return { rows: [] };
    };

    const res = await request(makeApp()).get("/api/team/contributions");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.contributions["u-1"]).toEqual({ audits: 4, missions: 2, reports: 0, monitors: 0 });
    expect(res.body.contributions["u-2"]).toEqual({ audits: 0, missions: 0, reports: 1, monitors: 0 });
    expect(res.body.contributions["alice@example.com"]).toBeUndefined();
    expect(res.body.contributions[ORG_ID]).toBeUndefined();
    expect(capturedOrg.every(o => o === ORG_ID)).toBe(true);
  });

  it("2. attributes historical NULL missions to the explicit owner, not the first member", async () => {
    const businessQueries: string[] = [];
    queryHandler = async (sql) => {
      if (/canonical_uid/.test(sql) && /FROM team_members tm/.test(sql)) {
        return { rows: [
          { canonical_uid: "member-1", email: "member@example.com", is_owner: false },
          { canonical_uid: "owner-1",  email: "owner@example.com",  is_owner: true  },
        ] };
      }
      if (/FROM audits/.test(sql)) return { rows: [
        { created_by: "owner-1",  cnt: 1 },
        { created_by: "member-1", cnt: 2 },
      ] };
      if (/FROM missions/.test(sql)) {
        businessQueries.push(sql);
        return { rows: [
          { created_by: null,       cnt: 3 },
          { created_by: "owner-1",  cnt: 2 },
          { created_by: "member-1", cnt: 4 },
        ] };
      }
      if (/FROM reports/.test(sql)) return { rows: [{ created_by: "owner-1", cnt: 1 }] };
      return { rows: [] };
    };

    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.period).toBe("month");
    expect(res.body.contributions["owner-1"]).toEqual({ audits: 1, missions: 5, reports: 1, monitors: 0 });
    expect(res.body.contributions["member-1"]).toEqual({ audits: 2, missions: 4, reports: 0, monitors: 0 });
    expect(businessQueries[0]).toContain("created_at >= date_trunc('month', CURRENT_TIMESTAMP)");
  });

  it("3. returns canonical zero metrics for every known principal", async () => {
    queryHandler = async (sql) => {
      if (/canonical_uid/.test(sql) && /FROM team_members tm/.test(sql)) {
        return { rows: [
          { canonical_uid: "owner-1",  email: "owner@example.com",  is_owner: true  },
          { canonical_uid: "member-1", email: "member@example.com", is_owner: false },
        ] };
      }
      return { rows: [] };
    };

    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions).toEqual({
      "owner-1":  { audits: 0, missions: 0, reports: 0, monitors: 0 },
      "member-1": { audits: 0, missions: 0, reports: 0, monitors: 0 },
    });
    expect(res.body.totals).toEqual({ audits: 0, missions: 0, reports: 0, monitors: 0 });
  });

  it("4. genuine zero (tables fulfilled, no principals) → 200 empty contributions", async () => {
    queryHandler = async () => ({ rows: [] });
    const res = await request(makeApp()).get("/api/team/contributions");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.contributions).toEqual({});
  });

  it("5. backend failure → 503, not false-empty", async () => {
    queryHandler = async () => { throw new Error("db down"); };
    const res = await request(makeApp()).get("/api/team/contributions");
    expect(res.status).toBe(503);
    expect(res.body.ok).toBe(false);
    expect(res.body.error).toBe("contributions_unavailable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AUDIT ATTRIBUTION — A1–A9
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/team/contributions — audit created_by attribution", () => {
  beforeEach(() => vi.clearAllMocks());

  const OWNER_UID   = "owner-uuid-001";
  const OWNER_EMAIL = "owner@example.com";
  const MEMBER_UID  = "member-uuid-002";

  const baseOwner  = { canonical_uid: OWNER_UID,  email: OWNER_EMAIL, is_owner: true  };
  const baseMember = { canonical_uid: MEMBER_UID, email: "member@example.com", is_owner: false };

  it("A1. audit created_by = owner UUID → attributed to owner", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows:  [{ created_by: OWNER_UID, cnt: 1 }],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].audits).toBe(1);
    expect(res.body.contributions[MEMBER_UID].audits).toBe(0);
  });

  it("A2. audit created_by = owner email → attributed to owner canonical_uid", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows:  [{ created_by: OWNER_EMAIL, cnt: 1 }],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].audits).toBe(1);
    expect(res.body.contributions[MEMBER_UID].audits).toBe(0);
  });

  it("A3. audit created_by = NULL → attributed to explicit owner", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows:  [{ created_by: null, cnt: 2 }],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].audits).toBe(2);
    expect(res.body.contributions[MEMBER_UID].audits).toBe(0);
  });

  it("A4. audit created_by = '' → attributed to explicit owner", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows:  [{ created_by: "", cnt: 1 }],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].audits).toBe(1);
  });

  it("A5. audit created_by = 'system' → attributed to explicit owner", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows:  [{ created_by: "system", cnt: 3 }],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].audits).toBe(3);
  });

  it("A6. audit created_by = legacy unresolvable → attributed to explicit owner", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows:  [{ created_by: "legacy-unknown-id-99", cnt: 2 }],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].audits).toBe(2);
    expect(res.body.contributions[MEMBER_UID].audits).toBe(0);
  });

  it("A7. audit created_by = member UUID → attributed to member, not owner", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows:  [{ created_by: MEMBER_UID, cnt: 5 }],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[MEMBER_UID].audits).toBe(5);
    expect(res.body.contributions[OWNER_UID].audits).toBe(0);
  });

  it("A8. audit from another org is not returned (org_id filter verified by SQL capture)", async () => {
    const captured: unknown[][] = [];
    queryHandler = async (sql, values) => {
      captured.push(values ?? []);
      if (/canonical_uid/.test(sql) && /FROM team_members tm/.test(sql)) {
        return { rows: [baseOwner] };
      }
      if (/FROM audits/.test(sql)) return { rows: [{ created_by: OWNER_UID, cnt: 2 }] };
      return { rows: [] };
    };
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    // Every query must be parameterised with ORG_ID — never with another org
    for (const vals of captured) {
      if (vals.length > 0) expect(vals[0]).toBe(ORG_ID);
    }
  });

  it("A9. audit from previous month is excluded when period=month", async () => {
    const auditQueries: string[] = [];
    queryHandler = async (sql) => {
      if (/canonical_uid/.test(sql) && /FROM team_members tm/.test(sql)) {
        return { rows: [baseOwner] };
      }
      if (/FROM audits/.test(sql)) {
        auditQueries.push(sql);
        return { rows: [] };
      }
      return { rows: [] };
    };
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    // The audit query must contain the monthly date_trunc filter
    expect(auditQueries[0]).toContain("date_trunc('month', CURRENT_TIMESTAMP)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORT ATTRIBUTION — R1–R9 (mirrors A1–A9)
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/team/contributions — report created_by attribution", () => {
  beforeEach(() => vi.clearAllMocks());

  const OWNER_UID   = "owner-uuid-001";
  const OWNER_EMAIL = "owner@example.com";
  const MEMBER_UID  = "member-uuid-002";

  const baseOwner  = { canonical_uid: OWNER_UID,  email: OWNER_EMAIL, is_owner: true  };
  const baseMember = { canonical_uid: MEMBER_UID, email: "member@example.com", is_owner: false };

  it("R1. report created_by = owner UUID → attributed to owner", async () => {
    queryHandler = makeHandler({ principals: [baseOwner, baseMember], reportRows: [{ created_by: OWNER_UID, cnt: 2 }] });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].reports).toBe(2);
    expect(res.body.contributions[MEMBER_UID].reports).toBe(0);
  });

  it("R2. report created_by = owner email → attributed to owner canonical_uid", async () => {
    queryHandler = makeHandler({ principals: [baseOwner, baseMember], reportRows: [{ created_by: OWNER_EMAIL, cnt: 1 }] });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].reports).toBe(1);
    expect(res.body.contributions[MEMBER_UID].reports).toBe(0);
  });

  it("R3. report created_by = NULL → attributed to explicit owner", async () => {
    queryHandler = makeHandler({ principals: [baseOwner, baseMember], reportRows: [{ created_by: null, cnt: 2 }] });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].reports).toBe(2);
    expect(res.body.contributions[MEMBER_UID].reports).toBe(0);
  });

  it("R4. report created_by = '' → attributed to explicit owner", async () => {
    queryHandler = makeHandler({ principals: [baseOwner, baseMember], reportRows: [{ created_by: "", cnt: 1 }] });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].reports).toBe(1);
  });

  it("R5. report created_by = 'system' → attributed to explicit owner", async () => {
    queryHandler = makeHandler({ principals: [baseOwner, baseMember], reportRows: [{ created_by: "system", cnt: 3 }] });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].reports).toBe(3);
  });

  it("R6. report created_by = legacy unresolvable → attributed to explicit owner", async () => {
    queryHandler = makeHandler({ principals: [baseOwner, baseMember], reportRows: [{ created_by: "legacy-unknown-99", cnt: 2 }] });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].reports).toBe(2);
    expect(res.body.contributions[MEMBER_UID].reports).toBe(0);
  });

  it("R7. report created_by = member UUID → attributed to member, not owner", async () => {
    queryHandler = makeHandler({ principals: [baseOwner, baseMember], reportRows: [{ created_by: MEMBER_UID, cnt: 4 }] });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[MEMBER_UID].reports).toBe(4);
    expect(res.body.contributions[OWNER_UID].reports).toBe(0);
  });

  it("R8. report from another org is not returned (org_id filter verified by SQL capture)", async () => {
    const captured: unknown[][] = [];
    queryHandler = async (sql, values) => {
      captured.push(values ?? []);
      if (/canonical_uid/.test(sql) && /FROM team_members tm/.test(sql)) return { rows: [baseOwner] };
      if (/FROM reports/.test(sql)) return { rows: [{ created_by: OWNER_UID, cnt: 1 }] };
      return { rows: [] };
    };
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    for (const vals of captured) {
      if (vals.length > 0) expect(vals[0]).toBe(ORG_ID);
    }
  });

  it("R9. report from previous month is excluded when period=month", async () => {
    const reportQueries: string[] = [];
    queryHandler = async (sql) => {
      if (/canonical_uid/.test(sql) && /FROM team_members tm/.test(sql)) return { rows: [baseOwner] };
      if (/FROM reports/.test(sql)) { reportQueries.push(sql); return { rows: [] }; }
      return { rows: [] };
    };
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(reportQueries[0]).toContain("date_trunc('month', CURRENT_TIMESTAMP)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SYNTHESIS — S1–S5
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/team/contributions — synthesis: addition, isolation, regression", () => {
  beforeEach(() => vi.clearAllMocks());

  const OWNER_UID   = "owner-uuid-001";
  const OWNER_EMAIL = "owner@example.com";
  const MEMBER_UID  = "member-uuid-002";
  const baseOwner   = { canonical_uid: OWNER_UID, email: OWNER_EMAIL, is_owner: true  };
  const baseMember  = { canonical_uid: MEMBER_UID, email: "member@example.com", is_owner: false };

  it("S1. UUID + email + NULL rows from same owner are SUMMED for audits", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows: [
        { created_by: OWNER_UID,   cnt: 1 },  // UUID row
        { created_by: OWNER_EMAIL, cnt: 1 },  // email row → same owner
        { created_by: null,        cnt: 1 },  // NULL → owner fallback
      ],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    // Must be 1+1+1 = 3, not max(1,1,1) = 1
    expect(res.body.contributions[OWNER_UID].audits).toBe(3);
  });

  it("S1b. UUID + email + NULL rows from same owner are SUMMED for reports", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      reportRows: [
        { created_by: OWNER_UID,   cnt: 1 },
        { created_by: OWNER_EMAIL, cnt: 1 },
        { created_by: null,        cnt: 1 },
      ],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].reports).toBe(3);
  });

  it("S2. attributed rows and unattributed rows for same owner don't double-count members", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows: [
        { created_by: OWNER_UID, cnt: 2 },
        { created_by: null,      cnt: 1 },
        { created_by: MEMBER_UID, cnt: 3 },
      ],
      reportRows: [
        { created_by: MEMBER_UID, cnt: 2 },
        { created_by: null,       cnt: 1 },
      ],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    // owner: 2 (UUID) + 1 (NULL) = 3 audits; 1 (NULL) report
    expect(res.body.contributions[OWNER_UID].audits).toBe(3);
    expect(res.body.contributions[OWNER_UID].reports).toBe(1);
    // member: 3 audits, 2 reports — must not have owner rows mixed in
    expect(res.body.contributions[MEMBER_UID].audits).toBe(3);
    expect(res.body.contributions[MEMBER_UID].reports).toBe(2);
  });

  it("S3. cross-org isolation: every SQL query is scoped to ORG_ID", async () => {
    const allValues: unknown[][] = [];
    queryHandler = async (sql, values) => {
      allValues.push(values ?? []);
      if (/canonical_uid/.test(sql) && /FROM team_members tm/.test(sql)) return { rows: [baseOwner] };
      if (/FROM audits/.test(sql))   return { rows: [{ created_by: OWNER_UID, cnt: 1 }] };
      if (/FROM missions/.test(sql)) return { rows: [{ created_by: OWNER_UID, cnt: 1 }] };
      if (/FROM reports/.test(sql))  return { rows: [{ created_by: OWNER_UID, cnt: 1 }] };
      return { rows: [] };
    };
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    for (const vals of allValues) {
      if (vals.length > 0) {
        expect(vals[0]).toBe(ORG_ID);
        expect(vals[0]).not.toBe(ORG2_ID);
      }
    }
  });

  it("S4. missions attribution unchanged: NULL still goes to owner; member count unaffected", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows:   [],
      reportRows:  [],
      missionRows: [
        { created_by: null,       cnt: 3 },
        { created_by: OWNER_UID,  cnt: 2 },
        { created_by: MEMBER_UID, cnt: 4 },
      ],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    expect(res.body.contributions[OWNER_UID].missions).toBe(5);   // 3+2
    expect(res.body.contributions[MEMBER_UID].missions).toBe(4);
    // audits and reports are 0 (no rows) — not fabricated
    expect(res.body.contributions[OWNER_UID].audits).toBe(0);
    expect(res.body.contributions[OWNER_UID].reports).toBe(0);
  });

  it("S5. totals aggregate all members correctly after attribution fix", async () => {
    queryHandler = makeHandler({
      principals: [baseOwner, baseMember],
      auditRows: [
        { created_by: OWNER_UID,  cnt: 2 },
        { created_by: null,       cnt: 1 },   // → owner
        { created_by: MEMBER_UID, cnt: 3 },
      ],
      missionRows: [
        { created_by: OWNER_UID,  cnt: 5 },
        { created_by: MEMBER_UID, cnt: 1 },
      ],
      reportRows: [
        { created_by: OWNER_UID,  cnt: 1 },
        { created_by: null,       cnt: 1 },   // → owner
        { created_by: MEMBER_UID, cnt: 2 },
      ],
    });
    const res = await request(makeApp()).get("/api/team/contributions?period=month");
    expect(res.status).toBe(200);
    // owner: 3 audits, 5 missions, 2 reports
    expect(res.body.contributions[OWNER_UID]).toEqual({ audits: 3, missions: 5, reports: 2, monitors: 0 });
    // member: 3 audits, 1 mission, 2 reports
    expect(res.body.contributions[MEMBER_UID]).toEqual({ audits: 3, missions: 1, reports: 2, monitors: 0 });
    // totals must be the sum of all members
    expect(res.body.totals.audits).toBe(6);
    expect(res.body.totals.missions).toBe(6);
    expect(res.body.totals.reports).toBe(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRE-EXISTING SUITE — team metric source contract
// ─────────────────────────────────────────────────────────────────────────────
describe("team metric source contract", () => {
  it("6. both dashboard builds use the canonical monthly contribution response", () => {
    const sourceRoot = path.resolve(process.cwd(), "../../src/frontend/dashboard.js");
    const exportRoot = path.resolve(process.cwd(), "../flowpoint-export/dashboard.js");
    for (const file of [sourceRoot, exportRoot]) {
      const source = fs.readFileSync(file, "utf8");
      expect(source).toContain("function fpTeamMetricContribution");
      expect(source).toContain("/api/team/contributions?period=month");
      expect(source).toContain("const _contrib = fpTeamMetricContribution(t);");
      expect(source).not.toMatch(/missions:\s*_contrib\s*!=\s*null\s*\?\s*_contrib\.missions\s*:\s*\(isOwner/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRE-EXISTING SUITE — GET /api/team/streaks
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/team/streaks — all members, error vs genuine zero", () => {
  beforeEach(() => vi.clearAllMocks());

  it("4. member identity selection has NO LIMIT clause (static guard)", () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), "src/routes/team.ts"), "utf8");
    const block = src.match(/`SELECT DISTINCT om\.user_id[\s\S]*?om\.status = 'active'[^`]*`/);
    expect(block, "streaks member-select block not found").toBeTruthy();
    expect(/LIMIT\s+\d+/.test(block![0])).toBe(false);
  });

  it("5. per-member query error flagged error:true; empty rows = genuine zero", async () => {
    queryHandler = async (sql, values) => {
      if (/FROM user_prefs/.test(sql)) return { rows: [{ settings: { timezone: "UTC" } }] };
      if (/FROM organization_members/.test(sql)) {
        return { rows: [
          { user_id: "u-ok",   email: "ok@example.com",  name: "Ok User",   role: "member" },
          { user_id: "u-err",  email: "err@example.com", name: "Err User",  role: "member" },
          { user_id: "u-zero", email: "z@example.com",   name: "Zero User", role: "member" },
        ] };
      }
      if (/FROM member_activity_days/.test(sql)) {
        const uid = values?.[1];
        if (uid === "u-err") throw new Error("activity read failed");
        if (uid === "u-ok") {
          const today = new Date()
            .toLocaleString("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" })
            .slice(0, 10);
          return { rows: [{ d: today }] };
        }
        return { rows: [] };
      }
      return { rows: [] };
    };

    const res = await request(makeApp()).get("/api/team/streaks");
    expect(res.status).toBe(200);
    const byUser = Object.fromEntries(
      (res.body.streaks as Array<Record<string, unknown>>).map(s => [s.userId, s])
    );
    expect(Object.keys(byUser)).toHaveLength(3);
    expect(byUser["u-ok"].current).toBe(1);
    expect(byUser["u-ok"].error).toBeUndefined();
    expect(byUser["u-zero"].current).toBe(0);
    expect(byUser["u-zero"].error).toBeUndefined();
    expect(byUser["u-err"].error).toBe(true);
  });

  it("6. owner uses user_activity_days, matching /api/me/streak", async () => {
    const activityQueries: Array<{ sql: string; values?: unknown[] }> = [];
    queryHandler = async (sql, values) => {
      if (/FROM user_prefs/.test(sql)) return { rows: [{ settings: { timezone: "UTC" } }] };
      if (/FROM organization_members/.test(sql)) {
        return { rows: [
          { user_id: "owner-uuid",  email: "owner@example.com",  name: "Owner",  role: "member" },
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
