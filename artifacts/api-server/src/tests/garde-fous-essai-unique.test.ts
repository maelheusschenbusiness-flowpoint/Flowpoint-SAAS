/**
 * garde-fous-essai-unique.test.ts — G3 : pas de deuxieme essai gratuit.
 *
 * Garde-fou : `isTrialEligibleForIdentity` (services/stripe-trial-history.ts),
 * partagee par le devis, le PaymentIntent, finalize-checkout et le webhook.
 * Deja couvert ailleurs : services/stripe-trial-history.test.ts (cote Stripe
 * seul : clients par e-mail, abonnement annule, pagination) et
 * tests/signup-410-guarantees-db.test.ts (refus du deuxieme essai au webhook,
 * contre PostgreSQL). Manquait, et certifie ici : la decision prise EN BASE
 * (essai consomme, souscription presente, etat legacy `org_settings`), et la
 * meme decision vue par POST /api/billing/quote, qui fixe le montant annonce.
 * Tout est simule : ni base, ni reseau, ni Stripe, ni variable d'environnement.
 */
import express from "express";
import request from "supertest";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
/** Prix de TEST injecte : createBillingQuote exige un identifiant de prix. */
vi.mock("../lib/plans.js", async (original) => {
  const reel = await original<typeof import("../lib/plans.js")>();
  return { ...reel, getPlanPriceId: (plan: string) => (plan ? `price_test_${plan}` : undefined) };
});
/** Cle de TEST injectee ; le client Stripe reste celui de setStripeForTesting. */
vi.mock("../services/stripe-factory.js", async (original) => {
  const reel = await original<typeof import("../services/stripe-factory.js")>();
  return { ...reel, getStripeKey: () => "sk_test_garde_fous_essai_unique" };
});

const EMAIL_NEUF = "premiere.fois@exemple.fr";
const EMAIL_HISTORIQUE = "deja.essaye@exemple.fr";
const TOKEN_NEUF = "n".repeat(64);
const TOKEN_HISTORIQUE = "h".repeat(64);
const TOKEN_INCONNU = "x".repeat(64);

/* ── Doubles partages ──────────────────────────────────────────────────── */

type Ligne = { stripe_customer_id: string | null; stripe_subscription_id: string | null; trial_consumed_at: string | null };

const vierge = (extra: Partial<Ligne> = {}): Ligne => ({
  stripe_customer_id: null, stripe_subscription_id: null, trial_consumed_at: null, ...extra,
});

/** Pool minimal : `organizations` et `org_settings` pour une seule identite. */
function faussePool(organizations: Ligne[], legacy: Ligne[] = []) {
  const requetes: string[] = [];
  return {
    requetes,
    query: async <R>(sql: string): Promise<{ rows: R[] }> => {
      requetes.push(sql.replace(/\s+/g, " ").trim());
      const lignes = /FROM organizations/i.test(sql) ? organizations : /FROM org_settings/i.test(sql) ? legacy : [];
      return { rows: lignes as unknown as R[] };
    },
  };
}

/** Stripe simule : clients retrouves par e-mail et abonnements par client. */
function fauxStripe(opts: { clientsParEmail?: string[]; abonnementsParClient?: Record<string, string[]>; panne?: boolean } = {}) {
  const emailsConsultes: string[] = [];
  const clientsConsultes: string[] = [];
  return {
    emailsConsultes,
    clientsConsultes,
    customers: {
      list: async (p: { email: string; limit: number; starting_after?: string }) => {
        if (opts.panne) throw new Error("stripe indisponible (simule)");
        emailsConsultes.push(p.email);
        return { data: (opts.clientsParEmail ?? []).map((id) => ({ id })), has_more: false };
      },
    },
    subscriptions: {
      list: async (p: { customer: string; status: "all"; limit: number }) => {
        clientsConsultes.push(p.customer);
        return { data: (opts.abonnementsParClient?.[p.customer] ?? []).map((id) => ({ id })) };
      },
    },
  };
}

const { isTrialEligibleForIdentity } = await import("../services/stripe-trial-history.js");

/* ── G3-a — decision en base : un essai appartient a une personne ──────── */

