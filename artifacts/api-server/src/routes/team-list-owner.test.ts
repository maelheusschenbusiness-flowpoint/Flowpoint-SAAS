/**
 * team-list-owner.test.ts — GET /api/team synthetic owner row.
 *
 * The owner occupies a seat (getSeatUsage counts "1 + active members + pending
 * invites") but usually has NO team_members row. GET /team must therefore
 * prepend a synthetic owner entry so the visible member list matches
 * seatUsage.used for BOTH the owner and invited members.
 *
 * Coverage:
 *   1. Owner without a team_members row → synthetic owner row prepended,
 *      members.length === seatUsage.used.
 *   2. Owner already present as an active member (same email) → NO duplicate.
 *   3. organizations lookup failure → non-fatal (200, list without owner).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

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
vi.mock("../services/mailer.js", () => ({
  mailer: { sendTeamInvitation: vi.fn(async () => ({ ok: true })) },
}));
vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings: vi.fn(async () => ({ orgName: "Test Org" })),
}));
vi.mock("@workspace/db", () => ({
  pool: { connect: vi.fn(), query: vi.fn(async () => ({ rows: [] })) },
}));
vi.mock("../services/seat-entitlement.js", async () => {
  const actual = await vi.importActual<typeof import("../services/seat-entitlement.js")>(
    "../services/seat-entitlement.js"
  );
  return {
    ...actual,
    resolveSeatEntitlement: vi.fn(async () => ({ limit: 5, plan: "pro" })),
  };
});

import teamRouter from "../routes/team.js";

type Row = Record<string, unknown>;

const ORG_ID = "org-uuid-1234";
const OWNER_EMAIL = "owner@example.com";

let memberRows: Row[] = [];
let ownerRow: Row | null = null;
let ownerLookupThrows = false;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { orgId: string }).orgId = ORG_ID;
    (req as unknown as { orgContext: { email: string; role: string } }).orgContext = {
      email: OWNER_EMAIL,
      role:  "owner",
    };
    (req as unknown as { orgDb: (sql: string, v?: unknown[]) => Promise<{ rows: Row[] }> }).orgDb =
      async (sql: string) => {
        // getSeatUsage COUNT queries — mirrors ACTIVE_NON_OWNER_MEMBERS_COUNT_SQL:
        // active rows representing the org owner (email or user_id match) are
        // excluded, because the owner's seat is the separate constant "1".
        if (/COUNT\(\*\)/.test(sql) && /FROM team_members/.test(sql)) {
          const ownerEmailL = ownerRow ? String(ownerRow.email).toLowerCase() : null;
          const ownerUid    = ownerRow ? (ownerRow.user_id as string | null) : null;
          const n = memberRows.filter(m =>
            m.status === "active" &&
            !(ownerEmailL && String(m.email ?? "").toLowerCase() === ownerEmailL) &&
            !(ownerUid && String(m.user_id ?? "") === ownerUid)
          ).length;
          return { rows: [{ n }] };
        }
        if (/COUNT\(\*\)/.test(sql) && /FROM team_invitations/.test(sql)) {
          return { rows: [{ n: 0 }] };
        }
        // member list
        if (/FROM team_members/.test(sql)) return { rows: memberRows };
        // pending invitations list
        if (/FROM team_invitations/.test(sql)) return { rows: [] };
        // synthetic owner lookup
        if (/FROM organizations o/.test(sql)) {
          if (ownerLookupThrows) throw new Error("organizations lookup failed (test)");
          return { rows: ownerRow ? [ownerRow] : [] };
        }
        return { rows: [] };
      };
    next();
  });
  app.use("/api", teamRouter);
  return app;
}

describe("GET /api/team — synthetic owner row", () => {
  beforeEach(() => {
    memberRows = [];
    ownerRow = {
      email: OWNER_EMAIL, org_created_at: "2026-01-01T00:00:00Z",
      first_name: "Olivia", last_name: "Owner", user_id: "owner-uuid-1",
    };
    ownerLookupThrows = false;
    vi.clearAllMocks();
  });

  it("1. prepends the owner when no team_members row represents them — list length matches seatUsage.used", async () => {
    memberRows = [{
      id: "tm-1", email: "member@example.com", role: "member", status: "active",
      user_id: "u-member", first_name: "Max", last_name: "Member", name: "Max",
      joined: "2026-02-01", joined_at: "2026-02-01T10:00:00Z",
      accepted_at: "2026-02-01T10:00:00Z", created_at: "2026-02-01T10:00:00Z",
      updated_at: "2026-02-01T10:00:00Z",
    }];

    const res = await request(makeApp()).get("/api/team");
    expect(res.status).toBe(200);

    const members = res.body.members as Array<Record<string, unknown>>;
    expect(members[0]).toMatchObject({
      id: "owner", email: OWNER_EMAIL, role: "owner", status: "active",
      name: "Olivia Owner", userId: "owner-uuid-1",
    });
    expect(members).toHaveLength(2);
    // owner (1) + active members (1) + pending invites (0)
    expect(res.body.seatUsage.used).toBe(2);
    expect(members).toHaveLength(res.body.seatUsage.used);
  });

  it("2. does not duplicate the owner when an active member row already has the owner's email", async () => {
    memberRows = [{
      id: "tm-owner", email: OWNER_EMAIL.toUpperCase(), role: "admin", status: "active",
      user_id: "owner-uuid-1", first_name: "Olivia", last_name: "Owner", name: "Olivia",
      joined: "2026-01-01", joined_at: "2026-01-01T00:00:00Z",
      accepted_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }];

    const res = await request(makeApp()).get("/api/team");
    expect(res.status).toBe(200);

    const members = res.body.members as Array<Record<string, unknown>>;
    const ownerish = members.filter(m =>
      String(m.email ?? "").toLowerCase() === OWNER_EMAIL || m.id === "owner");
    expect(ownerish).toHaveLength(1);
    expect(members.some(m => m.id === "owner")).toBe(false);

    // Seat accounting contract: the owner's legacy row must NOT be counted on
    // top of the owner's constant seat — displayed list matches used seats.
    expect(res.body.seatUsage.used).toBe(1);
    expect(members).toHaveLength(res.body.seatUsage.used);
  });

  it("2b. does not duplicate the owner when a member row matches by user_id only (different email)", async () => {
    memberRows = [{
      id: "tm-owner-alias", email: "owner-alias@example.com", role: "admin", status: "active",
      user_id: "owner-uuid-1", first_name: "Olivia", last_name: "Owner", name: "Olivia",
      joined: "2026-01-01", joined_at: "2026-01-01T00:00:00Z",
      accepted_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    }];

    const res = await request(makeApp()).get("/api/team");
    expect(res.status).toBe(200);
    const members = res.body.members as Array<Record<string, unknown>>;
    expect(members.some(m => m.id === "owner")).toBe(false);
    expect(members).toHaveLength(1);
    expect(res.body.seatUsage.used).toBe(1);
    expect(members).toHaveLength(res.body.seatUsage.used);
  });

  it("3. owner lookup failure is non-fatal — 200 with the plain member list", async () => {
    ownerLookupThrows = true;
    memberRows = [{
      id: "tm-1", email: "member@example.com", role: "member", status: "active",
      user_id: "u-member", first_name: "", last_name: "", name: "member",
      joined: "2026-02-01", joined_at: "2026-02-01T10:00:00Z",
      accepted_at: "2026-02-01T10:00:00Z", created_at: "2026-02-01T10:00:00Z",
      updated_at: "2026-02-01T10:00:00Z",
    }];

    const res = await request(makeApp()).get("/api/team");
    expect(res.status).toBe(200);
    const members = res.body.members as Array<Record<string, unknown>>;
    expect(members).toHaveLength(1);
    expect(members.some(m => m.id === "owner")).toBe(false);
  });
});
