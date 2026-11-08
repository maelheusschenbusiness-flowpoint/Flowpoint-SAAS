/**
 * stripe-webhook-ai-credits-db.test.ts
 *
 * Matrice de controle de l'attribution de credits IA par le webhook Stripe.
 * Stripe est reel cote bibliotheque de signature seulement (HMAC calcule ici,
 * comme stripe-webhook-signature.test.ts) : AUCUN appel reseau, aucune cle reelle.
 * La base est une PostgreSQL locale jetable (comme la CI). Sans base, la suite
 * s'ignore proprement.
 *
 * Controles : (1) pack du catalogue (2) credits du catalogue, jamais la metadata
 * (3) montant/devise payes (4) organisation = proprietaire du customer
 * (5) mode live/test (6) idempotence + statut (7) deux evenements, un achat.
 */
import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";

vi.hoisted(() => {
  process.env["STRIPE_TEST_PRICE_AI_50K"] = "price_t_ai50k";
  process.env["STRIPE_TEST_PRICE_AI_200K"] = "price_t_ai200k";
  process.env["STRIPE_TEST_PRICE_AI_500K"] = "price_t_ai500k";
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

const SECRET = "whsec_secret_de_test_calcule_localement";
const ORG_A = randomUUID();
const ORG_B = randomUUID();
const CUS_A = `cus_ai_a_${Date.now()}`;
const CUS_B = `cus_ai_b_${Date.now()}`;
const environnement = { ...process.env };
let dbUp = false;

function signer(corps: string): string {
  const t = Math.floor(Date.now() / 1000);
  return `t=${t},v1=${createHmac("sha256", SECRET).update(`${t}.${corps}`).digest("hex")}`;
}

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

async function envoyer(type: string, obj: Record<string, unknown>, opts: { id?: string; livemode?: boolean } = {}) {
  const corps = JSON.stringify({
    id: opts.id ?? uid("evt"), type, livemode: opts.livemode ?? false,
    created: Math.floor(Date.now() / 1000), data: { object: obj },
  });
  return request(await monter()).post("/api/webhooks/stripe")
    .set("Content-Type", "application/json").set("stripe-signature", signer(corps)).send(corps);
}

/** PaymentIntent tel que cree par /billing/ai-credits-intent (valeurs catalogue). */
function pi(over: Record<string, unknown> = {}, meta: Record<string, string> = {}): Record<string, unknown> {
  return {
    id: uid("pi"), object: "payment_intent", status: "succeeded", livemode: false,
    amount: 400, amount_received: 400, currency: "eur", customer: CUS_A,
    metadata: { type: "ai_credits", pack: "ai_credits_50k", credits: "50000", amountEurCents: "400", orgId: ORG_A, ...meta },
    ...over,
  };
}

async function credits(org: string, pi_?: string): Promise<number> {
  const r = await pool.query<{ s: string }>(
    `SELECT COALESCE(SUM(credits),0)::text AS s FROM ai_credit_purchases WHERE org_id = $1::uuid
       AND ($2::text IS NULL OR stripe_payment_intent = $2)`, [org, pi_ ?? null]);
  return Number(r.rows[0]?.s ?? 0);
}
async function rows(piId: string): Promise<number> {
  const r = await pool.query(`SELECT 1 FROM ai_credit_purchases WHERE stripe_payment_intent = $1`, [piId]);
  return r.rowCount ?? 0;
}

beforeAll(async () => {
  try {
    await pool.query(`INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email, stripe_customer_id)
      VALUES ($1,'AI A',$2,'u','active','standard',$3,$4),($5,'AI B',$6,'u','active','standard',$7,$8) ON CONFLICT (id) DO NOTHING`,
      [ORG_A, `ai-a-${Date.now()}`, `ai-a-${Date.now()}@example.test`, CUS_A,
       ORG_B, `ai-b-${Date.now()}`, `ai-b-${Date.now()}@example.test`, CUS_B]);
    dbUp = true;
  } catch { dbUp = false; }
});
afterAll(async () => {
  process.env = { ...environnement };
  if (!dbUp) return;
  await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [[ORG_A, ORG_B]]);
  await pool.query(`DELETE FROM billing_events WHERE stripe_event_id LIKE 'evt_%' AND created_at > NOW() - INTERVAL '1 hour' AND org_id = ANY($1::text[])`, [[ORG_A, ORG_B, "_system_"]]);
});
/** Lignes Stripe (listLineItems) par session : la composition vient d'ici, jamais des metadata. */
const LIGNES = new Map<string, Array<Record<string, unknown>>>();
const PRIX: Record<string, [string, number]> = { aiCreditsPack50k: ["price_t_ai50k", 400], aiCreditsPack200k: ["price_t_ai200k", 900], aiCreditsPack500k: ["price_t_ai500k", 1900] };
const ligne = (key: string, quantity: number, over: Record<string, unknown> = {}) => ({
  id: `li_${key}_${quantity}`, price: { id: PRIX[key]![0] }, quantity, amount_subtotal: PRIX[key]![1] * quantity, amount_discount: 0, amount_total: PRIX[key]![1] * quantity, ...over,
});
afterEach(() => setStripeForTesting(null));
beforeEach(() => {
  vi.clearAllMocks();
  LIGNES.clear();
  setStripeForTesting({ checkout: { sessions: { listLineItems: vi.fn(async (id: string) => ({ data: LIGNES.get(id) ?? [], has_more: false })) } } });
  process.env = { ...environnement };
  process.env["NODE_ENV"] = "development";
  process.env["STRIPE_SECRET_KEY"] = "sk_test_cle_de_test_locale";
  process.env["STRIPE_TEST_KEY"] = "sk_test_cle_de_test_locale";
  process.env["STRIPE_TEST_MODE"] = "true";
  delete process.env["STRIPE_WEBHOOK_SECRET"];
  process.env["STRIPE_TEST_WEBHOOK_SECRET"] = SECRET;
});

const erreurRejet = () => (logger.error as unknown as { mock: { calls: unknown[][] } }).mock.calls
  .some((c) => (c[0] as { AI_CREDITS_REJECTED?: boolean } | undefined)?.AI_CREDITS_REJECTED === true);

describe("controle 0 — achat valide", () => {
  it("pack/montant/org valides => credits du catalogue, une seule fois", async () => {
    if (!dbUp) return;
    const o = pi();
    const r = await envoyer("payment_intent.succeeded", o);
    expect(r.status).toBe(200);
    expect(await credits(ORG_A, o["id"] as string)).toBe(50000);
    expect(erreurRejet()).toBe(false);
  });
});

describe("controle 1 — pack connu du catalogue serveur", () => {
  it("pack inconnu => refus 422, journal ERREUR, aucun credit", async () => {
    if (!dbUp) return;
    const o = pi({}, { pack: "ai_credits_9m", credits: "9000000" });
    const r = await envoyer("payment_intent.succeeded", o);
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("unknown_pack");
    expect(await rows(o["id"] as string)).toBe(0);
    expect(erreurRejet()).toBe(true);
  });
  it("evenement rejete = rejouable (statut failed, pas processed)", async () => {
    if (!dbUp) return;
    const o = pi({}, { pack: "inconnu" });
    const id = uid("evt");
    expect((await envoyer("payment_intent.succeeded", o, { id })).status).toBe(422);
    const s = await pool.query<{ s: string }>(`SELECT metadata->>'status' AS s FROM billing_events WHERE stripe_event_id = $1`, [id]);
    expect(s.rows[0]?.s).toBe("failed");
  });
});

describe("controle 2 — credits du catalogue, jamais la metadata", () => {
  it("metadata.credits gonflee => credits du catalogue", async () => {
    if (!dbUp) return;
    const o = pi({}, { credits: "99999999" });
    expect((await envoyer("payment_intent.succeeded", o)).status).toBe(200);
    expect(await credits(ORG_A, o["id"] as string)).toBe(50000);
  });
  it("panier public x2 : credits = catalogue x quantite (montant 800)", async () => {
    if (!dbUp) return;
    const o = pi({ amount: 800, amount_received: 800 },
      { pack: "aiCreditsPack50k", credits: "50000", addons: JSON.stringify({ aiCreditsPack50k: 2 }) });
    expect((await envoyer("payment_intent.succeeded", o)).status).toBe(200);
    expect(await credits(ORG_A, o["id"] as string)).toBe(100000);
  });
});

describe("controle 3 — montant et devise payes = prix catalogue", () => {
  it("montant paye inferieur => refus", async () => {
    if (!dbUp) return;
    const o = pi({ amount_received: 100 });
    const r = await envoyer("payment_intent.succeeded", o);
    expect(r.status).toBe(422); expect(r.body.code).toBe("amount_mismatch");
    expect(await rows(o["id"] as string)).toBe(0);
  });
  it("metadata.amountEurCents correcte mais montant reel different => refus", async () => {
    if (!dbUp) return;
    const o = pi({ amount_received: 399 }, { amountEurCents: "400" });
    expect((await envoyer("payment_intent.succeeded", o)).status).toBe(422);
    expect(await rows(o["id"] as string)).toBe(0);
  });
  it("mauvaise devise => refus", async () => {
    if (!dbUp) return;
    const o = pi({ currency: "usd" });
    const r = await envoyer("payment_intent.succeeded", o);
    expect(r.status).toBe(422); expect(r.body.code).toBe("currency_mismatch");
  });
});

describe("controle 4 — organisation beneficiaire", () => {
  it("customer de A mais metadata.orgId = B => refus", async () => {
    if (!dbUp) return;
    const o = pi({}, { orgId: ORG_B });
    const r = await envoyer("payment_intent.succeeded", o);
    expect(r.status).toBe(422); expect(r.body.code).toBe("org_mismatch");
    expect(await credits(ORG_B, o["id"] as string)).toBe(0);
    expect(await credits(ORG_A, o["id"] as string)).toBe(0);
  });
  it("metadata.orgId absente => refus", async () => {
    if (!dbUp) return;
    const o = pi(); delete (o["metadata"] as Record<string, string>)["orgId"];
    const r = await envoyer("payment_intent.succeeded", o);
    expect(r.status).toBe(422);
    expect(await rows(o["id"] as string)).toBe(0);
  });
  it("customer inconnu + metadata.orgId existant => refus (customer rattache a aucune org)", async () => {
    if (!dbUp) return;
    const o = pi({ customer: "cus_inconnu_de_la_base" });
    const r = await envoyer("payment_intent.succeeded", o);
    expect(r.status).toBe(422); expect(r.body.code).toBe("customer_not_linked");
  });
  it("orgId forge inexistant (sans customer) => refus", async () => {
    if (!dbUp) return;
    const o = pi({ customer: null }, { orgId: randomUUID() });
    const r = await envoyer("payment_intent.succeeded", o);
    expect(r.status).toBe(422); expect(r.body.code).toBe("org_unknown");
  });
  it("customer de B + metadata B => credite B, pas A", async () => {
    if (!dbUp) return;
    const o = pi({ customer: CUS_B }, { orgId: ORG_B });
    expect((await envoyer("payment_intent.succeeded", o)).status).toBe(200);
    expect(await credits(ORG_B, o["id"] as string)).toBe(50000);
    expect(await credits(ORG_A, o["id"] as string)).toBe(0);
  });
});

describe("controle 5 — mode live/test", () => {
  it("evenement live sur un serveur en mode test => 400, rien de credite", async () => {
    if (!dbUp) return;
    const o = pi({ livemode: true });
    const r = await envoyer("payment_intent.succeeded", o, { livemode: true });
    expect(r.status).toBe(400);
    expect(await rows(o["id"] as string)).toBe(0);
  });
  it("objet live dans un evenement test => refus", async () => {
    if (!dbUp) return;
    const o = pi({ livemode: true });
    const r = await envoyer("payment_intent.succeeded", o, { livemode: false });
    expect(r.status).toBe(422); expect(r.body.code).toBe("livemode_mismatch");
    expect(await rows(o["id"] as string)).toBe(0);
  });
});

describe("controle 6 — idempotence et statut", () => {
  it("meme evenement rejoue => un seul credit", async () => {
    if (!dbUp) return;
    const o = pi(); const id = uid("evt");
    await envoyer("payment_intent.succeeded", o, { id });
    const r2 = await envoyer("payment_intent.succeeded", o, { id });
    expect(r2.body.duplicate).toBe(true);
    expect(await credits(ORG_A, o["id"] as string)).toBe(50000);
  });
  it("meme PaymentIntent, evenements distincts => un seul credit", async () => {
    if (!dbUp) return;
    const o = pi();
    await envoyer("payment_intent.succeeded", o);
    await envoyer("payment_intent.succeeded", o);
    expect(await credits(ORG_A, o["id"] as string)).toBe(50000);
  });
  it("concurrence : 4 livraisons simultanees => un seul credit", async () => {
    if (!dbUp) return;
    const o = pi();
    await Promise.all([1, 2, 3, 4].map(() => envoyer("payment_intent.succeeded", o)));
    expect(await credits(ORG_A, o["id"] as string)).toBe(50000);
  });
  it.each(["requires_payment_method", "canceled", "processing"])("statut %s => aucun credit", async (status) => {
    if (!dbUp) return;
    const o = pi({ status });
    const r = await envoyer("payment_intent.succeeded", o);
    expect(r.status).toBe(422); expect(r.body.code).toBe("not_paid");
    expect(await rows(o["id"] as string)).toBe(0);
  });
  it("setup_intent.succeeded etiquete ai_credits => aucun credit", async () => {
    if (!dbUp) return;
    const o = pi({ object: "setup_intent" });
    const r = await envoyer("setup_intent.succeeded", o);
    expect(r.status).toBe(422);
    expect(await rows(o["id"] as string)).toBe(0);
  });
  it("echec DB => 500 (Stripe rejoue), evenement non marque traite", async () => {
    if (!dbUp) return;
    // Pack et org valides ; l'INSERT echoue (contrainte temporaire) : le handler doit relancer.
    await pool.query(`ALTER TABLE ai_credit_purchases ADD CONSTRAINT tmp_fail_chk CHECK (credits <> 50000) NOT VALID`);
    try {
      const o = pi();
      const id = uid("evt");
      const r = await envoyer("payment_intent.succeeded", o, { id });
      expect(r.status).toBe(500);
      const s = await pool.query<{ s: string }>(`SELECT metadata->>'status' AS s FROM billing_events WHERE stripe_event_id = $1`, [id]);
      expect(s.rows[0]?.s).toBe("failed");
    } finally {
      await pool.query(`ALTER TABLE ai_credit_purchases DROP CONSTRAINT tmp_fail_chk`);
    }
  });
});

describe("controle 7 — checkout.session.completed + payment_intent.succeeded, un seul achat", () => {
  const session = (piId: string, over: Record<string, unknown> = {}, meta: Record<string, string> = {}, lignes: Array<Record<string, unknown>> = [ligne("aiCreditsPack50k", 1)]) => {
    const id = uid("cs_test"); LIGNES.set(id, lignes);
    return {
      id, object: "checkout.session", mode: "payment", payment_status: "paid", livemode: false,
      amount_total: 400, currency: "eur", customer: CUS_A, payment_intent: piId,
      metadata: { type: "ai_credits", pack: "ai_credits_50k", credits: "50000", amountEurCents: "400", orgId: ORG_A, ...meta },
      ...over,
    };
  };
  it("session payee valide => credits catalogue", async () => {
    if (!dbUp) return;
    const o = pi(); const s = session(o["id"] as string);
    expect((await envoyer("checkout.session.completed", s)).status).toBe(200);
    expect(await credits(ORG_A, o["id"] as string)).toBe(50000);
  });
  it("session puis PaymentIntent du meme achat => un seul credit (dans les deux ordres)", async () => {
    if (!dbUp) return;
    const o1 = pi();
    await envoyer("checkout.session.completed", session(o1["id"] as string));
    await envoyer("payment_intent.succeeded", o1);
    expect(await credits(ORG_A, o1["id"] as string)).toBe(50000);
    const o2 = pi();
    await envoyer("payment_intent.succeeded", o2);
    await envoyer("checkout.session.completed", session(o2["id"] as string));
    expect(await credits(ORG_A, o2["id"] as string)).toBe(50000);
  });
  it("concurrence session + PaymentIntent => un seul credit", async () => {
    if (!dbUp) return;
    const o = pi();
    await Promise.all([
      envoyer("checkout.session.completed", session(o["id"] as string)),
      envoyer("payment_intent.succeeded", o),
    ]);
    expect(await credits(ORG_A, o["id"] as string)).toBe(50000);
  });
  it("session : montant different du catalogue => refus", async () => {
    if (!dbUp) return;
    const o = pi(); const s = session(o["id"] as string, { amount_total: 150 });
    const r = await envoyer("checkout.session.completed", s);
    expect(r.status).toBe(422);
    expect(await rows(o["id"] as string)).toBe(0);
  });
  it("session : metadata.credits gonflee ignoree ; pack inconnu refuse", async () => {
    if (!dbUp) return;
    const o = pi(); const s = session(o["id"] as string, {}, { credits: "7000000" });
    await envoyer("checkout.session.completed", s);
    expect(await credits(ORG_A, o["id"] as string)).toBe(50000);
    // metadata.pack n'est plus lu : seule la ligne Stripe compte. Un price id inconnu => refus.
    const o2 = pi(); const s2 = session(o2["id"] as string, {}, {}, [{ ...ligne("aiCreditsPack50k", 1), price: { id: "price_inconnu" } }]);
    const r2 = await envoyer("checkout.session.completed", s2);
    expect(r2.status).toBe(422); expect(r2.body.code).toBe("unknown_line");
    expect(await rows(o2["id"] as string)).toBe(0);
    const o3 = pi(); const s3 = session(o3["id"] as string, {}, { pack: "ai_credits_xxl", credits: "9" });
    expect((await envoyer("checkout.session.completed", s3)).status).toBe(200);
    expect(await credits(ORG_A, o3["id"] as string)).toBe(50000);
  });
  it("session non payee => aucun credit, pas d'erreur", async () => {
    if (!dbUp) return;
    const o = pi(); const s = session(o["id"] as string, { payment_status: "unpaid" });
    expect((await envoyer("checkout.session.completed", s)).status).toBe(200);
    expect(await rows(o["id"] as string)).toBe(0);
  });
  it("session : quantite 3 lue sur la ligne Stripe (3 x 400 = 1200)", async () => {
    if (!dbUp) return;
    const o = pi(); const s = session(o["id"] as string, { amount_total: 1200 }, {}, [ligne("aiCreditsPack50k", 3)]);
    expect((await envoyer("checkout.session.completed", s)).status).toBe(200);
    expect(await credits(ORG_A, o["id"] as string)).toBe(150000);
  });
  it("session : org du customer different de metadata.orgId => refus", async () => {
    if (!dbUp) return;
    const o = pi(); const s = session(o["id"] as string, {}, { orgId: ORG_B });
    expect((await envoyer("checkout.session.completed", s)).status).toBe(422);
    expect(await rows(o["id"] as string)).toBe(0);
  });
});
