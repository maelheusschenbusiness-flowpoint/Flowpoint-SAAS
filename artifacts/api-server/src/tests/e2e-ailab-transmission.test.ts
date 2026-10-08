/**
 * E2E — transmission reelle FlowPoint -> AI Lab.
 *
 * Rien n'est simule du cote transport : le client `conversion-events.ts` n'est
 * PAS mocke, il poste vraiment en HTTP vers le recepteur AI Lab de la PR #125,
 * qui ecrit dans un vrai PostgreSQL. Seul le stockage propre au SaaS est
 * factice : ce n'est pas lui qu'on certifie ici.
 *
 * Stripe est simule sans paiement : la signature est produite par la vraie
 * bibliotheque `stripe` et verifiee par le vrai `constructEvent`. Aucun appel
 * reseau vers Stripe, aucun encaissement.
 *
 * CE FICHIER N'EST PAS DANS `vitest.config.ts` A DESSEIN : il exige un recepteur
 * AI Lab vivant et un PostgreSQL jetable, que la CI n'a pas. Il se lance a la
 * main, avec son propre config :
 *
 *   AILAB_URL=http://127.0.0.1:5599/events/conversion \
 *   AILAB_SECRET=<>=32 caracteres> E2E_FP_LID=<jeton> E2E_FP_LID_B=<autre jeton> \
 *   npx vitest run --config <chemin>/vitest.e2e.config.ts
 *
 * Le recepteur doit tourner sur la branche de la PR #125, avec une base nommee
 * `flowpoint_acquisition` sur un cluster JETABLE — les deux fabriques de
 * connexion refusent tout autre nom de base.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import Stripe from "stripe";

const AILAB = process.env["AILAB_URL"]!;
const SECRET = process.env["AILAB_SECRET"]!;
const FP_LID = process.env["E2E_FP_LID"]!;
const WH_SECRET = "whsec_e2e_only_secret";
const EMAIL = "e2e-lead@example.com";
const ORG = "11111111-2222-3333-4444-555555555555";
const CUS = "cus_E2E";

process.env["AI_LAB_CONVERSION_URL"] = AILAB;
process.env["CONVERSION_EVENT_SECRET"] = SECRET;
process.env["STRIPE_WEBHOOK_SECRET"] = WH_SECRET;

// ── Postgres factice, cote SaaS uniquement ───────────────────────────────────
let pending: Array<{ token: string; fp_lid: string | null; created_at: Date }>;
let orgFpLid: string | null;
let billingClaim: boolean;
export let statusWrites: Record<string, unknown>[] = [];

function answer(sql: string, v: unknown[] = []) {
  const s = sql.replace(/\s+/g, " ").trim();
  if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(s)) return { rows: [], rowCount: 0 };
  if (/DELETE FROM pending_signups WHERE lower\(email\)/i.test(s)) return { rows: [], rowCount: 0 };
  if (/^INSERT INTO pending_signups/i.test(s)) {
    // Le vrai INSERT renvoie created_at et fp_lid : l'emetteur signup s'en sert.
    const row = { token: String(v[0]), fp_lid: (v[12] as string) ?? null, created_at: new Date() };
    pending.push(row);
    return { rows: [{ created_at: row.created_at, fp_lid: row.fp_lid }], rowCount: 1 };
  }
  if (/SELECT id::text, subscription_status FROM organizations WHERE owner_email/i.test(s)) {
    return { rows: [], rowCount: 0 };
  }
  if (/INSERT INTO billing_events/i.test(s)) {
    return { rows: billingClaim ? [{ status: null }] : [], rowCount: billingClaim ? 1 : 0 };
  }
  if (/UPDATE billing_events SET metadata = jsonb_set/i.test(s)) {
    statusWrites.push({ status: String(v[1] ?? ""), ...JSON.parse(String(v[2] ?? "{}")) });
    return { rows: [], rowCount: 1 };
  }
  if (/UPDATE billing_events SET metadata/i.test(s)) return { rows: [], rowCount: 1 };
  if (/SELECT fp_lid FROM organizations/i.test(s)) {
    return { rows: [{ fp_lid: orgFpLid }], rowCount: 1 };
  }
  if (/UPDATE billing_events/i.test(s)) return { rows: [], rowCount: 1 };
  return { rows: [], rowCount: 0 };
}

vi.mock("@workspace/db", () => {
  const client = { query: vi.fn(async (s: string, v?: unknown[]) => answer(s, v)), release: vi.fn() };
  return { pool: { connect: vi.fn(async () => client), query: vi.fn(async (s: string, v?: unknown[]) => answer(s, v)) },
           db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn() };
});
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
vi.mock("../middlewares/rateLimiter.js", () => ({
  createRateLimit: () => (_q: unknown, _r: unknown, n: () => void) => n(),
  authRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  publicCheckoutRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
  globalRateLimit: (_q: unknown, _r: unknown, n: () => void) => n(),
}));
vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings: vi.fn(async () => null), upsertOrgSettings: vi.fn(async () => {}) }));
vi.mock("../services/seller-attribution.js", () => ({
  validateSellerCode: vi.fn(async () => null), resolveSellerIdFromToken: vi.fn(async () => null),
  recordCommission: vi.fn(async () => {}) }));
// La VRAIE bibliotheque Stripe, sans cle reelle : `constructEvent` est de la
// cryptographie pure, elle ne joint jamais le reseau.
const realStripe = new Stripe("sk_test_e2e_not_a_real_key", { apiVersion: "2025-02-24.acacia" as never });
vi.mock("../services/stripe-factory.js", () => ({
  getStripeKey: vi.fn(() => "sk_test_e2e_not_a_real_key"),
  createStripeClient: vi.fn(async () => realStripe) }));
vi.mock("../services/mailer.js", () => ({
  mailer: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }) }));
vi.mock("../services/store.js", () => ({ store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn() } }));
vi.mock("../services/addons-service.js", () => ({
  activateAddon: vi.fn(async () => true), deactivateAddon: vi.fn(async () => true),
  provisionPlanAddons: vi.fn(async () => {}) }));
vi.mock("../services/org-data.js", () => ({
  findOrgByStripeCustomer: vi.fn(async () => ORG), persistOrgData: vi.fn(async () => {}),
  loadOrgData: vi.fn(async () => ({ email: EMAIL, firstName: "Jean", plan: "standard" })) }));

const { default: authRouter } = await import("../routes/auth.js");
const { default: webhookRouter } = await import("../routes/stripe-webhook.js");

function saasApp() {
  const a = express();
  a.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));
  a.use((req: any, _res, next) => { req.cookies = {}; next(); });
  a.use("/api", authRouter);
  a.use(webhookRouter);
  return a;
}

/** Un evenement Stripe signe par la vraie bibliotheque. Aucun paiement. */
function signed(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  return realStripe.webhooks.generateTestHeaderString({ payload, secret: WH_SECRET });
}

