/**
 * A-09 — l'essai ne doit pas dependre du navigateur.
 *
 * Avant : le webhook `setup_intent.succeeded` activait l'organisation en
 * `trialing` (+14 j) mais la souscription Stripe n'etait creee que par
 * `finalize-checkout`, appele par l'onglet. Onglet ferme apres `confirmSetup`
 * (3DS, mobile, coupure) : organisation `trialing` SANS abonnement, donc aucun
 * prelevement a J+14.
 *
 * Ici : PostgreSQL local jetable (comme la CI), Stripe ENTIEREMENT simule
 * (aucun appel reseau, ni live ni test), le VRAI routeur webhook (signature
 * HMAC verifiee) et le VRAI handler finalize-checkout. Les donnees sont des
 * e-mails `a09-*@example.test`, nettoyes ensuite.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHmac, randomUUID } from "node:crypto";

const WEBHOOK_SECRET = "whsec_a09_unit";
vi.hoisted(() => {
  process.env["STRIPE_TEST_MODE"] = "true";
  process.env["STRIPE_TEST_KEY"] = "sk_test_a09_unit";
  process.env["STRIPE_TEST_WEBHOOK_SECRET"] = "whsec_a09_unit";
  process.env["STRIPE_TEST_PRICE_ID_STANDARD"] = "price_test_standard_a09";
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
const { TRIAL_DAYS } = await import("../services/billing-quote.js");
const { intentTrialDaysOf } = await import("../services/signup-subscription.js");

const RUN = randomUUID().slice(0, 8);
const PRICE = "price_test_standard_a09";
const DAY = 86400;

/* ── Stripe simule : idempotence reelle, aucune requete reseau ─────────────── */
type FakeSub = {
  id: string; customer: string; status: string; trial_end: number | null;
  cancel_at_period_end: boolean; metadata: Record<string, string>;
  items: { data: Array<{ price: { id: string }; quantity: number }> };
  current_period_end: number;
};
type Fake = {
  subs: FakeSub[];
  byKey: Map<string, FakeSub>;
  intents: Map<string, Record<string, unknown>>;
  createParams: Array<Record<string, unknown>>;
  createCalls: number;
  failCreate: boolean;
};
function newFake(): Fake {
  return { subs: [], byKey: new Map(), intents: new Map(), createParams: [], createCalls: 0, failCreate: false };
}
let fake: Fake = newFake();

function stripeClient() {
  return {
    setupIntents: { retrieve: async (id: string) => fake.intents.get(id) },
    paymentIntents: { retrieve: async (id: string) => fake.intents.get(id) },
    customers: {
      retrieve: async (id: string) => ({ id }),
      list: async () => ({ data: [] }),
      update: async (id: string) => ({ id }),
    },
    paymentMethods: {
      retrieve: async (id: string) => ({ id, customer: null, billing_details: {} }),
      attach: async (id: string) => ({ id }),
    },
    subscriptions: {
      list: async (p: { customer: string; limit?: number }) => ({
        data: fake.subs.filter((s) => s.customer === p.customer).slice(0, p.limit ?? 10),
      }),
      retrieve: async (id: string) => fake.subs.find((s) => s.id === id),
      cancel: async (id: string) => fake.subs.find((s) => s.id === id),
      create: async (params: Record<string, unknown>, options?: { idempotencyKey?: string }) => {
        fake.createCalls++;
        const k = options?.idempotencyKey;
        if (k && fake.byKey.has(k)) return fake.byKey.get(k)!;
        await new Promise((r) => setTimeout(r, 15)); // latence reseau
        if (fake.failCreate) throw Object.assign(new Error("stripe indisponible (simule)"), { code: "api_connection_error" });
        fake.createParams.push(params);
        const items = (params["items"] as Array<{ price: string; quantity: number }>) ?? [];
        const trialEnd = typeof params["trial_end"] === "number" ? (params["trial_end"] as number) : null;
        const sub: FakeSub = {
          id: `sub_${RUN}_${fake.subs.length + 1}_${randomUUID().slice(0, 4)}`,
          customer: String(params["customer"]),
          status: trialEnd ? "trialing" : "active",
          trial_end: trialEnd,
          cancel_at_period_end: false,
          metadata: (params["metadata"] as Record<string, string>) ?? {},
          items: { data: items.map((i) => ({ price: { id: i.price }, quantity: i.quantity })) },
          current_period_end: (trialEnd ?? Math.floor(Date.now() / 1000)) + 30 * DAY,
        };
        fake.subs.push(sub);
        if (k) fake.byKey.set(k, sub);
        return sub;
      },
    },
  };
}

