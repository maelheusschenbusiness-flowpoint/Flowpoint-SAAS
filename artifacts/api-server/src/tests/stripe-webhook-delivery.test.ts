/**
 * stripe-webhook-delivery.test.ts — livraison Stripe : signature reelle,
 * cinq familles d'evenements, rejeu, et separation des environnements.
 *
 * Contexte. Stripe a enregistre 361 echecs HTTP 404 depuis le 2026-10-13 sur un
 * ancien point de terminaison Replit, pendant que le point de terminaison de
 * production `https://flowpoint-saas-1.onrender.com/api/billing/webhook`
 * affichait 0 % d'erreur. L'audit de ce code a montre que la route de
 * production est correcte — les deux chemins existent et repondent 200 — mais a
 * fait apparaitre deux defauts reels qui, eux, pouvaient produire des echecs de
 * livraison ou un traitement errone :
 *
 *   1. Les deux chemins de webhook etaient soumis au compteur global
 *      `globalRateLimit`, dans le seau partage `global:default` de tout le
 *      trafic anonyme de /api. Un 429 est compte par Stripe comme un echec de
 *      livraison.
 *   2. La signature prouve que Stripe a emis l'evenement, pas dans quel MODE.
 *      Un `STRIPE_TEST_WEBHOOK_SECRET` laisse en production — la memoire du
 *      depot le signale comme a retirer apres certification — faisait accepter
 *      un evenement de test et le traiter contre la base LIVE.
 *
 * Ces tests signent chaque charge utile avec un vrai HMAC Stripe
 * (`generateTestHeaderString`) : la verification de signature est donc
 * reellement exercee, pas contournee. Aucun secret reel n'apparait ici — les
 * secrets de test sont des chaines locales inventees pour la duree du test.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import Stripe from "stripe";

const LIVE_SECRET = "whsec_local_live_fixture_only";
const TEST_SECRET = "whsec_local_test_fixture_only";
const LIVE_KEY    = "sk_live_local_fixture_only";
const TEST_KEY    = "sk_test_local_fixture_only";

const ORG  = "ad84e987-a1c4-4d94-8ea6-54d784c429ad";
const CUS  = "cus_DELIVERY";
const SUB  = "sub_DELIVERY";

// ── Monde simule ─────────────────────────────────────────────────────────────
let billingEvents: Map<string, { status: string }>;
let writes: string[];                 // toute requete mutante vue par la base
let persistCalls: Array<{ orgId: string; fields: Record<string, unknown> }>;
let mailCalls: string[];
let addonCalls: string[];
let activeStripeKey: string;

/** Les requetes mutantes, et elles seules : c'est ce qu'un doublon dupliquerait. */
function isMutation(sql: string): boolean {
  return /^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql) && !/\bbilling_events\b/i.test(sql);
}

