/**
 * stripe-webhook-ai-refunds-db.test.ts
 *
 * Remboursements de credits IA : retire UNIQUEMENT les credits non consommes,
 * jamais de solde negatif, idempotent par refund id, sans toucher au ledger
 * vendeur. Evenements signes localement (HMAC), Stripe MOCKE (setStripeForTesting),
 * PostgreSQL locale jetable : aucun appel reseau, aucune cle reelle.
 * Sans base, la suite s'ignore proprement (comme stripe-webhook-ai-credits-db).
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../services/store.js", () => ({
  store: { broadcast: vi.fn(), broadcastPlanUpdate: vi.fn(), logActivity: vi.fn() },
}));
// ai-engine est mocke globalement par vitest.setup.ts ; ici on veut le vrai calcul de solde.
vi.mock("../services/ai-engine.js", async (importOriginal) => importOriginal<typeof import("../services/ai-engine.js")>());

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { setStripeForTesting } from "../services/stripe-factory.js";
import { creditsForRefundedAmount, processAiCreditRefundEvent } from "../services/ai-credit-refunds.js";

const SECRET = "whsec_secret_de_test_calcule_localement";
const environnement = { ...process.env };
let dbUp = false;
const orgsCreees: string[] = [];
const month = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();

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
async function envoyer(type: string, obj: Record<string, unknown>, opts: { id?: string } = {}) {
  const corps = JSON.stringify({ id: opts.id ?? uid("evt"), type, livemode: false, created: Math.floor(Date.now() / 1000), data: { object: obj } });
  return request(await monter()).post("/api/webhooks/stripe")
    .set("Content-Type", "application/json").set("stripe-signature", signer(corps)).send(corps);
}

type Ctx = { org: string; cus: string };
async function nouvelleOrg(used = 0): Promise<Ctx> {
  const org = randomUUID(); const cus = `cus_rf_${org.slice(0, 8)}_${++n}`;
  await pool.query(`INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email, stripe_customer_id)
    VALUES ($1,'RF',$2,'u','active','standard',$3,$4)`, [org, `rf-${org}`, `rf-${org}@example.test`, cus]);
  orgsCreees.push(org);
  if (used > 0) {
    await pool.query(`INSERT INTO ai_monthly_usage (id, org_id, month, credits_used, cost_eur, request_count, tokens_used, reset_at, updated_at)
      VALUES ($1,$2,$3,$4,0,0,0,NOW()+INTERVAL '30 days',NOW())`, [`amu-${org}`, org, month, used]);
  }
  return { org, cus };
}

/** Achat reel via le webhook (chemin de production) : retourne l'id du PaymentIntent. */
async function acheter(c: Ctx, packKey = "aiCreditsPack50k", qty = 1, cents = 400): Promise<string> {
  const id = uid("pi");
  const r = await envoyer("payment_intent.succeeded", {
    id, object: "payment_intent", status: "succeeded", livemode: false, amount: cents * qty, amount_received: cents * qty,
    currency: "eur", customer: c.cus,
    metadata: { type: "ai_credits", orgId: c.org, addons: JSON.stringify({ [packKey]: qty }) },
  });
  expect(r.status).toBe(200);
  return id;
}
const refundObj = (piId: string, amount: number, over: Record<string, unknown> = {}) => ({
  id: uid("re"), object: "refund", amount, currency: "eur", status: "succeeded", payment_intent: piId, charge: `ch_${piId}`, livemode: false, ...over,
});
const chargeObj = (piId: string, c: Ctx, paid: number, refunds: Array<Record<string, unknown>>) => ({
  id: `ch_${piId}`, object: "charge", amount: paid, amount_refunded: refunds.reduce((s, r) => s + Number(r["amount"]), 0),
  currency: "eur", customer: c.cus, payment_intent: piId, livemode: false, refunds: { data: refunds },
});
let stripeCharges: Record<string, Record<string, unknown>> = {};
const stripeMock = { refunds: { list: vi.fn(async () => ({ data: [] })) }, charges: { retrieve: vi.fn(async (id: string) => stripeCharges[id]!) } };

