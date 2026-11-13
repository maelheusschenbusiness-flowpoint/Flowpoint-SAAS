/**
 * stripe-webhook-ai-cart-db.test.ts
 *
 * Paniers combinant abonnement et credits IA : les credits inscrits sont EXACTEMENT
 * Σ catalogue(pack) x quantite lue sur les LIGNES Stripe (price id + quantite), jamais
 * les metadata, jamais plus, jamais moins (sinon rien + rejet AI_CREDITS_REJECTED), et
 * l'abonnement de la meme session n'est jamais bloque par un refus de credits.
 * Stripe MOCKE (listLineItems), evenements signes localement, PostgreSQL locale jetable.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";

vi.hoisted(() => {
  process.env["STRIPE_TEST_PRICE_AI_50K"] = "price_t_ai50k";
  process.env["STRIPE_TEST_PRICE_AI_200K"] = "price_t_ai200k";
  process.env["STRIPE_TEST_PRICE_AI_500K"] = "price_t_ai500k";
  process.env["STRIPE_TEST_PRICE_ID_PRO"] = "price_t_pro";
  process.env["STRIPE_TEST_PRICE_ID_ADDON_MONITORS10"] = "price_t_mon10";
});
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../services/store.js", () => ({
  store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn(), logActivity: vi.fn() },
}));

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { setStripeForTesting } from "../services/stripe-factory.js";
import { resolveAiCreditsFromLineItems, fetchSessionLineItems, type StripeLineItemLike } from "../services/ai-credit-cart.js";
import { AI_CREDIT_CATALOG } from "../services/ai-credit-verification.js";

const SECRET = "whsec_secret_de_test_calcule_localement";
const environnement = { ...process.env };
let dbUp = false;
const orgsCreees: string[] = [];

const PACKS: Record<string, { price: string; cents: number; credits: number }> = {
  aiCreditsPack50k: { price: "price_t_ai50k", cents: 400, credits: 50_000 },
  aiCreditsPack200k: { price: "price_t_ai200k", cents: 900, credits: 200_000 },
  aiCreditsPack500k: { price: "price_t_ai500k", cents: 1900, credits: 500_000 },
};
const PLAN_LINE = (amount = 4900): StripeLineItemLike => ({ price: { id: "price_t_pro" }, quantity: 1, amount_subtotal: 4900, amount_discount: 0, amount_total: amount });
const ADDON_LINE: StripeLineItemLike = { price: { id: "price_t_mon10" }, quantity: 1, amount_subtotal: 1500, amount_discount: 0, amount_total: 1500 };
const pack = (key: string, q: number, discount = 0): StripeLineItemLike => ({
  price: { id: PACKS[key]!.price }, quantity: q, amount_subtotal: PACKS[key]!.cents * q, amount_discount: discount, amount_total: PACKS[key]!.cents * q - discount,
});

// ── A. Fonction pure : table + propriete ─────────────────────────────────────

const base = (lineItems: StripeLineItemLike[], over: Record<string, unknown> = {}) => ({
  paymentStatus: "paid", livemode: false, lineItems, amountTotal: 0, currency: "eur", creditsOnly: false, metadata: {}, ...over,
});
const sumPaid = (l: StripeLineItemLike[]) => l.reduce((s, x) => s + (x.amount_total ?? 0), 0);

describe("resolveAiCreditsFromLineItems — table", () => {
  const cas: Array<[string, StripeLineItemLike[], Record<string, unknown>, number | string]> = [
    ["credits seuls x1", [pack("aiCreditsPack50k", 1)], { creditsOnly: true }, 50_000],
    ["credits seuls x3", [pack("aiCreditsPack50k", 3)], { creditsOnly: true }, 150_000],
    ["plan + pack x1 (essai : plan a 0)", [PLAN_LINE(0), pack("aiCreditsPack50k", 1)], {}, 50_000],
    ["plan + pack x2", [PLAN_LINE(0), pack("aiCreditsPack50k", 2)], {}, 100_000],
    ["plan + pack x3 sans essai", [PLAN_LINE(), pack("aiCreditsPack50k", 3)], {}, 150_000],
    ["plan + packs distincts", [PLAN_LINE(0), pack("aiCreditsPack50k", 1), pack("aiCreditsPack200k", 2)], {}, 450_000],
    ["plan + add-on + pack", [PLAN_LINE(0), ADDON_LINE, pack("aiCreditsPack500k", 1)], {}, 500_000],
    ["meme pack sur deux lignes", [pack("aiCreditsPack50k", 1), pack("aiCreditsPack50k", 2)], {}, 150_000],
    ["remise 25 % : credits inchanges", [PLAN_LINE(0), pack("aiCreditsPack50k", 2, 200)], {}, 100_000],
    ["remise 100 % : revue manuelle", [PLAN_LINE(0), pack("aiCreditsPack50k", 1, 400)], {}, "credit_line_free"],
    ["quantite 0", [PLAN_LINE(0), pack("aiCreditsPack50k", 0)], {}, "bad_quantity"],
    ["quantite 21", [pack("aiCreditsPack50k", 21)], { creditsOnly: true }, "bad_quantity"],
    ["quantite fractionnaire", [{ ...pack("aiCreditsPack50k", 1), quantity: 1.5 }], {}, "bad_quantity"],
    ["ligne inconnue", [PLAN_LINE(0), pack("aiCreditsPack50k", 1), { price: { id: "price_inconnu" }, quantity: 1, amount_subtotal: 100 }], {}, "unknown_line"],
    ["prix LIVE dans un evenement test", [{ ...pack("aiCreditsPack50k", 1), price: { id: "price_1TknW49eqtbj6iPB2zvBynz9" } }], {}, "unknown_line"],
    ["sous-total different du catalogue", [{ ...pack("aiCreditsPack50k", 2), amount_subtotal: 400 }], {}, "amount_mismatch"],
    ["aucune ligne de pack (plan seul)", [PLAN_LINE()], {}, "no_credit_lines"],
    ["aucune ligne", [], {}, "no_line_items"],
    ["ligne hors credits dans une session credits seuls", [PLAN_LINE(), pack("aiCreditsPack50k", 1)], { creditsOnly: true }, "cart_not_ai_only"],
    ["devise", [pack("aiCreditsPack50k", 1)], { currency: "usd" }, "currency_mismatch"],
    ["non paye", [pack("aiCreditsPack50k", 1)], { paymentStatus: "unpaid" }, "not_paid"],
  ];
  it.each(cas)("%s", (_nom, lignes, over, attendu) => {
    const total = typeof over["amountTotal"] === "number" ? over["amountTotal"] : sumPaid(lignes);
    const v = resolveAiCreditsFromLineItems(base(lignes, { amountTotal: total, ...over }));
    if (typeof attendu === "number") { expect(v.ok && v.credits).toBe(attendu); }
    else { expect(v.ok).toBe(false); expect(!v.ok && v.code).toBe(attendu); }
  });
  it("amount_total inferieur aux credits payes => rejet (sous-paiement)", () => {
    const v = resolveAiCreditsFromLineItems(base([pack("aiCreditsPack200k", 2)], { amountTotal: 900 }));
    expect(!v.ok && v.code).toBe("amount_mismatch");
  });
  it("metadata.credits forgee n'influence pas le resultat", () => {
    const v = resolveAiCreditsFromLineItems(base([pack("aiCreditsPack50k", 1)], { amountTotal: 400, metadata: { credits: "9999999", ai_credits: "aiCreditsPack500k" } }));
    expect(v.ok && v.credits).toBe(50_000);
    expect(v.ok && v.metadataCreditsMismatch).toBe(true);
  });
  it("propriete : 2000 paniers aleatoires => credits == somme catalogue x quantite, exactement", () => {
    let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const keys = Object.keys(PACKS);
    for (let i = 0; i < 2000; i++) {
      const lignes: StripeLineItemLike[] = [];
      let attendu = 0;
      if (rnd() < 0.6) lignes.push(PLAN_LINE(rnd() < 0.5 ? 0 : 4900));
      if (rnd() < 0.3) lignes.push(ADDON_LINE);
      const n = 1 + Math.floor(rnd() * 3);
      for (let j = 0; j < n; j++) { const k = keys[Math.floor(rnd() * keys.length)]!; const q = 1 + Math.floor(rnd() * 5); lignes.push(pack(k, q)); attendu += PACKS[k]!.credits * q; }
      const v = resolveAiCreditsFromLineItems(base(lignes, { amountTotal: sumPaid(lignes) }));
      expect(v.ok && v.credits).toBe(attendu);
      // mutation : un seul sous-total altere => jamais de credit
      const idx = lignes.findIndex((l) => l !== lignes[0] && PACKS[Object.keys(PACKS).find((k) => PACKS[k]!.price === (l.price as { id: string }).id) ?? ""] !== undefined);
      const mut = lignes.map((l, x) => (x === (idx < 0 ? lignes.length - 1 : idx) && l.amount_subtotal ? { ...l, amount_subtotal: l.amount_subtotal + 1 } : l));
      if (mut.some((l, x) => l !== lignes[x])) expect(resolveAiCreditsFromLineItems(base(mut, { amountTotal: sumPaid(mut) })).ok).toBe(false);
    }
  });
  it("catalogue : packs et credits de reference inchanges", () => {
    for (const [k, v] of Object.entries(PACKS)) expect(AI_CREDIT_CATALOG[k]).toBe(v.credits);
  });
});

describe("fetchSessionLineItems — pagination", () => {
  it("suit has_more / starting_after", async () => {
    const pages = [{ data: [{ id: "li_1", ...pack("aiCreditsPack50k", 1) }], has_more: true }, { data: [{ id: "li_2", ...pack("aiCreditsPack200k", 1) }], has_more: false }];
    const fn = vi.fn(async () => pages.shift()!);
    const out = await fetchSessionLineItems({ checkout: { sessions: { listLineItems: fn } } }, "cs_1");
    expect(out).toHaveLength(2);
    expect(fn).toHaveBeenLastCalledWith("cs_1", { limit: 100, starting_after: "li_1" });
  });
});

// ── B. Webhook de bout en bout (PostgreSQL jetable) ──────────────────────────

const signer = (corps: string) => {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${corps}`).digest("hex")}`;
};
async function monter() {
  const { default: routeur } = await import("./stripe-webhook.js");
  const app = express();
  app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }),
    (req: express.Request & { rawBody?: Buffer }, _res, next) => { req.rawBody = req.body as Buffer; next(); });
  app.use("/api", routeur);
  return app;
}
let n = 0;
const uid = (p: string) => `${p}_${Date.now()}_${++n}_${Math.random().toString(36).slice(2, 8)}`;
async function envoyer(type: string, obj: Record<string, unknown>, id?: string) {
  const corps = JSON.stringify({ id: id ?? uid("evt"), type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: obj } });
  return request(await monter()).post("/api/webhooks/stripe")
    .set("Content-Type", "application/json").set("stripe-signature", signer(corps)).send(corps);
}
const LIGNES = new Map<string, StripeLineItemLike[]>();
let stripeIndisponible = false;
async function nouvelleOrg() {
  const org = randomUUID(); const cus = `cus_cart_${org.slice(0, 8)}_${++n}`;
  await pool.query(`INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email, stripe_customer_id)
    VALUES ($1,'CART',$2,'u','active','standard',$3,$4)`, [org, `cart-${org}`, `cart-${org}@example.test`, cus]);
  orgsCreees.push(org);
  return { org, cus };
}
/** Session Checkout. `plan` => abonnement (mode subscription) ; `lignes` enregistrees cote "Stripe" mocke. */
function session(c: { org: string; cus: string }, lignes: StripeLineItemLike[], opts: { plan?: boolean; meta?: Record<string, string>; over?: Record<string, unknown> } = {}) {
  const id = uid("cs_test"); LIGNES.set(id, lignes);
  const credits = lignes.some((l) => Object.values(PACKS).some((p) => p.price === (l.price as { id: string }).id));
  return {
    id, object: "checkout.session", mode: opts.plan ? "subscription" : "payment", status: "complete", payment_status: "paid", livemode: false,
    amount_total: sumPaid(lignes), currency: "eur", customer: c.cus, payment_intent: opts.plan ? null : uid("pi"),
    metadata: {
      orgId: c.org, ...(opts.plan ? { selected_plan: "pro", plan: "pro" } : { type: "ai_credits" }),
      ...(credits && opts.plan ? { ai_credits: "aiCreditsPack50k" } : {}), ...opts.meta,
    },
    ...opts.over,
  };
}
const solde = async (org: string) =>
  Number((await pool.query<{ s: string }>(`SELECT COALESCE(SUM(credits),0)::text AS s FROM ai_credit_purchases WHERE org_id = $1::uuid`, [org])).rows[0]!.s);
