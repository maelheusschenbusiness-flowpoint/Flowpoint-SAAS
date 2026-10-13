/**
 * requirePaidAccess-db.test.ts
 *
 * Controle serveur de l'acces aux fonctionnalites payantes, sur PostgreSQL reel.
 *
 * Certification P0 : une organisation dont l'abonnement etait annule gardait
 * l'acces API a toutes les donnees du plan. Le middleware applique desormais la
 * politique produit, et ces tests la verrouillent etat par etat.
 *
 * Couverture :
 *   - les six etats d'abonnement, avec et sans periode deja payee ;
 *   - la decision est independante du ROLE (owner, admin, member) : un membre
 *     n'echappe pas au blocage, et un owner n'y echappe pas davantage ;
 *   - isolation entre organisations : bloquer A ne bloque pas B, et la decision
 *     est prise sur l'org de la requete, jamais sur une autre ;
 *   - les chemins de regularisation (compte, auth, facturation, reactivation,
 *     plans, achats) restent ouverts dans TOUS les etats — un client bloque
 *     doit toujours pouvoir payer ;
 *   - un etat de facturation illisible refuse l'acces en 503 retryable, jamais
 *     en acces accorde par defaut.
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
import type { Request, Response, NextFunction } from "express";
import { requirePaidAccess, isPaidAccessExemptPath, PAID_ACCESS_EXEMPT_PREFIXES } from "./requirePaidAccess.js";

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const ALL = [ORG_A, ORG_B];
let dbUp = false;

/** Routes payantes representatives : donnees, SEO, monitoring, IA. */
const PAID_PATHS = ["/overview", "/audits", "/monitors", "/reports", "/keywords", "/ai/chat", "/competitors"];
/** Chemins qui doivent rester ouverts pour permettre la regularisation. */
const RECOVERY_PATHS = [
  "/me", "/me/prefs", "/auth/session", "/billing/subscription", "/billing/reactivate",
  "/billing/invoices", "/plans/catalog", "/public/payment-intent", "/addons", "/ai-credits",
  "/onboarding/status", "/settings/api-keys", "/permissions",
];

type Outcome = { nexted: boolean; status: number | null; body: Record<string, unknown> | null };

async function callGate(orgId: string, path: string, role = "owner"): Promise<Outcome> {
  const out: Outcome = { nexted: false, status: null, body: null };
  const req = {
    path, method: "GET", orgId,
    orgContext: { orgId, userId: "u", role },
    headers: {},
  } as unknown as Request;
  const res = {
    status(code: number) { out.status = code; return this; },
    json(payload: Record<string, unknown>) { out.body = payload; return this; },
  } as unknown as Response;
  const next = (() => { out.nexted = true; }) as NextFunction;
  await requirePaidAccess(req, res, next);
  return out;
}

/** Positionne l'etat d'abonnement reel de l'org en base. */
async function setState(orgId: string, opts: {
  status: string; trialEndsAt?: string | null; subId?: string | null; periodEnd?: string | null;
}): Promise<void> {
  const c = await pool.connect();
  try {
    await c.query(
      `UPDATE organizations
          SET subscription_status = $2, trial_ends_at = $3, stripe_subscription_id = $4,
              current_period_end = $5, stripe_customer_id = 'cus_test', trial_consumed_at = NOW() - INTERVAL '30 days'
        WHERE id = $1::uuid`,
      [orgId, opts.status, opts.trialEndsAt ?? null, opts.subId ?? null, opts.periodEnd ?? null]);
  } finally { c.release(); }
}

const inDays  = (n: number) => new Date(Date.now() + n * 86400_000).toISOString();
const agoDays = (n: number) => new Date(Date.now() - n * 86400_000).toISOString();

beforeAll(async () => {
  let c: PoolClient;
  try {
    c = (await pool.connect()) as unknown as PoolClient;   // seul echec tolere : pas de base
  } catch { dbUp = false; return; }
  try {
    for (const [i, id] of ALL.entries()) {
      await c.query(
        `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email)
         VALUES ($1,$2,$3,'test-user','active','pro',$4) ON CONFLICT (id) DO NOTHING`,
        [id, `Paid Access Org ${i}`, `paid-access-${i}-${Date.now()}`, `paid-access-${i}-${Date.now()}@example.test`]);
    }
    dbUp = true;
  } finally { c.release(); }
});

