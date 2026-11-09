/**
 * checkout.session.completed : un achat d'add-on ou de credits ne modifie ni le
 * plan ni la souscription principale, et n'est jamais annule ou rembourse.
 *
 * Banc repris de stripe-webhook-delivery.test.ts : signature Stripe reelle
 * (HMAC de test local), base simulee. Aucun appel Stripe, aucun secret reel.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import Stripe from "stripe";

let funnelInserts: Array<{ sql: string; params: unknown[] }>;
const LIVE_SECRET = "whsec_local_live_fixture_only";
const LIVE_KEY    = "sk_live_local_fixture_only";

const ORG  = "ad84e987-a1c4-4d94-8ea6-54d784c429ad";
const CUS  = "cus_DELIVERY";

// ── Monde simule ─────────────────────────────────────────────────────────────
let stripeSubs: Array<{ id: string; status: string; cancel_at_period_end: boolean; metadata?: Record<string, string> }>;
let stripeCalls: string[];
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
    subscriptions: {
      list: vi.fn(async () => ({ data: stripeSubs })),
      retrieve: vi.fn(async (id: string) => stripeSubs.find(s => s.id === id) ?? { items: { data: [] } }),
      cancel: vi.fn(async (id: string) => { stripeCalls.push(`cancel:${id}`); return {}; }),
    },
    invoices: {
      retrieve: vi.fn(async () => ({})),
      list: vi.fn(async () => ({ data: [{ id: "in_1", amount_paid: 1900, payment_intent: "pi_1" }] })),
    },
    refunds: { create: vi.fn(async (p: unknown) => { stripeCalls.push(`refund:${JSON.stringify(p)}`); return {}; }) },
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

const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 30));
const MAIN = { id: "sub_main", status: "active", cancel_at_period_end: false, metadata: { plan: "standard", orgId: ORG } };

function cs(id: string, metadata: Record<string, string>, extra: Record<string, unknown> = {}) {
  return {
    id: `evt_${id}`, type: "checkout.session.completed", created: 1792000000, livemode: true,
    data: { object: {
      id: `cs_${id}`, object: "checkout.session", customer: CUS, status: "complete", payment_status: "paid",
      mode: "subscription", subscription: `sub_${id}`, metadata: { orgId: ORG, ...metadata }, ...extra,
    } },
  };
}
const mainFieldWrites = () => persistCalls.filter(c =>
  c.fields["plan"] !== undefined || c.fields["stripeSubscriptionId"] !== undefined || c.fields["subscriptionStatus"] !== undefined);

beforeEach(() => {
  funnelInserts = []; billingEvents = new Map(); writes = []; persistCalls = []; mailCalls = []; addonCalls = [];
  stripeCalls = []; stripeSubs = [MAIN];
  activeStripeKey = LIVE_KEY; customerOrg = ORG; orgRowExists = true;
  process.env["STRIPE_WEBHOOK_SECRET"] = LIVE_SECRET;
  delete process.env["STRIPE_WEBHOOK_SECRET_RENDER"];
  delete process.env["STRIPE_TEST_WEBHOOK_SECRET"];
  process.env["NODE_ENV"] = "production";
  // Banc en mode LIVE (cle sk_live_ de fixture) : la CI exporte STRIPE_TEST_MODE=true.
  delete process.env["STRIPE_TEST_MODE"];
});

const ENV_AVANT = { STRIPE_TEST_MODE: process.env["STRIPE_TEST_MODE"], NODE_ENV: process.env["NODE_ENV"] };
afterAll(() => {
  for (const [k, v] of Object.entries(ENV_AVANT)) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

describe("checkout.session.completed — achats hors plan", () => {
  it("add-on direct (addonKey) : active l'add-on, ne touche ni plan ni souscription principale, aucune annulation", async () => {
    stripeSubs = [MAIN, { id: "sub_addon1", status: "active", cancel_at_period_end: false, metadata: {} }];
    const res = await deliver(cs("addon1", { addonKey: "whiteLabel", addonName: "White label", quantity: "1" }));
    await settle();
    expect(res.statusCode).toBe(200);
    expect(stripeCalls).toEqual([]);
    expect(mainFieldWrites()).toEqual([]);
    expect(addonCalls).toContain("activate:whiteLabel");
  });

  it("panier add-on seul (addon_only) : aucune annulation, plan et souscription intacts", async () => {
    stripeSubs = [MAIN, { id: "sub_addon2", status: "active", cancel_at_period_end: false, metadata: {} }];
    await deliver(cs("addon2", { flowpoint_checkout_type: "addon_only", selected_plan: "", immediate_addons: "whiteLabel" }));
    await settle();
    expect(stripeCalls).toEqual([]);
    expect(mainFieldWrites()).toEqual([]);
    expect(addonCalls).toContain("activate:whiteLabel");
  });

  it("pack de credits via addon-checkout (mode payment) : aucune ecriture d'abonnement", async () => {
    await deliver(cs("credits1", { addonKey: "aiCreditsPack50k", quantity: "1" }, { mode: "payment", subscription: null }));
    await settle();
    expect(stripeCalls).toEqual([]);
    expect(mainFieldWrites()).toEqual([]);
  });

  it("credits IA (type=ai_credits) : aucune ecriture d'abonnement", async () => {
    await deliver(cs("credits2", { type: "ai_credits", pack: "aiCreditsPack50k", credits: "50000" }, { mode: "payment", subscription: null }));
    await settle();
    expect(mainFieldWrites()).toEqual([]);
  });

  it("relivraison du meme evenement add-on : aucun effet supplementaire", async () => {
    stripeSubs = [MAIN, { id: "sub_addon3", status: "active", cancel_at_period_end: false, metadata: {} }];
    const ev = cs("addon3", { addonKey: "whiteLabel", quantity: "1" });
    await deliver(ev); await settle();
    const n = addonCalls.length;
    await deliver(ev); await settle();
    expect(addonCalls.length).toBe(n);
    expect(stripeCalls).toEqual([]);
  });
});

describe("checkout.session.completed — achats de plan (non-regression)", () => {
  it("premiere souscription Pro : plan, souscription et statut ecrits", async () => {
    stripeSubs = [{ id: "sub_p1", status: "trialing", cancel_at_period_end: false, metadata: { plan: "pro" } }];
    await deliver(cs("p1", { plan: "pro" }));
    await settle();
    expect(persistCalls.some(c => c.fields["plan"] === "pro" && c.fields["stripeSubscriptionId"] === "sub_p1")).toBe(true);
  });

  it("panier plan Ultra + add-on : plan ecrit et add-on active", async () => {
    stripeSubs = [{ id: "sub_u1", status: "trialing", cancel_at_period_end: false, metadata: { plan: "ultra" } }];
    await deliver(cs("u1", { flowpoint_checkout_type: "subscription_with_immediate_addons", selected_plan: "ultra", immediate_addons: "whiteLabel" }));
    await settle();
    expect(persistCalls.some(c => c.fields["plan"] === "ultra" && c.fields["stripeSubscriptionId"] === "sub_u1")).toBe(true);
    expect(addonCalls).toContain("activate:whiteLabel");
  });

  it("nouvelle souscription Standard alors que Standard est deja actif : doublon annule (garde conservee)", async () => {
    stripeSubs = [MAIN, { id: "sub_s2", status: "active", cancel_at_period_end: false, metadata: { plan: "standard" } }];
    await deliver(cs("s2", { plan: "standard" }));
    await settle();
    expect(stripeCalls).toContain("cancel:sub_s2");
  });
});
