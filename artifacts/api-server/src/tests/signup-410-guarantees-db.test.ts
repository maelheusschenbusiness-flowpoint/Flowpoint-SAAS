/**
 * Garanties de #410 portees dans l'architecture de #390 (signup-subscription.ts).
 *
 * Fusion #390 x #410 : le webhook `payment_intent.succeeded` (onglet ferme)
 *  1. cree le Customer Stripe de l'inscription APRES confirmation, l'ancre sur
 *     pending_signups et y rattache la souscription (ensurePendingSignupStripeCustomer) ;
 *  2. retrouve ce meme Customer a la relivraison (aucun second Customer, aucune
 *     seconde souscription, une seule organisation) ;
 *  3. refuse un deuxieme essai gratuit quand l'e-mail a deja un historique
 *     d'abonnement chez Stripe, meme sur un AUTRE Customer (hasStripeSubscriptionHistory) ;
 *  4. exige un moyen de paiement sur le PaymentIntent (sinon 500, relivraison).
 *
 * PostgreSQL local jetable (comme la CI), Stripe entierement simule, vrai routeur
 * webhook (signature HMAC verifiee). E-mails `g410-*@example.test`, nettoyes ensuite.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHmac, randomUUID } from "node:crypto";

const WEBHOOK_SECRET = "whsec_g410_unit";
vi.hoisted(() => {
  process.env["STRIPE_TEST_MODE"] = "true";
  process.env["STRIPE_TEST_KEY"] = "sk_test_g410_unit";
  process.env["STRIPE_TEST_WEBHOOK_SECRET"] = "whsec_g410_unit";
  process.env["STRIPE_TEST_PRICE_ID_STANDARD"] = "price_test_standard_g410";
  delete process.env["STRIPE_WEBHOOK_SECRET"];
  delete process.env["STRIPE_WEBHOOK_SECRET_RENDER"];
  delete process.env["ALLOW_UNSIGNED_STRIPE_WEBHOOKS"];
});

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../services/mailer.js", () => ({
  mailer: new Proxy({}, { get: () => vi.fn(async () => ({ ok: true })) }),
}));
vi.mock("../services/store.js", () => ({
  store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn() },
}));

const { pool } = await import("@workspace/db");
const { setStripeForTesting } = await import("../services/stripe-factory.js");
const { ensureClaimTable } = await import("../services/checkout-subscription-claim.js");

const RUN = randomUUID().slice(0, 8);
const PRICE = "price_test_standard_g410";
const DAY = 86400;

type FakeSub = {
  id: string; customer: string; status: string; trial_end: number | null;
  cancel_at_period_end: boolean; metadata: Record<string, string>;
  items: { data: Array<{ price: { id: string }; quantity: number }> };
  current_period_end: number;
};
type FakeCustomer = { id: string; email: string; metadata: Record<string, string> };
let subs: FakeSub[] = [];
let customersList: FakeCustomer[] = [];
let byKey = new Map<string, unknown>();
let createdCustomers = 0;
let failCreateOnce = false;
let forcedStatus: string | null = null;
const intents = new Map<string, Record<string, unknown>>();

function stripeClient() {
  return {
    setupIntents: { retrieve: async (id: string) => intents.get(id) },
    paymentIntents: { retrieve: async (id: string) => intents.get(id) },
    customers: {
      retrieve: async (id: string) => customersList.find((c) => c.id === id) ?? { id, metadata: {} },
      list: async (p: { email: string }) => ({
        data: customersList.filter((c) => c.email.toLowerCase() === p.email.toLowerCase()),
        has_more: false,
      }),
      create: async (params: { email: string; metadata: Record<string, string> }, o?: { idempotencyKey?: string }) => {
        if (o?.idempotencyKey && byKey.has(o.idempotencyKey)) return byKey.get(o.idempotencyKey);
        createdCustomers++;
        const c = { id: `cus_g410_${RUN}_${customersList.length + 1}`, email: params.email, metadata: params.metadata ?? {} };
        customersList.push(c);
        if (o?.idempotencyKey) byKey.set(o.idempotencyKey, c);
        return c;
      },
      update: async (id: string) => ({ id }),
    },
    paymentMethods: {
      retrieve: async (id: string) => ({ id, customer: null, billing_details: {} }),
      attach: async (id: string) => ({ id }),
    },
    subscriptions: {
      list: async (p: { customer: string; limit?: number }) => ({
        data: subs.filter((s) => s.customer === p.customer).slice(0, p.limit ?? 10),
      }),
      retrieve: async (id: string) => subs.find((s) => s.id === id),
      cancel: async (id: string) => subs.find((s) => s.id === id),
      create: async (params: Record<string, unknown>, o?: { idempotencyKey?: string }) => {
        if (o?.idempotencyKey && byKey.has(o.idempotencyKey)) return byKey.get(o.idempotencyKey);
        await new Promise((r) => setTimeout(r, 10)); // latence reseau
        if (failCreateOnce) {
          failCreateOnce = false;
          throw Object.assign(new Error("stripe indisponible (simule)"), { code: "api_connection_error" });
        }
        const items = (params["items"] as Array<{ price: string; quantity: number }>) ?? [];
        const trialEnd = typeof params["trial_end"] === "number" ? (params["trial_end"] as number) : null;
        const sub: FakeSub = {
          id: `sub_g410_${RUN}_${subs.length + 1}`,
          customer: String(params["customer"]),
          status: forcedStatus ?? (trialEnd ? "trialing" : "active"),
          trial_end: trialEnd,
          cancel_at_period_end: false,
          metadata: (params["metadata"] as Record<string, string>) ?? {},
          items: { data: items.map((i) => ({ price: { id: i.price }, quantity: i.quantity })) },
          current_period_end: (trialEnd ?? Math.floor(Date.now() / 1000)) + 30 * DAY,
        };
        subs.push(sub);
        if (o?.idempotencyKey) byKey.set(o.idempotencyKey, sub);
        return sub;
      },
    },
  };
}

const emails: string[] = [];
const intentIds: string[] = [];
let seq = 0;

async function seedSignup(): Promise<{ email: string; token: string }> {
  const n = ++seq;
  const email = `g410-${RUN}-${n}@example.test`;
  const token = `g410tok-${RUN}-${n}`;
  emails.push(email);
  await pool.query(
    `INSERT INTO pending_signups (token, email, first_name, last_name, company_name)
     VALUES ($1, $2, 'Test', 'G410', 'Societe G410')`,
    [token, email],
  );
  return { email, token };
}

function piEvent(token: string, opts: { paymentMethod?: string | null } = {}) {
  const id = `pi_g410_${RUN}_${randomUUID().slice(0, 6)}`;
  intentIds.push(id);
  const intent = {
    id, object: "payment_intent", status: "succeeded",
    created: Math.floor(Date.now() / 1000) - 60,
    customer: null,
    payment_method: opts.paymentMethod === undefined ? `pm_g410_${RUN}_${seq}` : opts.paymentMethod,
    metadata: { plan: "standard", pre_register_token: token, trial_days_remaining: "14", addons: "{}" },
  };
  return (eventId = `evt_g410_${RUN}_${id}`) => ({ id: eventId, type: "payment_intent.succeeded", livemode: false, data: { object: intent } });
}

async function postWebhook(event: Record<string, unknown>): Promise<number> {
  const { default: router } = await import("../routes/stripe-webhook.js");
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> })
    .stack.find((l) => l.route?.path === "/webhooks/stripe");
  const res = {
    statusCode: 200, body: undefined as unknown,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
  };
  const rawBody = Buffer.from(JSON.stringify(event));
  const ts = Math.floor(Date.now() / 1000);
  const sig = `t=${ts},v1=${createHmac("sha256", WEBHOOK_SECRET).update(`${ts}.${rawBody.toString("utf8")}`).digest("hex")}`;
  await layer!.route!.stack[0]!.handle({ headers: { "stripe-signature": sig }, body: event, rawBody }, res);
  return res.statusCode;
}

async function orgsOf(email: string) {
  const r = await pool.query<{ subscription_status: string; stripe_subscription_id: string | null; stripe_customer_id: string | null; trial_ends_at: Date | null }>(
    `SELECT subscription_status, stripe_subscription_id, stripe_customer_id, trial_ends_at
       FROM organizations WHERE lower(owner_email) = lower($1)`, [email]);
  return r.rows;
}

beforeAll(async () => { await ensureClaimTable(pool); });
beforeEach(() => {
  subs = []; customersList = []; byKey = new Map(); createdCustomers = 0;
  failCreateOnce = false; forcedStatus = null; intents.clear();
  setStripeForTesting(stripeClient());
});
afterAll(async () => {
  setStripeForTesting(null);
  await pool.query(`DELETE FROM checkout_subscription_claims WHERE intent_id = ANY($1)`, [intentIds]).catch(() => {});
  await pool.query(`DELETE FROM billing_events WHERE stripe_event_id LIKE $1`, [`evt_g410_${RUN}%`]).catch(() => {});
  await pool.query(`DELETE FROM organization_members WHERE organization_id IN (SELECT id FROM organizations WHERE owner_email = ANY($1))`, [emails]).catch(() => {});
  await pool.query(`DELETE FROM organizations WHERE owner_email = ANY($1)`, [emails]).catch(() => {});
  await pool.query(`DELETE FROM org_settings WHERE org_id = ANY($1)`, [emails]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [emails]).catch(() => {});
  await pool.query(`DELETE FROM pending_signups WHERE email = ANY($1)`, [emails]).catch(() => {});
});

describe("#410 dans l'architecture #390 — webhook payment_intent.succeeded (onglet ferme)", () => {
  it("cree le Customer en attente APRES confirmation, l'ancre sur pending_signups, et la souscription d'essai s'y rattache", async () => {
    const s = await seedSignup();
    const status = await postWebhook(piEvent(s.token)());
    expect(status).toBe(200);
    expect(createdCustomers).toBe(1);
    const anchored = await pool.query(`SELECT stripe_customer_id FROM pending_signups WHERE token = $1`, [s.token]);
    const customerId = anchored.rows[0]!.stripe_customer_id as string;
    expect(customerId).toBe(customersList[0]!.id);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.customer).toBe(customerId);
    expect(subs[0]!.status).toBe("trialing");
    const orgs = await orgsOf(s.email);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.subscription_status).toBe("trialing");
    expect(orgs[0]!.stripe_subscription_id).toBe(subs[0]!.id);
    expect(orgs[0]!.stripe_customer_id).toBe(customerId);
  });

  it("relivraison (meme intent, nouvel evenement) : retrouve le MEME Customer, aucune seconde souscription ni organisation", async () => {
    const s = await seedSignup();
    const ev = piEvent(s.token);
    expect(await postWebhook(ev())).toBe(200);
    expect(await postWebhook(ev(`evt_g410_${RUN}_replay_${s.token}`))).toBe(200);
    expect(createdCustomers).toBe(1);
    expect(subs).toHaveLength(1);
    expect(await orgsOf(s.email)).toHaveLength(1);
  });

  it("deuxieme essai refuse : l'e-mail a un abonnement ANNULE sur un autre Customer => facturation immediate, aucun trial_end", async () => {
    const s = await seedSignup();
    const previous = { id: `cus_g410_${RUN}_old`, email: s.email, metadata: {} };
    customersList.push(previous);
    subs.push({
      id: `sub_g410_${RUN}_old`, customer: previous.id, status: "canceled", trial_end: null,
      cancel_at_period_end: false, metadata: {}, items: { data: [{ price: { id: PRICE }, quantity: 1 }] },
      current_period_end: Math.floor(Date.now() / 1000) - DAY,
    });
    expect(await postWebhook(piEvent(s.token)())).toBe(200);
    const created = subs.filter((x) => x.id !== `sub_g410_${RUN}_old`);
    expect(created).toHaveLength(1);
    expect(created[0]!.trial_end).toBeNull();
    expect(created[0]!.status).toBe("active");
    const orgs = await orgsOf(s.email);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.subscription_status).toBe("active");
    expect(orgs[0]!.trial_ends_at).toBeNull();
  });

  it("PaymentIntent reussi SANS moyen de paiement : 500 (relivraison), ni Customer, ni souscription, ni organisation", async () => {
    const s = await seedSignup();
    expect(await postWebhook(piEvent(s.token, { paymentMethod: null })())).toBe(500);
    expect(createdCustomers).toBe(0);
    expect(subs).toHaveLength(0);
    expect(await orgsOf(s.email)).toHaveLength(0);
  });
});

/* ── Essai a 0 EUR : SetupIntent confirme puis onglet ferme ─────────────────── */

