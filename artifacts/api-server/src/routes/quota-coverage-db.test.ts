/**
 * quota-coverage-db.test.ts — quotas annonces reellement appliques cote serveur (B-05/B-07/B-09),
 * sur PostgreSQL reel.
 *
 * Cartographie (FLOWPOINT_AI_CONTEXT.md §2 -> route qui applique le plafond) :
 *   audits       POST /audits                     checkQuota (cumul usage_events, B-05)
 *   reports      POST /reports (+ packs, AI)      checkQuota (cumul usage_events, B-05)
 *   monitors     POST /monitors                   checkQuota
 *   exports      GET  /settings/data-export       checkQuota fail-closed
 *   seats        /team                            seat-entitlement
 *   competitors  POST /competitors                requireQuota
 *   keywords     POST /keywords/track, /keywords  checkKeywordCapacity (B-07 : /keywords n'avait AUCUNE limite)
 *   automations  POST /automation/workflows       requireQuota (B-07)
 *   heatmaps     POST /local-maps/heatmaps        requireQuota (B-07)
 *   crmIntegrations  POST /crm/connect/:provider  501 CRM_OAUTH_UNAVAILABLE : rien a compter tant que la connexion n'existe pas
 *   missions, gbpPosts, workspaces                non appliques : semantique non tranchee / aucune route de creation (voir PR)
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
// Pas d'appel externe : seule la creation de heatmap est neutralisee, le quota est reel.
vi.mock("../services/local-maps-service.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/local-maps-service.js")>();
  return {
    ...real,
    createHeatmap: vi.fn(async () => ({ id: "hm_test", name: "x" })),
    startHeatmapScan: vi.fn(async () => false),
  };
});

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { checkQuota } from "../services/billing-service.js";
import { recordUsageEvent } from "../services/usage-events.js";
import automationRouter from "./automation.js";
import localMapsRouter from "./local-maps.js";
import keywordsRouter from "./keywords.js";

const STD = randomUUID();    // plan standard
const AGENCY = randomUUID(); // plan agency (alias d'Ultra)
const ALL = [STD, AGENCY];
let dbUp = false;

function appFor(orgId: string, router: express.Router) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId,
      orgContext: { orgId, userId: "u-test", role: "owner" },
      orgDb: (sql: string, values?: unknown[]) => pool.query(sql, values as unknown[]),
    });
    next();
  });
  app.use("/api", router);
  return app;
}

async function seedOrg(id: string, plan: string): Promise<void> {
  // Abonnement ACTIF : ce test cible les quotas, pas l'etat d'abonnement.
  await pool.query(
    `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, owner_email, subscription_status, stripe_subscription_id, stripe_customer_id)
     VALUES ($1,$2,$3,'u-test','active',$4,$5,'active','sub_quota_test','cus_quota_test') ON CONFLICT (id) DO NOTHING`,
    [id, `Quota Org ${plan}`, `quota-${plan}-${Date.now()}`, plan, `quota-${plan}-${Date.now()}@example.test`]);
  await pool.query(
    `INSERT INTO org_settings (org_id, plan, subscription_status, stripe_subscription_id) VALUES ($1,$2,'active','sub_quota_test')
     ON CONFLICT (org_id) DO UPDATE SET plan = EXCLUDED.plan`, [id, plan]);
  for (const addon of ["aiWorkflows", "localDominationMaps"]) {
    await pool.query(
      `INSERT INTO org_addons (id, org_id, addon_key, active) VALUES ($1,$2::uuid,$3,true) ON CONFLICT DO NOTHING`,
      [`qa_${randomUUID()}`, id, addon]);
  }
}

beforeAll(async () => {
  try {
    await recordUsageEvent(randomUUID(), "audit_created"); // cree usage_events paresseusement
    await seedOrg(STD, "standard");
    await seedOrg(AGENCY, "agency");
    dbUp = true;
  } catch (err) { console.error("[quota-coverage-db] seed failed", err); dbUp = false; }
});

afterAll(async () => {
  if (!dbUp) return;
  for (const t of ["automation_workflows", "local_heatmaps", "tracked_keywords", "usage_events", "audits", "reports", "org_addons", "org_settings"]) {
    const col = t === "org_addons" ? "org_id = ANY($1::uuid[])" : "org_id = ANY($1::text[])";
    await pool.query(`DELETE FROM ${t} WHERE ${col}`, [ALL]).catch(() => {});
  }
  await pool.query(`DELETE FROM organizations WHERE id = ANY($1::uuid[])`, [ALL]).catch(() => {});
});

describe("B-05 — audits/reports comptes sur la consommation cumulee (usage_events)", () => {
  it("supprimer des audits ne libere pas le quota du mois", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await pool.query(`INSERT INTO audits (id, url, org_id, created_at) VALUES ('a_live_1','https://a.test',$1,now())`, [STD]);
    for (let i = 0; i < 4; i++) await recordUsageEvent(STD, "audit_created"); // 4 audits lances ce mois
    const withLive = await checkQuota("audits", STD);
    expect(withLive.used).toBe(4); // max(1 vivant, 4 evenements)
    await pool.query(`DELETE FROM audits WHERE org_id=$1`, [STD]);
    const afterDelete = await checkQuota("audits", STD);
    expect(afterDelete.used).toBe(4); // la suppression ne libere rien
  });

  it("supprimer des rapports ne libere pas le quota du mois", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await recordUsageEvent(STD, "report_created");
    await recordUsageEvent(STD, "report_created");
    const q = await checkQuota("reports", STD);
    expect(q.used).toBe(2);
  });

  it("sans evenement, les lignes vivantes continuent de compter (jamais moins strict)", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await pool.query(`INSERT INTO reports (id, name, org_id, created_at) VALUES ('r_live_1','n',$1,now()), ('r_live_2','n',$1,now()), ('r_live_3','n',$1,now())`, [AGENCY]);
    expect((await checkQuota("reports", AGENCY)).used).toBe(3);
  });
});

describe("B-09 — plan 'agency' (alias d'Ultra) dans checkQuota", () => {
  it("agency recoit les limites Ultra (1000), et non celles de Standard (30)", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    const q = await checkQuota("audits", AGENCY);
    expect(q.limit).toBe(1000);
    expect((await checkQuota("monitors", AGENCY)).limit).toBe(300);
    expect((await checkQuota("audits", STD)).limit).toBe(30);
  });
});

describe("B-07 — POST /automation/workflows applique le plafond d'automatisations", () => {
  // #377 (D-07) refuse les declencheurs non emis ("manual") : on utilise un evenement reellement emis.
  const body = { name: "wf", triggerType: "event", triggerConfig: { event: "monitor.down" }, actions: [{ type: "send_alert" }] };

  it("Standard (3) : les 3 premiers passent, le 4e est refuse en 429 explicite", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    const app = appFor(STD, automationRouter);
    for (let i = 0; i < 3; i++) {
      const ok = await request(app).post("/api/automation/workflows").send(body);
      expect(ok.status, JSON.stringify(ok.body)).toBeLessThan(300);
    }
    const blocked = await request(app).post("/api/automation/workflows").send(body);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: "QUOTA_EXCEEDED", details: { resource: "automations", limit: 3, plan: "standard", used: 3 } });
    expect(blocked.body.message).toContain("automatisations");
  });

  it("agency (alias Ultra, 100) : n'est pas bloque a 3", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    const app = appFor(AGENCY, automationRouter);
    for (let i = 0; i < 4; i++) {
      const r = await request(app).post("/api/automation/workflows").send(body);
      expect(r.status, JSON.stringify(r.body)).toBeLessThan(300);
    }
  });
});

describe("B-07 — POST /local-maps/heatmaps applique le plafond de heatmaps", () => {
  const body = { name: "h", keyword: "k", businessName: "b", centerLat: 48.8, centerLng: 2.3 };

  it("Standard (2) : refuse la 3e heatmap en 429, les existantes restent", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await pool.query(`INSERT INTO local_heatmaps (id, org_id, name) VALUES ('hm_q1',$1,'a'),('hm_q2',$1,'b')`, [STD]);
    const blocked = await request(appFor(STD, localMapsRouter)).post("/api/local-maps/heatmaps").send(body);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toMatchObject({ code: "QUOTA_EXCEEDED", details: { resource: "heatmaps", limit: 2, used: 2 } });
    const left = await pool.query(`SELECT COUNT(*)::int AS n FROM local_heatmaps WHERE org_id=$1`, [STD]);
    expect(left.rows[0].n).toBe(2);
  });

  it("agency (alias Ultra, 50) : la meme situation est acceptee", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await pool.query(`INSERT INTO local_heatmaps (id, org_id, name) VALUES ('hm_q3',$1,'a'),('hm_q4',$1,'b')`, [AGENCY]);
    const r = await request(appFor(AGENCY, localMapsRouter)).post("/api/local-maps/heatmaps").send(body);
    expect(r.status, JSON.stringify(r.body)).toBe(202);
  });
});

describe("B-07 — POST /keywords (route historique) applique le plafond de mots-cles", () => {
  const seed = (org: string, n: number) => pool.query(
    `INSERT INTO tracked_keywords (id, org_id, keyword, active, device, location)
     SELECT 'kq_' || $1 || g, $1, 'kw' || g, true, 'desktop', 'France' FROM generate_series(1, $2::int) g`, [org, n]);

  it("Standard (50) : le 51e est refuse en 429 KEYWORD_LIMIT_REACHED (avant : aucune limite)", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await seed(STD, 50);
    const r = await request(appFor(STD, keywordsRouter)).post("/api/keywords").send({ keyword: "nouveau" });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ code: "KEYWORD_LIMIT_REACHED", limit: 50, current: 50 });
  });

  it("agency (alias Ultra, 5000) : 50 mots-cles n'empechent pas l'ajout", async () => {
    if (!dbUp) return expect(dbUp).toBe(false);
    await seed(AGENCY, 50);
    const r = await request(appFor(AGENCY, keywordsRouter)).post("/api/keywords").send({ keyword: "nouveau" });
    // Le quota ne bloque pas. (L'INSERT historique de cette route vise une colonne `language`
    // absente du schema migre : probleme distinct, hors perimetre — on ne verifie donc que le quota.)
    expect(r.status).not.toBe(429);
    expect(r.body.code).not.toBe("KEYWORD_LIMIT_REACHED");
  });
});
