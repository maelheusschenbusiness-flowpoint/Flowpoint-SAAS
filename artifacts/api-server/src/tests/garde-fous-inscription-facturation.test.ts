/**
 * garde-fous-inscription-facturation.test.ts
 *
 * Certification par la route des garde-fous de facturation a l'inscription,
 * parcours classique (POST /api/auth/pre-register) et parcours Google
 * (GET /api/auth/google/callback). Ne couvre que ce qui manquait :
 *  G1 classique — le refus 409 d'un compte deja existant n'etait verifie que
 *    par lecture du source (tests/conversion-a-funnel-guards.test.ts, « still
 *    refuses an account that really exists ») ; il l'est ici surface par
 *    surface, avec la preuve qu'aucune ligne pending_signups n'est ouverte.
 *  G1 Google — la branche « organisation deja activee » du callback (auth.ts,
 *    _googleIsActivated) n'etait couverte par aucun test :
 *    routes/google-signup-account-guard.test.ts ne renvoie jamais
 *    d'organisation detenue.
 *  G6 — une inscription abandonnee avant Stripe ne cree ni organisation, ni
 *    souscription, ni session, sur les deux parcours (verifie par les ecritures
 *    SQL emises ; tests/checkout-abandon-guards.test.ts CA-9 ne le verifiait
 *    que par lecture du source).
 * Tout est simule : ni base, ni reseau, ni Stripe, ni connexion Google reelle.
 */
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  loadOrgSettings: vi.fn(),
  upsertOrgSettings: vi.fn(),
  fetchBorne: vi.fn(),
  createSession: vi.fn(),
  createStripeClient: vi.fn(),
  getStripeKey: vi.fn(() => ""),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock("@workspace/db", () => ({ pool: { query: mocks.poolQuery, connect: mocks.poolConnect } }));
