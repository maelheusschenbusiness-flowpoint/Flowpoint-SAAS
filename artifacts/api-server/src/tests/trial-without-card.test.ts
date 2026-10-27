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
             trial_consumed: boolean; fp_lid: string | null; seller_id: string | null;
             trial_started_days_ago?: number; expired?: boolean; cardless?: boolean };
type Exc = { domain: string; extra: number; active: boolean };
let exceptions: Exc[] = [];
const sqlLog: string[] = [];
let users: Map<string, { id: string; status: string }>;
let orgs: Org[];
let pending: { token: string; email: string; fp_lid: string | null; consumed: boolean; stripe_customer_id: string | null }[];
let members: unknown[][];
let magicTokens: string[];
let writes: string[];
let locks: string[];
let failOrgLookup = false;

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
  if (/SELECT COUNT\(\*\)::int AS n FROM organizations WHERE lower\(split_part\(owner_email, '@', 2\)\) = \$1/i.test(s)) {
    const windowDays = Number(v[1]);
    const n = orgs.filter(o => o.owner_email.split("@")[1] === v[0]
      && o.trial_started_days_ago !== undefined && o.trial_started_days_ago < windowDays).length;
    return { rows: [{ n }], rowCount: 1 };
  }
  sqlLog.push(s);
  if (/SELECT EXISTS \(SELECT 1 FROM organizations WHERE trial_origin = 'cardless'\)/i.test(s)) {
    if (failOrgLookup) throw new Error("db down");
    return { rows: [{ any: orgs.some(o => o.cardless !== false && o.expired !== undefined) }], rowCount: 1 };
  }
  if (/FROM trial_domain_exceptions WHERE lower\(domain\) = lower\(\$1\) AND revoked_at IS NULL/i.test(s)) {
    const n = exceptions.filter(e => e.active && e.domain === String(v[0]).toLowerCase()).reduce((a, e) => a + e.extra, 0);
    return { rows: [{ n }], rowCount: 1 };
  }
  if (/^CREATE (TABLE|INDEX)/i.test(s)) return { rows: [], rowCount: 0 };
  if (/^INSERT INTO trial_domain_exceptions/i.test(s)) {
    writes.push("insert_exception");
    return { rows: [{ id: v[0], domain: String(v[1]).toLowerCase(), extra_trials: v[2], created_by: v[5] }], rowCount: 1 };
  }
  if (/^INSERT INTO trial_domain_exception_audit/i.test(s)) { writes.push(`audit_${/'create'/.test(s) ? "create" : "revoke"}`); return { rows: [], rowCount: 1 }; }
  if (/^UPDATE trial_domain_exceptions SET revoked_at/i.test(s)) { writes.push("revoke_exception"); return { rows: v[0] === "tde_known" ? [{ id: v[0] }] : [], rowCount: v[0] === "tde_known" ? 1 : 0 }; }
  if (/WITH candidates AS \( SELECT id FROM organizations WHERE trial_origin = 'cardless'/i.test(s)) {
    const due = orgs.filter(o => o.expired && o.cardless !== false);
    return { rows: due.map(o => ({ org_id: o.id, email: o.owner_email, first_name: "X", plan: o.plan })), rowCount: due.length };
  }
  if (/FROM organizations WHERE id::text = ANY/i.test(s) || /FROM organizations WHERE id = \$1 AND trial_origin = 'cardless'/i.test(s)) {
    if (failOrgLookup) throw new Error("db down");
    const ids = Array.isArray(v[0]) ? (v[0] as string[]) : [String(v[0])];
    const hit = orgs.filter(o => ids.includes(o.id) && o.expired);
    return { rows: hit.map(o => ({ id: o.id })), rowCount: hit.length };
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
const sendTrialExpired = vi.fn(async (_o: Record<string, unknown>) => ({ ok: true, id: "em_2" }));
vi.mock("../services/mailer.js", () => ({ mailer: new Proxy({ sendActivationMagicLink, sendTrialExpired }, {
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
const gate = await import("../middlewares/trialExpiredGate.js");
const { pool: fakePool } = await import("@workspace/db");

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
  failOrgLookup = false;
  exceptions = [];
  sqlLog.length = 0;
  vi.clearAllMocks();
  gate.clearTrialGateCache();
  delete process.env["TRIAL_WITHOUT_CARD"];
  delete process.env["TRIAL_DOMAIN_MAX_TRIALS"];
  delete process.env["TRIAL_DOMAIN_WINDOW_DAYS"];
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
    for (const d of ["gmail.com", "outlook.com", "hotmail.fr", "live.fr", "yahoo.fr", "icloud.com", "orange.fr",
                     "free.fr", "laposte.net", "sfr.fr", "wanadoo.fr", "proton.me", "protonmail.com", "gmx.fr"]) {
      expect(tw.trialGuardDomain(`x@${d}`)).toBeNull();
    }
  });
  it("Outlook/Hotmail/Live : +etiquette retiree, points conserves", () => {
    expect(tw.canonicalTrialEmail("Jean.Dupont+promo@Outlook.fr").canonical).toBe("jean.dupont@outlook.fr");
    expect(tw.canonicalTrialEmail("a+b@hotmail.com").canonical).toBe("a@hotmail.com");
    expect(tw.canonicalTrialEmail("a+b@live.be").canonical).toBe("a@live.be");
  });
  it("limite de domaine configurable, valeurs invalides → defauts 3 / 30 j", () => {
    expect(tw.trialDomainLimit({})).toEqual({ max: 3, windowDays: 30 });
    expect(tw.trialDomainLimit({ TRIAL_DOMAIN_MAX_TRIALS: "5", TRIAL_DOMAIN_WINDOW_DAYS: "7" } as NodeJS.ProcessEnv))
      .toEqual({ max: 5, windowDays: 7 });
    expect(tw.trialDomainLimit({ TRIAL_DOMAIN_MAX_TRIALS: "0", TRIAL_DOMAIN_WINDOW_DAYS: "abc" } as NodeJS.ProcessEnv))
      .toEqual({ max: 3, windowDays: 30 });
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
  const colleague = (email: string, daysAgo: number): Org => ({ id: `o-${email}`, owner_email: email, plan: "standard",
    subscription_status: "trialing", stripe_customer_id: null, stripe_subscription_id: null, trial_consumed: true,
    fp_lid: null, seller_id: null, trial_started_days_ago: daysAgo });
  it("meme domaine d'entreprise : des collegues peuvent essayer sous le seuil (2 < 3)", async () => {
    orgs.push(colleague("boss@agence-test.fr", 2), colleague("paul@agence-test.fr", 10));
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody());
    expect(r.status).toBe(200);
  });
  it("au seuil (3 essais / 30 j / domaine) → 409 TRIAL_DOMAIN_LIMIT", async () => {
    orgs.push(colleague("a@agence-test.fr", 1), colleague("b@agence-test.fr", 5), colleague("c@agence-test.fr", 29));
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody());
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("TRIAL_DOMAIN_LIMIT");
    expect(writes).not.toContain("insert_org");
  });
  it("essais du domaine hors fenetre : ne comptent pas", async () => {
    orgs.push(colleague("a@agence-test.fr", 40), colleague("b@agence-test.fr", 45), colleague("c@agence-test.fr", 60));
    expect((await request(app()).post("/api/auth/trial-signup").send(trialBody())).status).toBe(200);
  });
  it("seuil configurable : TRIAL_DOMAIN_MAX_TRIALS=1", async () => {
    process.env["TRIAL_DOMAIN_MAX_TRIALS"] = "1";
    orgs.push(colleague("a@agence-test.fr", 1));
    expect((await request(app()).post("/api/auth/trial-signup").send(trialBody())).body.code).toBe("TRIAL_DOMAIN_LIMIT");
  });
  it("Outlook +etiquette : meme boite → 409", async () => {
    orgs.push(colleague("jean@outlook.fr", 100));
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody({ email: "jean+2@outlook.fr" }));
    expect(r.body.code).toBe("TRIAL_ALREADY_USED_EMAIL");
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
    // les dates d'essai vont aussi dans org_settings : le webhook subscription.created
    // n'y verra pas un « premier essai » et ne reecrira ni trial_* ni l'email de debut.
    expect(upsertOrgSettings).toHaveBeenCalledWith(orgs[0]!.id, expect.objectContaining({
      orgName: "Agence Test", firstName: "Marie", trialConsumedAt: "2026-10-27T10:00:00.000Z",
      trialStartedAt: "2026-10-27T10:00:00.000Z", trialEndsAt: "2026-11-10T10:00:00.000Z" }));
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


describe("H — controle d'acces serveur apres expiration", () => {
  it.each([
    ["POST", "/ai/chat", "blocked"], ["GET", "/ai/recommendations", "blocked"], ["GET", "/seo/domain", "blocked"],
    ["GET", "/keywords/ranks", "blocked"], ["GET", "/pagespeed", "blocked"], ["POST", "/audits", "blocked"],
    ["POST", "/missions/run", "blocked"], ["POST", "/automations", "blocked"], ["POST", "/reports/generate", "blocked"],
    ["POST", "/monitors", "blocked"],
    ["GET", "/audits", "read"], ["GET", "/overview", "read"],
    ["POST", "/billing/upgrade", "open"], ["POST", "/billing/checkout", "open"], ["POST", "/billing/portal", "open"],
    ["DELETE", "/billing/account", "open"], ["GET", "/me", "open"], ["PATCH", "/me/prefs", "open"],
    ["PUT", "/ai/preferences", "open"], ["GET", "/settings/data-export", "open"], ["POST", "/auth/logout", "open"],
    ["GET", "/notifications", "open"],
  ])("%s %s → %s", (m, p, d) => { expect(gate.decideExpiredTrialAccess(m, p)).toBe(d); });

  const ORG = "22222222-2222-4222-8222-222222222222";
  function gatedApp(orgId = ORG) {
    const a = express();
    a.use(express.json());
    a.use((req: any, _r, n) => { req.orgContext = { orgId }; n(); });
    a.use(gate.trialExpiredGate);
    a.all("/{*rest}", (_q, r) => { r.json({ reached: true }); });
    return a;
  }
  const expiredOrg = (): Org => ({ id: ORG, owner_email: "x@agence-test.fr", plan: "standard", subscription_status: "trialing",
    stripe_customer_id: null, stripe_subscription_id: null, trial_consumed: true, fp_lid: null, seller_id: null, expired: true });

  it("DRAPEAU ETEINT + essai sans carte expire existant → route couteuse 402 (la protection ne depend pas du drapeau)", async () => {
    orgs.push(expiredOrg());
    const r = await request(gatedApp()).post("/ai/chat").send({});
    expect(r.status).toBe(402);
    expect(r.body.code).toBe("TRIAL_EXPIRED");
  });
  it("DRAPEAU ETEINT + essai expire : paiement toujours ouvert", async () => {
    orgs.push(expiredOrg());
    expect((await request(gatedApp()).post("/billing/upgrade").send({ plan: "pro" })).body.reached).toBe(true);
  });
  it("aucune org d'essai sans carte en base : une seule requete d'existence, pas de requete par org", async () => {
    const r = await request(gatedApp()).post("/ai/chat").send({});
    expect(r.body.reached).toBe(true);
    expect(sqlLog.filter(q => /trial_origin/.test(q))).toHaveLength(1);
    expect(sqlLog.some(q => /WHERE id = \$1/.test(q))).toBe(false);
  });
  it("une org expiree SANS marque cardless (essai Stripe classique) n'est jamais bloquee", async () => {
    orgs.push({ ...expiredOrg(), cardless: false, expired: false });
    expect((await request(gatedApp()).post("/ai/chat").send({})).body.reached).toBe(true);
  });
  it("essai expire : route couteuse → 402 TRIAL_EXPIRED", async () => {
    process.env["TRIAL_WITHOUT_CARD"] = "true";
    orgs.push(expiredOrg());
    const r = await request(gatedApp()).post("/ai/chat").send({});
    expect(r.status).toBe(402);
    expect(r.body.code).toBe("TRIAL_EXPIRED");
  });
  it("essai expire : route de paiement ouverte (upgrade) et lecture ouverte", async () => {
    process.env["TRIAL_WITHOUT_CARD"] = "true";
    orgs.push(expiredOrg());
    expect((await request(gatedApp()).post("/billing/upgrade").send({ plan: "pro" })).body.reached).toBe(true);
    expect((await request(gatedApp()).get("/audits")).body.reached).toBe(true);
  });
  it("essai en cours ou paye : rien n'est bloque", async () => {
    process.env["TRIAL_WITHOUT_CARD"] = "true";
    orgs.push({ ...expiredOrg(), expired: false });
    expect((await request(gatedApp()).post("/ai/chat").send({})).body.reached).toBe(true);
  });
  it("base indisponible : on laisse passer (journalise)", async () => {
    process.env["TRIAL_WITHOUT_CARD"] = "true";
    failOrgLookup = true;
    expect((await request(gatedApp()).post("/ai/chat").send({})).body.reached).toBe(true);
  });
  it("monte dans routes/index.ts apres l'authentification, avant les routeurs metier", () => {
    const idx = read("../routes/index.ts");
    expect(idx.indexOf("router.use(trialExpiredGate)")).toBeGreaterThan(idx.indexOf("router.use(requireAuth)"));
    expect(idx.indexOf("router.use(trialExpiredGate)")).toBeLessThan(idx.indexOf("router.use(aiRouter)"));
  });
});

describe("I — taches planifiees", () => {
  const ORG = "33333333-3333-4333-8333-333333333333";
  it("DRAPEAU ETEINT : les orgs d'essai sans carte expirees sont quand meme sautees", async () => {
    const db = { query: vi.fn(async (_s: string, _v?: unknown[]) => ({ rows: [{ id: ORG }] })) };
    expect([...(await tw.expiredCardlessTrialOrgIds(db as never, [ORG]))]).toEqual([ORG]);
    expect(String((db.query.mock.calls[0] as unknown[])[0])).toMatch(/trial_origin = 'cardless'/);
  });
  it("DRAPEAU ETEINT : la passe d'expiration envoie l'email et le jalon trial_expired", async () => {
    orgs.push({ id: ORG, owner_email: "fin@agence-test.fr", plan: "standard", subscription_status: "trialing",
      stripe_customer_id: null, stripe_subscription_id: null, trial_consumed: true, fp_lid: null, seller_id: null, expired: true });
    const { checkCardlessTrialExpirations } = await import("../services/monitor-cron.js");
    expect(await checkCardlessTrialExpirations()).toBe(1);
    expect(sendTrialExpired).toHaveBeenCalledWith(expect.objectContaining({ to: "fin@agence-test.fr" }));
    await vi.waitFor(() => expect(enregistrerEtape).toHaveBeenCalledWith(expect.objectContaining({
      etape: "trial_expired", orgId: ORG, cleIdempotence: `trial_expired:cardless:${ORG}` })));
  });
  it("le predicat d'expiration exige la marque d'origine cardless", () => {
    expect(tw.CARDLESS_TRIAL_EXPIRED_WHERE).toMatch(/^trial_origin = 'cardless'/);
  });
  it("rend les orgs expirees ; erreur → ensemble vide", async () => {
    const db = { query: vi.fn(async () => ({ rows: [{ id: ORG }] })) };
    expect([...(await tw.expiredCardlessTrialOrgIds(db as never, [ORG, "default", ORG]))]).toEqual([ORG]);
    const bad = { query: vi.fn(async () => { throw new Error("x"); }) };
    expect((await tw.expiredCardlessTrialOrgIds(bad as never, [ORG])).size).toBe(0);
  });
  it("moniteurs, audits planifies et DataForSEO sautent les orgs expirees (contrats source)", () => {
    expect(read("../routes/monitors.ts")).toMatch(/if \(_expiredOrgs\.has\(_cronOrgId\)\) continue;/);
    expect(read("../services/audit-schedule-cron.ts")).toMatch(/for \(const row of runnable\.slice/);
    expect(read("../routes/dataforseo-cron.ts")).toMatch(/filter\(r => !expired\.has\(r\.org_id\)\)/);
  });
});

describe("J — Google OAuth (drapeau allume)", () => {
  beforeEach(() => {
    process.env["TRIAL_WITHOUT_CARD"] = "true";
    process.env["GOOGLE_CLIENT_ID"] = "cid"; process.env["GOOGLE_CLIENT_SECRET"] = "secret";
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  function stubGoogle(profile: Record<string, unknown>) {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      json: async () => (String(url).includes("token") ? { access_token: "at" } : profile),
    })));
  }
  const state = (o: Record<string, unknown>) => Buffer.from(JSON.stringify({ ts: Date.now(), ...o })).toString("base64");

  it("nouveau compte Google verifie : essai ouvert, fp_lid de l'etat OAuth propage, aucun lien magique", async () => {
    stubGoogle({ email: "lea@agence-g.fr", email_verified: true, given_name: "Léa" });
    const r = await request(app()).get(`/api/auth/google/callback?code=c&state=${state({ fp_lid: VALID })}`);
    expect(r.status).toBe(302);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]).toMatchObject({ owner_email: "lea@agence-g.fr", subscription_status: "trialing", fp_lid: VALID });
    expect(sendActivationMagicLink).not.toHaveBeenCalled();
    expect(queueConversionEvent.mock.calls.map(c => c[0]["stage"])).toEqual(["signup", "trial"]);
  });
  it("second essai par Google (variante canonique Gmail) → refuse, aucune org", async () => {
    orgs.push({ id: "o1", owner_email: "lea.martin@gmail.com", plan: "standard", subscription_status: "none",
      stripe_customer_id: null, stripe_subscription_id: null, trial_consumed: true, fp_lid: null, seller_id: null });
    stubGoogle({ email: "leamartin@googlemail.com", email_verified: true, given_name: "Léa" });
    const r = await request(app()).get(`/api/auth/google/callback?code=c&state=${state({})}`);
    expect(r.status).toBe(302);
    expect(r.headers.location).toMatch(/signin\.html\?error=trial_already_used/);
    expect(orgs).toHaveLength(1);
  });
  it("email non verifie par Google : pas d'essai sans carte (parcours historique)", async () => {
    stubGoogle({ email: "x@agence-g.fr", email_verified: false, given_name: "X" });
    await request(app()).get(`/api/auth/google/callback?code=c&state=${state({})}`);
    // le coeur de l'essai sans carte (verrou + transaction) n'a pas tourne
    expect(locks).toEqual([]);
    expect(orgs.some(o => o.subscription_status === "trialing")).toBe(false);
  });
});


describe("K — drapeau eteint : aucune nouvelle inscription sans carte", () => {
  it("POST /auth/trial-signup → 404 + redirection vers le parcours carte, rien n'est ecrit", async () => {
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody({ fp_lid: VALID }));
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: "TRIAL_WITHOUT_CARD_DISABLED", redirectTo: "/signin.html" });
    expect(writes).toEqual([]);
  });
  it("Google OAuth drapeau eteint : parcours historique (carte), pas d'essai sans carte", async () => {
    process.env["GOOGLE_CLIENT_ID"] = "cid"; process.env["GOOGLE_CLIENT_SECRET"] = "secret";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      json: async () => (String(url).includes("token") ? { access_token: "at" } : { email: "new@agence-g.fr", email_verified: true, given_name: "N" }),
    })));
    const r = await request(app()).get(`/api/auth/google/callback?code=c&state=${Buffer.from(JSON.stringify({ ts: 1 })).toString("base64")}`);
    vi.unstubAllGlobals();
    expect(r.status).toBe(302);
    expect(locks).toEqual([]);
    expect(orgs.some(o => o.subscription_status === "trialing")).toBe(false);
  });
  it("signin.html garde le parcours carte tant que /auth/providers ne renvoie pas trialWithoutCard:true", () => {
    const html = read("../../../flowpoint-export/signin.html");
    expect(html).toMatch(/var _cardlessTrial = false;/);
  });
});