describe("G3 — isTrialEligibleForIdentity refuse un deuxieme essai", () => {
  it("essai deja consomme par l'organisation : refus immediat, Stripe n'est meme pas consulte", async () => {
    const pool = faussePool([vierge({ trial_consumed_at: "2026-01-15T00:00:00.000Z", stripe_customer_id: "cus_a" })]);
    const stripe = fauxStripe();

    await expect(isTrialEligibleForIdentity(pool, { email: EMAIL_HISTORIQUE }, stripe)).resolves.toBe(false);
    expect(stripe.emailsConsultes).toEqual([]);
    expect(stripe.clientsConsultes).toEqual([]);
  });

  it("souscription deja rattachee a l'organisation : refus", async () => {
    const pool = faussePool([vierge({ stripe_subscription_id: "sub_en_cours" })]);
    await expect(isTrialEligibleForIdentity(pool, { email: EMAIL_HISTORIQUE }, fauxStripe())).resolves.toBe(false);
  });

  it("etat legacy org_settings (essai consomme) : refus", async () => {
    const pool = faussePool([], [vierge({ trial_consumed_at: "2025-12-01T00:00:00.000Z" })]);
    await expect(isTrialEligibleForIdentity(pool, { email: EMAIL_HISTORIQUE }, fauxStripe())).resolves.toBe(false);
  });

  it("etat legacy org_settings (souscription) : refus", async () => {
    const pool = faussePool([], [vierge({ stripe_subscription_id: "sub_legacy" })]);
    await expect(isTrialEligibleForIdentity(pool, { email: EMAIL_HISTORIQUE }, fauxStripe())).resolves.toBe(false);
  });

  it("historique d'abonnement sur le client ancre en base : refus", async () => {
    const pool = faussePool([vierge({ stripe_customer_id: "cus_ancre" })]);
    const stripe = fauxStripe({ abonnementsParClient: { cus_ancre: ["sub_annule"] } });

    await expect(isTrialEligibleForIdentity(pool, { email: EMAIL_HISTORIQUE }, stripe)).resolves.toBe(false);
    expect(stripe.clientsConsultes).toContain("cus_ancre");
  });

  it("historique d'abonnement sur un AUTRE client du meme e-mail : refus", async () => {
    const pool = faussePool([]);
    const stripe = fauxStripe({ clientsParEmail: ["cus_autre"], abonnementsParClient: { cus_autre: ["sub_precedent"] } });

    await expect(isTrialEligibleForIdentity(pool, { email: EMAIL_HISTORIQUE }, stripe)).resolves.toBe(false);
    expect(stripe.emailsConsultes).toEqual([EMAIL_HISTORIQUE]);
  });

  it("identite vierge (aucune organisation, aucun client Stripe) : essai accorde", async () => {
    const pool = faussePool([]);
    await expect(isTrialEligibleForIdentity(pool, { email: EMAIL_NEUF }, fauxStripe())).resolves.toBe(true);
  });

  it("les deux tables sont interrogees sur l'e-mail, en minuscules", async () => {
    const pool = faussePool([]);
    await isTrialEligibleForIdentity(pool, { email: EMAIL_NEUF }, fauxStripe());
    expect(pool.requetes.some((q) => /FROM organizations WHERE lower\(owner_email\) = lower\(\$1\)/i.test(q))).toBe(true);
    expect(pool.requetes.some((q) => /FROM org_settings WHERE lower\(org_id\) = lower\(\$1\)/i.test(q))).toBe(true);
  });

  it("panne du fournisseur : l'erreur remonte pour que l'appelant echoue ferme", async () => {
    const pool = faussePool([]);
    await expect(isTrialEligibleForIdentity(pool, { email: EMAIL_NEUF }, fauxStripe({ panne: true })))
      .rejects.toThrow(/stripe indisponible/);
  });
});

/* ── G3-b — meme decision vue par la route qui annonce le prix ─────────── */

const ORGANISATIONS: Record<string, Ligne[]> = {};
const PENDING: Record<string, { email: string; stripe_customer_id: string | null }> = {
  [TOKEN_NEUF]: { email: EMAIL_NEUF, stripe_customer_id: null },
  [TOKEN_HISTORIQUE]: { email: EMAIL_HISTORIQUE, stripe_customer_id: null },
};

function reponseSql(sql: string, values: unknown[] = []) {
  if (/FROM pending_signups/i.test(sql)) {
    const row = PENDING[String(values[0])];
    return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
  }
  if (/FROM organizations/i.test(sql)) {
    const rows = ORGANISATIONS[String(values[0]).toLowerCase()] ?? [];
    return { rows, rowCount: rows.length };
  }
  return { rows: [], rowCount: 0 };
}

