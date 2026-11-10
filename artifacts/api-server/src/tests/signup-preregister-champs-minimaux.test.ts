/**
 * signup-preregister-champs-minimaux.test.ts
 *
 * POST /api/auth/pre-register — l'inscription etape 1 ne demande plus que
 * prenom, nom et e-mail professionnel. Societe, pays, adresse, ville et code
 * postal sont facultatifs : l'adresse de facturation et la TVA sont collectees
 * plus tard par Stripe.
 *
 *  1  prenom + nom + email valides seuls → 200 + preRegisterToken
 *  2  prenom manquant, nom manquant, email invalide → 400 (inchange)
 *  3  un appelant qui envoie encore les anciens champs est accepte et ses
 *     valeurs sont enregistrees telles quelles (compatibilite)
 *
 * Tout est mocke : ni base de donnees, ni Stripe, ni e-mail reel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const EMAIL = "minimal@exemple.fr";

// ── Faux Postgres ────────────────────────────────────────────────────────────
type Pending = { token: string; email: string; consumed: boolean };
let pending: Pending[];
let preRegInserts: unknown[][];
let preRegUpdates: unknown[][];

function answer(sql: string, v: unknown[] = []) {
  const s = sql.replace(/\s+/g, " ").trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return { rows: [], rowCount: 0 };
  if (/SELECT token, fp_lid FROM pending_signups/i.test(s)) {
    const row = pending.find(p => p.email === String(v[0]).toLowerCase() && !p.consumed);
    return { rows: row ? [{ token: row.token, fp_lid: null }] : [], rowCount: row ? 1 : 0 };
  }
  if (/^INSERT INTO pending_signups/i.test(s)) {
    preRegInserts.push(v);
    pending.push({ token: String(v[0]), email: String(v[1]).toLowerCase(), consumed: false });
    return { rows: [{ created_at: new Date("2026-01-01T00:00:00.000Z"), fp_lid: null }], rowCount: 1 };
  }
  if (/^UPDATE pending_signups SET first_name/i.test(s)) {
    preRegUpdates.push(v);
    return { rows: [{ created_at: new Date("2026-01-01T00:00:00.000Z"), fp_lid: null }], rowCount: 1 };
  }
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
vi.mock("../services/mailer.js", () => ({
  mailer: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }),
  captureTestMail: vi.fn(() => {}),
}));
vi.mock("../services/store.js", () => ({ store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn() } }));
vi.mock("../services/addons-service.js", () => ({ activateAddon: vi.fn(async () => true), deactivateAddon: vi.fn(async () => true), provisionPlanAddons: vi.fn(async () => {}) }));
vi.mock("../services/org-data.js", () => ({ findOrgByStripeCustomer: vi.fn(async () => null), persistOrgData: vi.fn(async () => {}), loadOrgData: vi.fn(async () => ({})) }));

const { default: authRouter } = await import("../routes/auth.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: express.Request & { cookies?: Record<string, string> }, _res, next) => { req.cookies = {}; next(); });
  a.use("/api", authRouter);
  return a;
}

/** Le formulaire simplifie : prenom, nom, e-mail professionnel. Rien d'autre. */
const minimalBody = (extra: Record<string, unknown> = {}) => ({
  firstName: "Camille", lastName: "Durand", email: EMAIL, ...extra,
});

/** L'ancien formulaire, tel qu'un appelant pas encore mis a jour l'envoie. */
const legacyBody = () => ({
  firstName: "Camille", lastName: "Durand", email: "legacy@exemple.fr",
  companyName: "Agence Durand", country: "FR", address: "12 rue de la Paix",
  city: "Paris", postalCode: "75002", phone: "+33123456789", vat: "FR12345678901",
});

const preRegister = (body: Record<string, unknown>) =>
  request(app()).post("/api/auth/pre-register").send(body);

beforeEach(() => {
  pending = []; preRegInserts = []; preRegUpdates = [];
});

