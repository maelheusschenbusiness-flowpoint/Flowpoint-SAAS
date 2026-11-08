/**
 * planGate-subscription-status-db.test.ts — B-03, sur PostgreSQL reel.
 *
 * Avant : requirePlan / requireFeature / requireQuota / requireAddon ne lisaient
 * que la colonne `plan`. Une organisation dont l'abonnement etait annule, impaye
 * ou jamais finalise gardait donc ses droits des qu'une route etait montee sous
 * un prefixe exempte du middleware global (ex. /permissions).
 * Desormais chaque garde applique l'etat d'abonnement (grantsPaidAccess).
 *
 * Etats couverts : actif, essai, essai expire, past_due dans/hors periode payee,
 * unpaid, paused, annule (avec/sans periode payee), expire, incomplete,
 * pending_billing, plan inconnu, plan 'agency'.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";
import { requirePlan, requireFeature, requireQuota, requireAddon, requireAddonOrFeature } from "./planGate.js";

const ORG = randomUUID();
let dbUp = false;

const inDays = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();
const agoDays = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

type Outcome = { nexted: boolean; status: number | null; body: Record<string, unknown> | null };
type Gate = (req: Request, res: Response, next: NextFunction) => unknown;

async function run(gate: Gate, orgId: string): Promise<Outcome> {
  const out: Outcome = { nexted: false, status: null, body: null };
  await new Promise<void>((resolve) => {
    const req = { url: "/permissions/roles", path: "/permissions/roles", method: "GET", orgId, headers: {} } as unknown as Request;
    const res = {
      status(code: number) { out.status = code; return this; },
      json(payload: Record<string, unknown>) { out.body = payload; resolve(); return this; },
    } as unknown as Response;
    const next = ((err?: unknown) => { if (err) throw err; out.nexted = true; resolve(); }) as NextFunction;
    Promise.resolve(gate(req, res, next)).catch(() => resolve());
  });
  return out;
}

async function setOrg(o: { plan?: string; status: string | null; sub?: string | null; trialEnds?: string | null; periodEnd?: string | null; consumed?: boolean }) {
  await pool.query(
    `UPDATE organizations
        SET plan = $2, subscription_status = $3, stripe_subscription_id = $4, stripe_customer_id = 'cus_gate',
            trial_ends_at = $5, current_period_end = $6,
            trial_consumed_at = CASE WHEN $7::boolean THEN NOW() - INTERVAL '30 days' ELSE NULL END
      WHERE id = $1::uuid`,
    [ORG, o.plan ?? "pro", o.status, o.sub ?? null, o.trialEnds ?? null, o.periodEnd ?? null, o.consumed ?? true]);
}

beforeAll(async () => {
  try {
    await pool.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email)
       VALUES ($1,'Plan Gate Org',$2,'test-user','active','pro',$3) ON CONFLICT (id) DO NOTHING`,
      [ORG, `plan-gate-${Date.now()}`, `plan-gate-${Date.now()}@example.test`]);
    dbUp = true;
  } catch { dbUp = false; }
});

afterAll(async () => {
  if (dbUp) await pool.query(`DELETE FROM organizations WHERE id = $1::uuid`, [ORG]).catch(() => {});
});

/** Les cinq gardes, toutes sur un droit que le plan 'pro' possede. */
const GATES: Array<[string, () => Gate]> = [
  ["requirePlan(pro)", () => requirePlan("pro")],
  ["requireFeature(crmIntegration)", () => requireFeature("crmIntegration", "CRM")],
  ["requireQuota(competitors)", () => requireQuota("competitors", () => 0)],
  ["requireAddon(whiteLabel, inclus au plan)", () => requireAddon("whiteLabel", "White label")],
  ["requireAddonOrFeature(crmIntegration)", () => requireAddonOrFeature("crmIntegration", "crmIntegration", "CRM")],
];

