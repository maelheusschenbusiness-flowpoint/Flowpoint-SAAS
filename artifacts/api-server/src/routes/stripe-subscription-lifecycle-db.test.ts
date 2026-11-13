/**
 * stripe-subscription-lifecycle-db.test.ts
 *
 * Certification du cycle de vie de l'abonnement, demandee le 18/10/2026, sur un
 * VRAI PostgreSQL et le VRAI routeur de webhook — avec des evenements signes
 * localement, sans aucune cle Stripe.
 *
 * Ce qui se certifie ici : ce qui nous appartient. L'evenement arrive signe,
 * l'organisation est resolue depuis `stripe_customer_id`, et l'etat est
 * persiste. Ce qui ne peut PAS se certifier sans cle `sk_test_` : la creation
 * reelle d'une session Checkout chez Stripe et le paiement par carte de test.
 *
 * TROU MESURE QUI MOTIVE CE FICHIER : `invoice.payment_failed` est traite par
 * le code de production depuis longtemps — il persiste `past_due`, diffuse un
 * evenement et envoie un courriel — mais AUCUN test ne couvrait cette branche.
 * Le seul fichier que `grep payment_failed` ramenait etait growth-facts, par
 * coincidence de vocabulaire.
 *
 * La signature est calculee avec le meme HMAC que Stripe (verifie identique a
 * `generateTestHeaderString`), ce qui permet de prouver les deux cotes : un
 * evenement signe est traite, un evenement forge est refuse.
 */
import { vi, describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";

vi.hoisted(() => {
  process.env["STRIPE_TEST_MODE"] = "true";
  process.env["STRIPE_TEST_KEY"] = "sk_test_cle_locale_de_certification";
  process.env["STRIPE_SECRET_KEY"] = "sk_test_cle_locale_de_certification";
  process.env["STRIPE_TEST_WEBHOOK_SECRET"] = "whsec_certification_locale";
  delete process.env["STRIPE_WEBHOOK_SECRET"];
  delete process.env["ALLOW_UNSIGNED_STRIPE_WEBHOOKS"];
});

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
// Aucun courriel ne part : le webhook en envoie sur echec de paiement.
vi.mock("../services/mailer.js", () => ({
  mailer: {
    sendPaymentFailed: vi.fn(async () => ({ ok: true })),
    sendAccountDeleted: vi.fn(async () => ({ ok: true })),
    sendSubscriptionCanceled: vi.fn(async () => ({ ok: true })),
  },
}));

import { pool } from "@workspace/db";

const SECRET = "whsec_certification_locale";
const ORG = "cccccccc-0000-4000-8000-00000000000c";
const CLIENT = `cus_certif_${Date.now()}`;
const ABO = `sub_certif_${Date.now()}`;

function signer(corps: string, secret = SECRET, horodatage = Math.floor(Date.now() / 1000)): string {
  return `t=${horodatage},v1=${createHmac("sha256", secret).update(`${horodatage}.${corps}`).digest("hex")}`;
}

async function monter() {
  const { default: routeur } = await import("./stripe-webhook.js");
  const app = express();
  app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }),
    (req: express.Request & { rawBody?: Buffer }, _res, next) => { req.rawBody = req.body as Buffer; next(); });
  app.use("/api", routeur);
  return app;
}

/** Envoie un evenement SIGNE et rend le statut HTTP. */
async function envoyer(type: string, objet: Record<string, unknown>, opts: { id?: string; cree?: number } = {}): Promise<number> {
  const corps = JSON.stringify({
    id: opts.id ?? `evt_${randomUUID()}`,
    type,
    livemode: false,
    created: opts.cree ?? Math.floor(Date.now() / 1000),
    data: { object: objet },
  });
  const r = await request(await monter())
    .post("/api/webhooks/stripe")
    .set("Content-Type", "application/json")
    .set("stripe-signature", signer(corps))
    .send(corps);          // CHAINE : supertest serialise un Buffer en JSON
  return r.status;
}

async function etatOrg(): Promise<{ statut: string | null; abo: string | null; annulation: boolean | null; plan: string | null }> {
  const o = await pool.query<{ subscription_status: string | null; stripe_subscription_id: string | null; cancel_at_period_end: boolean | null }>(
    `SELECT subscription_status, stripe_subscription_id, cancel_at_period_end FROM organizations WHERE id = $1::uuid`, [ORG]);
  const s = await pool.query<{ plan: string | null; subscription_status: string | null }>(
    `SELECT plan, subscription_status FROM org_settings WHERE org_id = $1`, [ORG]);
  return {
    statut: o.rows[0]?.subscription_status ?? s.rows[0]?.subscription_status ?? null,
    abo: o.rows[0]?.stripe_subscription_id ?? null,
    annulation: o.rows[0]?.cancel_at_period_end ?? null,
    plan: s.rows[0]?.plan ?? null,
  };
}

let dbOk = false;
beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
});

