/**
 * auth-me-org-resolution-db.test.ts
 *
 * Regression : GET /api/auth/me renvoyait 401 "organization data not found"
 * avec une session parfaitement valide. Dans le meme etat, /auth/session
 * repondait `authenticated: true` et /me repondait 200 — ce n'etait donc pas
 * un defaut d'authentification mais de resolution de donnees : cet alias
 * lisait org_settings SEUL, par UUID, alors qu'une organisation peut n'avoir
 * encore qu'une ligne org_settings clee par e-mail (etat produit par
 * l'activation de compte, avant tout evenement d'abonnement).
 *
 * `organizations` est la source de verite ; loadOrgData() la lit avec repli
 * sur org_settings. Ces tests verrouillent les trois configurations reelles
 * de donnees, sur PostgreSQL reel. Le systeme d'authentification n'est pas
 * sollicite ici : le contexte de session est injecte, comme dans les autres
 * tests de routes.
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

vi.mock("../services/mailer.js", () => ({
  mailer: { sendTeamInvitation: vi.fn(async () => ({ ok: true })) },
}));

import request from "supertest";
import express, { type Request, type Response, type NextFunction } from "express";
import { pool } from "@workspace/db";
import type { PoolClient } from "pg";
import { randomUUID } from "node:crypto";

const ORG_UUID_ONLY   = randomUUID();   // org_settings clee UUID seulement
const ORG_EMAIL_ONLY  = randomUUID();   // org_settings clee e-mail seulement  ← le cas du 401
const ORG_NO_SETTINGS = randomUUID();   // aucune ligne org_settings
const ALL = [ORG_UUID_ONLY, ORG_EMAIL_ONLY, ORG_NO_SETTINGS];
const emailOf = new Map<string, string>();
let dbUp = false;

async function makeApp(orgId: string) {
  const { default: authRouter } = await import("./auth.js");
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { orgId: string }).orgId = orgId;
    (req as unknown as { orgContext: Record<string, string> }).orgContext = {
      orgId, userId: "u-test", email: emailOf.get(orgId) ?? "", role: "owner",
    };
    next();
  });
  app.use("/api", authRouter);
  return app;
}

beforeAll(async () => {
  let c: PoolClient;
  try {
    c = (await pool.connect()) as unknown as PoolClient;   // seul echec tolere : pas de base
  } catch { dbUp = false; return; }
  try {
    for (const [i, id] of ALL.entries()) {
      const email = `auth-me-${i}-${Date.now()}@example.test`;
      emailOf.set(id, email);
      await c.query(
        `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email,
                                    subscription_status, stripe_subscription_id, stripe_customer_id)
         VALUES ($1,$2,$3,'test-user','active','pro',$4,'active','sub_x','cus_x')
         ON CONFLICT (id) DO NOTHING`,
        [id, `Auth Me Org ${i}`, `auth-me-${i}-${Date.now()}`, email]);
    }
    // Ligne org_settings clee UUID pour la premiere org.
    await c.query(
      `INSERT INTO org_settings (org_id, plan, subscription_status)
       VALUES ($1,'pro','active') ON CONFLICT (org_id) DO UPDATE SET plan = 'pro'`,
      [ORG_UUID_ONLY]);
    // Ligne clee E-MAIL pour la deuxieme : exactement l'etat qui produisait le 401.
    await c.query(
      `INSERT INTO org_settings (org_id, plan, subscription_status)
       VALUES ($1,'standard','none') ON CONFLICT (org_id) DO UPDATE SET plan = 'standard'`,
      [emailOf.get(ORG_EMAIL_ONLY)]);
    dbUp = true;
  } finally { c.release(); }
});

afterAll(async () => {
  if (!dbUp) return;
  const c = await pool.connect();
  try {
    await c.query(`DELETE FROM org_settings WHERE org_id = ANY($1::text[])`,
      [[...ALL, ...[...emailOf.values()]]]);
    await c.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [ALL]);
  } finally { c.release(); }
});

describe("GET /auth/me — resolution de l'organisation", () => {
  it("org_settings clee par E-MAIL seulement → 200 (le 401 corrige)", async () => {
    if (!dbUp) return;
    const app = await makeApp(ORG_EMAIL_ONLY);
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(ORG_EMAIL_ONLY);
    // Le plan vient de `organizations`, source de verite — pas de la ligne
    // legacy clee par e-mail qui dit encore 'standard'.
    expect(String(res.body.plan).toLowerCase()).toBe("pro");
    expect(res.body.subscriptionStatus).toBe("active");
    expect(res.body.role).toBe("owner");
    expect(res.body.limits).toBeTruthy();
  });

  it("org_settings clee par UUID → 200 (comportement conserve)", async () => {
    if (!dbUp) return;
    const res = await request(await makeApp(ORG_UUID_ONLY)).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(String(res.body.plan).toLowerCase()).toBe("pro");
  });

  it("aucune ligne org_settings → 200 depuis organizations seul", async () => {
    if (!dbUp) return;
    const res = await request(await makeApp(ORG_NO_SETTINGS)).get("/api/auth/me");
    expect(res.status).toBe(200);
    expect(String(res.body.plan).toLowerCase()).toBe("pro");
    expect(res.body.subscriptionStatus).toBe("active");
  });

  it("organisation absente des deux tables → 404, pas 401", async () => {
    if (!dbUp) return;
    const res = await request(await makeApp(randomUUID())).get("/api/auth/me");
    // Une organisation introuvable n'est pas une session invalide.
    expect(res.status).toBe(404);
    expect(res.status).not.toBe(401);
  });

  it("sans contexte d'organisation → 401 (comportement d'authentification intact)", async () => {
    if (!dbUp) return;
    const res = await request(await makeApp("default")).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(String(res.body.error)).toContain("no valid session");
  });
});