/* ── Donnees de test ──────────────────────────────────────────────────────── */
const emails: string[] = [];
const customers: string[] = [];
const intentIds: string[] = [];
let seq = 0;

type Signup = { email: string; token: string; customer: string; intent: string; created: number };

async function seedSignup(opts?: { noCustomer?: boolean }): Promise<Signup> {
  const n = ++seq;
  const email = `a09-${RUN}-${n}@example.test`;
  const token = `a09tok-${RUN}-${n}`;
  const customer = `cus_a09_${RUN}_${n}`;
  const intent = `seti_a09_${RUN}_${n}`;
  const created = Math.floor(Date.now() / 1000) - 120;
  emails.push(email); customers.push(customer); intentIds.push(intent);
  await pool.query(
    `INSERT INTO pending_signups (token, email, first_name, last_name, company_name)
     VALUES ($1, $2, 'Test', 'A09', 'Societe A09')`,
    [token, email],
  );
  fake.intents.set(intent, {
    id: intent, object: "setup_intent", status: "succeeded", created,
    customer: opts?.noCustomer ? null : customer,
    payment_method: `pm_a09_${RUN}_${n}`,
    metadata: {
      plan: "standard", pre_register_token: token, trial_days_remaining: "14", addons: "{}",
    },
  });
  return { email, token, customer, intent, created };
}

function deliverWebhook(s: Signup, eventId = `evt_a09_${RUN}_${s.intent}`) {
  return postWebhook({
    id: eventId, type: "setup_intent.succeeded", livemode: false,
    data: { object: fake.intents.get(s.intent) },
  });
}

async function postWebhook(event: Record<string, unknown>): Promise<{ status: number; body: unknown }> {
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
  return { status: res.statusCode, body: res.body };
}

async function postFinalize(s: Signup): Promise<{ status: number; body: Record<string, unknown> }> {
  const { default: router } = await import("../routes/public-billing.js");
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> })
    .stack.find((l) => l.route?.path === "/public/finalize-checkout");
  const handlers = layer!.route!.stack;
  const handler = handlers[handlers.length - 1]!.handle; // saute le limiteur de debit
  const res = {
    statusCode: 200, body: {} as Record<string, unknown>,
    status(c: number) { this.statusCode = c; return this; },
    json(b: Record<string, unknown>) { this.body = b; return this; },
    cookie() { return this; }, setHeader() { return this; },
  };
  await handler({
    body: { intentId: s.intent, intentType: "setup", plan: "standard", preRegisterToken: s.token },
    headers: {}, cookies: {}, ip: "127.0.0.1", socket: { remoteAddress: "127.0.0.1" },
    get: () => undefined,
  }, res);
  return { status: res.statusCode, body: res.body };
}

type OrgRow = {
  id: string; subscription_status: string; stripe_subscription_id: string | null;
  trial_ends_at: Date | null; trial_consumed_at: Date | null; stripe_customer_id: string | null; plan: string;
};
async function orgsOf(email: string): Promise<OrgRow[]> {
  const r = await pool.query<OrgRow>(
    `SELECT id::text, subscription_status, stripe_subscription_id, trial_ends_at, trial_consumed_at, stripe_customer_id, plan
       FROM organizations WHERE lower(owner_email) = lower($1)`, [email]);
  return r.rows;
}
const subsOf = (customer: string) => fake.subs.filter((x) => x.customer === customer);
async function eventStatus(eventId: string): Promise<string | null> {
  const r = await pool.query(`SELECT metadata->>'status' AS st FROM billing_events WHERE stripe_event_id = $1`, [eventId]);
  return (r.rows[0]?.st as string | undefined) ?? null;
}

