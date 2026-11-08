/**
 * stripe-webhook-past-due-db.test.ts
 *
 * Regle commerciale : past_due → grace PAST_DUE_GRACE_DAYS mesuree depuis
 * organizations.past_due_since ; annulation → acces jusqu'a current_period_end.
 *
 * Stripe est MOCKE : aucun appel reseau (signature HMAC calculee localement,
 * cle `sk_test_` factice). Base PostgreSQL locale jetable. Horloge simulee
 * (vi.setSystemTime sur Date seulement) pour les transitions temporelles ; aucun
 * sleep reel. Sans PostgreSQL, la suite s'ignore proprement.
 *
 * Verifie :
 *  1. deux invoice.payment_failed → past_due_since pose UNE fois, jamais repousse ;
 *  2. invoice.payment_succeeded (montant > 0) → NULL + active ;
 *  3. customer.subscription.updated active/trialing → NULL ; past_due → pose une fois ;
 *  4. cancel_at_period_end et current_period_end persistes, puis
 *     customer.subscription.deleted → canceled, current_period_end conserve,
 *     acces complet avant la fin, lecture seule apres ;
 *  5. organisation deja past_due SANS horodatage : pas de bascule brutale ;
 *  6. le code fonctionne meme si la colonne past_due_since est absente.
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
// Aucun email reel.
vi.mock("../services/mailer.js", () => {
  const ok = async () => ({ ok: true });
  return { mailer: new Proxy({}, { get: () => ok }) };
});

import { pool } from "@workspace/db";
import { loadBillingContext } from "../services/billing-context.js";
import { loadOrgData, persistOrgData } from "../services/org-data.js";

const SECRET = "whsec_secret_de_test_calcule_localement";
const ORG = randomUUID();
const CUS = `cus_pd_${Date.now()}`;
const SUB = `sub_pd_${Date.now()}`;
const environnement = { ...process.env };
const DAY = 86_400_000;
let dbUp = false;
let n = 0;
const uid = (p: string) => `${p}_${Date.now()}_${++n}_${Math.random().toString(36).slice(2, 8)}`;

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
let createdCounter = Math.floor(Date.now() / 1000) + 1000;
async function envoyer(type: string, obj: Record<string, unknown>) {
  // `created` strictement croissant : la garde d'ordonnancement ne rejette rien.
  const corps = JSON.stringify({ id: uid("evt"), type, livemode: false, created: ++createdCounter, data: { object: obj } });
  return request(await monter()).post("/api/webhooks/stripe")
    .set("Content-Type", "application/json").set("stripe-signature", signer(corps)).send(corps);
}

const invoice = (over: Record<string, unknown> = {}) => ({
  id: uid("in"), object: "invoice", customer: CUS, subscription: SUB, amount_paid: 0, amount_due: 2900,
  currency: "eur", attempt_count: 1, billing_reason: "subscription_cycle", lines: { data: [] }, ...over,
});
const subscription = (over: Record<string, unknown> = {}) => ({
  id: SUB, object: "subscription", customer: CUS, status: "active", cancel_at_period_end: false, cancel_at: null,
  current_period_end: Math.floor((Date.now() + 20 * DAY) / 1000), metadata: { plan: "pro", orgId: ORG },
  items: { data: [] }, ...over,
});

async function row() {
  const r = await pool.query<{ since: string | null; status: string | null; period: string | null; cape: boolean }>(
    `SELECT past_due_since::text AS since, subscription_status AS status, current_period_end::text AS period,
            cancel_at_period_end AS cape FROM organizations WHERE id = $1::uuid`, [ORG]);
  return r.rows[0]!;
}
async function setRow(sql: string, params: unknown[] = []) {
  await pool.query(`UPDATE organizations SET ${sql} WHERE id = $1::uuid`, [ORG, ...params]);
}

beforeAll(async () => {
  try {
    await pool.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email, stripe_customer_id,
                                  stripe_subscription_id, subscription_status, trial_consumed_at)
       VALUES ($1,'PastDue Org',$2,'u','active','pro',$3,$4,$5,'active', NOW() - INTERVAL '40 days')
       ON CONFLICT (id) DO NOTHING`,
      [ORG, `pd-${Date.now()}`, `pd-${Date.now()}@example.test`, CUS, SUB]);
    dbUp = true;
  } catch { dbUp = false; }
});
afterAll(async () => {
  process.env = { ...environnement };
  if (!dbUp) return;
  await pool.query(`DELETE FROM organizations WHERE id = $1::uuid`, [ORG]);
});
beforeEach(async () => {
  vi.clearAllMocks();
  process.env = { ...environnement };
  process.env["NODE_ENV"] = "development";
  process.env["STRIPE_SECRET_KEY"] = "sk_test_cle_de_test_locale";
  process.env["STRIPE_TEST_KEY"] = "sk_test_cle_de_test_locale";
  process.env["STRIPE_TEST_MODE"] = "true";
  delete process.env["STRIPE_WEBHOOK_SECRET"];
  process.env["STRIPE_TEST_WEBHOOK_SECRET"] = SECRET;
  delete process.env["PAST_DUE_GRACE_DAYS"];
  if (dbUp) await setRow(`subscription_status='active', past_due_since=NULL, cancel_at_period_end=false, cancel_at=NULL, current_period_end = NOW() + INTERVAL '20 days'`);
});
afterEach(() => { vi.useRealTimers(); });

describe("invoice.payment_failed / invoice.payment_succeeded", () => {
  it("1 — past_due_since est pose UNE fois ; une relance ne repousse jamais la grace", async () => {
    if (!dbUp) return;
    expect((await row()).since).toBeNull();
    const r1 = await envoyer("invoice.payment_failed", invoice({ attempt_count: 1 }));
    expect(r1.status).toBe(200);
    const first = await row();
    expect(first.status).toBe("past_due");
    expect(first.since).not.toBeNull();

    // On recule l'horodatage de 2 jours : si la relance le reecrivait, il changerait.
    await setRow(`past_due_since = NOW() - INTERVAL '2 days'`);
    const known = (await row()).since;
    const r2 = await envoyer("invoice.payment_failed", invoice({ attempt_count: 2 }));
    expect(r2.status).toBe(200);
    expect((await row()).since).toBe(known);
    const r3 = await envoyer("invoice.payment_failed", invoice({ attempt_count: 3 }));
    expect(r3.status).toBe(200);
    expect((await row()).since).toBe(known);
  });

  it("2 — invoice.payment_succeeded (montant > 0) remet past_due_since a NULL et repasse active", async () => {
    if (!dbUp) return;
    await envoyer("invoice.payment_failed", invoice());
    expect((await row()).since).not.toBeNull();
    const r = await envoyer("invoice.payment_succeeded", invoice({ amount_paid: 2900 }));
    expect(r.status).toBe(200);
    const after = await row();
    expect(after.status).toBe("active");
    expect(after.since).toBeNull();
  });

  it("2b — un nouvel episode apres paiement repart d'une grace neuve", async () => {
    if (!dbUp) return;
    await envoyer("invoice.payment_failed", invoice());
    await setRow(`past_due_since = NOW() - INTERVAL '10 days'`);
    await envoyer("invoice.payment_succeeded", invoice({ amount_paid: 2900 }));
    expect((await row()).since).toBeNull();
    await envoyer("invoice.payment_failed", invoice());
    const since = new Date((await row()).since!).getTime();
    expect(Date.now() - since).toBeLessThan(60_000);
  });

  it("2c — grace et lecture seule de bout en bout (horloge simulee)", async () => {
    if (!dbUp) return;
    await envoyer("invoice.payment_failed", invoice());
    const since = new Date((await row()).since!).getTime();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(since + 2 * DAY);
    let ctx = await loadBillingContext(ORG);
    expect(ctx.accessMode).toBe("full");
    expect(ctx.accessReason).toBe("past_due_grace");
    vi.setSystemTime(since + 3 * DAY + 1000);
    ctx = await loadBillingContext(ORG);
    expect(ctx.accessMode).toBe("read_only");
    expect(ctx.readOnly).toBe(true);
    // PAST_DUE_GRACE_DAYS=0 : lecture seule immediate.
    vi.setSystemTime(since + 1000);
    process.env["PAST_DUE_GRACE_DAYS"] = "0";
    expect((await loadBillingContext(ORG)).accessMode).toBe("read_only");
    // PAST_DUE_GRACE_DAYS=7.
    process.env["PAST_DUE_GRACE_DAYS"] = "7";
    vi.setSystemTime(since + 6 * DAY);
    expect((await loadBillingContext(ORG)).accessMode).toBe("full");
    vi.setSystemTime(since + 8 * DAY);
    expect((await loadBillingContext(ORG)).accessMode).toBe("read_only");
    // Valeur invalide → 3.
    process.env["PAST_DUE_GRACE_DAYS"] = "beaucoup";
    vi.setSystemTime(since + 2 * DAY);
    expect((await loadBillingContext(ORG)).accessMode).toBe("full");
    vi.setSystemTime(since + 4 * DAY);
    expect((await loadBillingContext(ORG)).accessMode).toBe("read_only");
  });
});

describe("customer.subscription.* — past_due_since, annulation, fin de periode", () => {
  it("3 — subscription.updated past_due pose une fois ; active/trialing remet a NULL", async () => {
    if (!dbUp) return;
    expect((await envoyer("customer.subscription.updated", subscription({ status: "past_due" }))).status).toBe(200);
    expect((await row()).status).toBe("past_due");
    await setRow(`past_due_since = NOW() - INTERVAL '2 days'`);
    const known = (await row()).since;
    await envoyer("customer.subscription.updated", subscription({ status: "past_due" }));
    expect((await row()).since).toBe(known);
    await envoyer("customer.subscription.updated", subscription({ status: "active" }));
    const a = await row();
    expect(a.status).toBe("active");
    expect(a.since).toBeNull();
    // trialing
    await setRow(`subscription_status='past_due', past_due_since = NOW() - INTERVAL '1 day'`);
    await envoyer("customer.subscription.updated", subscription({ status: "trialing" }));
    expect((await row()).since).toBeNull();
  });

  it("4 — cancel_at_period_end + current_period_end persistes ; deleted → canceled, acces jusqu'a la fin puis lecture seule", async () => {
    if (!dbUp) return;
    const periodEndUnix = Math.floor((Date.now() + 9 * DAY) / 1000);
    await envoyer("customer.subscription.updated", subscription({
      cancel_at_period_end: true, cancel_at: periodEndUnix, current_period_end: periodEndUnix,
    }));
    let r = await row();
    expect(r.cape).toBe(true);
    expect(new Date(r.period!).getTime()).toBe(periodEndUnix * 1000);
    let ctx = await loadBillingContext(ORG);
    expect(ctx.cancelAtPeriodEnd).toBe(true);
    expect(ctx.accessMode).toBe("full");
    expect(ctx.accessReason).toBe("active_cancel_scheduled");

    // Fin de periode : Stripe envoie customer.subscription.deleted.
    await envoyer("customer.subscription.deleted", subscription({
      status: "canceled", cancel_at_period_end: false, current_period_end: periodEndUnix,
    }));
    r = await row();
    expect(r.status).toBe("canceled");
    expect(new Date(r.period!).getTime()).toBe(periodEndUnix * 1000);   // conserve
    // Avant la fin payee : acces complet.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(periodEndUnix * 1000 - DAY);
    ctx = await loadBillingContext(ORG);
    expect(ctx.accessMode).toBe("full");
    expect(ctx.accessReason).toBe("canceled_paid_period");
    // Apres : lecture seule.
    vi.setSystemTime(periodEndUnix * 1000 + 1000);
    ctx = await loadBillingContext(ORG);
    expect(ctx.accessMode).toBe("read_only");
    expect(ctx.accessReason).toBe("canceled_period_ended");
    expect(ctx.hasPaidAccess).toBe(false);
  });
});

describe("organisations existantes et colonne absente", () => {
  it("5 — past_due SANS past_due_since : grace depuis l'activation de la regle, pas de bascule brutale", async () => {
    if (!dbUp) return;
    // Period Stripe passee depuis 20 jours, aucun horodatage : cas d'un compte deja
    // past_due le jour du deploiement.
    await setRow(`subscription_status='past_due', past_due_since=NULL, current_period_end = NOW() - INTERVAL '20 days'`);
    const ctx = await loadBillingContext(ORG);
    expect(ctx.pastDueSince).toBeNull();
    expect(ctx.accessMode).toBe("full");            // grace depuis le demarrage du processus
    expect(ctx.accessReason).toBe("past_due_grace");
    // 4 jours apres l'activation de la regle → lecture seule.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 4 * DAY);
    expect((await loadBillingContext(ORG)).accessMode).toBe("read_only");
  });

  it("5b — le demarrage (initDataTables) pose past_due_since = NOW() aux past_due sans horodatage, une seule fois", async () => {
    if (!dbUp) return;
    await setRow(`subscription_status='past_due', past_due_since=NULL`);
    const { initDataTables } = await import("../services/init-data-tables.js");
    await initDataTables();
    const first = await row();
    expect(first.since).not.toBeNull();
    await setRow(`past_due_since = NOW() - INTERVAL '2 days'`);
    const known = (await row()).since;
    await initDataTables();
    expect((await row()).since).toBe(known);          // idempotent : jamais reecrit
  }, 120_000);

  it("6 — colonne past_due_since ABSENTE : lecture et ecriture de facturation continuent", async () => {
    if (!dbUp) return;
    await pool.query(`ALTER TABLE organizations DROP COLUMN past_due_since`);
    try {
      const d = await loadOrgData(ORG);
      expect(d).not.toBeNull();
      expect(d!.pastDueSince).toBeNull();
      await persistOrgData(ORG, { subscriptionStatus: "past_due" });
      const st = await pool.query<{ s: string }>(`SELECT subscription_status AS s FROM organizations WHERE id=$1::uuid`, [ORG]);
      expect(st.rows[0]!.s).toBe("past_due");
      const ctx = await loadBillingContext(ORG);
      expect(["full", "read_only"]).toContain(ctx.accessMode);   // decision rendue, aucune exception
    } finally {
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ`);
    }
  });
});
