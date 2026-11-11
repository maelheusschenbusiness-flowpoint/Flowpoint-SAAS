/**
 * signup-preregister-champs-minimaux.test.ts
 *
 * POST /api/auth/pre-register apres la simplification du formulaire : seuls
 * prenom, nom et e-mail professionnel sont demandes. Societe, pays, adresse,
 * ville et code postal ne sont plus obligatoires — l'adresse de facturation et
 * la TVA sont collectees plus tard par Stripe.
 *
 *   A  prenom + nom + e-mail valide suffisent → 200 + preRegisterToken
 *   B  prenom manquant, nom manquant, e-mail invalide ou absent → 400, inchange
 *   C  une requete qui porte encore les anciens champs est acceptee et ces
 *      valeurs sont enregistrees telles quelles (compatibilite)
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const EMAIL = "prospect@exemple.fr";

// ── Faux Postgres : aucun compte existant, la ligne pending est memorisee ─────
type Pending = { token: string; email: string };
let pending: Pending[];
let preRegInserts: unknown[][];
let preRegUpdates: unknown[][];

function answer(sql: string, v: unknown[] = []) {
  const s = sql.replace(/\s+/g, " ").trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return { rows: [], rowCount: 0 };
  if (/SELECT token, fp_lid FROM pending_signups/i.test(s)) {
    const row = pending.find(p => p.email === String(v[0]).toLowerCase());
    return { rows: row ? [{ token: row.token, fp_lid: null }] : [], rowCount: row ? 1 : 0 };
  }
  if (/^INSERT INTO pending_signups/i.test(s)) {
    preRegInserts.push(v);
    pending.push({ token: String(v[0]), email: String(v[1]).toLowerCase() });
    return { rows: [{ created_at: new Date("2026-01-01T00:00:00.000Z"), fp_lid: null }], rowCount: 1 };
  }
  if (/^UPDATE pending_signups SET first_name/i.test(s)) {
    preRegUpdates.push(v);
    return { rows: [{ created_at: new Date("2026-01-01T00:00:00.000Z"), fp_lid: null }], rowCount: 1 };
  }
  // users / organization_members / organizations : aucun compte actif
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
vi.mock("../services/stripe-factory.js", () => ({
  getStripeKey: vi.fn(() => undefined),
  isStripeTestMode: vi.fn(() => false),
  createStripeClient: vi.fn(async () => null),
}));
vi.mock("../services/mailer.js", () => ({ mailer: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }) }));
vi.mock("../services/store.js", () => ({ store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn() } }));

const { default: authRouter } = await import("../routes/auth.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: express.Request & { cookies?: Record<string, string> }, _res, next) => { req.cookies = {}; next(); });
  a.use("/api", authRouter);
  return a;
}

/** Le formulaire simplifie : rien d'autre que prenom, nom, e-mail. */
const bodyMinimal = (extra: Record<string, unknown> = {}) => ({
  firstName: "Camille", lastName: "Durand", email: EMAIL, ...extra,
});

beforeEach(() => {
  pending = []; preRegInserts = []; preRegUpdates = [];
  vi.stubEnv("ALLOWED_EMAILS", "");
  vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "");
});

describe("A — prenom, nom et e-mail suffisent", () => {
  it("accepte le formulaire minimal et rend un preRegisterToken", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send(bodyMinimal());
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.preRegisterToken).toBe("string");
    expect(r.body.preRegisterToken.length).toBeGreaterThan(0);
    expect(preRegInserts).toHaveLength(1);
  });

  it("enregistre la ligne pending avec les champs retires vides, jamais refuses", async () => {
    await request(app()).post("/api/auth/pre-register").send(bodyMinimal());
    const row = preRegInserts[0]!;
    // $2..$5 : email, prenom, nom, societe — puis pays, adresse, ville, code postal
    expect(row.slice(1, 5)).toEqual([EMAIL, "Camille", "Durand", ""]);
    expect(row.slice(5, 9)).toEqual(["", "", "", ""]);
    // phone ($10) et vat ($11) restent NULL quand ils ne sont pas transmis
    expect(row[9]).toBeNull();
    expect(row[10]).toBeNull();
  });

  it("chacun des champs retires, fourni vide, ne declenche aucun refus", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send(bodyMinimal({
      companyName: "", country: "", address: "", city: "", postalCode: "", phone: "", vat: "",
    }));
    expect(r.status).toBe(200);
    expect(r.body.preRegisterToken).toBeTruthy();
  });
});

