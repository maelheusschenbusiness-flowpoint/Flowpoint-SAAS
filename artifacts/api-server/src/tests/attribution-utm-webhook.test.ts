/**
 * attribution-utm-webhook.test.ts — la campagne UTM (Instagram) circule des
 * metadonnees Stripe jusqu'aux etapes du tunnel ecrites par le webhook :
 * checkout_completed, trial_activated, subscription_activated.
 *
 * Banc repris de stripe-webhook-delivery.test.ts : signature Stripe reelle
 * (HMAC de test local), base simulee. Aucun appel Stripe, aucun secret reel.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import Stripe from "stripe";

let funnelInserts: Array<{ sql: string; params: unknown[] }>;
const LIVE_SECRET = "whsec_local_live_fixture_only";
const LIVE_KEY    = "sk_live_local_fixture_only";

const ORG  = "ad84e987-a1c4-4d94-8ea6-54d784c429ad";
const CUS  = "cus_DELIVERY";

// ── Monde simule ─────────────────────────────────────────────────────────────
let billingEvents: Map<string, { status: string }>;
let writes: string[];                 // toute requete mutante vue par la base
let persistCalls: Array<{ orgId: string; fields: Record<string, unknown> }>;
let mailCalls: string[];
let addonCalls: string[];
let activeStripeKey: string;
let customerOrg: string;              // ce que la resolution par client Stripe rend
let orgRowExists: boolean;            // une ligne `organizations` existe-t-elle
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `organizations.id` est de type UUID : un parametre non UUID leve 22P02. */
function pgUuidError(): Error {
  return Object.assign(new Error("invalid input syntax for type uuid"), {
    code: "22P02", routine: "string_to_uuid", severity: "ERROR", file: "uuid.c",
  });
}

/** Les requetes mutantes, et elles seules : c'est ce qu'un doublon dupliquerait. */
function isMutation(sql: string): boolean {
  return /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql) && !/\bbilling_events\b/i.test(sql);
}

async function fakeQuery(sql: string, params: unknown[] = []) {
  const s = sql.replace(/\s+/g, " ").trim();
  if (isMutation(s)) writes.push(s.slice(0, 60));
  if (/^INSERT INTO funnel_events/i.test(s)) {
    funnelInserts.push({ sql: s, params: [...params] });
    return { rows: [], rowCount: 1 };
  }

  // Reclamation d'idempotence : claim-then-finalize, comme en production.
  if (/INSERT INTO billing_events/i.test(s)) {
    const eventId = (params as string[])[2]!;
    const existing = billingEvents.get(eventId);
    // Un evenement deja `processed`, ou en cours avec un bail frais, n'est pas
    // reclame : rowCount 0, et le gestionnaire repond en doublon.
    if (existing && (existing.status === "processed" || existing.status === "processing")) {
      return { rows: [], rowCount: 0 };
    }
    billingEvents.set(eventId, { status: "processing" });
    return { rows: [{ status: "processing" }], rowCount: 1 };
  }
  if (/UPDATE billing_events/i.test(s)) {
    const [eventId, status] = params as [string, string];
    const e = billingEvents.get(eventId);
    if (e && status) e.status = status;
    return { rows: [], rowCount: e ? 1 : 0 };
  }

  // Reproduit le typage de production AVANT toute reponse : toute requete
  // `organizations ... WHERE id = $1` avec un parametre non UUID leve 22P02.
  if (/\borganizations\b/i.test(s) && /\bWHERE id ?= ?\$1/i.test(s)) {
    if (!UUID_RE.test(String((params as unknown[])[0]))) throw pgUuidError();
  }
  // Instantane combine organisation canonique + inscription en attente.
  if (/pending_signups/i.test(s) && /organizations/i.test(s)) {
    return { rows: [{ org_id: orgRowExists ? ORG : null, pending: false }], rowCount: 1 };
  }
  if (/SELECT seller_id, owner_email, plan FROM organizations/i.test(s)) {
    return { rows: [{ seller_id: null, owner_email: "client@example.com", plan: "pro" }], rowCount: 1 };
  }
  if (/SELECT fp_lid FROM organizations/i.test(s)) return { rows: [{ fp_lid: null }], rowCount: 1 };
  if (/SELECT plan FROM organizations/i.test(s)) return { rows: [{ plan: "pro" }], rowCount: 1 };
  if (/SELECT id FROM organizations WHERE lower\(owner_email\)/i.test(s)) {
    return { rows: orgRowExists ? [{ id: ORG }] : [], rowCount: orgRowExists ? 1 : 0 };
  }
  return { rows: [], rowCount: 0 };
}