async function deliverStripe(event: Record<string, unknown>) {
  const payload = JSON.stringify(event);
  const res = await request(saasApp())
    .post("/webhooks/stripe")
    .set("stripe-signature", signed(event))
    .set("content-type", "application/json")
    .send(payload);
  await new Promise((r) => setTimeout(r, 400)); // l'emission est detachee
  return res;
}

const CREATED = Math.floor(Date.now() / 1000) - 120;
const checkoutEvent = () => ({
  id: "evt_e2e_checkout", type: "checkout.session.completed", created: CREATED,
  data: { object: { id: "cs_e2e", object: "checkout_session", customer: CUS, metadata: { orgId: ORG } } } });
const trialEvent = () => ({
  id: "evt_e2e_trial", type: "customer.subscription.created", created: CREATED,
  data: { object: { id: "sub_e2e", object: "subscription", customer: CUS, status: "trialing",
                    metadata: { orgId: ORG }, items: { data: [] } } } });
const paidEvent = () => ({
  id: "evt_e2e_paid", type: "invoice.payment_succeeded", created: CREATED,
  data: { object: { id: "in_e2e", object: "invoice", customer: CUS, subscription: "sub_e2e",
                    amount_paid: 4900, billing_reason: "subscription_cycle", lines: { data: [] },
                    metadata: { orgId: ORG } } } });