describe("L — exceptions administrateur au seuil de domaine", () => {
  beforeEach(() => { process.env["TRIAL_WITHOUT_CARD"] = "true"; });
  const col = (email: string): Org => ({ id: `o-${email}`, owner_email: email, plan: "standard", subscription_status: "trialing",
    stripe_customer_id: null, stripe_subscription_id: null, trial_consumed: true, fp_lid: null, seller_id: null, trial_started_days_ago: 1 });

  it("validation : domaine, messagerie publique refusee, quota, date future <= 1 an, motif, auteur", () => {
    const now = new Date("2026-10-27T00:00:00Z");
    const ok = { domain: "agence.fr", extraTrials: 5, expiresAt: "2026-12-01T00:00:00Z", reason: "salon pro", actor: "mael" };
    expect(tw.validateDomainException(ok, now)).toBeNull();
    expect(tw.validateDomainException({ ...ok, domain: "gmail.com" }, now)).toMatch(/grand public/);
    expect(tw.validateDomainException({ ...ok, domain: "pas un domaine" }, now)).toMatch(/domain/);
    expect(tw.validateDomainException({ ...ok, extraTrials: 0 }, now)).toMatch(/extraTrials/);
    expect(tw.validateDomainException({ ...ok, expiresAt: "2026-01-01T00:00:00Z" }, now)).toMatch(/future/);
    expect(tw.validateDomainException({ ...ok, expiresAt: "2028-01-01T00:00:00Z" }, now)).toMatch(/1 an/);
    expect(tw.validateDomainException({ ...ok, reason: "x" }, now)).toMatch(/reason/);
    expect(tw.validateDomainException({ ...ok, actor: "" }, now)).toMatch(/actor/);
  });
  it("exception active : le 4e essai du domaine passe", async () => {
    orgs.push(col("a@agence-test.fr"), col("b@agence-test.fr"), col("c@agence-test.fr"));
    exceptions.push({ domain: "agence-test.fr", extra: 2, active: true });
    expect((await request(app()).post("/api/auth/trial-signup").send(trialBody())).status).toBe(200);
  });
  it("exception expiree ou revoquee : ignoree, seuil de base", async () => {
    orgs.push(col("a@agence-test.fr"), col("b@agence-test.fr"), col("c@agence-test.fr"));
    exceptions.push({ domain: "agence-test.fr", extra: 5, active: false });
    expect((await request(app()).post("/api/auth/trial-signup").send(trialBody())).body.code).toBe("TRIAL_DOMAIN_LIMIT");
  });
  it("une exception ne permet JAMAIS un second essai pour la meme boite canonique", async () => {
    orgs.push(col("marie@agence-test.fr"));
    exceptions.push({ domain: "agence-test.fr", extra: 100, active: true });
    const r = await request(app()).post("/api/auth/trial-signup").send(trialBody({ email: "marie+2@agence-test.fr" }));
    expect(r.body.code).toBe("TRIAL_ALREADY_USED_EMAIL");
  });

  describe("routes admin", () => {
    let adminApp: express.Express;
    const KEY = "k".repeat(40);
    beforeEach(async () => {
      process.env["ADMIN_KEY"] = KEY;
      const { default: adminRouter } = await import("../routes/admin.js");
      adminApp = express(); adminApp.use(express.json()); adminApp.use("/api", adminRouter);
    });
    afterEach(() => { delete process.env["ADMIN_KEY"]; });
    const body = { domain: "Agence-Test.fr", extraTrials: 3, expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
                   reason: "salon professionnel", actor: "mael" };
    it("sans x-admin-key → 403, rien n'est ecrit", async () => {
      const r = await request(adminApp).post("/api/admin/trial-domain-exceptions").send(body);
      expect(r.status).toBe(403);
      expect(writes).not.toContain("insert_exception");
    });
    it("creation : 201 + ligne d'audit dans la meme transaction", async () => {
      const r = await request(adminApp).post("/api/admin/trial-domain-exceptions").set("x-admin-key", KEY).send(body);
      expect(r.status).toBe(201);
      expect(r.body.exception).toMatchObject({ domain: "agence-test.fr", extra_trials: 3, created_by: "mael" });
      expect(writes).toEqual(["insert_exception", "audit_create"]);
    });
    it("entree invalide (messagerie publique) → 400", async () => {
      const r = await request(adminApp).post("/api/admin/trial-domain-exceptions").set("x-admin-key", KEY).send({ ...body, domain: "gmail.com" });
      expect(r.status).toBe(400);
    });
    it("revocation : motif + auteur requis, audit ecrit ; id inconnu → 404", async () => {
      expect((await request(adminApp).post("/api/admin/trial-domain-exceptions/tde_known/revoke").set("x-admin-key", KEY).send({ actor: "mael" })).status).toBe(400);
      const ok = await request(adminApp).post("/api/admin/trial-domain-exceptions/tde_known/revoke").set("x-admin-key", KEY)
        .send({ actor: "mael", reason: "fin du salon" });
      expect(ok.status).toBe(200);
      expect(writes).toContain("audit_revoke");
      const ko = await request(adminApp).post("/api/admin/trial-domain-exceptions/tde_x/revoke").set("x-admin-key", KEY)
        .send({ actor: "mael", reason: "fin du salon" });
      expect(ko.status).toBe(404);
    });
  });
});
