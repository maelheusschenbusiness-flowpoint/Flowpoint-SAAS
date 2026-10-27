/**
 * E2E (PostgreSQL jetable reel) — checkout d'une organisation issue de l'essai
 * sans carte, via le VRAI routeur /billing/upgrade.
 *
 * Seul Stripe est simule (setStripeForTesting) : on enregistre exactement ce
 * que FlowPoint demanderait a Stripe Checkout, sans aucun appel reseau.
 *
 * Hors suite CI (exige une base locale). Lancement :
 *   E2E_TRIAL_DATABASE_URL=postgres://postgres@127.0.0.1:55432/flowpoint_e2e \
 *   npx vitest run --config vitest.e2e.config.ts src/tests/e2e-trial-checkout.test.ts
 * La base doit avoir recu les migrations (dist/migrate.mjs) et un demarrage
 * du serveur (init-phase1-users). Refuse toute base non locale.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";

const DB = process.env["E2E_TRIAL_DATABASE_URL"] ?? "";
const enabled = /@(127\.0\.0\.1|localhost)[:/]/.test(DB);
if (enabled) {
  process.env["DATABASE_URL"] = DB;
  process.env["NODE_ENV"] = "development";
  process.env["TRIAL_WITHOUT_CARD"] = "true";
  process.env["STRIPE_SECRET_KEY"] = "sk_test_e2e_local_fake_key_not_real";
}

describe.skipIf(!enabled)("E2E — /billing/upgrade d'un essai sans carte (Postgres reel, Stripe simule)", () => {
  let pool: { query: (s: string, v?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; end: () => Promise<void> };
  let app: express.Express;
  const calls: Array<{ params: Record<string, unknown>; opts?: Record<string, unknown> }> = [];
  const otherCalls: string[] = [];

  const fakeStripe = {
    checkout: { sessions: {
      create: async (params: Record<string, unknown>, opts?: Record<string, unknown>) => {
        calls.push({ params, opts });
        return { id: `cs_e2e_${calls.length}`, url: `https://checkout.stripe.test/${calls.length}` };
      },
      list: async () => { otherCalls.push("checkout.sessions.list"); return { data: [] }; },
    } },
    subscriptions: { list: async () => { otherCalls.push("subscriptions.list"); return { data: [] }; } },
    customers: { create: async () => { otherCalls.push("customers.create"); return { id: "cus_x" }; } },
  };

  async function cardlessOrg(endsInHours: number) {
    const orgId = randomUUID(); const userId = randomUUID();
    const email = `co.${orgId.slice(0, 8)}@checkout-e2e.fr`;
    await pool.query(`INSERT INTO users (id, email, first_name, last_name, auth_provider, email_verified, status)
                      VALUES ($1,$2,'C','', 'magic_link', TRUE, 'active')`, [userId, email]);
    await pool.query(`INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, subscription_status, owner_email,
                        trial_started_at, trial_consumed_at, trial_ends_at)
                      VALUES ($1::uuid,'co',$5,$2,'active','standard','trialing',$3, NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day',
                              NOW() + ($4::numeric * INTERVAL '1 hour'))`, [orgId, userId, email, endsInHours, orgId.slice(0, 8)]);
    const r = await pool.query(`SELECT trial_ends_at FROM organizations WHERE id=$1`, [orgId]);
    return { orgId, userId, trialEndsAt: new Date(r.rows[0]!["trial_ends_at"] as string) };
  }

  beforeAll(async () => {
    const db = await import("@workspace/db");
    pool = db.pool as unknown as typeof pool;
    const { setStripeForTesting } = await import("../services/stripe-factory.js");
    setStripeForTesting(fakeStripe);
    const { default: billingRouter } = await import("../routes/billing.js");
    app = express();
    app.use(express.json());
    app.use((req: any, _r, n) => {
      const orgId = String(req.headers["x-org"]);
      req.orgId = orgId;
      req.orgContext = { orgId, role: "owner", userId: String(req.headers["x-user"]), email: "x@y.fr" };
      req.userId = String(req.headers["x-user"]);
      n();
    });
    app.use("/api", billingRouter);
  });
  afterAll(async () => {
    const { setStripeForTesting } = await import("../services/stripe-factory.js");
    setStripeForTesting(null);
  });

  it("pendant l'essai (>= 48 h restantes) : Checkout reporte le prelevement a la fin de l'essai (trial_end)", async () => {
    const o = await cardlessOrg(24 * 10);
    calls.length = 0;
    const r = await request(app).post("/api/billing/upgrade").set("x-org", o.orgId).set("x-user", o.userId).send({ plan: "pro" });
    expect({ status: r.status, body: r.body }).toMatchObject({ status: 200 });
    expect(r.body.checkoutUrl).toMatch(/checkout\.stripe\.test/);
    expect(calls).toHaveLength(1);
    const sd = calls[0]!.params["subscription_data"] as Record<string, unknown>;
    expect(sd["trial_end"]).toBe(Math.floor(o.trialEndsAt.getTime() / 1000));
    expect((sd["metadata"] as Record<string, string>)["orgId"]).toBe(o.orgId);
    expect(calls[0]!.params["customer"]).toBeUndefined(); // aucun client pre-cree
    expect(String(calls[0]!.opts?.["idempotencyKey"])).toMatch(/-te\d+$/);
    expect(otherCalls).not.toContain("customers.create");
  });

  it("moins de 48 h restantes : facturation immediate (pas de trial_end)", async () => {
    const o = await cardlessOrg(20);
    calls.length = 0;
    const r = await request(app).post("/api/billing/upgrade").set("x-org", o.orgId).set("x-user", o.userId).send({ plan: "standard" });
    expect({ status: r.status, body: r.body }).toMatchObject({ status: 200 });
    const sd = calls[0]!.params["subscription_data"] as Record<string, unknown>;
    expect(sd["trial_end"]).toBeUndefined();
  });

  it("apres l'echeance : facturation immediate, aucun nouvel essai", async () => {
    const o = await cardlessOrg(-2);
    calls.length = 0;
    const r = await request(app).post("/api/billing/upgrade").set("x-org", o.orgId).set("x-user", o.userId).send({ plan: "pro" });
    expect({ status: r.status, body: r.body }).toMatchObject({ status: 200 });
    const sd = calls[0]!.params["subscription_data"] as Record<string, unknown>;
    expect(sd["trial_end"]).toBeUndefined();
    expect(sd["trial_period_days"]).toBeUndefined();
  });

  it("plan de l'essai (standard) pendant l'essai : le paiement s'ouvre, pas de « deja sur ce plan »", async () => {
    const o = await cardlessOrg(24 * 5);
    calls.length = 0;
    const r = await request(app).post("/api/billing/upgrade").set("x-org", o.orgId).set("x-user", o.userId).send({ plan: "standard" });
    expect({ status: r.status, body: r.body }).toMatchObject({ status: 200 });
    expect(r.body.error).not.toBe("plan_already_active");
    expect(calls).toHaveLength(1);
  });
});