beforeEach(() => {
  pending = []; statusWrites = []; orgFpLid = FP_LID; billingClaim = true;
  process.env["AI_LAB_CONVERSION_URL"] = AILAB;
  process.env["CONVERSION_EVENT_SECRET"] = SECRET;
  vi.clearAllMocks();
});

describe("E2E — les quatre jalons traversent vraiment le reseau", () => {
  it("signup : /auth/pre-register emet vers AI Lab", async () => {
    const r = await request(saasApp()).post("/api/auth/pre-register").send({
      firstName: "Jean", lastName: "E2E", email: EMAIL, companyName: "Example", country: "FR",
      address: "1 rue", city: "Paris", postalCode: "75001", fp_lid: FP_LID });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 400));
  });

  it("checkout : checkout.session.completed signe emet vers AI Lab", async () => {
    const r = await deliverStripe(checkoutEvent());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ received: true });
  });

  it("trial : customer.subscription.created trialing emet vers AI Lab", async () => {
    const r = await deliverStripe(trialEvent());
    expect(r.status).toBe(200);
  });

  it("paid : invoice.payment_succeeded emet vers AI Lab", async () => {
    const r = await deliverStripe(paidEvent());
    expect(r.status).toBe(200);
    expect(statusWrites[0]).toMatchObject({ status: "processed", aiLabStages: ["paid"] });
  });

  it("redelivraison : les memes evenements ne peuvent pas gonfler le funnel", async () => {
    for (const e of [checkoutEvent(), trialEvent(), paidEvent()]) {
      const r = await deliverStripe(e);
      expect(r.status).toBe(200);
    }
  });
});

describe("E2E — resilience : AI Lab en panne ne bloque jamais FlowPoint", () => {
  it("mauvais secret : l inscription reussit quand meme", async () => {
    process.env["CONVERSION_EVENT_SECRET"] = "x".repeat(40);
    const r = await request(saasApp()).post("/api/auth/pre-register").send({
      firstName: "Jean", lastName: "E2E", email: EMAIL, companyName: "Example", country: "FR",
      address: "1 rue", city: "Paris", postalCode: "75001", fp_lid: FP_LID });
    expect(r.status).toBe(200);
    await new Promise((res) => setTimeout(res, 400));
  });

  it("AI Lab injoignable : le webhook Stripe repond 200 malgre tout", async () => {
    process.env["AI_LAB_CONVERSION_URL"] = "http://127.0.0.1:1/events/conversion";
    const r = await deliverStripe(paidEvent());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ received: true });
    // L'intention reste inscrite : le jalon est rattrapable.
    expect(statusWrites[0]).toMatchObject({ aiLabStages: ["paid"], aiLabEmitted: false });
  });

  it("AI Lab lent (timeout 2 s) : le webhook n attend pas et repond 200", async () => {
    process.env["AI_LAB_CONVERSION_URL"] = "http://10.255.255.1:9/events/conversion";
    const started = Date.now();
    const r = await deliverStripe(paidEvent());
    expect(r.status).toBe(200);
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it("non configure : aucune emission, aucun effet", async () => {
    delete process.env["AI_LAB_CONVERSION_URL"];
    const r = await deliverStripe(paidEvent());
    expect(r.status).toBe(200);
  });
});