// ── Doublures (declarees avant l'import du routeur) ──────────────────────────
vi.mock("@workspace/db", () => {
  const client = { query: vi.fn((sql: string, p?: unknown[]) => fakeQuery(sql, p)), release: vi.fn() };
  return {
    pool: { connect: vi.fn(async () => client), query: vi.fn((sql: string, p?: unknown[]) => fakeQuery(sql, p)) },
    db: {}, eq: vi.fn(), desc: vi.fn(), and: vi.fn(),
  };
});

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/stripe-factory.js", () => ({
  // La cle active decide du mode des donnees derriere : c'est elle que la regle
  // de coherence interroge.
  getStripeKey: vi.fn(() => activeStripeKey),
  createStripeClient: vi.fn(async () => ({
    subscriptions: { list: vi.fn(async () => ({ data: [] })), retrieve: vi.fn(async () => ({ items: { data: [] } })) },
    invoices: { retrieve: vi.fn(async () => ({})) },
  })),
}));

vi.mock("../services/org-data.js", () => ({
  findOrgByStripeCustomer: vi.fn(async () => customerOrg),
  persistOrgData: vi.fn(async (orgId: string, fields: Record<string, unknown>) => {
    persistCalls.push({ orgId, fields });
  }),
  loadOrgData: vi.fn(async () => ({ email: "client@example.com", firstName: "Client", plan: "pro" })),
}));

vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings: vi.fn(async () => null),
  upsertOrgSettings: vi.fn(async () => {}),
}));

vi.mock("../services/addons-service.js", () => ({
  activateAddon: vi.fn(async (k: string) => { addonCalls.push(`activate:${k}`); return true; }),
  deactivateAddon: vi.fn(async (k: string) => { addonCalls.push(`deactivate:${k}`); return true; }),
  provisionPlanAddons: vi.fn(async () => { addonCalls.push("provision"); }),
}));

vi.mock("../services/mailer.js", () => ({
  mailer: {
    sendPaymentSucceeded: vi.fn(async () => { mailCalls.push("payment_succeeded"); return { ok: true }; }),
    sendPaymentFailed:    vi.fn(async () => { mailCalls.push("payment_failed"); return { ok: true }; }),
    sendPlanChanged:      vi.fn(async () => { mailCalls.push("plan_changed"); return { ok: true }; }),
    sendWelcome:          vi.fn(async () => { mailCalls.push("welcome"); return { ok: true }; }),
    sendTrialStarted:     vi.fn(async () => { mailCalls.push("trial_started"); return { ok: true }; }),
  },
}));

vi.mock("../services/store.js", () => ({
  store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn() },
}));

vi.mock("../services/seller-attribution.js", () => ({
  recordCommission: vi.fn(async () => {}),
}));

vi.mock("../services/seller-financial-ledger.js", () => ({
  recordPlanRevenue: vi.fn(async () => {}),
  recordRefund: vi.fn(async () => {}),
}));

vi.mock("../services/billing-service.js", () => ({
  reconcileSubscription: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../lib/conversion-events.js", () => ({
  emitConversionEvent: vi.fn(async () => "sent"),
}));

type FakeRes = { statusCode: number; body: unknown; status(c: number): FakeRes; json(b: unknown): FakeRes };