beforeAll(async () => { await ensureClaimTable(pool); });
beforeEach(() => { fake = newFake(); setStripeForTesting(stripeClient()); });
afterAll(async () => {
  setStripeForTesting(null);
  await pool.query(`DELETE FROM checkout_subscription_claims WHERE intent_id = ANY($1)`, [intentIds]).catch(() => {});
  await pool.query(`DELETE FROM billing_events WHERE stripe_event_id LIKE $1`, [`evt_a09_${RUN}%`]).catch(() => {});
  await pool.query(`DELETE FROM organization_members WHERE organization_id IN (SELECT id FROM organizations WHERE owner_email = ANY($1))`, [emails]).catch(() => {});
  await pool.query(`DELETE FROM organizations WHERE owner_email = ANY($1)`, [emails]).catch(() => {});
  await pool.query(`DELETE FROM org_settings WHERE org_id = ANY($1)`, [emails]).catch(() => {});
  await pool.query(`DELETE FROM users WHERE email = ANY($1)`, [emails]).catch(() => {});
  await pool.query(`DELETE FROM pending_signups WHERE email = ANY($1)`, [emails]).catch(() => {});
});

describe("A-09 — webhook seul (onglet ferme apres confirmSetup)", () => {
  it("cree LUI-MEME la souscription d'essai et l'organisation passe trialing avec son abonnement", async () => {
    const s = await seedSignup();
    const res = await deliverWebhook(s);
    expect(res.status).toBe(200);

    expect(fake.createCalls).toBeGreaterThanOrEqual(1);
    expect(subsOf(s.customer)).toHaveLength(1);
    const sub = subsOf(s.customer)[0]!;
    expect(sub.status).toBe("trialing");
    expect(sub.items.data[0]!.price.id).toBe(PRICE);

    const orgs = await orgsOf(s.email);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.subscription_status).toBe("trialing");
    expect(orgs[0]!.stripe_subscription_id).toBe(sub.id);
    expect(orgs[0]!.stripe_customer_id).toBe(s.customer);
    expect(orgs[0]!.trial_consumed_at).not.toBeNull();
    // fin d'essai = celle de Stripe (created + 14 j), pas « maintenant + 14 j »
    expect(Math.floor(orgs[0]!.trial_ends_at!.getTime() / 1000)).toBe(s.created + 14 * DAY);
    expect(await eventStatus(`evt_a09_${RUN}_${s.intent}`)).toBe("processed");
  });

  it("CONTRAT — l'essai vaut 14 jours : trial_end = intent.created + 14 j, TRIAL_DAYS = 14, defaut de l'intent = 14", async () => {
    expect(TRIAL_DAYS).toBe(14);
    expect(intentTrialDaysOf({})).toBe(14);
    expect(intentTrialDaysOf({ trial_days_remaining: "0" })).toBe(0);
    const s = await seedSignup();
    await deliverWebhook(s);
    const params = fake.createParams[0]!;
    expect(params["trial_end"]).toBe(s.created + 14 * DAY);
    expect(params["trial_period_days"]).toBeUndefined();
    expect(params["default_payment_method"]).toMatch(/^pm_a09_/);
    expect((params["items"] as Array<{ price: string }>)[0]!.price).toBe(PRICE);
  });

  it("webhook rejoue (meme evenement, puis nouvel evenement pour le meme intent) : toujours UNE souscription et UNE organisation", async () => {
    const s = await seedSignup();
    const eventId = `evt_a09_${RUN}_replay_${s.intent}`;
    await deliverWebhook(s, eventId);
    const again = await deliverWebhook(s, eventId);
    expect(again.status).toBe(200);
    const other = await deliverWebhook(s, `${eventId}_bis`);
    expect(other.status).toBe(200);
    expect(subsOf(s.customer)).toHaveLength(1);
    expect(await orgsOf(s.email)).toHaveLength(1);
    expect((await orgsOf(s.email))[0]!.stripe_subscription_id).toBe(subsOf(s.customer)[0]!.id);
  });

  it("echec Stripe : 500, evenement NON marque traite, aucune organisation premium ; la relivraison guerit", async () => {
    const s = await seedSignup();
    const eventId = `evt_a09_${RUN}_fail_${s.intent}`;
    fake.failCreate = true;
    const res = await deliverWebhook(s, eventId);
    expect(res.status).toBe(500);
    expect(await eventStatus(eventId)).not.toBe("processed");
    expect(subsOf(s.customer)).toHaveLength(0);
    const orgs = await orgsOf(s.email);
    expect(orgs.filter((o) => o.subscription_status === "trialing" || o.subscription_status === "active")).toHaveLength(0);

    fake.failCreate = false;
    const retry = await deliverWebhook(s, eventId);
    expect(retry.status).toBe(200);
    expect(await eventStatus(eventId)).toBe("processed");
    expect(subsOf(s.customer)).toHaveLength(1);
    const healed = await orgsOf(s.email);
    expect(healed).toHaveLength(1);
    expect(healed[0]!.subscription_status).toBe("trialing");
    expect(healed[0]!.stripe_subscription_id).toBe(subsOf(s.customer)[0]!.id);
  });

  it("intent sans client Stripe : etat explicite NON premium (pending_billing), jamais trialing sans souscription", async () => {
    const s = await seedSignup({ noCustomer: true });
    const res = await deliverWebhook(s);
    expect(res.status).toBe(200);
    expect(fake.subs).toHaveLength(0);
    const orgs = await orgsOf(s.email);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.subscription_status).toBe("pending_billing");
    expect(orgs[0]!.stripe_subscription_id).toBeNull();
    expect(orgs[0]!.trial_ends_at).toBeNull();
  });
});