beforeEach(async () => {
  if (!dbOk) return;
  await pool.query(`DELETE FROM org_settings WHERE org_id = $1`, [ORG]).catch(() => undefined);
  await pool.query(`DELETE FROM organizations WHERE id = $1::uuid`, [ORG]).catch(() => undefined);
  await pool.query(
    `INSERT INTO organizations (id, name, owner_email, created_at) VALUES ($1::uuid,'Org de certification','certif@flowpoint-test.internal',NOW())`,
    [ORG]);
  // L'organisation est resolue depuis `stripe_customer_id` : c'est le chemin
  // principal du webhook, et il doit etre pose pour que l'evenement atterrisse.
  await pool.query(
    `INSERT INTO org_settings (org_id, plan, email, stripe_customer_id)
     VALUES ($1,'standard','certif@flowpoint-test.internal',$2)
     ON CONFLICT (org_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id`,
    [ORG, CLIENT]);
});

afterAll(async () => {
  if (!dbOk) return;
  await pool.query(`DELETE FROM org_settings WHERE org_id = $1`, [ORG]).catch(() => undefined);
  await pool.query(`DELETE FROM organizations WHERE id = $1::uuid`, [ORG]).catch(() => undefined);
});

describe("l'organisation est resolue depuis le client Stripe, jamais devinee", () => {
  it("un evenement portant un client INCONNU n'ecrit rien", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const avant = await etatOrg();
    const code = await envoyer("invoice.payment_failed", { customer: "cus_inconnu_absolument", attempt_count: 1 });
    expect(code).toBeLessThan(500);
    const apres = await etatOrg();
    expect(apres, "un client inconnu a modifie l'etat d'une organisation").toEqual(avant);
  });
});

describe("echec de paiement — branche jusqu'ici non couverte", () => {
  it("`invoice.payment_failed` persiste le statut past_due", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const code = await envoyer("invoice.payment_failed", { customer: CLIENT, attempt_count: 2 });
    expect(code).toBeLessThan(400);
    expect((await etatOrg()).statut, "le statut past_due n'a pas ete persiste").toBe("past_due");
  });

  it("rejouer le meme echec ne change pas l'etat", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const id = `evt_rejeu_${randomUUID()}`;
    await envoyer("invoice.payment_failed", { customer: CLIENT, attempt_count: 1 }, { id });
    const apres1 = await etatOrg();
    await envoyer("invoice.payment_failed", { customer: CLIENT, attempt_count: 1 }, { id });
    expect(await etatOrg(), "un rejeu a produit un etat different").toEqual(apres1);
  });
});

describe("changement d'abonnement", () => {
  it("`customer.subscription.updated` persiste le statut et l'identifiant", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const code = await envoyer("customer.subscription.updated", {
      id: ABO, customer: CLIENT, status: "active", cancel_at_period_end: false,
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      items: { data: [{ price: { id: "price_certif", recurring: { interval: "month" } }, quantity: 1 }] },
    });
    expect(code).toBeLessThan(400);
    const e = await etatOrg();
    expect(e.statut, "le statut actif n'a pas ete persiste").toBe("active");
    expect(e.abo, "l'identifiant d'abonnement n'a pas ete persiste").toBe(ABO);
  });

  it("une annulation programmee est persistee, puis sa levee aussi", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const base = {
      id: ABO, customer: CLIENT, status: "active",
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      items: { data: [{ price: { id: "price_certif", recurring: { interval: "month" } }, quantity: 1 }] },
    };
    await envoyer("customer.subscription.updated", { ...base, cancel_at_period_end: true });
    expect((await etatOrg()).annulation, "l'annulation programmee n'a pas ete persistee").toBe(true);

    // La levee doit etre persistee elle aussi : un `false` ne doit pas etre
    // confondu avec « champ absent ».
    await envoyer("customer.subscription.updated", { ...base, cancel_at_period_end: false });
    expect((await etatOrg()).annulation, "la levee de l'annulation n'a pas ete persistee").toBe(false);
  });
});

describe("un evenement non signe ou forge ne touche jamais la base", () => {
  it("une signature forgee est refusee et n'ecrit rien", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const avant = await etatOrg();
    const corps = JSON.stringify({
      id: "evt_forge", type: "customer.subscription.updated",
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: ABO, customer: CLIENT, status: "active" } },
    });
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=1,v1=" + "f".repeat(64))
      .send(corps);
    expect(r.status).toBe(400);
    expect(await etatOrg(), "un evenement forge a modifie la base").toEqual(avant);
  });

  it("un evenement signe avec un autre secret est refuse et n'ecrit rien", async (ctx) => {
    if (!dbOk) return ctx.skip();
    const avant = await etatOrg();
    const corps = JSON.stringify({
      id: "evt_autre_secret", type: "invoice.payment_failed",
      created: Math.floor(Date.now() / 1000),
      data: { object: { customer: CLIENT, attempt_count: 9 } },
    });
    const r = await request(await monter())
      .post("/api/webhooks/stripe")
      .set("Content-Type", "application/json")
      .set("stripe-signature", signer(corps, "whsec_secret_d_un_attaquant"))
      .send(corps);
    expect(r.status).toBe(400);
    expect(await etatOrg(), "un evenement d'un attaquant a modifie la base").toEqual(avant);
  });
});