afterAll(async () => {
  if (!dbUp) return;
  const c = await pool.connect();
  try { await c.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [ALL]); }
  finally { c.release(); }
});

describe("requirePaidAccess — etats d'abonnement", () => {
  it("essai valide de 14 jours → acces autorise", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "trialing", trialEndsAt: inDays(14), subId: "sub_a" });
    for (const p of PAID_PATHS) {
      const r = await callGate(ORG_A, p);
      expect(r.nexted, p).toBe(true);
      expect(r.status, p).toBeNull();
    }
  });

  it("abonnement actif → acces autorise", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "active", subId: "sub_a", periodEnd: inDays(20) });
    for (const p of PAID_PATHS) expect((await callGate(ORG_A, p)).nexted, p).toBe(true);
  });

  it("essai expire sans abonnement → fonctionnalites payantes bloquees (402)", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "trialing", trialEndsAt: agoDays(2), subId: null });
    for (const p of PAID_PATHS) {
      const r = await callGate(ORG_A, p);
      expect(r.nexted, p).toBe(false);
      expect(r.status, p).toBe(402);
      expect(r.body?.["code"], p).toBe("SUBSCRIPTION_REQUIRED");
    }
  });

  it("annule mais periode deja payee en cours → acces maintenu", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "canceled", subId: "sub_a", periodEnd: inDays(9) });
    for (const p of PAID_PATHS) expect((await callGate(ORG_A, p)).nexted, p).toBe(true);
  });

  it("annule et periode payee terminee → bloque", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "canceled", subId: "sub_a", periodEnd: agoDays(1) });
    for (const p of PAID_PATHS) {
      const r = await callGate(ORG_A, p);
      expect(r.nexted, p).toBe(false);
      expect(r.status, p).toBe(402);
    }
  });

  it("annule sans periode connue → bloque (aucun acces accorde par defaut)", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "canceled", subId: "sub_a", periodEnd: null });
    expect((await callGate(ORG_A, "/overview")).status).toBe(402);
  });

  it("impaye : periode payee en cours → autorise ; terminee → bloque", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "past_due", subId: "sub_a", periodEnd: inDays(5) });
    expect((await callGate(ORG_A, "/audits")).nexted).toBe(true);
    await setState(ORG_A, { status: "past_due", subId: "sub_a", periodEnd: agoDays(5) });
    expect((await callGate(ORG_A, "/audits")).status).toBe(402);
  });

  it("suspendu (unpaid) sans periode → bloque", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "unpaid", subId: "sub_a", periodEnd: null });
    expect((await callGate(ORG_A, "/monitors")).status).toBe(402);
  });

  it("facturation non finalisee (pending_billing) → bloque", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "pending_billing", subId: null, periodEnd: null });
    const r = await callGate(ORG_A, "/overview");
    expect(r.status).toBe(402);
    expect(r.body?.["subscriptionStatus"]).toBe("pending_billing");
  });

  it("la reponse 402 porte de quoi regulariser", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "canceled", subId: "sub_a", periodEnd: agoDays(1) });
    const r = await callGate(ORG_A, "/reports");
    expect(r.body?.["code"]).toBe("SUBSCRIPTION_REQUIRED");
    expect(r.body?.["billingUrl"]).toBeTruthy();
    expect(r.body?.["recovery"]).toBeTruthy();
    expect(r.body?.["plan"]).toBeTruthy();
  });
});

describe("requirePaidAccess — roles", () => {
  for (const role of ["owner", "admin", "member"]) {
    it(`role ${role} : bloque quand l'abonnement est inactif`, async () => {
      if (!dbUp) return;
      await setState(ORG_A, { status: "canceled", subId: "sub_a", periodEnd: agoDays(2) });
      const r = await callGate(ORG_A, "/overview", role);
      expect(r.nexted).toBe(false);
      expect(r.status).toBe(402);
    });

    it(`role ${role} : autorise quand l'abonnement est actif`, async () => {
      if (!dbUp) return;
      await setState(ORG_A, { status: "active", subId: "sub_a", periodEnd: inDays(10) });
      expect((await callGate(ORG_A, "/overview", role)).nexted).toBe(true);
    });
  }
});