vi.mock("resend", () => ({ Resend: class { emails = { send: vi.fn() }; } }));
vi.mock("nodemailer", () => ({ createTransport: vi.fn(() => ({ sendMail: vi.fn() })) }));
vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings: mocks.loadOrgSettings,
  upsertOrgSettings: mocks.upsertOrgSettings,
}));
vi.mock("../lib/logger.js", () => ({ logger: mocks.logger }));
vi.mock("../lib/fetch-borne.js", () => ({ fetchBorne: mocks.fetchBorne, DELAIS: { identite: 1000 } }));
vi.mock("../services/mailer.js", () => ({ captureTestMail: vi.fn() }));
vi.mock("../services/store.js", () => ({ store: {} }));
vi.mock("../services/funnel-events.js", () => ({ enregistrerEtape: vi.fn(), normaliserAttributionFunnel: vi.fn(() => null) }));
vi.mock("../services/sessions.js", () => ({
  createSession: mocks.createSession,
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  invalidateAllSessions: vi.fn(),
  SESSION_TTL_MS: 60_000,
}));
vi.mock("../middlewares/rateLimiter.js", () => ({ authRateLimit: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../middlewares/requireAuth.js", () => ({ requireAuth: (_q: unknown, _s: unknown, n: () => void) => n() }));
vi.mock("../services/stripe-factory.js", () => ({
  createStripeClient: mocks.createStripeClient,
  getStripeKey: mocks.getStripeKey,
}));
vi.mock("../lib/conversion-events.js", () => ({ stableEventId: vi.fn(() => "evt") }));
vi.mock("../lib/conversion-outbox.js", () => ({ queueConversionEvent: vi.fn() }));

const { default: authRouter } = await import("../routes/auth.js");
const { _resetConsumedOAuthStates } = await import("../services/oauth-state.js");

const EMAIL = "camille.durand@exemple.fr";
const ORG_ACTIVE = "11111111-1111-4111-8111-111111111111";
const USER_UUID = "33333333-3333-4333-8333-333333333333";

/** Etat de la base pour la requete en cours. */
type Etat = {
  /** Ligne `users` de cet e-mail (status 'active' | 'pending' | 'suspended'). */
  utilisateur?: { id: string; status: string } | null;
  /** Ligne `organization_members` active rattachee a cet e-mail. */
  membreActif?: boolean;
  /** Organisation detenue par cet e-mail (`organizations.owner_email`). */
  orgDetenue?: { id: string; subscription_status: string | null } | null;
};

let etat: Etat;
/** Tout le SQL emis par la requete (pool et client), normalise sur une ligne. */
let journal: string[];

function repondre(sql: string, _params: unknown[] = []) {
  const s = String(sql).replace(/\s+/g, " ").trim();
  journal.push(s);
  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return { rows: [], rowCount: 0 };
  if (/^INSERT INTO pending_signups/i.test(s)) {
    return { rows: [{ created_at: new Date("2026-01-01T00:00:00.000Z"), fp_lid: null }], rowCount: 1 };
  }
  if (/pending_signups/i.test(s)) return { rows: [], rowCount: 0 };
  if (/FROM organizations/i.test(s)) {
    return { rows: etat.orgDetenue ? [etat.orgDetenue] : [], rowCount: etat.orgDetenue ? 1 : 0 };
  }
  if (/FROM organization_members/i.test(s)) {
    // `SELECT 1 FROM organization_members` : appartenance deja enregistree de
    // l'organisation detenue. `SELECT om.id ... JOIN users` : garde pre-register.
    const present = /SELECT 1 FROM organization_members/i.test(s) ? !!etat.orgDetenue : !!etat.membreActif;
    return { rows: present ? [{ id: "om-1" }] : [], rowCount: present ? 1 : 0 };
  }
  if (/FROM users/i.test(s)) {
    return { rows: etat.utilisateur ? [etat.utilisateur] : [], rowCount: etat.utilisateur ? 1 : 0 };
  }
  if (/FROM team_members/i.test(s)) return { rows: [], rowCount: 0 };
  return { rows: [], rowCount: 0 };
}

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use("/api", authRouter);
  return a;
}

const ECRITURES_COMPTE = /^(INSERT INTO|UPDATE) (users|organizations|organization_members)\b/i;

/** Les ecritures de compte ou de facturation emises par la requete. */
function ecrituresCompte(): string[] {
  return journal.filter((s) => ECRITURES_COMPTE.test(s));
}

beforeEach(() => {
  _resetConsumedOAuthStates();
  vi.clearAllMocks();
  mocks.getStripeKey.mockReturnValue("");
  etat = {};
  journal = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => repondre(sql, params)),
    release: vi.fn(),
  };
  mocks.poolQuery.mockImplementation(async (sql: string, params: unknown[] = []) => repondre(sql, params));
  mocks.poolConnect.mockResolvedValue(client);
  mocks.loadOrgSettings.mockResolvedValue(null);
  mocks.createSession.mockResolvedValue("jeton-de-session");
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("ALLOWED_EMAILS", "");
  vi.stubEnv("ALLOWED_EMAIL_DOMAIN", "");
  vi.stubEnv("GOOGLE_CLIENT_ID", "gid");
  vi.stubEnv("GOOGLE_CLIENT_SECRET", "gsecret");
  vi.stubEnv("PUBLIC_BASE_URL", "https://app.example.test");
});
afterEach(() => vi.unstubAllEnvs());

const formulaireMinimal = { firstName: "Camille", lastName: "Durand", email: EMAIL };

function preRegister() {
  return request(app()).post("/api/auth/pre-register").send(formulaireMinimal);
}

/* ── G1 / G6 — parcours classique : POST /api/auth/pre-register ────────── */

