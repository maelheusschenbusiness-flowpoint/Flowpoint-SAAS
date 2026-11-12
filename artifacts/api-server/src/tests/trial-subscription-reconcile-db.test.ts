/**
 * A-09 — detection (lecture seule) et rattrapage borne des essais sans souscription.
 * PostgreSQL local jetable ; Stripe simule, aucun appel reseau.
 */
import { describe, it, expect, vi, afterAll, beforeAll } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.hoisted(() => {
  process.env["STRIPE_TEST_MODE"] = "true";
  process.env["STRIPE_TEST_KEY"] = "sk_test_a09_rec";
  process.env["STRIPE_TEST_PRICE_ID_STANDARD"] = "price_test_standard_a09";
});
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const { pool } = await import("@workspace/db");
const { findTrialingOrgsWithoutSubscription, reconcileOrphanTrials } = await import("../services/trial-subscription-reconcile.js");
const { ensureClaimTable } = await import("../services/checkout-subscription-claim.js");

const RUN = randomUUID().slice(0, 8);
const ids: string[] = [];
const intentIds: string[] = [];
async function seedOrg(tag: string, o: { status?: string; sub?: string | null; customer?: string | null; trialInDays?: number }): Promise<{ id: string; email: string; customer: string | null }> {
  const id = randomUUID(); ids.push(id);
  const email = `a09r-${RUN}-${tag}@example.test`;
  const customer = o.customer === undefined ? `cus_a09r_${RUN}_${tag}` : o.customer;
  await pool.query(
    `INSERT INTO organizations (id,name,slug,status,plan,subscription_status,owner_email,stripe_customer_id,stripe_subscription_id,trial_ends_at)
     VALUES ($1,$2,$3,'active','standard',$4,$5,$6,$7, NOW() + ($8 || ' days')::interval)`,
    [id, `Org ${tag}`, `a09r-${RUN}-${tag}`, o.status ?? "trialing", email, customer, o.sub ?? null, String(o.trialInDays ?? 10)],
  );
  return { id, email, customer };
}
const row = async (id: string) => (await pool.query(`SELECT subscription_status, stripe_subscription_id FROM organizations WHERE id=$1`, [id])).rows[0]!;

type Sub = { id: string; customer: string; status: string; trial_end: number | null; cancel_at_period_end: boolean; items: { data: Array<{ price: { id: string } }> } };
function fakeStripe(existing: Sub[], intents: Array<Record<string, unknown>>) {
  const subs = [...existing]; let creates = 0; const byKey = new Map<string, Sub>();
  return {
    creates: () => creates,
    stripe: {
      subscriptions: {
        list: async (p: { customer: string }) => ({ data: subs.filter((s) => s.customer === p.customer) }),
        create: async (params: Record<string, unknown>, o?: { idempotencyKey?: string }) => {
          if (o?.idempotencyKey && byKey.has(o.idempotencyKey)) return byKey.get(o.idempotencyKey)!;
          creates++;
          const s: Sub = { id: `sub_a09r_${RUN}_${creates}`, customer: String(params["customer"]), status: "trialing",
            trial_end: params["trial_end"] as number, cancel_at_period_end: false,
            items: { data: (params["items"] as Array<{ price: string }>).map((i) => ({ price: { id: i.price } })) } };
          subs.push(s); if (o?.idempotencyKey) byKey.set(o.idempotencyKey, s); return s;
        },
      },
      setupIntents: { list: async () => ({ data: intents }) },
      paymentMethods: { retrieve: async (id: string) => ({ id, customer: "x" }), attach: async () => ({}) },
      customers: { update: async () => ({}) },
    } as never,
  };
}

beforeAll(async () => { await ensureClaimTable(pool); });
afterAll(async () => {
  await pool.query(`DELETE FROM checkout_subscription_claims WHERE intent_id = ANY($1)`, [intentIds]).catch(() => {});
  await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [ids]).catch(() => {});
});

