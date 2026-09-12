/**
 * team-seat-gate.test.ts — P0 Ultra seat invitation gate tests.
 *
 * Proves POST /team/invite uses exactly the SAME authoritative resolver as the
 * dashboard, so an Ultra org can never be refused at Standard/1.
 *
 * Coverage:
 *   - Ultra at 1/10 used → invite PERMITTED
 *   - Ultra at 9/10 used → invite PERMITTED
 *   - Ultra at 10/10 used → invite REFUSED (402 SEAT_LIMIT_REACHED)
 *   - Standard at 1/1 used → invite REFUSED (402 SEAT_LIMIT_REACHED)
 *   - resolver unavailable → 503 SEAT_ENTITLEMENT_UNAVAILABLE (retryable),
 *     NOT a quota (402) refusal
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─── Logger mock ──────────────────────────────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

// ─── requireRole (canAdmin) mock — pass through ───────────────────────────────
vi.mock("../middlewares/requireRole.js", () => ({
  canAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ─── sessions mock (imported at module load) ──────────────────────────────────
vi.mock("../services/sessions.js", () => ({
  SESSION_TTL_MS:        604_800_000,
  createSession:         vi.fn(async () => "sess_x"),
  invalidateAllSessions: vi.fn(async () => {}),
}));

// ─── mailer mock — invite email always succeeds (kept out of the way) ─────────
vi.mock("../services/mailer.js", () => ({
  mailer: { sendTeamInvitation: vi.fn(async () => ({ ok: true, id: "email-1" })) },
}));
vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings: vi.fn(async () => ({ firstName: "A", orgName: "Org" })),
}));

// ─── @workspace/db mock — mirrors the transaction used by atomic reservation ──
vi.mock("@workspace/db", () => ({
  pool: {
    connect: vi.fn(async () => ({
      query: vi.fn(async (sql: string) => {
        if (/FROM team_members/.test(sql) && /status = 'active'/.test(sql)) {
          return { rows: [{ n: activeMembers }] };
        }
        if (/FROM team_invitations/.test(sql) && /status = 'pending'/.test(sql) && /expires_at/.test(sql)) {
          return { rows: [{ n: pendingInvites }] };
        }
        return { rows: [] };
      }),
      release: vi.fn(),
    })),
    query: vi.fn(async () => ({ rows: [] })),
  },
}));

// ─── seat-entitlement resolver mock — the authoritative source ────────────────
type SeatMock = { value?: { limit: number; plan: string }; throwUnavailable?: boolean };
let seatMock: SeatMock = {};

vi.mock("../services/seat-entitlement.js", async () => {
  const actual = await vi.importActual<typeof import("../services/seat-entitlement.js")>(
    "../services/seat-entitlement.js"
  );
  return {
    ...actual,
    resolveSeatEntitlement: vi.fn(async () => {
      if (seatMock.throwUnavailable) {
        throw new actual.SeatEntitlementUnavailableError("unavailable for test");
      }
      return seatMock.value!;
    }),
  };
});

import teamRouter from "../routes/team.js";

// ─── Test harness: inject orgId / orgDb / orgContext + seat-count stubs ────────
// getSeatUsage computes: used = 1 (owner) + active members + pending invites.
let activeMembers = 0;
let pendingInvites = 0;

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { orgId: string }).orgId = "org-uuid-1234";
    (req as unknown as { orgContext: { email: string; role: string } }).orgContext = {
      email: "owner@example.com",
      role:  "owner",
    };
    (req as unknown as { orgDb: (sql: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> }).orgDb =
      async (sql: string) => {
        if (/FROM team_members/.test(sql) && /status = 'active'/.test(sql)) {
          return { rows: [{ n: activeMembers }] };
        }
        if (/FROM team_invitations/.test(sql) && /status = 'pending'/.test(sql) && /expires_at/.test(sql)) {
          return { rows: [{ n: pendingInvites }] };
        }
        // duplicate-invitation check + active-member check → no rows (clean invite)
        return { rows: [] };
      };
    next();
  });
  app.use("/api", teamRouter);
  return app;
}

const app = makeApp();

function invite() {
  return request(app)
    .post("/api/team/invite")
    .send({ email: "new@example.com", role: "member" });
}

describe("POST /api/team/invite — seat gate (P0 Ultra fix)", () => {
  beforeEach(() => {
    seatMock       = {};
    activeMembers  = 0;
    pendingInvites = 0;
    vi.clearAllMocks();
  });

  it("Ultra at 1/10 used → PERMITS invite", async () => {
    seatMock       = { value: { limit: 10, plan: "ultra" } };
    activeMembers  = 0;
    pendingInvites = 0; // used = 1
    const res = await invite();
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it("Ultra at 9/10 used → PERMITS invite", async () => {
    seatMock       = { value: { limit: 10, plan: "ultra" } };
    activeMembers  = 8;
    pendingInvites = 0; // used = 9
    const res = await invite();
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });

  it("Ultra at 10/10 used → REFUSES invite (402 SEAT_LIMIT_REACHED)", async () => {
    seatMock       = { value: { limit: 10, plan: "ultra" } };
    activeMembers  = 9;
    pendingInvites = 0; // used = 10
    const res = await invite();
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SEAT_LIMIT_REACHED");
  });

  it("Standard at 1/1 used → REFUSES invite (402 SEAT_LIMIT_REACHED)", async () => {
    seatMock       = { value: { limit: 1, plan: "standard" } };
    activeMembers  = 0;
    pendingInvites = 0; // used = 1
    const res = await invite();
    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SEAT_LIMIT_REACHED");
  });

  it("resolver unavailable → 503 retryable, NOT a 402 quota refusal", async () => {
    seatMock = { throwUnavailable: true };
    const res = await invite();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("SEAT_ENTITLEMENT_UNAVAILABLE");
    expect(res.body.retryable).toBe(true);
  });
});
