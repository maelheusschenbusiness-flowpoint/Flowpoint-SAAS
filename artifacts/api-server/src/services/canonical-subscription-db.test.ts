/**
 * canonical-subscription-db.test.ts
 *
 * P0 : apres un paiement reussi, `organizations` restait sans
 * stripe_subscription_id ni current_period_end. L'etat n'existait que sur
 * org_settings[e-mail] — la ligne legacy — parce que finalize-checkout cree
 * l'abonnement Stripe et le persiste AVANT de creer l'organisation (etapes
 * FC-4a/FC-4b). L'ancrage tente plus tot ne trouvait donc rien : mesure sur
 * Stripe de test, 0 ancrage reussi et
 *     organizations : pro | trialing | sub=(VIDE) | periode=(VIDE)
 *     org_settings[email] : pro | trialing | sub=sub_1UQ6pt…
 * Les droits ne tenaient qu'a la completion de lecture depuis la ligne legacy.
 *
 * Ces tests verrouillent l'invariant sur PostgreSQL reel, SANS dependre de la
 * ligne legacy : l'etat canonique doit suffire a faire fonctionner l'acces,
 * l'annulation, la suspension et la reactivation.
 *
 * Sans PostgreSQL, la suite s'ignore proprement.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  return importOriginal<typeof import("@workspace/db")>();
});

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";
import { loadOrgData, persistOrgData } from "./org-data.js";
import { loadBillingContext } from "./billing-context.js";

const ORG = randomUUID();
const EMAIL = `canon-${Date.now()}@example.test`;
const SUB = "sub_canon_test";
const CUS = "cus_canon_test";
const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();
const agoDays = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();
let dbUp = false;

async function canonical() {
  const c = await pool.connect();
  try {
    const r = await c.query(
      `SELECT plan, subscription_status AS status, stripe_subscription_id AS sub,
              stripe_customer_id AS cus, current_period_end::text AS period
         FROM organizations WHERE id = $1::uuid`, [ORG]);
    return (r.rows[0] as Record<string, string | null>) ?? null;
  } finally { c.release(); }
}
async function dropLegacyRows() {
  const c = await pool.connect();
  try { await c.query(`DELETE FROM org_settings WHERE org_id = ANY($1::text[])`, [[EMAIL, ORG]]); }
  finally { c.release(); }
}
async function countLegacy(): Promise<number> {
  const c = await pool.connect();
  try {
    const r = await c.query(`SELECT count(*)::int AS n FROM org_settings WHERE org_id = $1`, [EMAIL]);
    return (r.rows[0] as { n: number }).n;
  } finally { c.release(); }
}

beforeAll(async () => {
  let c: PoolClient;
  try { c = (await pool.connect()) as unknown as PoolClient; }
  catch { dbUp = false; return; }
  try {
    await c.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email)
       VALUES ($1,$2,$3,'test-user','active','pro',$4) ON CONFLICT (id) DO NOTHING`,
      [ORG, "Canon Org", `canon-${Date.now()}`, EMAIL]);
    dbUp = true;
  } finally { c.release(); }
});

afterAll(async () => {
  if (!dbUp) return;
  const c = await pool.connect();
  try {
    await c.query(`DELETE FROM org_settings WHERE org_id = ANY($1::text[])`, [[EMAIL, ORG]]);
    await c.query(`DELETE FROM organizations WHERE id = $1::uuid`, [ORG]);
  } finally { c.release(); }
});

describe("persistance canonique de l'abonnement", () => {
  it("1 — etat de depart : organisation sans abonnement canonique", async () => {
    if (!dbUp) return;
    const row = await canonical();
    expect(row?.["sub"]).toBeNull();
    expect(row?.["period"]).toBeNull();
    // C'est exactement l'etat laisse par un paiement reussi avant correction.
    const ctx = await loadBillingContext(ORG);
    expect(ctx.hasPaidAccess).toBe(false);
  });

  it("2 — l'ancrage ecrit les QUATRE champs exiges sur organizations", async () => {
    if (!dbUp) return;
    await persistOrgData(ORG, {
      plan: "pro",
      subscriptionStatus: "trialing",
      stripeSubscriptionId: SUB,
      stripeCustomerId: CUS,
      currentPeriodEnd: inDays(14),
      trialEndsAt: inDays(14),
      trialConsumedAt: new Date().toISOString(),
    });
    const row = await canonical();
    expect(row?.["plan"]).toBe("pro");
    expect(row?.["status"]).toBe("trialing");
    expect(row?.["sub"]).toBe(SUB);
    expect(row?.["period"]).toBeTruthy();
  });

  it("3 — SANS ligne legacy, l'acces est accorde depuis la ligne canonique", async () => {
    if (!dbUp) return;
    await dropLegacyRows();
    expect(await countLegacy()).toBe(0);
    const ctx = await loadBillingContext(ORG);
    expect(ctx.subscriptionStatus).toBe("trialing");
    expect(ctx.stripeSubscriptionId).toBe(SUB);
    expect(ctx.hasPaidAccess).toBe(true);
    expect(ctx.currentPeriodEnd).toBeTruthy();
  });

  it("4 — SANS ligne legacy : suspension honorant la periode payee, puis blocage", async () => {
    if (!dbUp) return;
    await dropLegacyRows();
    await persistOrgData(ORG, { subscriptionStatus: "past_due", currentPeriodEnd: inDays(10) });
    await dropLegacyRows();
    let ctx = await loadBillingContext(ORG);
    expect(ctx.subscriptionStatus).toBe("past_due");
    expect(ctx.hasPaidAccess).toBe(true);
    expect(ctx.inPaidGracePeriod).toBe(true);

    await persistOrgData(ORG, { currentPeriodEnd: agoDays(1) });
    await dropLegacyRows();
    ctx = await loadBillingContext(ORG);
    expect(ctx.hasPaidAccess).toBe(false);
  });

  it("5 — SANS ligne legacy : annulation puis reactivation", async () => {
    if (!dbUp) return;
    await persistOrgData(ORG, { subscriptionStatus: "canceled", currentPeriodEnd: agoDays(1) });
    await dropLegacyRows();
    expect((await loadBillingContext(ORG)).hasPaidAccess).toBe(false);

    await persistOrgData(ORG, { subscriptionStatus: "active", currentPeriodEnd: inDays(30) });
    await dropLegacyRows();
    const ctx = await loadBillingContext(ORG);
    expect(ctx.subscriptionStatus).toBe("active");
    expect(ctx.hasPaidAccess).toBe(true);
    expect(await countLegacy()).toBe(0);
  });

  it("6 — un rejeu de l'ancrage est idempotent et ne duplique rien", async () => {
    if (!dbUp) return;
    const payload = {
      plan: "pro", subscriptionStatus: "active", stripeSubscriptionId: SUB,
      stripeCustomerId: CUS, currentPeriodEnd: inDays(30),
    } as const;
    await persistOrgData(ORG, { ...payload });
    await persistOrgData(ORG, { ...payload });
    await persistOrgData(ORG, { ...payload });
    const c = await pool.connect();
    try {
      const r = await c.query(`SELECT count(*)::int AS n FROM organizations WHERE owner_email = $1`, [EMAIL]);
      expect((r.rows[0] as { n: number }).n).toBe(1);
      const u = await c.query(`SELECT count(*)::int AS n FROM users WHERE email = $1`, [EMAIL]);
      // Aucun utilisateur cree par l'ancrage.
      expect((u.rows[0] as { n: number }).n).toBe(0);
    } finally { c.release(); }
    expect((await canonical())?.["sub"]).toBe(SUB);
  });

  it("7 — concurrence : trois ancrages simultanes laissent un etat coherent", async () => {
    if (!dbUp) return;
    await Promise.all([
      persistOrgData(ORG, { stripeSubscriptionId: SUB, subscriptionStatus: "active", currentPeriodEnd: inDays(30) }),
      persistOrgData(ORG, { stripeSubscriptionId: SUB, subscriptionStatus: "active", currentPeriodEnd: inDays(30) }),
      persistOrgData(ORG, { stripeSubscriptionId: SUB, subscriptionStatus: "active", currentPeriodEnd: inDays(30) }),
    ]);
    const row = await canonical();
    expect(row?.["sub"]).toBe(SUB);
    expect(row?.["status"]).toBe("active");
    const c = await pool.connect();
    try {
      const r = await c.query(`SELECT count(*)::int AS n FROM organizations WHERE owner_email = $1`, [EMAIL]);
      expect((r.rows[0] as { n: number }).n).toBe(1);
    } finally { c.release(); }
  });

  it("8 — une ecriture partielle n'effface pas l'identifiant d'abonnement", async () => {
    if (!dbUp) return;
    await persistOrgData(ORG, { stripeSubscriptionId: SUB, subscriptionStatus: "active" });
    // Ecriture sans rapport : l'abonnement canonique doit survivre.
    await persistOrgData(ORG, { plan: "ultra" });
    const row = await canonical();
    expect(row?.["sub"]).toBe(SUB);
    expect(row?.["plan"]).toBe("ultra");
    expect((await loadOrgData(ORG))?.stripeSubscriptionId).toBe(SUB);
  });
});
