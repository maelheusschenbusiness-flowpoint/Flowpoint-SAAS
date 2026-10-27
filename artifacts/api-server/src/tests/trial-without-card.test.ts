/**
 * trial-without-card.test.ts — essai gratuit 14 jours SANS carte, derriere
 * TRIAL_WITHOUT_CARD (eteint par defaut).
 *
 *  A  drapeau : absent / "false" / "1" → eteint ; seul "true" l'allume
 *  B  helpers purs : adresse canonique (+etiquette, points Gmail), domaine du
 *     garde (messageries grand public exclues), report du trial_end Checkout
 *  C  machine d'etats : essai sans carte = `trialing` + acces premium pendant
 *     l'essai, `none` sans acces a l'echeance, jamais un second essai
 *  D  route drapeau eteint : 404, AUCUNE ecriture ; pre-register inchange
 *  E  route drapeau allume : honeypot, email jetable, prenom requis,
 *     compte existant, un essai par adresse canonique et par domaine
 *  F  activation : org `trialing` plan standard, trial_consumed_at pose,
 *     aucun objet Stripe ; fp_lid propage (premiere attribution gagne) ;
 *     jalons AI Lab signup + trial ; lien magique « sans carte »
 *  G  contrats source : providers expose le drapeau, signin.html ne bascule
 *     que sur trialWithoutCard === true, /billing/upgrade reporte l'essai
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VALID = "AbCdEfGhIjKlMnOpQr_-12";
const OTHER = "ZzYyXxWwVvUuTtSsRr0123";

// ── Fausse base Postgres ────────────────────────────────────────────────────
type Org = { id: string; owner_email: string; plan: string; subscription_status: string;
             stripe_customer_id: string | null; stripe_subscription_id: string | null;
             trial_consumed: boolean; fp_lid: string | null; seller_id: string | null };
let users: Map<string, { id: string; status: string }>;
let orgs: Org[];
let pending: { token: string; email: string; fp_lid: string | null; consumed: boolean; stripe_customer_id: string | null }[];
let members: unknown[][];
let magicTokens: string[];
let writes: string[];
let locks: string[];

function canonLocal(email: string): { local: string; domain: string } {
  const [l, d] = email.toLowerCase().split("@");
  let local = l!.replace(/\+.*$/, "");
  if (d === "gmail.com" || d === "googlemail.com") local = local.replace(/\./g, "");
  return { local, domain: d! };
}

function answer(sql: string, v: unknown[] = []) {
  const s = sql.replace(/\s+/g, " ").trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return { rows: [], rowCount: 0 };
  if (/pg_advisory_xact_lock/i.test(s)) { locks.push(String(v[0])); return { rows: [], rowCount: 1 }; }
  if (/^SELECT status FROM users WHERE lower\(email\)/i.test(s)) {
    const u = users.get(String(v[0])); return { rows: u ? [{ status: u.status }] : [], rowCount: u ? 1 : 0 };
  }
  if (/FROM organization_members om JOIN users/i.test(s)) return { rows: [], rowCount: 0 };
  if (/^SELECT id FROM organizations WHERE lower\(owner_email\) = \$1/i.test(s)) {
    const o = orgs.find(x => x.owner_email === v[0]); return { rows: o ? [{ id: o.id }] : [], rowCount: o ? 1 : 0 };
  }
  if (/FROM organizations WHERE lower\(split_part\(owner_email, '@', 2\)\) = ANY/i.test(s)) {
    const [local, domains] = [String(v[0]), v[1] as string[]];
    const hit = orgs.find(o => { const c = canonLocal(o.owner_email); return domains.includes(c.domain) && c.local === local; });
    return { rows: hit ? [{ "?column?": 1 }] : [], rowCount: hit ? 1 : 0 };
  }
  if (/FROM organizations WHERE lower\(split_part\(owner_email, '@', 2\)\) = \$1/i.test(s)) {
    const hit = orgs.find(o => o.owner_email.split("@")[1] === v[0]);
    return { rows: hit ? [{ "?column?": 1 }] : [], rowCount: hit ? 1 : 0 };
  }
  if (/^DELETE FROM pending_signups WHERE lower\(email\)/i.test(s)) {
    writes.push("delete_pending");
    const gone = pending.filter(p => p.email === String(v[0]).toLowerCase() && !p.consumed);
    pending = pending.filter(p => !gone.includes(p));
    return { rows: gone.map(p => ({ stripe_customer_id: p.stripe_customer_id, fp_lid: p.fp_lid })), rowCount: gone.length };
  }
  if (/^INSERT INTO pending_signups/i.test(s)) {
    writes.push("insert_pending");
    const consumed = /consumed_at\)/.test(s);
    pending.push({ token: String(v[0]), email: String(v[1]), fp_lid: (v[5] as string) ?? null, consumed, stripe_customer_id: null });
    return { rows: [{ created_at: new Date("2026-10-27T10:00:00Z"), fp_lid: (v[5] as string) ?? null }], rowCount: 1 };
  }
  if (/^INSERT INTO users/i.test(s)) {
    writes.push("insert_user");
    const email = String(v[1]); const u = users.get(email);
    if (u && u.status !== "pending") return { rows: [], rowCount: 0 }; // ON CONFLICT ... WHERE status='pending'
    const id = u?.id ?? String(v[0]); users.set(email, { id, status: "active" });
    return { rows: [{ id }], rowCount: 1 };
  }
  if (/^INSERT INTO organizations/i.test(s)) {
    writes.push("insert_org");
    orgs.push({ id: String(v[0]), owner_email: String(v[5]), plan: String(v[4]),
                subscription_status: /'trialing'/.test(s) ? "trialing" : "?",
                stripe_customer_id: /NULL, NULL, NOW\(\), NOW\(\)/.test(s) ? null : "?", stripe_subscription_id: null,
                trial_consumed: /trial_consumed_at/.test(s), seller_id: (v[8] as string) ?? null, fp_lid: (v[9] as string) ?? null });
    return { rows: [{ trial_ends_at: new Date("2026-11-10T10:00:00Z"), trial_started_at: new Date("2026-10-27T10:00:00Z") }], rowCount: 1 };
  }
  if (/^INSERT INTO organization_members/i.test(s)) { writes.push("insert_member"); members.push(v); return { rows: [], rowCount: 1 }; }
  if (/^INSERT INTO magic_link_tokens/i.test(s)) { writes.push("insert_magic"); magicTokens.push(String(v[0])); return { rows: [], rowCount: 1 }; }
  if (/FROM org_addons/i.test(s)) return { rows: [], rowCount: 0 };
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
  trialSignupRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  publicCheckoutRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  globalRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
}));
const upsertOrgSettings = vi.fn(async () => ({}));
vi.mock("../services/org-settings.js", () => ({ loadOrgSettings: vi.fn(async () => null), upsertOrgSettings }));
vi.mock("../services/seller-attribution.js", () => ({
  validateSellerCode: vi.fn(async (c: string) => (c === "SELLER-OK" ? { id: "seller-1" } : null)),
  resolveSellerIdFromToken: vi.fn(async () => null), recordCommission: vi.fn(async () => {}),
}));
const createStripeClient = vi.fn(async () => ({ customers: { del: vi.fn(async () => ({})) } }));
vi.mock("../services/stripe-factory.js", () => ({ getStripeKey: vi.fn(() => "sk_test_x"), createStripeClient }));
const sendActivationMagicLink = vi.fn(async (_o: Record<string, unknown>) => ({ ok: true, id: "em_1" }));
vi.mock("../services/mailer.js", () => ({ mailer: new Proxy({ sendActivationMagicLink }, {
  get: (t, k) => (k in t ? (t as Record<string | symbol, unknown>)[k] : vi.fn(async () => ({ ok: true }))) }) }));
vi.mock("../services/store.js", () => ({ store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn() } }));
const queueConversionEvent = vi.fn(async (_e: Record<string, unknown>) => "sent");
vi.mock("../lib/conversion-outbox.js", () => ({ queueConversionEvent }));
const enregistrerEtape = vi.fn(async () => true);
vi.mock("../services/funnel-events.js", () => ({
  enregistrerEtape, normaliserAttributionFunnel: vi.fn(() => ({ visiteurId: "fp-a-b", source: "smartlead" })),
}));
const loadOrgData = vi.fn();
vi.mock("../services/org-data.js", () => ({ loadOrgData, persistOrgData: vi.fn(async () => {}), findOrgByStripeCustomer: vi.fn(async () => null) }));

const tw = await import("../services/trial-without-card.js");
const { normalizeSubscriptionStatus, statusGrantsAccess, NORMALIZE_IMPOSSIBLE_STATES_SQL } = await import("../lib/subscription-state.js");
const { loadBillingContext } = await import("../services/billing-context.js");
const { default: authRouter } = await import("../routes/auth.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _res, next) => { req.cookies = {}; next(); });
  a.use("/api", authRouter);
  return a;
}
const read = (p: string) => readFileSync(resolve(__dirname, p), "utf8");
const trialBody = (extra: Record<string, unknown> = {}) => ({ firstName: "Marie", email: "marie@agence-test.fr", ...extra });

beforeEach(() => {
  users = new Map(); orgs = []; pending = []; members = []; magicTokens = []; writes = []; locks = [];
  vi.clearAllMocks();
  delete process.env["TRIAL_WITHOUT_CARD"];
});
afterEach(() => { delete process.env["TRIAL_WITHOUT_CARD"]; });

describe("A — drapeau TRIAL_WITHOUT_CARD", () => {
  it.each([[undefined, false], ["", false], ["false", false], ["1", false], ["yes", false], ["true", true], [" TRUE ", true]])(
    "%s → %s", (val, expected) => {
      const env = val === undefined ? {} : { TRIAL_WITHOUT_CARD: val as string };
      expect(tw.isTrialWithoutCardEnabled(env as NodeJS.ProcessEnv)).toBe(expected);
    });
});

describe("B — helpers purs", () => {
  it("adresse canonique : +etiquette retiree partout, points retires chez Gmail", () => {
    expect(tw.canonicalTrialEmail("Marie+essai2@Agence.fr").canonical).toBe("marie@agence.fr");
    expect(tw.canonicalTrialEmail("m.a.rie+x@googlemail.com").canonical).toBe("marie@gmail.com");
    expect(tw.canonicalTrialEmail("jean.dupont@agence.fr").canonical).toBe("jean.dupont@agence.fr");
  });
  it("domaine du garde : entreprise oui, messagerie grand public non", () => {
    expect(tw.trialGuardDomain("a@agence.fr")).toBe("agence.fr");
    expect(tw.trialGuardDomain("a@gmail.com")).toBeNull();
    expect(tw.trialGuardDomain("a@orange.fr")).toBeNull();
    expect(tw.trialGuardDomain("a@skynet.be")).toBeNull();
  });
  const now = new Date("2026-10-27T10:00:00Z");
  const cardless = { rawSubscriptionStatus: "trialing", stripeSubscriptionId: null, stripeCustomerId: null,
                     trialConsumedAt: "2026-10-27T10:00:00Z", trialEndsAt: "2026-11-10T10:00:00Z" };
  it("isCardlessTrial : uniquement trialing sans aucun objet Stripe et essai consomme", () => {
    expect(tw.isCardlessTrial(cardless)).toBe(true);
    expect(tw.isCardlessTrial({ ...cardless, stripeSubscriptionId: "sub_1" })).toBe(false);
    expect(tw.isCardlessTrial({ ...cardless, stripeCustomerId: "cus_1" })).toBe(false);
    expect(tw.isCardlessTrial({ ...cardless, trialConsumedAt: null })).toBe(false);
    expect(tw.isCardlessTrial({ ...cardless, rawSubscriptionStatus: "active" })).toBe(false);
  });
  it("trial_end Checkout : fin de l'essai si >= 48 h, sinon facturation immediate", () => {
    expect(tw.cardlessTrialEndForCheckout(cardless, now)).toBe(Math.floor(Date.parse("2026-11-10T10:00:00Z") / 1000));
    expect(tw.cardlessTrialEndForCheckout({ ...cardless, trialEndsAt: "2026-10-29T09:00:00Z" }, now)).toBeUndefined();
    expect(tw.cardlessTrialEndForCheckout({ ...cardless, trialEndsAt: "2026-10-20T00:00:00Z" }, now)).toBeUndefined();
    expect(tw.cardlessTrialEndForCheckout({ ...cardless, stripeCustomerId: "cus_1" }, now)).toBeUndefined();
  });
});

describe("C — machine d'etats existante", () => {
  const base = { rawStatus: "trialing", stripeSubscriptionId: null, stripeCustomerId: null,
                 trialConsumedAt: "2026-10-27T10:00:00Z" };
  it("pendant l'essai : trialing, acces premium", () => {
    const st = normalizeSubscriptionStatus({ ...base, trialEndsAt: new Date(Date.now() + 86400_000).toISOString() });
    expect(st).toBe("trialing");
    expect(statusGrantsAccess(st)).toBe(true);
  });
  it("a l'echeance sans paiement : none, plus d'acces (comme un essai Stripe expire)", () => {
    const st = normalizeSubscriptionStatus({ ...base, trialEndsAt: new Date(Date.now() - 1000).toISOString() });
    expect(st).toBe("none");
    expect(statusGrantsAccess(st)).toBe(false);
  });
  it("le SQL de normalisation ne remet en pending_billing que les essais SANS trial_consumed_at", () => {
    expect(NORMALIZE_IMPOSSIBLE_STATES_SQL).toMatch(/subscription_status = 'trialing'[\s\S]*trial_consumed_at IS NULL/);
  });
  it("loadBillingContext : acces premium pendant l'essai, canStartTrial=false (pas de second essai Stripe)", async () => {
    loadOrgData.mockResolvedValueOnce({ plan: "standard", subscriptionStatus: "trialing", stripeCustomerId: null,
      stripeSubscriptionId: null, trialEndsAt: new Date(Date.now() + 5 * 86400_000).toISOString(),
      trialConsumedAt: new Date().toISOString(), addons: {} });
    const ctx = await loadBillingContext("11111111-1111-4111-8111-111111111111");
    expect(ctx.subscriptionStatus).toBe("trialing");
    expect(ctx.hasPremiumAccess).toBe(true);
    expect(ctx.canStartTrial).toBe(false);
  });
  it("loadBillingContext apres l'echeance : bloque, doit completer la facturation", async () => {
    loadOrgData.mockResolvedValueOnce({ plan: "standard", subscriptionStatus: "trialing", stripeCustomerId: null,
      stripeSubscriptionId: null, trialEndsAt: new Date(Date.now() - 86400_000).toISOString(),
      trialConsumedAt: new Date(Date.now() - 15 * 86400_000).toISOString(), addons: {} });
    const ctx = await loadBillingContext("11111111-1111-4111-8111-111111111111");
    expect(ctx.hasPremiumAccess).toBe(false);
    expect(ctx.mustCompleteBilling).toBe(true);
    expect(ctx.canStartTrial).toBe(false);
  });
});

describe("D — drapeau eteint : rien ne change", () => {
  it("POST /auth/trial-signup → 404, aucune ecriture, aucun email", async () => {
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody());
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("TRIAL_WITHOUT_CARD_DISABLED");
    expect(writes).toEqual([]);
    expect(sendActivationMagicLink).not.toHaveBeenCalled();
  });
  it("pre-register exige toujours l'adresse, meme drapeau allume (parcours carte intact)", async () => {
    process.env["TRIAL_WITHOUT_CARD"] = "true";
    const r = await request(app()).post("/api/auth/pre-register").send({ firstName: "M", lastName: "D",
      email: "m@agence-test.fr", companyName: "A", country: "FR", city: "Paris", postalCode: "75001" });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/adresse/i);
  });
  it("/auth/providers expose trialWithoutCard=false par defaut, true quand allume", async () => {
    expect((await request(app()).get("/api/auth/providers")).body.trialWithoutCard).toBe(false);
    process.env["TRIAL_WITHOUT_CARD"] = "true";
    expect((await request(app()).get("/api/auth/providers")).body.trialWithoutCard).toBe(true);
  });
});

describe("E — anti-abus (drapeau allume)", () => {
  beforeEach(() => { process.env["TRIAL_WITHOUT_CARD"] = "true"; });

  it("honeypot : succes simule, aucune ecriture", async () => {
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody({ _hp: "bot" }));
    expect(r.status).toBe(200);
    expect(writes).toEqual([]);
  });
  it("email jetable refuse", async () => {
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody({ email: "x@yopmail.com" }));
    expect(r.status).toBe(400);
    expect(writes).toEqual([]);
  });
  it("prenom requis, email valide requis", async () => {
    expect((await request(app()).post("/api/auth/trial-signup").send({ email: "a@agence-test.fr" })).status).toBe(400);
    expect((await request(app()).post("/api/auth/trial-signup").send({ firstName: "A", email: "pas-un-email" })).status).toBe(400);
    expect(writes).toEqual([]);
  });
  it("compte actif existant → 409 vers /login.html", async () => {
    users.set("marie@agence-test.fr", { id: "u0", status: "active" });
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody());
    expect(r.status).toBe(409);
    expect(r.body.redirectTo).toBe("/login.html");
    expect(writes).toEqual([]);
  });
  it("meme boite canonique (+etiquette) → 409 TRIAL_ALREADY_USED_EMAIL", async () => {
    orgs.push({ id: "o0", owner_email: "marie@gmail.com", plan: "standard", subscription_status: "none",
      stripe_customer_id: null, stripe_subscription_id: null, trial_consumed: true, fp_lid: null, seller_id: null });
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody({ email: "m.arie+2@gmail.com" }));
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("TRIAL_ALREADY_USED_EMAIL");
    expect(writes).not.toContain("insert_org");
  });
  it("meme domaine d'entreprise → 409 TRIAL_ALREADY_USED_DOMAIN", async () => {
    orgs.push({ id: "o0", owner_email: "boss@agence-test.fr", plan: "pro", subscription_status: "active",
      stripe_customer_id: "cus_1", stripe_subscription_id: "sub_1", trial_consumed: true, fp_lid: null, seller_id: null });
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("TRIAL_ALREADY_USED_DOMAIN");
    expect(writes).not.toContain("insert_org");
  });
  it("messagerie grand public : pas de garde de domaine", async () => {
    orgs.push({ id: "o0", owner_email: "autre@gmail.com", plan: "standard", subscription_status: "none",
      stripe_customer_id: null, stripe_subscription_id: null, trial_consumed: true, fp_lid: null, seller_id: null });
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody({ email: "marie@gmail.com" }));
    expect(r.status).toBe(200);
  });
  it("course : un compte devenu actif entre le garde et l'insertion → 409, rien n'est ecrase", async () => {
    // Le garde voit `pending`, l'insertion trouve un compte deja actif.
    users.set("marie@agence-test.fr", { id: "u0", status: "pending" });
    const orig = users.get.bind(users);
    let calls = 0;
    users.get = ((k: string) => { const u = orig(k); calls++; return calls > 1 && u ? { ...u, status: "active" } : u; }) as typeof users.get;
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody());
    expect(r.status).toBe(409);
    expect(writes).not.toContain("insert_org");
  });
});

describe("F — activation (drapeau allume)", () => {
  beforeEach(() => { process.env["TRIAL_WITHOUT_CARD"] = "true"; });

  it("cree org trialing plan standard, essai consomme, AUCUN objet Stripe", async () => {
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody({ companyName: "Agence Test" }));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, activationEmailSent: true, trialEndsAt: "2026-11-10T10:00:00.000Z" });
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ owner_email: "marie@agence-test.fr", plan: "standard",
      subscription_status: "trialing", stripe_customer_id: null, trial_consumed: true });
    expect(members).toHaveLength(1);
    expect(users.get("marie@agence-test.fr")?.status).toBe("active");
    expect(createStripeClient).not.toHaveBeenCalled();
    expect(locks).toEqual(["fp-cardless-trial:agence-test.fr"]);
    expect(upsertOrgSettings).toHaveBeenCalledWith(orgs[0]!.id, expect.objectContaining({ orgName: "Agence Test", firstName: "Marie" }));
  });
  it("entreprise optionnelle : repli sur le domaine", async () => {
    await request(app()).post("/api/auth/trial-signup").send(trialBody());
    expect(upsertOrgSettings).toHaveBeenCalledWith(orgs[0]!.id, expect.objectContaining({ orgName: "agence-test.fr" }));
  });
  it("fp_lid : pending_signups (consomme) → organizations.fp_lid", async () => {
    await request(app()).post("/api/auth/trial-signup").send(trialBody({ fp_lid: VALID }));
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({ fp_lid: VALID, consumed: true });
    expect(orgs[0]!.fp_lid).toBe(VALID);
  });
  it("fp_lid invalide → NULL, l'inscription passe", async () => {
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody({ fp_lid: "<script>" }));
    expect(r.status).toBe(200);
    expect(orgs[0]!.fp_lid).toBeNull();
  });
  it("premiere attribution gagne sur une tentative carte abandonnee ; son client Stripe est nettoye", async () => {
    pending.push({ token: "old", email: "marie@agence-test.fr", fp_lid: OTHER, consumed: false, stripe_customer_id: "cus_stale" });
    await request(app()).post("/api/auth/trial-signup").send(trialBody({ fp_lid: VALID }));
    expect(orgs[0]!.fp_lid).toBe(OTHER);
    await vi.waitFor(() => expect(createStripeClient).toHaveBeenCalledTimes(1));
  });
  it("jalons AI Lab : signup puis trial, source saas, horodatages persistes", async () => {
    await request(app()).post("/api/auth/trial-signup").send(trialBody({ fp_lid: VALID }));
    const evs = queueConversionEvent.mock.calls.map(c => c[0]);
    expect(evs.map(e => e["stage"])).toEqual(["signup", "trial"]);
    expect(evs.every(e => e["source"] === "saas" && e["fpLid"] === VALID)).toBe(true);
    expect(evs[0]!["occurredAt"]).toBe("2026-10-27T10:00:00.000Z");
    expect(String(evs[1]!["eventId"])).toMatch(/^trial:[0-9a-f]{32}$/);
  });
  it("sans fp_lid : aucun jalon AI Lab", async () => {
    await request(app()).post("/api/auth/trial-signup").send(trialBody());
    expect(queueConversionEvent).not.toHaveBeenCalled();
  });
  it("seller_code valide → seller_id sur l'organisation", async () => {
    await request(app()).post("/api/auth/trial-signup").send(trialBody({ seller_code: "SELLER-OK" }));
    expect(orgs[0]!.seller_id).toBe("seller-1");
  });
  it("lien magique « sans carte » envoye ; un echec d'envoi est signale, l'essai reste cree", async () => {
    await request(app()).post("/api/auth/trial-signup").send(trialBody());
    expect(magicTokens).toHaveLength(1);
    expect(sendActivationMagicLink).toHaveBeenCalledWith(expect.objectContaining({
      to: "marie@agence-test.fr", isTrial: true, cardless: true, plan: "standard" }));
    sendActivationMagicLink.mockResolvedValueOnce({ ok: false, id: "" });
    const r2 = await request(app()).post("/api/auth/trial-signup").send(trialBody({ email: "paul@autre-agence.fr" }));
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ ok: true, activationEmailSent: false, emailFailed: true });
  });
  it("funnel interne : signup_form_completed et trial_activated", async () => {
    await request(app()).post("/api/auth/trial-signup").send(trialBody());
    expect(enregistrerEtape.mock.calls.map(c => (c as unknown as [{ etape: string }])[0].etape))
      .toEqual(["signup_form_completed", "trial_activated"]);
  });
});

describe("G — contrats source", () => {
  it("signin.html ne bascule que sur trialWithoutCard === true et poste /auth/trial-signup", () => {
    const html = read("../../../flowpoint-export/signin.html");
    expect(html).toMatch(/data\.trialWithoutCard === true\) enableCardlessTrial\(\)/);
    expect(html).toMatch(/fetch\('\/api\/auth\/trial-signup'/);
    // le parcours carte reste celui par defaut
    expect(html).toMatch(/fetch\('\/api\/auth\/pre-register'/);
    for (const id of ["lastName", "country", "address", "city", "phone"]) {
      expect(html).toMatch(new RegExp(`billing-field[^]*?id="${id}"`));
    }
  });
  it("/billing/upgrade : trial_end uniquement via cardlessTrialEndForCheckout", () => {
    const src = read("../routes/billing.ts");
    expect(src).toMatch(/const _nsTrialEnd = cardlessTrialEndForCheckout\(billingCtx\)/);
    expect(src).toMatch(/\.\.\.\(_nsTrialEnd \? \{ trial_end: _nsTrialEnd \} : \{\}\)/);
  });
  it("finalize-checkout (parcours carte) n'est pas touche par le drapeau", () => {
    expect(read("../routes/public-billing.ts")).not.toMatch(/TRIAL_WITHOUT_CARD|trial-without-card/);
  });
});
