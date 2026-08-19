/**
 * team-invite-accept.test.ts
 *
 * Integration tests for POST /team/invitations/accept and GET /team/invitations/validate.
 *
 * Covers:
 *   1. Happy path: valid token + email → { ok: true, sessionToken, orgId, role, memberId }
 *   2. Invalid token (not found in DB) → 404 INVALID_TOKEN
 *   3. Already accepted invitation → 409 ALREADY_ACCEPTED
 *   4. Expired invitation → 410 EXPIRED
 *   5. DB error during org_members INSERT (simulated RLS failure) → 500 SERVER_ERROR, no session created
 *   6. Missing token → 400 MISSING_TOKEN
 *   7. Missing/invalid email → 400 MISSING_EMAIL
 *   8. Validate endpoint: valid pending invitation → { valid: true, invitation: { ... } }
 *   9. Validate endpoint: unknown token → 404 { valid: false }
 */

import { createHash } from "crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Logger mock ──────────────────────────────────────────────────────────────
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

// ─── Mailer mock (fire-and-forget — must not throw) ───────────────────────────
vi.mock("../services/mailer.js", () => ({
  mailer: { sendInvitationAccepted: vi.fn(async () => ({ ok: true })) },
}));

// ─── org-settings mock (used in fire-and-forget notify) ──────────────────────
vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings: vi.fn(async () => ({ orgName: "Test Org" })),
}));

// ─── Session service mock ─────────────────────────────────────────────────────
const sessionTokens: string[] = [];
vi.mock("../services/sessions.js", () => ({
  SESSION_TTL_MS: 604_800_000,
  createSession: vi.fn(async () => {
    const t = "sess_" + Math.random().toString(36).slice(2);
    sessionTokens.push(t);
    return t;
  }),
  invalidateAllSessions: vi.fn(async () => {}),
}));

// ─── Plans mock ───────────────────────────────────────────────────────────────
vi.mock("../lib/plans.js", () => ({
  PLAN_LIMITS:          { standard: { seats: 5 }, pro: { seats: 20 }, ultra: { seats: 100 } },
  PLAN_INCLUDED_ADDONS: { standard: [], pro: [], ultra: [] },
  ADDON_DEFINITIONS:    {},
}));