const plan = async (org: string) => (await pool.query<{ plan: string }>(`SELECT plan FROM organizations WHERE id=$1::uuid`, [org])).rows[0]!.plan;
const rejets = () => (logger.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
  .filter((c) => (c[0] as Record<string, unknown> | undefined)?.["AI_CREDITS_REJECTED"] === true).map((c) => (c[0] as { code: string }).code);

beforeAll(async () => { try { await pool.query(`SELECT 1 FROM ai_credit_purchases LIMIT 0`); dbUp = true; } catch { dbUp = false; } });
afterAll(async () => { process.env = { ...environnement }; if (dbUp) await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [orgsCreees]); });
beforeEach(() => {
  vi.clearAllMocks(); LIGNES.clear(); stripeIndisponible = false;
  process.env = { ...environnement };
  process.env["NODE_ENV"] = "development";
  process.env["STRIPE_SECRET_KEY"] = "sk_test_cle_de_test_locale";
  process.env["STRIPE_TEST_KEY"] = "sk_test_cle_de_test_locale";
  process.env["STRIPE_TEST_MODE"] = "true";
  delete process.env["STRIPE_WEBHOOK_SECRET"];
  process.env["STRIPE_TEST_WEBHOOK_SECRET"] = SECRET;
  setStripeForTesting({ checkout: { sessions: { listLineItems: vi.fn(async (id: string) => {
    if (stripeIndisponible) throw new Error("stripe down");
    return { data: LIGNES.get(id) ?? [], has_more: false };
  }) } } });
});
afterEach(() => setStripeForTesting(null));