describe("requirePaidAccess — isolation entre organisations", () => {
  it("bloquer A ne bloque pas B, et la decision suit l'org de la requete", async () => {
    if (!dbUp) return;
    await setState(ORG_A, { status: "canceled", subId: "sub_a", periodEnd: agoDays(3) });
    await setState(ORG_B, { status: "active",   subId: "sub_b", periodEnd: inDays(25) });
    expect((await callGate(ORG_A, "/overview")).status).toBe(402);
    expect((await callGate(ORG_B, "/overview")).nexted).toBe(true);
    // Inversion : la decision n'est pas memorisee entre organisations.
    await setState(ORG_A, { status: "active",   subId: "sub_a", periodEnd: inDays(25) });
    await setState(ORG_B, { status: "unpaid",   subId: "sub_b", periodEnd: agoDays(1) });
    expect((await callGate(ORG_A, "/overview")).nexted).toBe(true);
    expect((await callGate(ORG_B, "/overview")).status).toBe(402);
  });

  it("organisation inexistante : etat illisible → 503 retryable, jamais un acces", async () => {
    if (!dbUp) return;
    const r = await callGate(randomUUID(), "/overview");
    expect(r.nexted).toBe(false);
    expect(r.status).toBe(503);
    expect(r.body?.["code"]).toBe("BILLING_STATE_UNAVAILABLE");
    expect(r.body?.["retryable"]).toBe(true);
  });

  it("sans contexte d'organisation, le garde laisse la route decider (401, pas 402)", async () => {
    if (!dbUp) return;
    expect((await callGate("default", "/overview")).nexted).toBe(true);
    expect((await callGate("", "/overview")).nexted).toBe(true);
  });
});

describe("requirePaidAccess — un client bloque peut toujours payer", () => {
  const BLOCKING_STATES: Array<{ label: string; st: Parameters<typeof setState>[1] }> = [
    { label: "essai expire",        st: { status: "trialing", trialEndsAt: agoDays(3), subId: null } },
    { label: "annule",              st: { status: "canceled", subId: "sub_a", periodEnd: agoDays(3) } },
    { label: "impaye",              st: { status: "unpaid",   subId: "sub_a", periodEnd: agoDays(3) } },
    { label: "pending_billing",     st: { status: "pending_billing", subId: null, periodEnd: null } },
  ];
  for (const { label, st } of BLOCKING_STATES) {
    it(`${label} : compte, auth, facturation et reactivation restent ouverts`, async () => {
      if (!dbUp) return;
      await setState(ORG_A, st);
      // Garde-fou : l'etat choisi bloque bien une route payante.
      expect((await callGate(ORG_A, "/overview")).status).toBe(402);
      for (const p of RECOVERY_PATHS) {
        const r = await callGate(ORG_A, p);
        expect(r.nexted, `${label} ${p}`).toBe(true);
        expect(r.status, `${label} ${p}`).toBeNull();
      }
    });
  }
});

describe("requirePaidAccess — allowlist", () => {
  it("les prefixes exemptes couvrent compte, auth, facturation et achats", async () => {
    for (const p of RECOVERY_PATHS) expect(isPaidAccessExemptPath(p), p).toBe(true);
    for (const p of ["/billing/webhook", "/webhooks/stripe", "/health", "/admin/orgs", "/team/invitations/abc"]) {
      expect(isPaidAccessExemptPath(p), p).toBe(true);
    }
  });

  it("les routes payantes ne sont pas exemptees, et un prefixe n'ouvre pas un chemin voisin", async () => {
    for (const p of PAID_PATHS) expect(isPaidAccessExemptPath(p), p).toBe(false);
    // "/me" ne doit pas ouvrir "/members", "/org" ne doit pas ouvrir "/organic"
    for (const p of ["/members", "/organic/keywords", "/meta", "/plansXYZ", "/teams", "/team"]) {
      expect(isPaidAccessExemptPath(p), p).toBe(false);
    }
    expect(PAID_ACCESS_EXEMPT_PREFIXES.length).toBeGreaterThan(10);
  });
});