describe("G1 classique — une seule organisation et une seule souscription par e-mail", () => {
  it("compte utilisateur actif : 409 vers /login.html, aucune inscription ouverte", async () => {
    etat = { utilisateur: { id: USER_UUID, status: "active" } };
    const r = await preRegister();
    expect(r.status).toBe(409);
    expect(r.body.redirectTo).toBe("/login.html");
    expect(r.body.preRegisterToken).toBeUndefined();
    expect(journal.some((s) => /pending_signups/i.test(s))).toBe(false);
    expect(ecrituresCompte()).toEqual([]);
  });

  it("compte suspendu : 409, aucune inscription ouverte", async () => {
    etat = { utilisateur: { id: USER_UUID, status: "suspended" } };
    const r = await preRegister();
    expect(r.status).toBe(409);
    expect(journal.some((s) => /pending_signups/i.test(s))).toBe(false);
  });

  it("membre d'equipe actif : 409, aucune inscription ouverte", async () => {
    etat = { utilisateur: null, membreActif: true };
    const r = await preRegister();
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already linked to a FlowPoint organization/i);
    expect(journal.some((s) => /pending_signups/i.test(s))).toBe(false);
  });

  it("organisation deja detenue par cet e-mail : 409, aucune seconde inscription", async () => {
    etat = { orgDetenue: { id: ORG_ACTIVE, subscription_status: "active" } };
    const r = await preRegister();
    expect(r.status).toBe(409);
    expect(r.body.redirectTo).toBe("/login.html");
    expect(journal.some((s) => /pending_signups/i.test(s))).toBe(false);
  });

  it("etat de facturation legacy deja active (client Stripe ancre) : 409", async () => {
    mocks.loadOrgSettings.mockResolvedValue({
      orgId: EMAIL, email: EMAIL, plan: "pro",
      subscriptionStatus: "canceled", stripeCustomerId: "cus_deja_client",
    });
    const r = await preRegister();
    expect(r.status).toBe(409);
    expect(r.body.error).toMatch(/already exists/i);
    expect(journal.some((s) => /pending_signups/i.test(s))).toBe(false);
  });

  it("une inscription reprise (users.status='pending') reste autorisee", async () => {
    etat = { utilisateur: { id: USER_UUID, status: "pending" } };
    const r = await preRegister();
    expect(r.status).toBe(200);
    expect(typeof r.body.preRegisterToken).toBe("string");
    expect(journal.some((s) => /^INSERT INTO pending_signups/i.test(s))).toBe(true);
  });

  it("une verification de compte indisponible refuse en 503 — jamais une seconde inscription", async () => {
    mocks.poolQuery.mockRejectedValue(new Error("base indisponible (simule)"));
    const r = await preRegister();
    expect(r.status).toBe(503);
    expect(journal.some((s) => /pending_signups/i.test(s))).toBe(false);
  });
});

describe("G6 classique — inscription abandonnee avant Stripe", () => {
  it("n'ecrit que pending_signups : ni utilisateur, ni organisation, ni souscription, ni client Stripe", async () => {
    const r = await preRegister();
    expect(r.status).toBe(200);
    expect(typeof r.body.preRegisterToken).toBe("string");

    const inserts = journal.filter((s) => /^INSERT/i.test(s));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/^INSERT INTO pending_signups/i);
    expect(ecrituresCompte()).toEqual([]);
    expect(journal.some((s) => /subscription/i.test(s))).toBe(false);
    // Aucun client Stripe n'est cree a cette etape (le Customer nait apres paiement).
    expect(mocks.createStripeClient).not.toHaveBeenCalled();
    // Aucune session de tableau de bord avant Stripe.
    expect(mocks.createSession).not.toHaveBeenCalled();
    // L'etat de facturation n'est jamais ecrit par l'inscription publique.
    expect(mocks.upsertOrgSettings).not.toHaveBeenCalled();
  });
});

/* ── G1 / G6 — parcours Google : GET /api/auth/google/callback ─────────── */

const utilisateurGoogle = {
  sub: "1", email: "Camille.Durand@exemple.fr", email_verified: true,
  given_name: "Camille", family_name: "Durand",
};