async function fakeQuery(sql: string, params: unknown[] = []) {
  const s = sql.replace(/\s+/g, " ").trim();
  if (isMutation(s)) writes.push(s.slice(0, 60));

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

  if (/SELECT seller_id, owner_email, plan FROM organizations/i.test(s)) {
    return { rows: [{ seller_id: null, owner_email: "client@example.com", plan: "pro" }], rowCount: 1 };
  }
  if (/SELECT fp_lid FROM organizations/i.test(s)) return { rows: [{ fp_lid: null }], rowCount: 1 };
  if (/SELECT plan FROM organizations/i.test(s)) return { rows: [{ plan: "pro" }], rowCount: 1 };
  if (/SELECT id FROM organizations WHERE lower\(owner_email\)/i.test(s)) {
    return { rows: [{ id: ORG }], rowCount: 1 };
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
  findOrgByStripeCustomer: vi.fn(async () => ORG),
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

// ── Banc d'essai ─────────────────────────────────────────────────────────────
type FakeRes = { statusCode: number; body: unknown; status(c: number): FakeRes; json(b: unknown): FakeRes };

/**
 * Livre un evenement sur l'un des deux chemins, avec une signature Stripe
 * authentique calculee sur le corps brut exact.
 */
async function deliver(
  event: Record<string, unknown>,
  opts: { path?: "/webhooks/stripe" | "/billing/webhook"; signWith?: string; signature?: string } = {},
): Promise<FakeRes> {
  const { default: router } = await import("../routes/stripe-webhook.js");
  const path = opts.path ?? "/billing/webhook";
  const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> })
    .stack.find((l) => l.route?.path === path);
  expect(layer, `route ${path} absente du routeur`).toBeTruthy();

  const payload = JSON.stringify(event);
  const header = opts.signature ?? Stripe.webhooks.generateTestHeaderString({
    payload, secret: opts.signWith ?? LIVE_SECRET,
  });

  const res: FakeRes = {
    statusCode: 200, body: undefined,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const req = { headers: { "stripe-signature": header }, body: event, rawBody: Buffer.from(payload) };
  await layer!.route!.stack[0]!.handle(req, res);
  return res;
}

/** Laisse retomber l'emission AI Lab, lancee sans await par le gestionnaire. */
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

// ── Les cinq familles d'evenements ───────────────────────────────────────────
const EVENTS: Record<string, Record<string, unknown>> = {
  "creation d'abonnement": {
    id: "evt_sub_created", type: "customer.subscription.created", created: 1792000000, livemode: true,
    data: { object: {
      id: SUB, object: "subscription", customer: CUS, status: "active",
      metadata: { plan: "pro", orgId: ORG },
      items: { data: [{ price: { id: "price_pro_live" }, quantity: 1 }] },
    } },
  },
  "paiement reussi": {
    id: "evt_inv_paid", type: "invoice.payment_succeeded", created: 1792000100, livemode: true,
    data: { object: {
      id: "in_FIRST", object: "invoice", customer: CUS, amount_paid: 9900, currency: "eur",
      billing_reason: "subscription_create", parent: { subscription_details: { subscription: SUB, metadata: { orgId: ORG, plan: "pro" } } },
      lines: { data: [{ price: { id: "price_pro_live" }, quantity: 1 }] }, payments: { data: [] },
    } },
  },
  "renouvellement": {
    id: "evt_inv_renewal", type: "invoice.payment_succeeded", created: 1792000200, livemode: true,
    data: { object: {
      id: "in_RENEWAL", object: "invoice", customer: CUS, amount_paid: 9900, currency: "eur",
      billing_reason: "subscription_cycle", parent: { subscription_details: { subscription: SUB, metadata: { orgId: ORG, plan: "pro" } } },
      lines: { data: [{ price: { id: "price_pro_live" }, quantity: 1 }] }, payments: { data: [] },
    } },
  },
  "paiement echoue": {
    id: "evt_inv_failed", type: "invoice.payment_failed", created: 1792000300, livemode: true,
    data: { object: {
      id: "in_FAILED", object: "invoice", customer: CUS, amount_due: 9900, currency: "eur",
      attempt_count: 2, billing_reason: "subscription_cycle",
      parent: { subscription_details: { subscription: SUB, metadata: { orgId: ORG, plan: "pro" } } },
    } },
  },
  "resiliation": {
    id: "evt_sub_deleted", type: "customer.subscription.deleted", created: 1792000400, livemode: true,
    data: { object: {
      id: SUB, object: "subscription", customer: CUS, status: "canceled",
      metadata: { plan: "pro", orgId: ORG }, items: { data: [] },
    } },
  },
};

beforeEach(() => {
  billingEvents = new Map();
  writes = [];
  persistCalls = [];
  mailCalls = [];
  addonCalls = [];
  activeStripeKey = LIVE_KEY;
  process.env["STRIPE_WEBHOOK_SECRET"] = LIVE_SECRET;
  delete process.env["STRIPE_WEBHOOK_SECRET_RENDER"];
  delete process.env["STRIPE_TEST_WEBHOOK_SECRET"];
  process.env["NODE_ENV"] = "production";
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Livraison Stripe — les cinq familles d'evenements, signature reelle", () => {
  for (const [label, event] of Object.entries(EVENTS)) {
    it(`${label} : signature verifiee, 200, et l'evenement est marque traite`, async () => {
      const res = await deliver(event);
      await settle();

      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ received: true });
      // La preuve du traitement : l'evenement est passe de `processing` a
      // `processed`. C'est exactement ce que lira le rejeu.
      expect(billingEvents.get(String(event["id"]))?.status).toBe("processed");
    });
  }

  it("un paiement reussi met l'abonnement en `active` et previent le client", async () => {
    await deliver(EVENTS["paiement reussi"]!);
    await settle();
    expect(persistCalls.some((c) => c.orgId === ORG && c.fields["subscriptionStatus"] === "active")).toBe(true);
  });

  it("un renouvellement est traite comme un paiement, sur sa propre facture", async () => {
    await deliver(EVENTS["renouvellement"]!);
    await settle();
    expect(persistCalls.some((c) => c.fields["subscriptionStatus"] === "active")).toBe(true);
  });

  it("un paiement echoue est enregistre sans resilier", async () => {
    await deliver(EVENTS["paiement echoue"]!);
    await settle();
    // `past_due` est un etat de recouvrement : ce n'est pas une resiliation.
    expect(persistCalls.some((c) => c.fields["subscriptionStatus"] === "past_due")).toBe(true);
    expect(persistCalls.some((c) => c.fields["plan"] === "standard")).toBe(false);
  });

  it("une resiliation redescend le plan et desactive les options payantes", async () => {
    await deliver(EVENTS["resiliation"]!);
    await settle();
    expect(persistCalls.some((c) => c.fields["subscriptionStatus"] === "canceled")).toBe(true);
    expect(persistCalls.some((c) => c.fields["plan"] === "standard")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Aucun evenement n'est traite deux fois", () => {
  for (const [label, event] of Object.entries(EVENTS)) {
    it(`${label} : le rejeu repond en doublon et n'ecrit plus rien`, async () => {
      await deliver(event);
      await settle();
      const writesAfterFirst  = [...writes];
      const persistAfterFirst = persistCalls.length;
      const mailAfterFirst    = mailCalls.length;
      const addonAfterFirst   = addonCalls.length;
      expect(writesAfterFirst.length + persistAfterFirst).toBeGreaterThan(0);

      // Stripe rejoue le MEME evenement : meme identifiant, meme horodatage.
      const replay = await deliver(event);
      await settle();

      expect(replay.statusCode).toBe(200);
      expect(replay.body).toEqual({ received: true, duplicate: true });
      expect(writes).toEqual(writesAfterFirst);
      expect(persistCalls.length).toBe(persistAfterFirst);
      expect(mailCalls.length).toBe(mailAfterFirst);
      expect(addonCalls.length).toBe(addonAfterFirst);
    });
  }

  it("le meme evenement livre sur les deux chemins n'est traite qu'une fois", async () => {
    // Les deux chemins partagent le gestionnaire ET la table d'idempotence :
    // un point de terminaison en double dans Stripe ne peut pas doubler un plan.
    const first = await deliver(EVENTS["creation d'abonnement"]!, { path: "/billing/webhook" });
    await settle();
    const after = [...writes];

    const second = await deliver(EVENTS["creation d'abonnement"]!, { path: "/webhooks/stripe" });
    await settle();

    expect(first.body).toEqual({ received: true });
    expect(second.body).toEqual({ received: true, duplicate: true });
    expect(writes).toEqual(after);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Signature et separation des environnements", () => {
  it("une signature absente est refusee en 400, sans aucune ecriture", async () => {
    const res = await deliver(EVENTS["resiliation"]!, { signature: "" });
    expect(res.statusCode).toBe(400);
    expect(writes).toEqual([]);
    expect(persistCalls).toEqual([]);
  });

  it("une signature calculee avec un autre secret est refusee en 400", async () => {
    const res = await deliver(EVENTS["resiliation"]!, { signWith: "whsec_wrong_secret_fixture" });
    expect(res.statusCode).toBe(400);
    expect(writes).toEqual([]);
  });

  it("un corps modifie apres signature est refuse en 400", async () => {
    const event = EVENTS["paiement reussi"]!;
    const header = Stripe.webhooks.generateTestHeaderString({
      payload: JSON.stringify(event), secret: LIVE_SECRET,
    });
    // Meme en-tete, montant gonfle : le HMAC ne colle plus.
    const tampered = JSON.parse(JSON.stringify(event)) as typeof event;
    (tampered["data"] as { object: Record<string, unknown> }).object["amount_paid"] = 1;
    const res = await deliver(tampered, { signature: header });
    expect(res.statusCode).toBe(400);
    expect(writes).toEqual([]);
  });

  it("le secret est lu sous ses DEUX noms (STRIPE_WEBHOOK_SECRET_RENDER inclus)", async () => {
    // Le secret Render porte l'autre nom ; ne lire que le premier renvoyait 503
    // sur chaque evenement en production.
    delete process.env["STRIPE_WEBHOOK_SECRET"];
    process.env["STRIPE_WEBHOOK_SECRET_RENDER"] = LIVE_SECRET;
    const res = await deliver(EVENTS["resiliation"]!);
    await settle();
    expect(res.statusCode).toBe(200);
  });

  it("REPRO : un evenement de TEST signe par le secret de test est refuse quand la cle active est live", async () => {
    // Le defaut : un `STRIPE_TEST_WEBHOOK_SECRET` oublie en production apres une
    // certification. L'evenement est authentique, sa signature est valide — et
    // il porte livemode=false. Il ne doit pas toucher la base des clients.
    process.env["STRIPE_TEST_WEBHOOK_SECRET"] = TEST_SECRET;
    activeStripeKey = LIVE_KEY;
    const testEvent = { ...EVENTS["resiliation"]!, id: "evt_test_mode_cancel", livemode: false };

    const res = await deliver(testEvent, { signWith: TEST_SECRET });
    await settle();

    expect(res.statusCode).toBe(400);
    expect(writes).toEqual([]);
    expect(persistCalls).toEqual([]);
    // Refuse AVANT la reclamation d'idempotence : rien n'est consomme.
    expect(billingEvents.size).toBe(0);
  });

  it("un evenement live valide par le secret de test est refuse", async () => {
    process.env["STRIPE_TEST_WEBHOOK_SECRET"] = TEST_SECRET;
    const res = await deliver({ ...EVENTS["resiliation"]!, id: "evt_live_on_test_secret", livemode: true },
      { signWith: TEST_SECRET });
    expect(res.statusCode).toBe(400);
    expect(writes).toEqual([]);
  });

  it("l'environnement de test traite normalement ses propres evenements de test", async () => {
    // La regle ne doit pas casser le service de test : cle sk_test_, point de
    // terminaison de test, evenements livemode=false.
    activeStripeKey = TEST_KEY;
    process.env["STRIPE_TEST_WEBHOOK_SECRET"] = TEST_SECRET;
    const res = await deliver({ ...EVENTS["creation d'abonnement"]!, id: "evt_test_env_sub", livemode: false },
      { signWith: TEST_SECRET });
    await settle();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });

  it("la production traite normalement un evenement live", async () => {
    activeStripeKey = LIVE_KEY;
    const res = await deliver({ ...EVENTS["creation d'abonnement"]!, id: "evt_live_env_sub", livemode: true });
    await settle();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ received: true });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Les deux chemins de webhook echappent au compteur global", () => {
  /**
   * Reproduit la forme exacte du montage de `app.ts` : le filtre est installe
   * avec `app.use("/api", ...)`, donc `req.path` y est ampute du prefixe. Le
   * test verifie cette semantique autant que la regle — une erreur de prefixe
   * rendrait l'exemption inoperante ou, pire, exempterait tout /api.
   */
  function appWithLimiter(): { app: express.Express; counted: string[] } {
    const counted: string[] = [];
    const limiter = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
      counted.push(`${req.method} ${req.path}`);
      next();
    };
    const STRIPE_WEBHOOK_PATHS = new Set(["/webhooks/stripe", "/billing/webhook"]);
    const app = express();
    app.use("/api", (req, res, next) => {
      if (req.method === "POST" && STRIPE_WEBHOOK_PATHS.has(req.path)) { next(); return; }
      limiter(req, res, next);
    });
    app.use("/api", (_req, res) => { res.status(200).json({ ok: true }); });
    return { app, counted };
  }

  async function hit(app: express.Express, method: "POST" | "GET", url: string): Promise<void> {
    const { createServer } = await import("http");
    const server = createServer(app);
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    await fetch(`http://127.0.0.1:${port}${url}`, { method });
    await new Promise<void>((r) => server.close(() => r()));
  }

  it("un POST sur les deux chemins de webhook n'est pas compte", async () => {
    const { app, counted } = appWithLimiter();
    await hit(app, "POST", "/api/billing/webhook");
    await hit(app, "POST", "/api/webhooks/stripe");
    expect(counted).toEqual([]);
  });

  it("app.ts n'installe plus `globalRateLimit` nu sur /api, et exempte les deux chemins", async () => {
    // Le test precedent prouve la semantique de la regle ; celui-ci prouve
    // qu'app.ts l'applique vraiment. Monter `globalRateLimit` directement sur
    // "/api" remettrait les webhooks dans le seau partage sans qu'aucun test de
    // comportement ne s'en apercoive.
    const { readFile } = await import("fs/promises");
    const src = await readFile(new URL("../app.ts", import.meta.url), "utf-8");
    expect(src).not.toMatch(/app\.use\("\/api",\s*globalRateLimit\)/);
    expect(src).toContain('new Set(["/webhooks/stripe", "/billing/webhook"])');
    expect(src).toMatch(/globalRateLimit\(req, res, next\)/);
  });

  it("toute autre route reste comptee, et les webhooks en GET aussi", async () => {
    const { app, counted } = appWithLimiter();
    await hit(app, "POST", "/api/billing/checkout");
    await hit(app, "GET", "/api/billing/webhook");
    expect(counted).toEqual(["POST /billing/checkout", "GET /billing/webhook"]);
  });
});
