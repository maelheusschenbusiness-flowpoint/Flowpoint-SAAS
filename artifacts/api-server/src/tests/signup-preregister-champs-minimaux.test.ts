/**
 * signup-preregister-champs-minimaux.test.ts
 *
 * L'inscription initiale ne demande plus que Prénom, Nom et E-mail
 * professionnel. Société, pays, adresse, ville et code postal ne sont plus
 * obligatoires côté serveur : l'adresse de facturation et la TVA sont
 * collectées plus tard par Stripe.
 *
 * Ce que ce fichier prouve sur POST /api/auth/pre-register :
 *   A  firstName + lastName + email valide seuls → 200 + preRegisterToken,
 *      et chacun des cinq anciens champs peut manquer isolément
 *   B  sans firstName, sans lastName, ou email invalide → 400, comme avant
 *   C  une requête qui porte encore les anciens champs est acceptée et leurs
 *      valeurs sont enregistrées telles quelles (compatibilité)
 *
 * Mock-only : pas de base, pas de Stripe, pas d'e-mail.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const EMAIL = "candidat@exemple.fr";

// ── Faux Postgres : juste ce que pre-register interroge ──────────────────────
// Les colonnes company_name / country / address / city / postal_code existent
// toujours ; on retient les paramètres de l'INSERT pour vérifier ce qui est
// réellement enregistré.
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
vi.mock("../services/org-data.js", () => ({ findOrgByStripeCustomer: vi.fn(async () => null), persistOrgData: vi.fn(async () => {}), loadOrgData: vi.fn(async () => ({})) }));

const { default: authRouter } = await import("../routes/auth.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: express.Request & { cookies?: Record<string, string> }, _res, next) => { req.cookies = {}; next(); });
  a.use("/api", authRouter);
  return a;
}

const preRegister = (body: Record<string, unknown>) =>
  request(app()).post("/api/auth/pre-register").send(body);

/** Le formulaire simplifié : prénom, nom, e-mail professionnel. Rien d'autre. */
const minimal = (extra: Record<string, unknown> = {}) => ({
  firstName: "Camille", lastName: "Dupont", email: EMAIL, ...extra,
});

/** Les sept champs retirés du formulaire, tels qu'un ancien client les envoie. */
const anciensChamps = {
  companyName: "Agence Nord", country: "FR", address: "12 rue des Lilas",
  city: "Lille", postalCode: "59000", phone: "+33612345678", vat: "FR12345678901",
};

// Positions des paramètres de l'INSERT INTO pending_signups (auth.ts) :
// $1 token, $2 email, $3 first_name, $4 last_name, $5 company_name, $6 country,
// $7 address, $8 city, $9 postal_code, $10 phone, $11 vat, $12 seller_id, $13 fp_lid.
const COL = { company: 4, country: 5, address: 6, city: 7, postal: 8, phone: 9, vat: 10 } as const;

beforeEach(() => {
  pending = []; preRegInserts = []; preRegUpdates = [];
  // Mode ouvert : l'allowlist ne doit pas transformer un 200 en jeton "blocked_".
  vi.stubEnv("ALLOWED_EMAILS", "");
  vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "");
});