/**
 * Sonde : un abonnement d'ADD-ON du parcours reel peut-il produire un jalon ?
 *
 * `finalize-checkout` (public-billing.ts:2404) cree l'abonnement d'add-on avec
 * `metadata { plan, addons, source: "checkout_payment_addons", flowpoint_cart }`
 * — SANS `addonSub`. Or c'est `addonSub` que `isAddonInvoice` cherche, et
 * `customer.subscription.created` n'a aucune garde add-on du tout. Cet
 * abonnement nait avec `trial_end = +30 jours`, donc `status: "trialing"`.
 */
const FP_LID_B = process.env["E2E_FP_LID_B"]!;
const ADDON_META = { plan: "standard", addons: '{"seats":2}',
                     source: "checkout_payment_addons", flowpoint_cart: "true" };

const addonSubCreated = () => ({
  id: "evt_e2e_addon_trial", type: "customer.subscription.created", created: CREATED,
  data: { object: { id: "sub_e2e_addon", object: "subscription", customer: CUS,
                    status: "trialing", metadata: { ...ADDON_META, orgId: ORG },
                    items: { data: [] } } } });

const addonRenewalInvoice = () => ({
  id: "evt_e2e_addon_paid", type: "invoice.payment_succeeded", created: CREATED,
  data: { object: { id: "in_e2e_addon", object: "invoice", customer: CUS,
                    subscription: "sub_e2e_addon", amount_paid: 1900,
                    billing_reason: "subscription_cycle",
                    subscription_details: { metadata: ADDON_META },
                    lines: { data: [{ metadata: ADDON_META }] },
                    metadata: { orgId: ORG } } } });

describe("E2E — l add-on du parcours reel ne produit aucun jalon", () => {
  it("customer.subscription.created d un add-on : un jalon trial part-il ?", async () => {
    orgFpLid = FP_LID_B;
    const r = await deliverStripe(addonSubCreated());
    expect(r.status).toBe(200);
    expect(statusWrites[0]!["aiLabStages"]).toBeUndefined();
  });

  it("facture de renouvellement d un add-on : un jalon paid part-il ?", async () => {
    orgFpLid = FP_LID_B;
    const r = await deliverStripe(addonRenewalInvoice());
    expect(r.status).toBe(200);
    expect(statusWrites[0]!["aiLabStages"]).toBeUndefined();
  });
});

/**
 * Le cas decisif : l'abonnement PRINCIPAL tel que `finalize-checkout` le cree.
 *
 * Aucune Checkout Session n'existe dans ce parcours, donc `checkout` ne pouvait
 * pas arriver. Cette creation d'abonnement doit desormais faire arriver DEUX
 * jalons — l'engagement, puis l'essai — sous deux identifiants distincts.
 */
const FP_LID_C = process.env["E2E_FP_LID_C"]!;
const planSubCreated = (status: string) => ({
  id: `evt_e2e_plan_${status}`, type: "customer.subscription.created", created: CREATED,
  data: { object: { id: "sub_e2e_plan", object: "subscription", customer: CUS, status,
                    metadata: { orgId: ORG, plan: "standard", source: "checkout_payment" },
                    items: { data: [] } } } });

describe("E2E — l abonnement principal du parcours PaymentIntent", () => {
  it("sa creation en essai fait arriver checkout PUIS trial", async () => {
    orgFpLid = FP_LID_C;
    const r = await deliverStripe(planSubCreated("trialing"));
    expect(r.status).toBe(200);
    expect(statusWrites[0]).toMatchObject({
      status: "processed", aiLabStages: ["checkout", "trial"] });
    expect(statusWrites.length).toBe(1);
  });

  it("une creation en incomplete ne fait rien arriver", async () => {
    orgFpLid = FP_LID_C;
    const r = await deliverStripe(planSubCreated("incomplete"));
    expect(r.status).toBe(200);
    expect(statusWrites[0]!["aiLabStages"]).toBeUndefined();
  });
});
