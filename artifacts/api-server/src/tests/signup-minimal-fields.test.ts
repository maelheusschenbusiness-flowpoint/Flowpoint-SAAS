/**
 * signup-minimal-fields.test.ts — demarrer l'essai avec le strict necessaire.
 *
 * L'inscription ne demande plus que email, prenom et entreprise. L'adresse, le
 * pays, le telephone et la TVA sont collectes au paiement (Address Element) et
 * recopies par finalize-checkout avant l'activation et la premiere facture.
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


const { default: authRouter } = await import("../routes/auth.js");
const { normalizeVat } = await import("../lib/vat.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.cookies = {}; next(); });
  a.use("/api", authRouter);
  return a;
}
const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

beforeEach(() => { pending = []; orgs = new Map(); preRegInserts = []; });

describe("Inscription minimale — pre-register", () => {
  it("accepte email + prenom + entreprise seuls, sans adresse ni TVA", async () => {
    const r = await request(app()).post("/api/auth/pre-register")
      .send({ email: EMAIL, firstName: "Lead", companyName: "Agence" });
    expect(r.status).toBe(200);
    expect(r.body.preRegisterToken).toBeTruthy();
    const row = preRegInserts[0]!;
    // email, first, last, company, country, address, city, postal, phone, vat
    expect(row.slice(1, 11)).toEqual([EMAIL, "Lead", "", "Agence", null, null, null, null, null, null]);
  });
  it("conserve l'adresse si elle est fournie (compatibilite)", async () => {
    await request(app()).post("/api/auth/pre-register").send({ email: EMAIL, firstName: "Lead",
      lastName: "Test", companyName: "Agence", country: "FR", address: "1 rue", city: "Paris", postalCode: "75001" });
    expect(preRegInserts[0]!.slice(5, 9)).toEqual(["FR", "1 rue", "Paris", "75001"]);
  });
  it.each([
    [{ firstName: "Lead", companyName: "Agence" }, "Adresse email invalide ou manquante."],
    [{ email: EMAIL, companyName: "Agence" }, "Le prénom est requis."],
    [{ email: EMAIL, firstName: "Lead" }, "Le nom de l'entreprise est requis."],
  ])("refuse %j", async (payload, error) => {
    const r = await request(app()).post("/api/auth/pre-register").send(payload);
    expect(r.status).toBe(400);
    expect(r.body.error).toBe(error);
    expect(preRegInserts).toHaveLength(0);
  });
});

describe("Inscription minimale — facturation reportee au paiement", () => {
  it("signin.html ne demande plus que email, prenom et entreprise", () => {
    const html = read("../../../flowpoint-export/signin.html");
    for (const id of ["email", "firstName", "companyName"]) expect(html).toContain(`id="${id}"`);
    for (const id of ["lastName", "country", "address", "city", "postalCode", "phone", "vat"]) {
      expect(html).not.toContain(`id="${id}"`);
    }
  });
  it("checkout-payment.html collecte l'adresse (Address Element, billing) et bloque le paiement tant qu'elle est incomplete", () => {
    const html = read("../../../flowpoint-export/checkout-payment.html");
    expect(html).toMatch(/elements\.create\('address'/);
    expect(html).toMatch(/mode: 'billing'/);
    expect(html).toMatch(/_paymentReady && _addressComplete/);
    expect(html).toContain('id="fp-vat"');
  });
  it("finalize-checkout recopie adresse, telephone et TVA sur pending_signups avant activation, sans ecraser", () => {
    const ts = read("../routes/public-billing.ts");
    const copy = ts.indexOf("await fillPendingSignup(_fcAddrPool, _fcPrt2, _fcBilling)");
    const stripeUpdate = ts.indexOf("await stripe.customers.update(customerId!, _fcUpdate);");
    const activation = ts.indexOf("[FC] step-1: querying pending_signups");
    expect(copy).toBeGreaterThan(0);
    // copie en base AVANT la mise a jour Stripe : un echec Stripe ne la perd pas
    expect(stripeUpdate).toBeGreaterThan(copy);
    expect(activation).toBeGreaterThan(copy);
    expect(ts).toContain("ensureEuVatTaxId(");
    expect(ts).not.toContain("createTaxId(customerId!");
    // reprise apres interruption : le webhook recupere l'adresse du moyen de paiement
    expect(read("../routes/stripe-webhook.ts")).toContain("listPaymentMethods(customerId");
    expect(read("../../../flowpoint-export/checkout-return.html")).toContain("fcBody.vat = _fcVat");
  });
  it.each([["FR 12 345.678-901", "FR12345678901"], ["be0123456789", "BE0123456789"]])("normalizeVat(%s)", (a, b) => {
    expect(normalizeVat(a)).toBe(b);
  });
  it.each(["", "12345", "FRx", null, 42])("normalizeVat refuse %s", (a) => { expect(normalizeVat(a)).toBeNull(); });
});
