/**
 * conversion-b-fp-lid.test.ts — Conversion B: one opaque lead id, from the
 * outreach email to the organization it converts into.
 *
 *   Smartlead link ?fp_lid=… → signin.html (sessionStorage) → pre-register body
 *   or Google OAuth state → pending_signups.fp_lid → organizations.fp_lid
 *
 *  A  normalizeFpLid: exactly 22 [A-Za-z0-9_-]; anything else → null
 *  B  pre-register: valid stored, invalid / absent → NULL, signup never refused
 *  C  pre-register retry: the first attribution (earlier pending row) wins
 *  D  Google login: the state carries a valid fp_lid, never an invalid one
 *  E  activation (webhook path): pending fp_lid → organizations.fp_lid, copied
 *     in the transaction that consumes the pending row; an existing value is
 *     never overwritten; no fp_lid → NULL; re-running is idempotent
 *  F  root redirects keep fp_lid; the funnel pages capture it first-touch;
 *     finalize-checkout and the Google callback copy it (source contracts)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VALID = "AbCdEfGhIjKlMnOpQr_-12";       // 22 chars
const OTHER = "ZzYyXxWwVvUuTtSsRr0123";
const EMAIL = "lead@exemple.fr";

// ── Fake Postgres ────────────────────────────────────────────────────────────
type Pending = { token: string; email: string; fp_lid: string | null; seller_id: string | null; consumed: boolean };
let pending: Pending[];
let orgs: Map<string, { id: string; owner_email: string; fp_lid: string | null; subscription_status: string }>;
let preRegInserts: unknown[][];

function answer(sql: string, v: unknown[] = []) {
  const s = sql.replace(/\s+/g, " ").trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return { rows: [], rowCount: 0 };
  if (/DELETE FROM pending_signups WHERE lower\(email\)/i.test(s)) {
    const gone = pending.filter(p => p.email === String(v[0]).toLowerCase() && !p.consumed);
    pending = pending.filter(p => !gone.includes(p));
    return { rows: gone.map(p => ({ stripe_customer_id: null, fp_lid: p.fp_lid })), rowCount: gone.length };
  }
  if (/^INSERT INTO pending_signups/i.test(s)) {
    preRegInserts.push(v);
    pending.push({ token: String(v[0]), email: String(v[1]), seller_id: (v[11] as string) ?? null,
                   fp_lid: (v[12] as string) ?? null, consumed: false });
    return { rows: [], rowCount: 1 };
  }
  if (/FROM pending_signups WHERE token = \$1 AND consumed_at IS NULL/i.test(s)) {
    const row = pending.find(p => p.token === v[0] && !p.consumed);
    return { rows: row ? [{ email: row.email, first_name: "Lead", last_name: "Test", company_name: "Agence",
                            country: "FR", address: "1 rue", city: "Paris", postal_code: "75001",
                            phone: null, vat: null, seller_id: row.seller_id, fp_lid: row.fp_lid }] : [],
             rowCount: row ? 1 : 0 };
  }
  if (/SELECT consumed_at FROM pending_signups/i.test(s)) {
    const row = pending.find(p => p.token === v[0]);
    return { rows: row ? [{ consumed_at: row.consumed ? new Date() : null }] : [], rowCount: row ? 1 : 0 };
  }
  if (/UPDATE pending_signups SET consumed_at/i.test(s)) {
    pending.filter(p => p.token === v[0]).forEach(p => { p.consumed = true; });
    return { rows: [], rowCount: 1 };
  }
  if (/SELECT id::text, subscription_status FROM organizations WHERE owner_email/i.test(s)) {
    const o = [...orgs.values()].find(x => x.owner_email === v[0]);
    return { rows: o ? [{ id: o.id, subscription_status: o.subscription_status }] : [], rowCount: o ? 1 : 0 };
  }
  if (/^INSERT INTO users/i.test(s)) return { rows: [{ id: "user-1" }], rowCount: 1 };
  if (/^INSERT INTO organizations/i.test(s)) {
    // Emulates ON CONFLICT (id) DO UPDATE ... fp_lid = COALESCE(organizations.fp_lid, EXCLUDED.fp_lid)
    const id = String(v[0]); const incoming = (v[10] as string) ?? null;
    const existing = orgs.get(id);
    const coalesced = /fp_lid\s*= COALESCE\(organizations\.fp_lid, EXCLUDED\.fp_lid\)/.test(s);
    orgs.set(id, { id, owner_email: String(v[6]), subscription_status: String(v[5]),
                   fp_lid: existing ? (coalesced ? (existing.fp_lid ?? incoming) : incoming) : incoming });
    return { rows: [{ id }], rowCount: 1 };
  }
  if (/FROM users WHERE|FROM organization_members|FROM user_sessions/i.test(s)) return { rows: [], rowCount: 0 };
  return { rows: [], rowCount: 0 };
}

vi.mock("@workspace/db", () => {
  const client = { query: vi.fn(async (s: string, v?: unknown[]) => answer(s, v)), release: vi.fn() };
  return { pool: { connect: vi.fn(async () => client), query: vi.fn(async (s: string, v?: unknown[]) => answer(s, v)) },
           db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn() };
});
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
vi.mock("../middlewares/rateLimiter.js", () => ({
  createRateLimit: () => (_q: unknown, _r: unknown, n: () => void) => n(),
  authRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  publicCheckoutRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  globalRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
}));
vi.mock("../services/org-settings.js", () => ({ loadOrgSettings: vi.fn(async () => null), upsertOrgSettings: vi.fn(async () => {}) }));
vi.mock("../services/seller-attribution.js", () => ({
  validateSellerCode: vi.fn(async () => null), resolveSellerIdFromToken: vi.fn(async () => null), recordCommission: vi.fn(async () => {}),
}));
vi.mock("../services/stripe-factory.js", () => ({ getStripeKey: vi.fn(() => undefined), createStripeClient: vi.fn(async () => null) }));
vi.mock("../services/mailer.js", () => ({ mailer: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }) }));
vi.mock("../services/store.js", () => ({ store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn() } }));
vi.mock("../services/addons-service.js", () => ({ activateAddon: vi.fn(async () => true), deactivateAddon: vi.fn(async () => true), provisionPlanAddons: vi.fn(async () => {}) }));
vi.mock("../services/org-data.js", () => ({ findOrgByStripeCustomer: vi.fn(async () => null), persistOrgData: vi.fn(async () => {}), loadOrgData: vi.fn(async () => ({})) }));

const { normalizeFpLid } = await import("../lib/fp-lid.js");
const { withCarriedParams } = await import("../lib/carry-params.js");
const { default: authRouter } = await import("../routes/auth.js");
const { activateNewSignup } = await import("../routes/stripe-webhook.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.cookies = {}; next(); });
  a.use("/api", authRouter);
  return a;
}
const signupBody = (extra: Record<string, unknown> = {}) => ({
  firstName: "Lead", lastName: "Test", email: EMAIL, companyName: "Agence", country: "FR",
  address: "1 rue", city: "Paris", postalCode: "75001", ...extra,
});
const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

beforeEach(() => {
  pending = []; orgs = new Map(); preRegInserts = [];
  process.env["GOOGLE_CLIENT_ID"] = "test-client";
});

describe("A — normalizeFpLid", () => {
  it("accepts exactly 22 base64url characters", () => {
    expect(normalizeFpLid(VALID)).toBe(VALID);
  });
  it.each([undefined, null, 42, "", VALID.slice(0, 21), VALID + "x", VALID.slice(0, 21) + "=",
           VALID.slice(0, 21) + ".", VALID.slice(0, 21) + " ", "lead@exemple.fr.aaaaaaa", [VALID]])(
    "rejects %s → null", (bad) => { expect(normalizeFpLid(bad)).toBeNull(); });
});

describe("B/C — pre-register", () => {
  it("stores a valid fp_lid on the pending signup", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send(signupBody({ fp_lid: VALID }));
    expect(r.status).toBe(200);
    expect(preRegInserts).toHaveLength(1);
    expect(preRegInserts[0]![12]).toBe(VALID);
  });
  it("stores NULL for an invalid fp_lid and still accepts the signup", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send(signupBody({ fp_lid: "not-a-lead-id" }));
    expect(r.status).toBe(200);
    expect(r.body.preRegisterToken).toBeTruthy();
    expect(preRegInserts[0]![12]).toBeNull();
  });
  it("without fp_lid the signup is unchanged (NULL, same other columns)", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send(signupBody());
    expect(r.status).toBe(200);
    const row = preRegInserts[0]!;
    expect(row[12]).toBeNull();
    expect(row.slice(1, 9)).toEqual([EMAIL, "Lead", "Test", "Agence", "FR", "1 rue", "Paris", "75001"]);
    expect(row[11]).toBeNull();
  });
  it("a retry keeps the first attribution", async () => {
    await request(app()).post("/api/auth/pre-register").send(signupBody({ fp_lid: VALID }));
    await request(app()).post("/api/auth/pre-register").send(signupBody({ fp_lid: OTHER }));
    await request(app()).post("/api/auth/pre-register").send(signupBody());
    expect(preRegInserts.map(r => r[12])).toEqual([VALID, VALID, VALID]);
  });
});

describe("D — Google login state", () => {
  const stateOf = (loc: string) =>
    JSON.parse(Buffer.from(new URL(loc).searchParams.get("state")!, "base64").toString("utf8"));
  it("carries a valid fp_lid", async () => {
    const r = await request(app()).get(`/api/auth/google/login?fp_lid=${VALID}`);
    expect(r.status).toBe(302);
    expect(stateOf(r.headers.location).fp_lid).toBe(VALID);
  });
  it("never carries an invalid one", async () => {
    const r = await request(app()).get("/api/auth/google/login?fp_lid=%3Cscript%3E");
    expect(stateOf(r.headers.location).fp_lid).toBeNull();
  });
  it("is unchanged otherwise (seller_code still carried)", async () => {
    const r = await request(app()).get("/api/auth/google/login?seller_code=SELLER-AB12");
    const st = stateOf(r.headers.location);
    expect(st.seller_code).toBe("SELLER-AB12");
    expect(st.fp_lid).toBeNull();
  });
});

describe("E — activation copies fp_lid to the organization", () => {
  const activate = (token: string) =>
    activateNewSignup({ preRegToken: token, orgId: EMAIL, customerId: "cus_x", selectedPlan: "standard", isTrial: true });

  it("pending fp_lid → organizations.fp_lid, and the pending row is consumed", async () => {
    pending.push({ token: "t1", email: EMAIL, fp_lid: VALID, seller_id: null, consumed: false });
    await activate("t1");
    const org = [...orgs.values()][0]!;
    expect(org.fp_lid).toBe(VALID);
    expect(pending[0]!.consumed).toBe(true);
  });
  it("no fp_lid → NULL", async () => {
    pending.push({ token: "t2", email: EMAIL, fp_lid: null, seller_id: null, consumed: false });
    await activate("t2");
    expect([...orgs.values()][0]!.fp_lid).toBeNull();
  });
  it("an existing organization keeps its first fp_lid", async () => {
    orgs.set("11111111-1111-4111-8111-111111111111",
      { id: "11111111-1111-4111-8111-111111111111", owner_email: EMAIL, fp_lid: VALID, subscription_status: "pending_billing" });
    pending.push({ token: "t3", email: EMAIL, fp_lid: OTHER, seller_id: null, consumed: false });
    await activate("t3");
    expect(orgs.get("11111111-1111-4111-8111-111111111111")!.fp_lid).toBe(VALID);
  });
  it("re-running is idempotent", async () => {
    pending.push({ token: "t4", email: EMAIL, fp_lid: VALID, seller_id: null, consumed: false });
    await activate("t4");
    await activate("t4");
    expect(orgs.size).toBe(1);
    expect([...orgs.values()][0]!.fp_lid).toBe(VALID);
  });
});

describe("F — funnel and finalize contracts", () => {
  it("root redirects carry fp_lid and nothing new otherwise", () => {
    expect(withCarriedParams("/signin.html", { fp_lid: VALID })).toBe(`/signin.html?fp_lid=${VALID}`);
    expect(withCarriedParams("/signin.html", {})).toBe("/signin.html");
    const appSrc = read("../app.ts");
    expect(appSrc).toMatch(/app\.get\("\/index\.html"[\s\S]{0,120}withCarriedParams\("\/signin\.html"/);
    expect(appSrc).toMatch(/app\.get\("\/",[\s\S]{0,120}withCarriedParams\("\/signin\.html"/);
  });
  it("finalize-checkout reads fp_lid and copies it with first-wins COALESCE in the consuming transaction", () => {
    const src = read("../routes/public-billing.ts");
    expect(src).toMatch(/postal_code, phone, vat, seller_id, fp_lid, consumed_at, expires_at/);
    expect(src).toMatch(/trial_ends_at,seller_id,fp_lid\)/);
    expect(src).toMatch(/fp_lid=COALESCE\(organizations\.fp_lid,EXCLUDED\.fp_lid\)/);
    const insertAt = src.indexOf("trial_ends_at,seller_id,fp_lid)");
    const consumeAt = src.indexOf("UPDATE pending_signups SET consumed_at=NOW() WHERE token=$1", insertAt);
    expect(insertAt).toBeGreaterThan(0);
    expect(consumeAt).toBeGreaterThan(insertAt);
  });
  it("the Google callback stores the state fp_lid, the first attribution winning", () => {
    const src = read("../routes/auth.ts");
    expect(src).toMatch(/fpLidFromState = normalizeFpLid\(stateObj\.fp_lid\)/);
    expect(src).toMatch(/RETURNING fp_lid/);
    expect(src).toMatch(/\.find\(\(v\): v is string => v !== null\) \?\? fpLidFromState/);
    expect(src).toMatch(/postal_code, seller_id, fp_lid, created_at, expires_at/);
  });
  it("signin.html and pricing.html capture fp_lid first-touch, validated, in sessionStorage", () => {
    const signin = read("../../../flowpoint-export/signin.html");
    expect(signin).toMatch(/sessionStorage\.getItem\('fp_lid'\)/);
    expect(signin).toMatch(/\/\^\[A-Za-z0-9_-\]\{22\}\$\//);
    expect(signin).toMatch(/fp_lid: \(function\(\)\{try\{var _l=sessionStorage\.getItem\('fp_lid'\)/);
    expect(signin).toMatch(/'fp_lid=' \+ encodeURIComponent\(fpLidValue\)/);
    const pricing = read("../../../flowpoint-export/pricing.html");
    expect(pricing).toMatch(/sessionStorage\.setItem\('fp_lid',_l\)/);
  });
  it("schema adds fp_lid to pending_signups and organizations, idempotently", () => {
    const init = read("../services/init-data-tables.ts");
    expect(init).toMatch(/ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS fp_lid TEXT/);
    expect(init).toMatch(/ALTER TABLE organizations\s+ADD COLUMN IF NOT EXISTS fp_lid TEXT/);
    expect(read("../index.ts")).toMatch(/ALTER TABLE pending_signups ADD COLUMN IF NOT EXISTS fp_lid TEXT/);
  });
});