describe("webhook — matrice panier (credits inscrits == attendus exactement)", () => {
  const cas: Array<[string, StripeLineItemLike[], boolean, number]> = [
    ["credits seuls x1", [pack("aiCreditsPack50k", 1)], false, 50_000],
    ["credits seuls x3", [pack("aiCreditsPack50k", 3)], false, 150_000],
    ["credits seuls, deux packs distincts", [pack("aiCreditsPack50k", 1), pack("aiCreditsPack500k", 1)], false, 550_000],
    ["plan + pack x1 avec essai", [PLAN_LINE(0), pack("aiCreditsPack50k", 1)], true, 50_000],
    ["plan + pack x2 avec essai", [PLAN_LINE(0), pack("aiCreditsPack50k", 2)], true, 100_000],
    ["plan + pack x3 sans essai", [PLAN_LINE(), pack("aiCreditsPack50k", 3)], true, 150_000],
    ["plan + packs distincts (50k x1, 200k x2)", [PLAN_LINE(0), pack("aiCreditsPack50k", 1), pack("aiCreditsPack200k", 2)], true, 450_000],
    ["plan + add-on + pack", [PLAN_LINE(0), ADDON_LINE, pack("aiCreditsPack200k", 1)], true, 200_000],
    ["plan + pack avec remise 25 %", [PLAN_LINE(0), pack("aiCreditsPack50k", 2, 200)], true, 100_000],
  ];
  it.each(cas)("%s", async (_nom, lignes, avecPlan, attendu) => {
    if (!dbUp) return;
    const c = await nouvelleOrg();
    const r = await envoyer("checkout.session.completed", session(c, lignes, { plan: avecPlan }));
    expect(r.status).toBe(200);
    expect(await solde(c.org)).toBe(attendu);
    if (avecPlan) expect(await plan(c.org)).toBe("pro");
    expect(rejets()).toEqual([]);
  });

  it("plan seul : aucun credit, aucun rejet, abonnement actif", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg();
    expect((await envoyer("checkout.session.completed", session(c, [PLAN_LINE()], { plan: true }))).status).toBe(200);
    expect(await solde(c.org)).toBe(0);
    expect(await plan(c.org)).toBe("pro");
    expect(rejets()).toEqual([]);
  });

  it("metadata forgee (credits=9 999 999, ai_credits=500k, pack=500k) : ignorees, lignes = 50 000", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg();
    const s = session(c, [PLAN_LINE(0), pack("aiCreditsPack50k", 1)], { plan: true, meta: { credits: "9999999", ai_credits: "aiCreditsPack500k", pack: "aiCreditsPack500k" } });
    expect((await envoyer("checkout.session.completed", s)).status).toBe(200);
    expect(await solde(c.org)).toBe(50_000);
  });

  it.each<[string, StripeLineItemLike[], string]>([
    ["quantite 0", [PLAN_LINE(0), pack("aiCreditsPack50k", 0)], "bad_quantity"],
    ["ligne inconnue", [PLAN_LINE(0), pack("aiCreditsPack50k", 1), { price: { id: "price_inconnu" }, quantity: 1, amount_subtotal: 100 }], "unknown_line"],
    ["sous-total different du catalogue", [PLAN_LINE(0), { ...pack("aiCreditsPack200k", 1), amount_subtotal: 400 }], "amount_mismatch"],
    ["100 % de remise", [PLAN_LINE(0), pack("aiCreditsPack50k", 1, 400)], "credit_line_free"],
  ])("panier combine invalide (%s) : AUCUN credit, rejet journalise, abonnement NON bloque", async (_nom, lignes, code) => {
    if (!dbUp) return;
    const c = await nouvelleOrg();
    const r = await envoyer("checkout.session.completed", session(c, lignes, { plan: true }));
    expect(r.status).toBe(200);
    expect(await solde(c.org)).toBe(0);
    expect(rejets()).toContain(code);
    expect(await plan(c.org)).toBe("pro");
  });

  it("credits seuls invalides : 422, evenement rejouable, aucun credit", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const evt = uid("evt");
    const s = session(c, [pack("aiCreditsPack50k", 0)]);
    const r = await envoyer("checkout.session.completed", s, evt);
    expect(r.status).toBe(422);
    expect(await solde(c.org)).toBe(0);
    const st = await pool.query<{ s: string }>(`SELECT metadata->>'status' AS s FROM billing_events WHERE stripe_event_id=$1`, [evt]);
    expect(st.rows[0]?.s).toBe("failed");
    // corrige cote Stripe (lignes valides) puis relivre le MEME evenement : credite.
    LIGNES.set(String(s.id), [pack("aiCreditsPack50k", 1)]);
    expect((await envoyer("checkout.session.completed", { ...s, amount_total: 400 }, evt)).status).toBe(200);
    expect(await solde(c.org)).toBe(50_000);
  });

  it("Stripe indisponible : credits seuls => 500 (relivraison), panier combine => abonnement actif + rejet journalise", async () => {
    if (!dbUp) return;
    const c1 = await nouvelleOrg(); stripeIndisponible = true;
    expect((await envoyer("checkout.session.completed", session(c1, [pack("aiCreditsPack50k", 1)]))).status).toBe(500);
    expect(await solde(c1.org)).toBe(0);
    const c2 = await nouvelleOrg();
    expect((await envoyer("checkout.session.completed", session(c2, [PLAN_LINE(0), pack("aiCreditsPack50k", 1)], { plan: true }))).status).toBe(200);
    expect(await solde(c2.org)).toBe(0);
    expect(rejets()).toContain("line_items_unavailable");
    expect(await plan(c2.org)).toBe("pro");
  });

  it("rejeu (meme evenement, puis nouvel evenement pour la meme session) : un seul credit", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const evt = uid("evt");
    const s = session(c, [PLAN_LINE(0), pack("aiCreditsPack50k", 2)], { plan: true });
    await envoyer("checkout.session.completed", s, evt);
    expect((await envoyer("checkout.session.completed", s, evt)).body.duplicate).toBe(true);
    await envoyer("checkout.session.completed", s);
    expect(await solde(c.org)).toBe(100_000);
  });

  it("concurrence : 4 livraisons simultanees => un seul credit", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg();
    const s = session(c, [PLAN_LINE(0), pack("aiCreditsPack200k", 3)], { plan: true });
    await Promise.all([1, 2, 3, 4].map(() => envoyer("checkout.session.completed", s)));
    expect(await solde(c.org)).toBe(600_000);
  });
});