// ─── requireRole mock ─────────────────────────────────────────────────────────
vi.mock("../middlewares/requireRole.js", () => ({
  canAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// ─── DB pool mock — module-level mutable scenario ─────────────────────────────
// vi.mock factories are hoisted; we use a swappable state object so each test
// can configure behaviour without re-importing the module.
type Scenario = {
  invRow: Record<string, unknown> | null;        // SELECT … FOR UPDATE result
  orgMembersInsertShouldThrow?: boolean;          // simulate RLS INSERT failure
  existingTeamMember?: boolean;                   // team_members already has a row
  validateInvRow?: Record<string, unknown> | null; // pool.query result for validate
};

const scenario: Scenario = { invRow: null };

vi.mock("@workspace/db", () => {
  // pool.connect → returns a client with a query spy
  const makeClient = () => ({
    _queries: [] as Array<{ sql: string; values: unknown[] }>,
    query: vi.fn(async function (this: { _queries: Array<{ sql: string; values: unknown[] }> }, sql: string, values: unknown[] = []) {
      this._queries.push({ sql, values });

      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql.trim())) return { rows: [] };
      if (/set_config/.test(sql))                        return { rows: [{ set_config: "" }] };

      // Invitation SELECT FOR UPDATE
      if (/FROM team_invitations/.test(sql) && /FOR UPDATE/.test(sql)) {
        return { rows: scenario.invRow ? [scenario.invRow] : [] };
      }
      // team_members existence check
      if (/FROM team_members/.test(sql) && /lower\(email\)/.test(sql)) {
        return scenario.existingTeamMember ? { rows: [{ id: "tm-existing-id" }] } : { rows: [] };
      }
      // canonical users lookup after the users upsert (accept flow)
      if (/FROM users/.test(sql) && /lower\(email\)/.test(sql)) {
        return { rows: [{ id: "user-uuid-accepted" }] };
      }
      // org name lookup inside accept
      if (/FROM organizations/.test(sql)) return { rows: [{ org_name: "Test Org" }] };

      // organization_members INSERT — simulate RLS failure
      if (/INSERT INTO organization_members/.test(sql) && scenario.orgMembersInsertShouldThrow) {
        throw new Error('new row violates row-level security policy for table "organization_members"');
      }

      return { rows: [] };
    }),
    release: vi.fn(),
  });

  // pool.query (used by GET /validate)
  const poolQuery = vi.fn(async (sql: string, _values: unknown[] = []) => {
    if (/FROM team_invitations/.test(sql)) {
      return { rows: scenario.validateInvRow !== undefined
        ? (scenario.validateInvRow ? [scenario.validateInvRow] : [])
        : (scenario.invRow ? [scenario.invRow] : []) };
    }
    if (/FROM organizations/.test(sql)) return { rows: [{ org_name: "Test Org" }] };
    return { rows: [] };
  });

  // Track the last client created so tests can inspect queries
  let lastClient: ReturnType<typeof makeClient> | null = null;
  const connect = vi.fn(async () => {
    lastClient = makeClient();
    return lastClient;
  });

  const pool = { connect, query: poolQuery };

  // Expose lastClient getter via pool for test inspection
  (pool as unknown as { _getLastClient: () => typeof lastClient })._getLastClient = () => lastClient;

  return { pool };
});

// ─── Import router after mocks are set up ─────────────────────────────────────
import { publicTeamRouter } from "../routes/team.js";

// ─── App ─────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());
app.use("/api", publicTeamRouter);

// ─── Token / fixture helpers ──────────────────────────────────────────────────
const RAW_TOKEN     = "test_raw_token_abc123";
const TOKEN_HASH    = createHash("sha256").update(RAW_TOKEN).digest("hex");
const ORG_ID        = "org-uuid-1234";
const INVITED_EMAIL = "invited@example.com";

const BASE_INV = {
  id:                  "inv-id-001",
  org_id:              ORG_ID,
  email:               INVITED_EMAIL,
  role:                "member",
  status:              "pending",
  expires_at:          new Date(Date.now() + 7 * 86_400_000).toISOString(),
  invited_by_user_id:  null,
  token_hash:          TOKEN_HASH,
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /api/team/invitations/accept", () => {
  beforeEach(() => {
    // Reset shared scenario and session tracker before each test
    Object.assign(scenario, {
      invRow:                    null,
      orgMembersInsertShouldThrow: false,
      existingTeamMember:        false,
      validateInvRow:            undefined,
    });
    sessionTokens.length = 0;
    vi.clearAllMocks();
  });

  it("1. happy path — returns sessionToken, orgId, role, memberId", async () => {
    scenario.invRow = { ...BASE_INV };

    const res = await request(app)
      .post("/api/team/invitations/accept")
      .send({ token: RAW_TOKEN, email: INVITED_EMAIL });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.orgId).toBe(ORG_ID);
    expect(res.body.role).toBe("member");
    expect(res.body.email).toBe(INVITED_EMAIL);
    expect(typeof res.body.sessionToken).toBe("string");
    expect(res.body.sessionToken.startsWith("sess_")).toBe(true);
  });

  it("2. invalid token → 404 INVALID_TOKEN, no session created", async () => {
    scenario.invRow = null; // invitation not found

    const res = await request(app)
      .post("/api/team/invitations/accept")
      .send({ token: "bad_token_xxxxx", email: INVITED_EMAIL });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("INVALID_TOKEN");
    expect(sessionTokens).toHaveLength(0);
  });

  it("3. already accepted → 409 ALREADY_ACCEPTED, no session created", async () => {
    scenario.invRow = { ...BASE_INV, status: "accepted" };

    const res = await request(app)
      .post("/api/team/invitations/accept")
      .send({ token: RAW_TOKEN, email: INVITED_EMAIL });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ALREADY_ACCEPTED");
    expect(sessionTokens).toHaveLength(0);
  });

  it("4. expired invitation → 410 EXPIRED, no session created", async () => {
    scenario.invRow = {
      ...BASE_INV,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    };

    const res = await request(app)
      .post("/api/team/invitations/accept")
      .send({ token: RAW_TOKEN, email: INVITED_EMAIL });

    expect(res.status).toBe(410);
    expect(res.body.code).toBe("EXPIRED");
    expect(sessionTokens).toHaveLength(0);
  });

  it("5. org_members INSERT throws RLS error → 500 SERVER_ERROR, rollback issued, no session", async () => {
    scenario.invRow                    = { ...BASE_INV };
    scenario.orgMembersInsertShouldThrow = true;

    const res = await request(app)
      .post("/api/team/invitations/accept")
      .send({ token: RAW_TOKEN, email: INVITED_EMAIL });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("SERVER_ERROR");
    expect(sessionTokens).toHaveLength(0);
  });

  it("6. missing token → 400 MISSING_TOKEN", async () => {
    const res = await request(app)
      .post("/api/team/invitations/accept")
      .send({ email: INVITED_EMAIL });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_TOKEN");
  });

  it("7. missing/invalid email → 400 MISSING_EMAIL", async () => {
    const res = await request(app)
      .post("/api/team/invitations/accept")
      .send({ token: RAW_TOKEN });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("MISSING_EMAIL");
  });
});

describe("GET /api/team/invitations/validate", () => {
  beforeEach(() => {
    Object.assign(scenario, {
      invRow:         null,
      validateInvRow: undefined,
    });
    vi.clearAllMocks();
  });

  it("8. valid pending invitation → { valid: true, invitation: {...} }", async () => {
    scenario.invRow = { ...BASE_INV };

    const res = await request(app)
      .get(`/api/team/invitations/validate?token=${RAW_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.invitation.orgId).toBe(ORG_ID);
    expect(res.body.invitation.role).toBe("member");
    expect(res.body.invitation.email).toBe(INVITED_EMAIL);
  });

  it("9. unknown token → 404 { valid: false, reason: 'not_found' }", async () => {
    scenario.invRow = null;

    const res = await request(app)
      .get(`/api/team/invitations/validate?token=unknown_token_long`);

    expect(res.status).toBe(404);
    expect(res.body.valid).toBe(false);
    expect(res.body.reason).toBe("not_found");
  });
});