vi.mock("@workspace/db", () => ({
  pool: {
    connect: async () => ({ query: async (s: string, v: unknown[] = []) => reponseSql(s, v), release: () => {} }),
    query: async (s: string, v: unknown[] = []) => reponseSql(s, v),
  },
}));
vi.mock("../services/billing-context.js", () => ({
  loadBillingContext: vi.fn(async () => ({
    plan: null, subscriptionStatus: null, stripeCustomerId: null, email: null, canStartTrial: true, trialEndsAt: null,
  })),
}));
vi.mock("../services/sessions.js", () => ({ getSession: vi.fn(async () => null) }));
vi.mock("../services/ensure-stripe-customer.js", () => ({ ensureStripeCustomer: vi.fn(async () => null) }));
vi.mock("../services/pending-signup-stripe-customer.js", () => ({
  ensurePendingSignupStripeCustomer: vi.fn(async () => ({ customerId: "cus_simule", hasSubscriptionHistory: false })),
}));
vi.mock("../services/seller-attribution.js", () => ({
  resolveSellerIdFromToken: vi.fn(async () => null), validateSellerCode: vi.fn(async () => null),
}));
vi.mock("../middlewares/rateLimiter.js", () => ({
  createRateLimit: () => (_q: unknown, _r: unknown, n: () => void) => n(),
  publicCheckoutRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  funnelEventRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
}));
vi.mock("../services/addons-service.js", () => ({
  activateAddon: vi.fn(async () => true), deactivateAddon: vi.fn(async () => true), provisionPlanAddons: vi.fn(async () => {}),
}));

const { setStripeForTesting } = await import("../services/stripe-factory.js");
const { default: publicBillingRouter } = await import("../routes/public-billing.js");

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: express.Request & { cookies?: Record<string, string> }, _res, next) => { req.cookies = {}; next(); });
  a.use("/api", publicBillingRouter);
  return a;
}

function devis(preRegisterToken: string) {
  return request(app()).post("/api/billing/quote").send({ plan: "standard", addons: {}, preRegisterToken });
}

beforeEach(() => {
  for (const k of Object.keys(ORGANISATIONS)) delete ORGANISATIONS[k];
  setStripeForTesting(fauxStripe());
});
afterAll(() => setStripeForTesting(null));

describe("G3 — POST /api/billing/quote n'annonce jamais un deuxieme essai", () => {
  it("premiere inscription : essai de 14 jours, rien du aujourd'hui", async () => {
    const r = await devis(TOKEN_NEUF);
    expect(r.status).toBe(200);
    expect(r.body.quote.trialEligible).toBe(true);
    expect(r.body.quote.trialDays).toBe(14);
    expect(r.body.quote.amountDueTodayMinor).toBe(0);
    expect(r.body.quote.lines[0].billedToday).toBe(false);
  });

  it("essai deja consomme par cet e-mail : aucun essai, le plan est du aujourd'hui", async () => {
    ORGANISATIONS[EMAIL_HISTORIQUE] = [vierge({ trial_consumed_at: "2026-02-01T00:00:00.000Z" })];
    const r = await devis(TOKEN_HISTORIQUE);
    expect(r.status).toBe(200);
    expect(r.body.quote.trialEligible).toBe(false);
    expect(r.body.quote.trialDays).toBe(0);
    expect(r.body.quote.amountDueTodayMinor).toBeGreaterThan(0);
    expect(r.body.quote.lines[0].billedToday).toBe(true);
  });

  it("souscription deja existante pour cet e-mail : aucun essai", async () => {
    ORGANISATIONS[EMAIL_HISTORIQUE] = [vierge({ stripe_subscription_id: "sub_en_cours" })];
    const r = await devis(TOKEN_HISTORIQUE);
    expect(r.status).toBe(200);
    expect(r.body.quote.trialEligible).toBe(false);
    expect(r.body.quote.trialDays).toBe(0);
  });

  it("historique d'abonnement chez Stripe sur un autre client : aucun essai", async () => {
    setStripeForTesting(fauxStripe({ clientsParEmail: ["cus_precedent"], abonnementsParClient: { cus_precedent: ["sub_annule"] } }));
    const r = await devis(TOKEN_HISTORIQUE);
    expect(r.status).toBe(200);
    expect(r.body.quote.trialEligible).toBe(false);
    expect(r.body.quote.trialDays).toBe(0);
  });

  it("historique Stripe illisible : echec ferme, aucun essai annonce", async () => {
    setStripeForTesting(fauxStripe({ panne: true }));
    const r = await devis(TOKEN_NEUF);
    expect(r.status).toBe(200);
    expect(r.body.quote.trialEligible).toBe(false);
    expect(r.body.quote.trialDays).toBe(0);
  });

  it("jeton d'inscription inconnu et aucune session : aucun essai", async () => {
    const r = await devis(TOKEN_INCONNU);
    expect(r.status).toBe(200);
    expect(r.body.quote.trialEligible).toBe(false);
    expect(r.body.quote.trialDays).toBe(0);
  });
});