async function deliver(event: Record<string, unknown>): Promise<FakeRes> {
  const { default: router } = await import("../routes/stripe-webhook.js");
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> })
    .stack.find((l) => l.route?.path === "/billing/webhook");
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: LIVE_SECRET });
  const res: FakeRes = {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  await layer!.route!.stack[0]!.handle({ headers: { "stripe-signature": header }, body: event, rawBody: Buffer.from(payload) }, res);
  return res;
}

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const VISITEUR = "33333333-3333-4333-8333-333333333333";
const META_FUNNEL = {
  fp_analytics_consent: "accepted",
  fp_visitor_id: VISITEUR,
  fp_source: "social",
  fp_utm_source: "instagram",
  fp_utm_medium: "social",
  fp_utm_campaign: "reel_oct_2026",
};

function subscriptionEvent(id: string, status: string, metadata: Record<string, string>) {
  return {
    id, type: "customer.subscription.created", created: 1792000000, livemode: true,
    data: { object: {
      id: `sub_${id}`, object: "subscription", customer: CUS, status,
      metadata: { plan: "pro", orgId: ORG, ...metadata },
      items: { data: [{ price: { id: "price_pro_live" }, quantity: 1 }] },
    } },
  };
}

function inserted(etape: string) {
  return funnelInserts.filter((i) => i.params[0] === etape);
}

beforeEach(() => {
  funnelInserts = [];
  billingEvents = new Map();
  writes = [];
  persistCalls = [];
  mailCalls = [];
  addonCalls = [];
  activeStripeKey = LIVE_KEY;
  customerOrg = ORG;
  orgRowExists = true;
  process.env["STRIPE_WEBHOOK_SECRET"] = LIVE_SECRET;
  delete process.env["STRIPE_WEBHOOK_SECRET_RENDER"];
  delete process.env["STRIPE_TEST_WEBHOOK_SECRET"];
  process.env["NODE_ENV"] = "production";
});

describe("webhook Stripe : la campagne UTM atteint les etapes payantes", () => {
  it("essai demarre (trialing) -> trial_activated avec la campagne", async () => {
    const res = await deliver(subscriptionEvent("evt_utm_trial", "trialing", META_FUNNEL));
    await settle();
    expect(res.statusCode).toBe(200);
    const rows = inserted("trial_activated");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sql).toContain("utm_source, utm_medium, utm_campaign");
    expect(rows[0]!.params.slice(4)).toEqual([
      "social", "trial_activated:sub_evt_utm_trial", "instagram", "social", "reel_oct_2026",
    ]);
  });

  it("abonnement payant (active) -> subscription_activated avec la campagne", async () => {
    await deliver(subscriptionEvent("evt_utm_paid", "active", META_FUNNEL));
    await settle();
    const rows = inserted("subscription_activated");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.params.slice(6)).toEqual(["instagram", "social", "reel_oct_2026"]);
  });

  it("checkout.session.completed paye -> checkout_completed avec la campagne", async () => {
    await deliver({
      id: "evt_utm_cs", type: "checkout.session.completed", created: 1792000000, livemode: true,
      data: { object: {
        id: "cs_utm", object: "checkout.session", customer: CUS, status: "complete", payment_status: "paid",
        metadata: { selected_plan: "pro", orgId: ORG, ...META_FUNNEL },
      } },
    });
    await settle();
    const rows = inserted("checkout_completed");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.params.slice(6)).toEqual(["instagram", "social", "reel_oct_2026"]);
  });

  it("compatibilite : des metadonnees sans fp_utm_* gardent l'insertion d'origine", async () => {
    const { fp_utm_source: _a, fp_utm_medium: _b, fp_utm_campaign: _c, ...ancien } = META_FUNNEL;
    await deliver(subscriptionEvent("evt_legacy_trial", "trialing", ancien));
    await settle();
    const rows = inserted("trial_activated");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.sql).not.toContain("utm_");
    expect(rows[0]!.params).toHaveLength(6);
  });

  it("une campagne sans consentement dans les metadonnees n'est jamais ecrite", async () => {
    await deliver(subscriptionEvent("evt_noconsent", "trialing", { ...META_FUNNEL, fp_analytics_consent: "refused" }));
    await settle();
    expect(funnelInserts).toHaveLength(0);
  });
});