function setupIntent(token: string, opts: { plan?: string } = {}) {
  const id = `seti_g410_${RUN}_${randomUUID().slice(0, 6)}`;
  intentIds.push(id);
  const intent = {
    id, object: "setup_intent", status: "succeeded",
    created: Math.floor(Date.now() / 1000) - 60,
    customer: null, // depuis #410 : aucun Customer avant confirmation
    payment_method: `pm_g410_${RUN}_${randomUUID().slice(0, 4)}`,
    metadata: { plan: opts.plan ?? "standard", pre_register_token: token, trial_days_remaining: "14", addons: "{}" },
  };
  intents.set(id, intent);
  return {
    intent,
    event: (eventId = `evt_g410_${RUN}_${id}`) =>
      ({ id: eventId, type: "setup_intent.succeeded", livemode: false, data: { object: intent } }),
  };
}

async function postFinalize(intentId: string, token: string): Promise<number> {
  const { default: router } = await import("../routes/public-billing.js");
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> })
    .stack.find((l) => l.route?.path === "/public/finalize-checkout");
  const handlers = layer!.route!.stack;
  const res = {
    statusCode: 200, body: {} as unknown,
    status(c: number) { this.statusCode = c; return this; },
    json(b: unknown) { this.body = b; return this; },
    cookie() { return this; }, setHeader() { return this; },
  };
  await handlers[handlers.length - 1]!.handle({
    body: { intentId, intentType: "setup", plan: "standard", preRegisterToken: token },
    headers: {}, cookies: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" }, get: () => undefined,
  }, res);
  return res.statusCode;
}