describe("A-09 — detection et rattrapage", () => {
  it("la requete de diagnostic fournie est en LECTURE SEULE et identique a celle du code", () => {
    const sql = readFileSync(resolve(__dirname, "../../migrations/diagnostics/a09_trialing_sans_souscription.sql"), "utf8");
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT)\b/i);
    expect(code).toMatch(/subscription_status = 'trialing'/);
    expect(code).toMatch(/stripe_subscription_id IS NULL/);
  });

  it("detecte seulement les trialing sans souscription (lecture seule : rien n'est modifie)", async () => {
    const orphan = await seedOrg("det-orphan", {});
    const healthy = await seedOrg("det-ok", { sub: "sub_x" });
    const pending = await seedOrg("det-pb", { status: "pending_billing" });
    const found = (await findTrialingOrgsWithoutSubscription(pool, 500)).map((o) => o.id);
    expect(found).toContain(orphan.id);
    expect(found).not.toContain(healthy.id);
    expect(found).not.toContain(pending.id);
    expect((await row(orphan.id)).stripe_subscription_id).toBeNull();
  });

  it("dry-run par defaut : rapporte sans rien ecrire ni creer", async () => {
    const o = await seedOrg("dry", {});
    const intent = { id: `seti_a09r_${RUN}_dry`, status: "succeeded", created: Math.floor(Date.now() / 1000) - 3600, customer: o.customer, payment_method: "pm_x", metadata: { plan: "standard", trial_days_remaining: "14" } };
    intentIds.push(intent.id);
    const f = fakeStripe([], [intent]);
    const actions = await reconcileOrphanTrials({ stripe: f.stripe, db: pool, limit: 100 });
    const mine = actions.find((a) => a.orgId === o.id)!;
    expect(mine.action).toBe("create_from_setup_intent");
    expect(f.creates()).toBe(0);
    expect((await row(o.id)).stripe_subscription_id).toBeNull();
  });

  it("applique : adopte l'abonnement existant (sans creation) et cree depuis le SetupIntent sinon, idempotent", async () => {
    const a = await seedOrg("adopt", {});
    const b = await seedOrg("create", {});
    const existing: Sub = { id: `sub_a09r_${RUN}_exist`, customer: a.customer!, status: "trialing", trial_end: Math.floor(Date.now() / 1000) + 5 * 86400, cancel_at_period_end: false, items: { data: [{ price: { id: "price_test_standard_a09" } }] } };
    const intent = { id: `seti_a09r_${RUN}_create`, status: "succeeded", created: Math.floor(Date.now() / 1000) - 3600, customer: b.customer, payment_method: "pm_y", metadata: { plan: "standard", trial_days_remaining: "14" } };
    intentIds.push(intent.id);
    const f = fakeStripe([existing], [intent]);
    await reconcileOrphanTrials({ stripe: f.stripe, db: pool, dryRun: false, limit: 100 });
    expect((await row(a.id)).stripe_subscription_id).toBe(existing.id);
    const rb = await row(b.id);
    expect(rb.stripe_subscription_id).toMatch(/^sub_a09r_/);
    expect(rb.subscription_status).toBe("trialing");
    expect(f.creates()).toBe(1);
    // seconde passe : plus d'orphelin, aucune creation supplementaire
    await reconcileOrphanTrials({ stripe: f.stripe, db: pool, dryRun: false, limit: 100 });
    expect(f.creates()).toBe(1);
  });

  it("essai deja termine ou sans client : revue manuelle, aucune creation (aucun prelevement decide automatiquement)", async () => {
    const closed = await seedOrg("closed", { trialInDays: -2 });
    const nocus = await seedOrg("nocus", { customer: null });
    const f = fakeStripe([], []);
    const actions = await reconcileOrphanTrials({ stripe: f.stripe, db: pool, dryRun: false, limit: 100 });
    expect(actions.find((x) => x.orgId === closed.id)).toMatchObject({ action: "manual_review", reason: "trial_window_closed" });
    expect(actions.find((x) => x.orgId === nocus.id)).toMatchObject({ action: "manual_review", reason: "no_customer" });
    expect(f.creates()).toBe(0);
  });
});