/** refund.created : Stripe fournit la charge via charges.retrieve (mock). */
async function rembourserEvt(piId: string, c: Ctx, paid: number, amount: number, over: Record<string, unknown> = {}, type = "refund.created", evtId?: string) {
  const rf = refundObj(piId, amount, over);
  stripeCharges[`ch_${piId}`] = { id: `ch_${piId}`, amount: paid, customer: c.cus, payment_intent: piId };
  const r = await envoyer(type, rf, evtId ? { id: evtId } : {});
  return { rf, r };
}
const solde = async (org: string) =>
  Number((await pool.query<{ s: string }>(`SELECT COALESCE(SUM(credits),0)::text AS s FROM ai_credit_purchases WHERE org_id = $1::uuid`, [org])).rows[0]!.s);
const retires = async (org: string) =>
  Number((await pool.query<{ s: string }>(`SELECT COALESCE(SUM(credits_removed),0)::text AS s FROM ai_credit_refunds WHERE org_id = $1::uuid AND status='applied'`, [org])).rows[0]!.s);
const ledger = async () =>
  (await pool.query<{ c: number; h: string }>(`SELECT count(*)::int AS c, COALESCE(md5(string_agg(t::text,'|' ORDER BY t::text)),'') AS h FROM seller_financial_ledger t`)).rows[0]!;
const logsErreur = (cle: string) => (logger.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
  .filter((c) => (c[0] as Record<string, unknown> | undefined)?.[cle] === true);

beforeAll(async () => {
  try { await pool.query(`SELECT 1 FROM ai_credit_refunds LIMIT 0`); dbUp = true; } catch { dbUp = false; }
});
afterAll(async () => {
  process.env = { ...environnement };
  if (!dbUp) return;
  await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [orgsCreees]);
});
beforeEach(() => {
  vi.clearAllMocks();
  stripeCharges = {};
  process.env = { ...environnement };
  process.env["NODE_ENV"] = "development";
  process.env["STRIPE_SECRET_KEY"] = "sk_test_cle_de_test_locale";
  process.env["STRIPE_TEST_KEY"] = "sk_test_cle_de_test_locale";
  process.env["STRIPE_TEST_MODE"] = "true";
  delete process.env["STRIPE_WEBHOOK_SECRET"];
  process.env["STRIPE_TEST_WEBHOOK_SECRET"] = SECRET;
  setStripeForTesting(stripeMock);
});
afterEach(() => setStripeForTesting(null));

describe("arithmetique entiere", () => {
  it.each([
    [50000, 400, 400, 50000], [50000, 100, 400, 12500], [200000, 100, 900, 22222], [200000, 300, 900, 66666],
    [200000, 900, 900, 200000], [200000, 5000, 900, 200000], [200000, 0, 900, 0], [0, 100, 900, 0], [10, 1, 3, 3],
  ])("floor(%i x %i / %i) = %i", (c, r, p, attendu) => expect(creditsForRefundedAmount(c, r, p)).toBe(attendu));
  it("jamais de flottant : 3 partiels + reste == total", () => {
    let cum = 0; let retire = 0;
    for (const m of [100, 100, 100, 600]) { cum += m; const cible = creditsForRefundedAmount(200000, cum, 900); retire += cible - retire; }
    expect(retire).toBe(200000);
  });
});

describe("remboursement total / partiel / successifs", () => {
  it("total : tous les credits non consommes sont retires, solde 0, jamais negatif", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    expect(await solde(c.org)).toBe(50000);
    const { r } = await rembourserEvt(pi, c, 400, 400);
    expect(r.status).toBe(200);
    expect(await solde(c.org)).toBe(0);
    expect(await retires(c.org)).toBe(50000);
  });
  it("partiel 100/400 => 12 500 credits", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    await rembourserEvt(pi, c, 400, 100);
    expect(await solde(c.org)).toBe(37500);
  });
  it("trois partiels (arrondis) puis total : cumul exact, jamais plus que les credits achetes", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c, "aiCreditsPack200k", 1, 900);
    for (const [m, attendu] of [[100, 177778], [100, 155556], [100, 133334]] as const) {
      await rembourserEvt(pi, c, 900, m);
      expect(await solde(c.org)).toBe(attendu);   // 200000 - 22222k : cumul floor(200000*k*100/900)
    }
    await rembourserEvt(pi, c, 900, 600);
    expect(await solde(c.org)).toBe(0);
    expect(await retires(c.org)).toBe(200000);
    await rembourserEvt(pi, c, 900, 50);          // sur-remboursement impossible cote Stripe ; on reste borne
    expect(await solde(c.org)).toBe(0);
  });
  it("multi-packs quantite 2 : remboursement d'une unite = 50 000", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c, "aiCreditsPack50k", 2, 400);
    expect(await solde(c.org)).toBe(100000);
    await rembourserEvt(pi, c, 800, 400);
    expect(await solde(c.org)).toBe(50000);
  });
  it("charge.refunded avec remboursements embarques : meme resultat", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    const rf = refundObj(pi, 100);
    expect((await envoyer("charge.refunded", chargeObj(pi, c, 400, [rf]))).status).toBe(200);
    expect(await solde(c.org)).toBe(37500);
  });
});

