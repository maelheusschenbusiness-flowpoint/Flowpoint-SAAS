/**
 * Inscription courte (#466) — certification de /api/auth/pre-register sur une
 * base PostgreSQL REELLE (celle de la CI, migree depuis zero).
 *
 * Aucun appel reseau : Stripe, le mailer et la file de conversion sont simules.
 * La file de conversion est remplacee par un espion : on verifie ce qui SERAIT
 * transmis au moteur, sans rien transmettre.
 *
 *  A  quatre champs (prenom, nom, email, pays) suffisent ; entreprise par defaut
 *  B  chacun des quatre champs reste obligatoire, rien n'est ecrit sinon
 *  C  non-regression : le formulaire complet est stocke a l'identique
 *  D  gardes inchangees : email jetable, compte existant, pot de miel
 *  E  evenement de conversion `signup` : seulement avec un fp_lid valide
 *  F  inscription Google (reponses Google simulees) : ni entreprise ni adresse fournies
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../middlewares/rateLimiter.js", () => ({
  createRateLimit: () => (_q: unknown, _r: unknown, n: () => void) => n(),
  authRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  publicCheckoutRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  globalRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
}));
vi.mock("../services/stripe-factory.js", () => ({ getStripeKey: vi.fn(() => undefined), createStripeClient: vi.fn(async () => null) }));
vi.mock("../services/mailer.js", () => ({ mailer: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }) }));
vi.mock("../services/seller-attribution.js", () => ({
  validateSellerCode: vi.fn(async () => null), resolveSellerIdFromToken: vi.fn(async () => null), recordCommission: vi.fn(async () => {}),
}));
const queued: Record<string, unknown>[] = [];
vi.mock("../lib/conversion-outbox.js", () => ({
  queueConversionEvent: vi.fn(async (e: Record<string, unknown>) => { queued.push(e); return "queued"; }),
}));

import express from "express";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import request from "supertest";
import { pool } from "@workspace/db";

const { default: authRouter } = await import("../routes/auth.js");

const DOMAIN = "signup-short-flow.test";
const FP_LID = "ShortFlowTest_00000466";
let dbOk = false;
let n = 0;

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.cookies = {}; next(); });
  a.use("/api", authRouter);
  return a;
}
const email = () => `inscription${++n}-${Date.now()}@${DOMAIN}`;
const short = (extra: Record<string, unknown> = {}) => ({
  firstName: "Camille", lastName: "Martin", email: email(), country: "BE", ...extra,
});
async function rows(addr: string) {
  const r = await pool.query(
    `SELECT first_name, last_name, company_name, country, address, city, postal_code, phone, vat, fp_lid, expires_at > now() AS live
       FROM pending_signups WHERE email = $1`, [addr]);
  return r.rows;
}

beforeAll(async () => {
  // Comme au demarrage du serveur : la migration du depot ne cree pas `users`
  // ni les tables de donnees ; le service les cree a l'amorcage (idempotent).
  try {
    await pool.query("SELECT 1");
    const { initPhase1Users } = await import("../services/init-phase1-users.js");
    const { initDataTables } = await import("../services/init-data-tables.js");
    await initPhase1Users();
    await initDataTables();
    await pool.query("SELECT 1 FROM pending_signups, users LIMIT 1");
    dbOk = true;
  } catch { dbOk = false; }
  delete process.env["ALLOWED_EMAILS"];
  delete process.env["ALLOWED_EMAIL_DOMAIN"];
}, 180_000);
beforeEach(() => { queued.length = 0; });
afterAll(async () => {
  if (!dbOk) return;
  await pool.query(`DELETE FROM pending_signups WHERE email LIKE $1`, [`%@${DOMAIN}`]).catch(() => undefined);
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%@${DOMAIN}`]).catch(() => undefined);
});

describe("A — quatre champs suffisent", () => {
  it("prenom, nom, email et pays : jeton, ligne en base, entreprise par defaut", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const body = short();
    const r = await request(app()).post("/api/auth/pre-register").send(body);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(String(r.body.preRegisterToken)).not.toMatch(/^(hp_|blocked_)/);
    const [row] = await rows(body.email);
    expect(row).toMatchObject({
      first_name: "Camille", last_name: "Martin", company_name: "Camille Martin", country: "BE",
      address: null, city: null, postal_code: null, phone: null, vat: null, fp_lid: null, live: true,
    });
  });

  it("champs de facturation vides ou blancs : NULL, jamais une chaine vide", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const body = short({ companyName: "  ", address: " ", city: "", postalCode: "  ", phone: " ", vat: "" });
    expect((await request(app()).post("/api/auth/pre-register").send(body)).status).toBe(200);
    const [row] = await rows(body.email);
    expect(row).toMatchObject({ company_name: "Camille Martin", address: null, city: null, postal_code: null, phone: null, vat: null });
  });
});

describe("B — chacun des quatre champs reste obligatoire", () => {
  for (const [field, message] of [
    ["firstName", /prénom/], ["lastName", /nom/], ["country", /pays/], ["email", /email/i],
  ] as const) it(`${field} absent : 400, rien n'est ecrit`, async (ctx) => {
    if (!dbOk) return ctx.skip();
    const body: Record<string, unknown> = short();
    const addr = String(body["email"]);
    body[field] = "   ";
    const r = await request(app()).post("/api/auth/pre-register").send(body);
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(message);
    expect(await rows(addr)).toHaveLength(0);
    expect(queued).toHaveLength(0);
  });

  it("email mal forme : 400", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await request(app()).post("/api/auth/pre-register").send(short({ email: "pas-un-email" }));
    expect(r.status).toBe(400);
  });
});

describe("C — non-regression : le formulaire complet est stocke a l'identique", () => {
  it("entreprise, adresse, telephone et TVA fournis : conserves tels quels", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const body = short({
      companyName: "Atelier Martin", address: "1 rue de la Loi", city: "Bruxelles",
      postalCode: "1000", phone: "+32 2 000 00 00", vat: "BE0123456789",
    });
    expect((await request(app()).post("/api/auth/pre-register").send(body)).status).toBe(200);
    const [row] = await rows(body.email);
    expect(row).toMatchObject({
      company_name: "Atelier Martin", address: "1 rue de la Loi", city: "Bruxelles",
      postal_code: "1000", phone: "+32 2 000 00 00", vat: "BE0123456789",
    });
  });

  it("nouvel essai avec le meme email : une seule ligne en attente, la derniere", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const body = short();
    await request(app()).post("/api/auth/pre-register").send(body);
    await request(app()).post("/api/auth/pre-register").send({ ...body, companyName: "Seconde" });
    const all = await rows(body.email);
    expect(all).toHaveLength(1);
    expect(all[0].company_name).toBe("Seconde");
  });
});

describe("D — gardes inchangees", () => {
  it("email jetable : 400, rien n'est ecrit", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const r = await request(app()).post("/api/auth/pre-register").send(short({ email: "x@mailinator.com" }));
    expect(r.status).toBe(400);
    expect(await rows("x@mailinator.com")).toHaveLength(0);
  });

  it("compte deja actif : 409 vers la connexion", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const addr = email();
    await pool.query(`INSERT INTO users (email, first_name, status) VALUES ($1, 'Existant', 'active')`, [addr]);
    const r = await request(app()).post("/api/auth/pre-register").send(short({ email: addr }));
    expect(r.status).toBe(409);
    expect(r.body.redirectTo).toBe("/login.html");
    expect(await rows(addr)).toHaveLength(0);
  });

  it("pot de miel rempli : faux succes, rien n'est ecrit", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const body = short({ _hp: "bot" });
    const r = await request(app()).post("/api/auth/pre-register").send(body);
    expect(r.status).toBe(200);
    expect(String(r.body.preRegisterToken)).toMatch(/^hp_/);
    expect(await rows(body.email)).toHaveLength(0);
  });
});

describe("E — evenement de conversion `signup` (file simulee, aucune transmission)", () => {
  it("fp_lid valide : stocke et un seul evenement signup/saas en file", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const body = short({ fp_lid: FP_LID });
    expect((await request(app()).post("/api/auth/pre-register").send(body)).status).toBe(200);
    expect((await rows(body.email))[0].fp_lid).toBe(FP_LID);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ stage: "signup", source: "saas", fpLid: FP_LID });
  });

  it("fp_lid absent ou invalide : inscription acceptee, aucun evenement", async (ctx) => {
    if (!dbOk) return ctx.skip();
    for (const extra of [{}, { fp_lid: "pas-un-jeton" }]) {
      const body = short(extra);
      expect((await request(app()).post("/api/auth/pre-register").send(body)).status).toBe(200);
      expect((await rows(body.email))[0].fp_lid).toBeNull();
    }
    expect(queued).toHaveLength(0);
  });
});

describe("F — inscription Google, reponses Google simulees (aucun appel reseau)", () => {
  const state = (extra: Record<string, unknown> = {}) =>
    Buffer.from(JSON.stringify({ ts: Date.now(), plan: "pro", fp_lid: FP_LID, ...extra })).toString("base64");
  function googleReturns(profile: Record<string, unknown>) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      if (String(url).startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "simule" }), { status: 200 });
      }
      if (String(url).startsWith("https://www.googleapis.com/oauth2/v3/userinfo")) {
        return new Response(JSON.stringify(profile), { status: 200 });
      }
      throw new Error("appel reseau inattendu : " + url);
    }));
  }
  afterAll(() => vi.unstubAllGlobals());

  it("nouveau compte Google : vers le choix du plan, entreprise = nom, adresse NULL, fp_lid garde", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const addr = email();
    googleReturns({ sub: "g-1", email: addr, email_verified: true, given_name: "Camille", family_name: "Martin" });
    const r = await request(app()).get(`/api/auth/google/callback?code=simule&state=${state()}`);
    expect(r.status).toBe(302);
    expect(r.headers["location"]).toMatch(/signin\.html\?google_signup=1&plan=pro&/);
    expect(r.headers["location"]).toMatch(/pre_reg_token=[^&]+/);
    const [row] = await rows(addr);
    expect(row).toMatchObject({
      company_name: "Camille Martin", country: "FR", address: null, city: null, postal_code: null, fp_lid: FP_LID,
    });
  });

  it("profil Google sans nom : l'entreprise prend l'email, jamais une chaine vide", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const addr = email();
    googleReturns({ sub: "g-2", email: addr, email_verified: true });
    const r = await request(app()).get(`/api/auth/google/callback?code=simule&state=${state({ fp_lid: null })}`);
    expect(r.status).toBe(302);
    const [row] = await rows(addr);
    expect(row.company_name).toBe(addr);
    expect(row.fp_lid).toBeNull();
  });
});

describe("G — page d'inscription : exactement quatre champs obligatoires", () => {
  const html = readFileSync(resolve(__dirname, "../../../flowpoint-export/signin.html"), "utf8");
  const form = html.slice(html.indexOf('id="signup-form"'), html.indexOf("</form>", html.indexOf('id="signup-form"')));
  const required = [...form.matchAll(/<(?:input|select)\b[^>]*\bid="([^"]+)"[^>]*>/g)]
    .filter((m) => /\brequired\b/.test(m[0])).map((m) => m[1]).sort();
  it("prenom, nom, email et pays ; facturation facultative", () => {
    expect(required).toEqual(["country", "email", "firstName", "lastName"]);
    for (const id of ["companyName", "address", "city", "postalCode", "phone", "vat"]) {
      expect(form).toContain(`id="${id}"`);
    }
  });
});

describe("H — adresse de facturation collectee au paiement (factures conformes)", () => {
  const page = readFileSync(resolve(__dirname, "../../../flowpoint-export/checkout-payment.html"), "utf8");
  const billing = readFileSync(resolve(__dirname, "../routes/public-billing.ts"), "utf8");
  it("Address Element en mode billing, monte avant le Payment Element, dans le meme groupe", () => {
    const address = page.indexOf("elements.create('address'");
    const payment = page.indexOf("elements.create('payment'");
    expect(address).toBeGreaterThan(0);
    expect(address).toBeLessThan(payment);
    expect(page.slice(address, payment)).toMatch(/mode:\s*'billing'/);
    expect(page).toContain('id="fp-address-element"');
  });
  it("finalize-checkout recopie l'adresse du moyen de paiement (ligne 1 + pays) sur le client", () => {
    expect(billing).toMatch(/_fcHasPmAddr\s*=\s*!!\(_fcPmAddr\?\.line1 && _fcPmAddr\?\.country\)/);
    expect(billing).toMatch(/\.\.\.\(_fcHasPmAddr\s*\?\s*\{\s*address:/);
  });
});