async function callbackGoogle(plan = "pro") {
  mocks.fetchBorne.mockImplementation(async (url: string) => {
    if (String(url).includes("oauth2.googleapis.com/token")) {
      return { ok: true, json: async () => ({ access_token: "tok" }) } as unknown as Response;
    }
    if (String(url).includes("userinfo")) {
      return { ok: true, json: async () => utilisateurGoogle } as unknown as Response;
    }
    throw new Error("appel reseau inattendu: " + url);
  });
  const login = await request(app()).get(`/api/auth/google/login?plan=${plan}`);
  const state = new URL(login.headers["location"] as string).searchParams.get("state")!;
  const cookie = ([] as string[])
    .concat(login.headers["set-cookie"] ?? [])
    .find((c) => c.startsWith("fp_oauth_google="))!
    .split(";")[0]!;
  journal = [];
  return request(app())
    .get(`/api/auth/google/callback?code=c&state=${encodeURIComponent(state)}`)
    .set("Cookie", cookie);
}

describe("G1 Google — un e-mail deja abonne ne recoit pas une seconde organisation", () => {
  it("organisation deja activee : session sur la MEME organisation, aucune inscription, facturation intacte", async () => {
    etat = { utilisateur: { id: USER_UUID, status: "active" }, orgDetenue: { id: ORG_ACTIVE, subscription_status: "active" } };
    const r = await callbackGoogle();

    expect(r.headers["location"]).toContain("/dashboard.html?provider=google");
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({
      orgId: ORG_ACTIVE, email: "camille.durand@exemple.fr",
    }));
    // Aucune seconde organisation, aucune inscription ouverte.
    expect(journal.some((s) => /^INSERT INTO organizations/i.test(s))).toBe(false);
    expect(journal.some((s) => /pending_signups/i.test(s))).toBe(false);
    // L'etat de facturation de l'organisation existante n'est pas touche, et la
    // branche pending_billing n'est pas empruntee du tout.
    expect(mocks.upsertOrgSettings).not.toHaveBeenCalled();
    expect(mocks.loadOrgSettings).not.toHaveBeenCalled();
  });

  it("essai en cours (trialing) : meme organisation reutilisee, aucune nouvelle inscription", async () => {
    etat = { utilisateur: { id: USER_UUID, status: "active" }, orgDetenue: { id: ORG_ACTIVE, subscription_status: "trialing" } };
    const r = await callbackGoogle("ultra");

    expect(r.headers["location"]).toContain("/dashboard.html");
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ orgId: ORG_ACTIVE }));
    expect(journal.some((s) => /pending_signups/i.test(s))).toBe(false);
    expect(journal.some((s) => /^INSERT INTO organizations/i.test(s))).toBe(false);
  });
});

describe("G6 Google — inscription Google abandonnee avant Stripe", () => {
  it("pending_signups seul : ni organisation, ni souscription, ni session de tableau de bord", async () => {
    etat = { utilisateur: null, orgDetenue: null };
    mocks.loadOrgSettings
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ orgId: EMAIL, email: EMAIL, plan: "pro", subscriptionStatus: "pending_billing" });

    const r = await callbackGoogle();

    expect(r.headers["location"]).toContain("/signin.html?google_signup=1");
    // L'inscription s'arrete avant Stripe : aucune session n'est emise.
    expect(mocks.createSession).not.toHaveBeenCalled();
    // Seule ecriture : la ligne temporaire d'inscription.
    const inserts = journal.filter((s) => /^INSERT/i.test(s));
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatch(/^INSERT INTO pending_signups/i);
    expect(journal.some((s) => /^INSERT INTO organizations/i.test(s))).toBe(false);
    // L'organisation n'est annoncee qu'en attente de facturation : jamais un
    // statut premium, jamais une souscription.
    const etatsEcrits = mocks.upsertOrgSettings.mock.calls.map((c) => (c[1] as { subscriptionStatus?: string }).subscriptionStatus);
    expect(etatsEcrits).toEqual(["pending_billing"]);
    for (const appel of mocks.upsertOrgSettings.mock.calls) {
      expect(appel[1]).not.toHaveProperty("stripeSubscriptionId");
    }
  });
});