const OPEN: Array<[string, Parameters<typeof setOrg>[0]]> = [
  ["actif", { status: "active", sub: "sub_1" }],
  ["essai Stripe en cours", { status: "trialing", sub: "sub_1", trialEnds: inDays(7) }],
  ["past_due DANS la periode payee (grace bornee)", { status: "past_due", sub: "sub_1", periodEnd: inDays(5) }],
  ["annule avec periode payee restante", { status: "canceled", sub: "sub_1", periodEnd: inDays(5) }],
];

const CLOSED: Array<[string, Parameters<typeof setOrg>[0]]> = [
  ["essai expire sans abonnement", { status: "trialing", sub: null, trialEnds: agoDays(2) }],
  ["past_due HORS periode payee", { status: "past_due", sub: "sub_1", periodEnd: agoDays(2) }],
  ["past_due sans date de periode", { status: "past_due", sub: "sub_1", periodEnd: null }],
  ["unpaid hors periode", { status: "unpaid", sub: "sub_1", periodEnd: agoDays(1) }],
  ["paused sans periode", { status: "paused", sub: "sub_1" }],
  ["annule, periode terminee", { status: "canceled", sub: "sub_1", periodEnd: agoDays(3) }],
  ["annule sans date de periode", { status: "canceled", sub: "sub_1" }],
  ["expire (statut brut inconnu)", { status: "expired", sub: null }],
  ["incomplete", { status: "incomplete", sub: null }],
  ["pending_billing", { status: "pending_billing", sub: null, consumed: false }],
  ["statut nul", { status: null, sub: null, consumed: false }],
];

describe.each(GATES)("planGate %s", (_label, makeGate) => {
  it.each(OPEN)("abonnement %s => acces accorde", async (_n, state) => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await setOrg(state);
    const out = await run(makeGate(), ORG);
    expect({ nexted: out.nexted, status: out.status }).toEqual({ nexted: true, status: null });
  });

  it.each(CLOSED)("abonnement %s => 402 SUBSCRIPTION_REQUIRED", async (_n, state) => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await setOrg(state);
    const out = await run(makeGate(), ORG);
    expect(out.nexted).toBe(false);
    expect(out.status).toBe(402);
    expect(out.body).toMatchObject({ code: "SUBSCRIPTION_REQUIRED", ok: false });
    expect(out.body).toHaveProperty("subscriptionStatus");
    expect(out.body).toHaveProperty("billingUrl");
  });
});

describe("planGate — plan inconnu et plan 'agency'", () => {
  it("plan inconnu avec abonnement actif : traite comme standard (droits Pro refuses, pas d'erreur)", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await setOrg({ plan: "enterprise-xyz", status: "active", sub: "sub_1" });
    const denied = await run(requireFeature("crmIntegration", "CRM"), ORG);
    expect(denied.status).toBe(403);
    expect(denied.body).toMatchObject({ code: "PLAN_REQUIRED" });
    // Un plan inconnu ne declenche ni 402 d'abonnement ni 5xx : seul le droit de plan decide.
    const std = await run(requirePlan("standard"), ORG);
    expect(std.nexted).toBe(true);
  });

  it("plan 'agency' actif : droits Ultra accordes ; abonnement annule : refuse", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await setOrg({ plan: "agency", status: "active", sub: "sub_1" });
    expect((await run(requirePlan("ultra"), ORG)).nexted).toBe(true);
    expect((await run(requireFeature("multiLocation", "Multi-location"), ORG)).nexted).toBe(true);
    await setOrg({ plan: "agency", status: "canceled", sub: "sub_1", periodEnd: agoDays(1) });
    const out = await run(requirePlan("ultra"), ORG);
    expect(out.status).toBe(402);
    expect(out.body).toMatchObject({ code: "SUBSCRIPTION_REQUIRED" });
  });
});

describe("planGate — etat de facturation illisible", () => {
  it("organisation inexistante : 503 BILLING_STATE_UNAVAILABLE, jamais un acces", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    const out = await run(requirePlan("pro"), randomUUID());
    expect(out.nexted).toBe(false);
    expect(out.status).toBe(503);
    expect(out.body).toMatchObject({ code: "BILLING_STATE_UNAVAILABLE", retryable: true });
  });
});