describe("1 — prenom, nom et e-mail suffisent", () => {
  it("accepte le corps minimal et retourne un preRegisterToken", async () => {
    const r = await preRegister(minimalBody());
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.preRegisterToken).toBe("string");
    expect(r.body.preRegisterToken.length).toBeGreaterThan(0);
    // Un vrai jeton, pas la reponse muette du honeypot ni celle de l'allowlist.
    expect(r.body.preRegisterToken).not.toMatch(/^(hp_|blocked_)/);
    expect(preRegInserts).toHaveLength(1);
  });

  it("enregistre la ligne temporaire avec les champs absents a vide", async () => {
    await preRegister(minimalBody());
    const row = preRegInserts[0]!;
    // (token, email, first_name, last_name, company_name, country, address, city, postal_code, phone, vat, …)
    expect(row[1]).toBe(EMAIL);
    expect(row[2]).toBe("Camille");
    expect(row[3]).toBe("Durand");
    expect(row.slice(4, 9)).toEqual(["", "", "", "", ""]);
    expect(row[9]).toBeNull();
    expect(row[10]).toBeNull();
  });

  it.each([
    ["companyName", { country: "FR", address: "12 rue de la Paix", city: "Paris", postalCode: "75002" }],
    ["country",     { companyName: "Agence Durand", address: "12 rue de la Paix", city: "Paris", postalCode: "75002" }],
    ["address",     { companyName: "Agence Durand", country: "FR", city: "Paris", postalCode: "75002" }],
    ["city",        { companyName: "Agence Durand", country: "FR", address: "12 rue de la Paix", postalCode: "75002" }],
    ["postalCode",  { companyName: "Agence Durand", country: "FR", address: "12 rue de la Paix", city: "Paris" }],
  ])("n'exige plus %s", async (_champ, reste) => {
    const r = await preRegister(minimalBody(reste));
    expect(r.status).toBe(200);
    expect(r.body.preRegisterToken).toBeTruthy();
  });

  it("une chaine vide pour un champ facultatif n'est pas un refus", async () => {
    const r = await preRegister(minimalBody({
      companyName: "", country: "", address: "", city: "", postalCode: "", phone: "", vat: "",
    }));
    expect(r.status).toBe(200);
    expect(preRegInserts).toHaveLength(1);
  });
});

describe("2 — prenom, nom et e-mail restent obligatoires", () => {
  it("sans firstName → 400", async () => {
    const r = await preRegister({ lastName: "Durand", email: EMAIL });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Le prénom est requis.");
    expect(preRegInserts).toHaveLength(0);
  });

  it("firstName vide ou en blancs → 400", async () => {
    const r = await preRegister(minimalBody({ firstName: "   " }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Le prénom est requis.");
  });

  it("sans lastName → 400", async () => {
    const r = await preRegister({ firstName: "Camille", email: EMAIL });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Le nom est requis.");
    expect(preRegInserts).toHaveLength(0);
  });

  it("lastName vide ou en blancs → 400", async () => {
    const r = await preRegister(minimalBody({ lastName: "  " }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Le nom est requis.");
  });

  it.each(["", "   ", "pas-un-email", "camille@", "@exemple.fr", "camille@exemple"])(
    "e-mail invalide (%s) → 400", async (email) => {
      const r = await preRegister({ firstName: "Camille", lastName: "Durand", email });
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("Adresse email invalide ou manquante.");
      expect(preRegInserts).toHaveLength(0);
    });

  it("sans email → 400", async () => {
    const r = await preRegister({ firstName: "Camille", lastName: "Durand" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Adresse email invalide ou manquante.");
  });

  it("e-mail jetable → 400 (garde inchangee)", async () => {
    const r = await preRegister(minimalBody({ email: "camille@yopmail.com" }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Les adresses email temporaires ne sont pas acceptées.");
    expect(preRegInserts).toHaveLength(0);
  });
});

describe("3 — les anciens champs restent acceptes et conserves", () => {
  it("un corps complet est accepte et chaque valeur est enregistree", async () => {
    const r = await preRegister(legacyBody());
    expect(r.status).toBe(200);
    expect(r.body.preRegisterToken).toBeTruthy();
    expect(preRegInserts).toHaveLength(1);
    const row = preRegInserts[0]!;
    expect(row[1]).toBe("legacy@exemple.fr");
    expect(row.slice(2, 11)).toEqual([
      "Camille", "Durand", "Agence Durand", "FR", "12 rue de la Paix", "Paris", "75002",
      "+33123456789", "FR12345678901",
    ]);
  });

  it("une reprise met a jour la ligne existante avec les anciens champs", async () => {
    const first = await preRegister(legacyBody());
    const second = await preRegister(legacyBody());
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.preRegisterToken).toBe(first.body.preRegisterToken);
    expect(preRegUpdates).toHaveLength(1);
    // (first_name, last_name, company_name, country, address, city, postal_code, phone, vat, …)
    expect(preRegUpdates[0]!.slice(0, 9)).toEqual([
      "Camille", "Durand", "Agence Durand", "FR", "12 rue de la Paix", "Paris", "75002",
      "+33123456789", "FR12345678901",
    ]);
  });

  it("un corps minimal apres un corps complet reste accepte", async () => {
    const first = await preRegister(legacyBody());
    const second = await preRegister(minimalBody({ email: "legacy@exemple.fr" }));
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.preRegisterToken).toBe(first.body.preRegisterToken);
  });
});