describe("A — prénom, nom et e-mail suffisent", () => {
  it("200 et un preRegisterToken avec les trois seuls champs du formulaire", async () => {
    const r = await preRegister(minimal());
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(typeof r.body.preRegisterToken).toBe("string");
    expect(r.body.preRegisterToken.length).toBeGreaterThan(0);
    // Ni jeton honeypot ni jeton d'allowlist : la pré-inscription est bien stockée.
    expect(r.body.preRegisterToken.startsWith("hp_")).toBe(false);
    expect(r.body.preRegisterToken.startsWith("blocked_")).toBe(false);
    expect(preRegInserts).toHaveLength(1);
  });

  it("la ligne pending porte l'identité, les champs retirés restant vides", async () => {
    await preRegister(minimal());
    const row = preRegInserts[0]!;
    expect(row.slice(1, 4)).toEqual([EMAIL, "Camille", "Dupont"]);
    expect(row[COL.company]).toBe("");
    expect(row[COL.country]).toBe("");
    expect(row[COL.address]).toBe("");
    expect(row[COL.city]).toBe("");
    expect(row[COL.postal]).toBe("");
    expect(row[COL.phone]).toBeNull();
    expect(row[COL.vat]).toBeNull();
  });

  it.each([
    ["companyName", "Le nom de l'entreprise est requis."],
    ["country", "Le pays est requis."],
    ["address", "L'adresse est requise."],
    ["city", "La ville est requise."],
    ["postalCode", "Le code postal est requis."],
  ])("%s manquant n'est plus refusé (plus de « %s »)", async (champ) => {
    const reste = Object.fromEntries(
      Object.entries(anciensChamps).filter(([k]) => k !== champ),
    );
    const r = await preRegister(minimal(reste));
    expect(r.status).toBe(200);
    expect(r.body.preRegisterToken).toBeTruthy();
  });

  it("une chaîne vide pour ces champs est acceptée aussi", async () => {
    const r = await preRegister(minimal({
      companyName: "", country: "", address: "", city: "", postalCode: "",
    }));
    expect(r.status).toBe(200);
    expect(r.body.preRegisterToken).toBeTruthy();
  });
});

describe("B — l'identité reste obligatoire", () => {
  it("sans firstName → 400", async () => {
    const r = await preRegister({ lastName: "Dupont", email: EMAIL });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Le prénom est requis.");
    expect(preRegInserts).toHaveLength(0);
  });

  it("firstName vide ou en blancs → 400", async () => {
    const r = await preRegister(minimal({ firstName: "   " }));
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Le prénom est requis.");
  });

  it("sans lastName → 400", async () => {
    const r = await preRegister({ firstName: "Camille", email: EMAIL });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Le nom est requis.");
    expect(preRegInserts).toHaveLength(0);
  });

  it.each(["", "   ", "camille", "camille@", "@exemple.fr", "camille@exemple", "camille exemple.fr"])(
    "e-mail invalide (%s) → 400", async (email) => {
      const r = await preRegister(minimal({ email }));
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("Adresse email invalide ou manquante.");
      expect(preRegInserts).toHaveLength(0);
    });

  it("sans email du tout → 400", async () => {
    const r = await preRegister({ firstName: "Camille", lastName: "Dupont" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("Adresse email invalide ou manquante.");
  });

  it("e-mail jetable → 400 (garde inchangée)", async () => {
    const r = await preRegister(minimal({ email: "camille@yopmail.com" }));
    expect(r.status).toBe(400);
    expect(preRegInserts).toHaveLength(0);
  });
});

describe("C — compatibilité : les anciens champs sont encore acceptés et conservés", () => {
  it("un corps complet passe et chaque valeur est enregistrée", async () => {
    const r = await preRegister(minimal(anciensChamps));
    expect(r.status).toBe(200);
    expect(r.body.preRegisterToken).toBeTruthy();
    const row = preRegInserts[0]!;
    expect(row.slice(1, 4)).toEqual([EMAIL, "Camille", "Dupont"]);
    expect(row[COL.company]).toBe(anciensChamps.companyName);
    expect(row[COL.country]).toBe(anciensChamps.country);
    expect(row[COL.address]).toBe(anciensChamps.address);
    expect(row[COL.city]).toBe(anciensChamps.city);
    expect(row[COL.postal]).toBe(anciensChamps.postalCode);
    expect(row[COL.phone]).toBe(anciensChamps.phone);
    expect(row[COL.vat]).toBe(anciensChamps.vat);
  });

  it("un renvoi réutilise le jeton et met à jour les mêmes colonnes", async () => {
    const first = await preRegister(minimal());
    const second = await preRegister(minimal(anciensChamps));
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.preRegisterToken).toBe(first.body.preRegisterToken);
    expect(preRegInserts).toHaveLength(1);
    expect(preRegUpdates).toHaveLength(1);
    // $1 first_name … $9 vat dans l'UPDATE : décalage de 2 par rapport à l'INSERT.
    const up = preRegUpdates[0]!;
    expect(up.slice(0, 9)).toEqual([
      "Camille", "Dupont", anciensChamps.companyName, anciensChamps.country,
      anciensChamps.address, anciensChamps.city, anciensChamps.postalCode,
      anciensChamps.phone, anciensChamps.vat,
    ]);
  });
});