describe("idempotence et concurrence", () => {
  it("meme evenement rejoue => rien de plus", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c); const evt = uid("evt");
    const { rf } = await rembourserEvt(pi, c, 400, 100, {}, "refund.created", evt);
    const r2 = await envoyer("refund.created", rf, { id: evt });
    expect(r2.body.duplicate).toBe(true);
    expect(await solde(c.org)).toBe(37500);
  });
  it("refund.created puis charge.refunded puis refund.updated pour le MEME refund => un seul retrait", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    const { rf } = await rembourserEvt(pi, c, 400, 100, { status: "pending" });
    await envoyer("charge.refunded", chargeObj(pi, c, 400, [{ ...rf, status: "succeeded" }]));
    await envoyer("refund.updated", { ...rf, status: "succeeded" });
    await envoyer("refund.updated", { ...rf, status: "succeeded" });
    expect(await solde(c.org)).toBe(37500);
    expect((await pool.query(`SELECT 1 FROM ai_credit_refunds WHERE refund_id=$1`, [rf["id"]])).rowCount).toBe(1);
  });
  it("concurrence : 4 livraisons simultanees (evenements distincts) => un seul retrait", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    const rf = refundObj(pi, 400);
    stripeCharges[`ch_${pi}`] = { id: `ch_${pi}`, amount: 400, customer: c.cus, payment_intent: pi };
    await Promise.all([
      envoyer("refund.created", rf), envoyer("refund.updated", rf),
      envoyer("charge.refunded", chargeObj(pi, c, 400, [rf])), envoyer("refund.created", rf),
    ]);
    expect(await solde(c.org)).toBe(0);
    expect(await retires(c.org)).toBe(50000);
  });
});

describe("plafond : jamais de solde negatif, pas de dette", () => {
  it("consommation du plan seulement (used < limite) : credits achetes intacts => retrait complet", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(60000); const pi = await acheter(c);
    await rembourserEvt(pi, c, 400, 400);
    expect(await solde(c.org)).toBe(0);
  });
  it("credits achetes partiellement consommes => retire le non consomme, journalise l'ecart", async () => {
    if (!dbUp) return;
    // limite plan 100 000 ; consomme 130 000 => 30 000 pris sur les credits achetes (50 000)
    const c = await nouvelleOrg(130000); const pi = await acheter(c);
    await rembourserEvt(pi, c, 400, 400);
    expect(await solde(c.org)).toBe(30000);                 // reste exactement ce qui a ete consomme
    expect(100000 + (await solde(c.org)) - 130000).toBeGreaterThanOrEqual(0);   // solde disponible >= 0
    const l = logsErreur("AI_CREDITS_REFUND_SHORTFALL");
    expect(l).toHaveLength(1);
    expect(l[0]![0]).toMatchObject({ creditsToRemove: 50000, creditsRemoved: 20000, shortfall: 30000, creditsAlreadyConsumed: 130000 });
    const row = (await pool.query(`SELECT credits_removed, credits_shortfall, kind FROM ai_credit_refunds WHERE org_id=$1::uuid`, [c.org])).rows[0]!;
    expect(row).toMatchObject({ credits_removed: 20000, credits_shortfall: 30000, kind: "refund_adjustment" });
  });
  it("tout consomme (au-dela de la limite + achat) => rien retire, pas de negatif", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(150000); const pi = await acheter(c);
    await rembourserEvt(pi, c, 400, 400);
    expect(await solde(c.org)).toBe(50000);
    expect(logsErreur("AI_CREDITS_REFUND_SHORTFALL")).toHaveLength(1);
  });
});