describe("A-09 — coordination webhook / finalize-checkout", () => {
  it("finalize APRES le webhook : ne double pas la souscription, l'etat reste trialing", async () => {
    const s = await seedSignup();
    await deliverWebhook(s);
    const before = subsOf(s.customer)[0]!;
    const fin = await postFinalize(s);
    expect(fin.status).toBe(200);
    expect(fin.body["subscriptionId"]).toBe(before.id);
    expect(subsOf(s.customer)).toHaveLength(1);
    const orgs = await orgsOf(s.email);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.subscription_status).toBe("trialing");
    expect(orgs[0]!.stripe_subscription_id).toBe(before.id);
    expect(Math.floor(orgs[0]!.trial_ends_at!.getTime() / 1000)).toBe(s.created + 14 * DAY);
  });

  it("finalize SEUL (sans webhook) fonctionne toujours, puis le webhook tardif ne double rien", async () => {
    const s = await seedSignup();
    const fin = await postFinalize(s);
    expect(fin.status).toBe(200);
    expect(subsOf(s.customer)).toHaveLength(1);
    const sub = subsOf(s.customer)[0]!;
    const orgs = await orgsOf(s.email);
    expect(orgs).toHaveLength(1);
    expect(orgs[0]!.subscription_status).toBe("trialing");
    expect(orgs[0]!.stripe_subscription_id).toBe(sub.id);

    const late = await deliverWebhook(s);
    expect(late.status).toBe(200);
    expect(subsOf(s.customer)).toHaveLength(1);
    expect(await orgsOf(s.email)).toHaveLength(1);
  });

  it("deux onglets (finalize x2) + webhook : une seule souscription", async () => {
    const s = await seedSignup();
    await Promise.all([postFinalize(s), postFinalize(s), deliverWebhook(s)]);
    expect(subsOf(s.customer)).toHaveLength(1);
    expect(await orgsOf(s.email)).toHaveLength(1);
    expect((await orgsOf(s.email))[0]!.stripe_subscription_id).toBe(subsOf(s.customer)[0]!.id);
  });

  it("concurrence : 12 paires webhook/finalize => une seule souscription par signup, une organisation, abonnement inscrit", async () => {
    // Les 24 requetes partent ensemble. Un 5xx (pool de connexions sature par 24
    // handlers simultanes) est rejoue comme le feraient Stripe (webhook) et le
    // navigateur (finalize) : l'invariant porte sur l'ETAT FINAL.
    const withRetry = async (fn: () => Promise<{ status: number }>): Promise<{ status: number }> => {
      let r = await fn();
      for (let i = 0; i < 4 && r.status >= 500; i++) r = await fn();
      return r;
    };
    const signups = await Promise.all(Array.from({ length: 12 }, () => seedSignup()));
    const results = await Promise.all(signups.flatMap((s) => [
      withRetry(() => deliverWebhook(s)),
      withRetry(() => postFinalize(s)),
    ]));
    for (const r of results) expect([200, 409], JSON.stringify(r)).toContain(r.status);
    for (const s of signups) {
      const subs = subsOf(s.customer);
      expect(subs, `souscriptions de ${s.customer}`).toHaveLength(1);
      const orgs = await orgsOf(s.email);
      expect(orgs, `organisations de ${s.email}`).toHaveLength(1);
      expect(orgs[0]!.stripe_subscription_id).toBe(subs[0]!.id);
      expect(orgs[0]!.subscription_status).toBe("trialing");
    }
  });
});