describe("B — les refus 400 restants sont inchanges", () => {
  it("sans firstName → 400", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send({ lastName: "Durand", email: EMAIL });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/first name/i);
    expect(preRegInserts).toHaveLength(0);
  });

  it("sans lastName → 400", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send({ firstName: "Camille", email: EMAIL });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/last name/i);
    expect(preRegInserts).toHaveLength(0);
  });

  it.each(["", "   ", "camille", "camille@", "@exemple.fr", "camille@exemple", "camille exemple.fr"])(
    "e-mail invalide (%j) → 400", async (email) => {
      const r = await request(app()).post("/api/auth/pre-register").send({ firstName: "Camille", lastName: "Durand", email });
      expect(r.status).toBe(400);
      expect(r.body.error).toMatch(/email/i);
      expect(preRegInserts).toHaveLength(0);
    });

  it("sans email du tout → 400", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send({ firstName: "Camille", lastName: "Durand" });
    expect(r.status).toBe(400);
    expect(preRegInserts).toHaveLength(0);
  });

  it("prenom et nom reduits a des espaces → 400", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send({ firstName: "  ", lastName: "  ", email: EMAIL });
    expect(r.status).toBe(400);
    expect(preRegInserts).toHaveLength(0);
  });
});

describe("C — compatibilite : les anciens champs restent acceptes et conserves", () => {
  const ancien = {
    companyName: "Agence Durand", country: "FR", address: "12 rue des Lilas",
    city: "Paris", postalCode: "75011", phone: "+33123456789", vat: "FR12345678901",
  };

  it("une requete qui porte encore tous les anciens champs est acceptee", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send(bodyMinimal(ancien));
    expect(r.status).toBe(200);
    expect(r.body.preRegisterToken).toBeTruthy();
  });

  it("les valeurs fournies sont enregistrees telles quelles", async () => {
    await request(app()).post("/api/auth/pre-register").send(bodyMinimal(ancien));
    const row = preRegInserts[0]!;
    expect(row.slice(1, 11)).toEqual([
      EMAIL, "Camille", "Durand", "Agence Durand",
      "FR", "12 rue des Lilas", "Paris", "75011",
      "+33123456789", "FR12345678901",
    ]);
  });

  it("une reprise met a jour la ligne existante avec les anciens champs fournis", async () => {
    const first = await request(app()).post("/api/auth/pre-register").send(bodyMinimal());
    const second = await request(app()).post("/api/auth/pre-register").send(bodyMinimal(ancien));
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.preRegisterToken).toBe(first.body.preRegisterToken);
    const row = preRegUpdates[0]!;
    // $1..$9 : prenom, nom, societe, pays, adresse, ville, code postal, phone, vat
    expect(row.slice(0, 9)).toEqual([
      "Camille", "Durand", "Agence Durand", "FR", "12 rue des Lilas", "Paris", "75011",
      "+33123456789", "FR12345678901",
    ]);
  });

  it("un champ partiel (societe seule) est accepte et conserve", async () => {
    const r = await request(app()).post("/api/auth/pre-register").send(bodyMinimal({ companyName: "Agence Durand" }));
    expect(r.status).toBe(200);
    const row = preRegInserts[0]!;
    expect(row[4]).toBe("Agence Durand");
    expect(row.slice(5, 9)).toEqual(["", "", "", ""]);
  });
});