describe("perimetre et coherence", () => {
  it("paiement sans achat de credits (abonnement) : AUCUN effet, aucun appel Stripe", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); await acheter(c);
    const avant = await solde(c.org);
    const piAbo = uid("pi");
    const r = await envoyer("refund.created", refundObj(piAbo, 4900));
    expect(r.status).toBe(200);
    expect(await solde(c.org)).toBe(avant);
    expect(stripeMock.charges.retrieve).not.toHaveBeenCalled();
    expect((await pool.query(`SELECT 1 FROM ai_credit_refunds WHERE payment_intent=$1`, [piAbo])).rowCount).toBe(0);
  });
  it("mauvaise organisation : charge d'un autre customer => rejet, rien retire", async () => {
    if (!dbUp) return;
    const a = await nouvelleOrg(); const b = await nouvelleOrg(); const pi = await acheter(a);
    await rembourserEvt(pi, b, 400, 400);      // la charge appartient au customer de B
    expect(await solde(a.org)).toBe(50000);
    expect(await solde(b.org)).toBe(0);
    expect(logsErreur("AI_CREDITS_REFUND_REJECTED")[0]![0]).toMatchObject({ code: "org_mismatch" });
  });
  it("customer inconnu => rejet", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    await rembourserEvt(pi, { org: c.org, cus: "cus_inconnu_xyz" }, 400, 400);
    expect(await solde(c.org)).toBe(50000);
    expect(logsErreur("AI_CREDITS_REFUND_REJECTED")[0]![0]).toMatchObject({ code: "customer_not_linked" });
  });
  it("objet live dans un evenement test => rejet, rien retire", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    await rembourserEvt(pi, c, 400, 400, { livemode: true });
    expect(await solde(c.org)).toBe(50000);
  });
});

describe("remboursement echoue / annule", () => {
  it.each(["failed", "canceled"])("%s avant application => rien", async (st) => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    await rembourserEvt(pi, c, 400, 400, { status: st });
    expect(await solde(c.org)).toBe(50000);
  });
  it("succeeded puis failed => credits restitues, rejeu sans effet", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    const { rf } = await rembourserEvt(pi, c, 400, 400);
    expect(await solde(c.org)).toBe(0);
    await envoyer("refund.updated", { ...rf, status: "failed" });
    expect(await solde(c.org)).toBe(50000);
    await envoyer("refund.updated", { ...rf, status: "failed" });
    await envoyer("refund.updated", { ...rf, status: "succeeded" });   // ne reapplique pas un refund deja annule
    expect(await solde(c.org)).toBe(50000);
  });
});

describe("ledger vendeur : comportement inchange", () => {
  it("un remboursement de credits n'ecrit rien dans seller_financial_ledger et le chemin ledger s'execute toujours", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    const avant = await ledger();
    const rf = refundObj(pi, 100);
    await envoyer("charge.refunded", chargeObj(pi, c, 400, [rf]));
    await envoyer("refund.created", rf);
    expect(await ledger()).toEqual(avant);
    // Le code ledger (inchange) a bien ete atteint : il a evalue le paiement comme non attribue.
    const infos = (logger.info as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((x) => String(x[1] ?? ""));
    expect(infos.some((m) => m.includes("[Webhook/seller] Refund is not an attributed plan payment"))).toBe(true);
  });
});

describe("service : charge.refunded sans remboursements embarques (Stripe mocke)", () => {
  it("liste les remboursements via Stripe et applique chacun une fois", async () => {
    if (!dbUp) return;
    const c = await nouvelleOrg(); const pi = await acheter(c);
    const r1 = refundObj(pi, 100); const r2 = refundObj(pi, 100);
    const list = vi.fn(async () => ({ data: [r1, r2] }));
    const deps = {
      pool: pool as never, getStripe: async () => ({ refunds: { list }, charges: { retrieve: vi.fn() } }) as never,
      findOrgByCustomer: async () => c.org,
    };
    const ev = { type: "charge.refunded", livemode: false, object: { id: `ch_${pi}`, amount: 400, customer: c.cus, payment_intent: pi } };
    await processAiCreditRefundEvent(ev, deps);
    await processAiCreditRefundEvent(ev, deps);
    expect(list).toHaveBeenCalledWith({ charge: `ch_${pi}`, limit: 100 });
    expect(await solde(c.org)).toBe(50000 - 25000);
  });
});