const PREMIUM = ["trialing", "active"];

describe("Essai 0 EUR — SetupIntent reussi, onglet ferme (webhook seul, sans finalize)", () => {
  it("cree le Customer, UNE souscription Stripe trialing reelle (trial_end = created + 14 j) et l'organisation trialing qui la reference", async () => {
    const s = await seedSignup();
    const si = setupIntent(s.token);
    expect(await postWebhook(si.event())).toBe(200);
    expect(createdCustomers).toBe(1);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.status).toBe("trialing");
    expect(subs[0]!.trial_end).toBe(si.intent.created + 14 * DAY);
    const orgs = await orgsOf(s.email);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.subscription_status).toBe("trialing");
    expect(orgs[0]!.stripe_subscription_id).toBe(subs[0]!.id);
    expect(orgs[0]!.stripe_customer_id).toBe(subs[0]!.customer);
    expect(Math.floor(orgs[0]!.trial_ends_at!.getTime() / 1000)).toBe(si.intent.created + 14 * DAY);
  });

  it("souscription Stripe NON trialing (incomplete) : 500, aucune organisation premium", async () => {
    const s = await seedSignup();
    forcedStatus = "incomplete";
    expect(await postWebhook(setupIntent(s.token).event())).toBe(500);
    const orgs = await orgsOf(s.email);
    expect(orgs.filter((o) => PREMIUM.includes(o.subscription_status))).toHaveLength(0);
  });

  it("plan inconnu (aucune souscription possible) : organisation pending_billing, jamais trialing, sans trial_ends_at", async () => {
    const s = await seedSignup();
    expect(await postWebhook(setupIntent(s.token, { plan: "inexistant" }).event())).toBe(200);
    expect(subs).toHaveLength(0);
    const orgs = await orgsOf(s.email);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.subscription_status).toBe("pending_billing");
    expect(orgs[0]!.stripe_subscription_id).toBeNull();
    expect(orgs[0]!.trial_ends_at).toBeNull();
  });

  it("rejeu (meme evenement puis nouvel evenement) : un Customer, une souscription, une organisation", async () => {
    const s = await seedSignup();
    const si = setupIntent(s.token);
    expect(await postWebhook(si.event())).toBe(200);
    expect(await postWebhook(si.event())).toBe(200);
    expect(await postWebhook(si.event(`evt_g410_${RUN}_again_${si.intent.id}`))).toBe(200);
    expect(createdCustomers).toBe(1);
    expect(subs).toHaveLength(1);
    expect(await orgsOf(s.email)).toHaveLength(1);
  });

  it("echec Stripe transitoire : 500 sans acces premium, puis la relivraison ouvre l'essai (une seule souscription)", async () => {
    const s = await seedSignup();
    const si = setupIntent(s.token);
    failCreateOnce = true;
    expect(await postWebhook(si.event())).toBe(500);
    expect(subs).toHaveLength(0);
    expect((await orgsOf(s.email)).filter((o) => PREMIUM.includes(o.subscription_status))).toHaveLength(0);
    expect(await postWebhook(si.event())).toBe(200);
    expect(subs).toHaveLength(1);
    const orgs = await orgsOf(s.email);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.subscription_status).toBe("trialing");
    expect(orgs[0]!.stripe_subscription_id).toBe(subs[0]!.id);
  });

  it("deuxieme essai refuse : historique d'abonnement sur l'e-mail => souscription active facturee, aucun trial", async () => {
    const s = await seedSignup();
    const previous = { id: `cus_g410_${RUN}_prev`, email: s.email, metadata: {} };
    customersList.push(previous);
    subs.push({
      id: `sub_g410_${RUN}_prev`, customer: previous.id, status: "canceled", trial_end: null,
      cancel_at_period_end: false, metadata: {}, items: { data: [{ price: { id: PRICE }, quantity: 1 }] },
      current_period_end: Math.floor(Date.now() / 1000) - DAY,
    });
    expect(await postWebhook(setupIntent(s.token).event())).toBe(200);
    const created = subs.filter((x) => x.id !== `sub_g410_${RUN}_prev`);
    expect(created).toHaveLength(1);
    expect(created[0]!.trial_end).toBeNull();
    const orgs = await orgsOf(s.email);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.subscription_status).not.toBe("trialing");
    expect(orgs[0]!.trial_ends_at).toBeNull();
  });

  it("concurrence : 8 paires webhook/finalize simultanees => un Customer, une souscription trialing, une organisation par inscription", async () => {
    const withRetry = async (fn: () => Promise<number>) => {
      let r = await fn();
      for (let i = 0; i < 4 && r >= 500; i++) r = await fn();
      return r;
    };
    const signups = await Promise.all(Array.from({ length: 8 }, async () => {
      const s = await seedSignup();
      return { ...s, si: setupIntent(s.token) };
    }));
    const results = await Promise.all(signups.flatMap((s) => [
      withRetry(() => postWebhook(s.si.event())),
      withRetry(() => postFinalize(s.si.intent.id, s.token)),
    ]));
    for (const r of results) expect([200, 409]).toContain(r);
    for (const s of signups) {
      const anchored = await pool.query(`SELECT stripe_customer_id FROM pending_signups WHERE token = $1`, [s.token]);
      const customerId = anchored.rows[0]!.stripe_customer_id as string;
      expect(customerId).toBeTruthy();
      const own = subs.filter((x) => x.customer === customerId);
      expect(own).toHaveLength(1);
      expect(own[0]!.status).toBe("trialing");
      const orgs = await orgsOf(s.email);
      expect(orgs).toHaveLength(1);
      expect(orgs[0]!.subscription_status).toBe("trialing");
      expect(orgs[0]!.stripe_subscription_id).toBe(own[0]!.id);
    }
    expect(createdCustomers).toBe(8);
  });
});
