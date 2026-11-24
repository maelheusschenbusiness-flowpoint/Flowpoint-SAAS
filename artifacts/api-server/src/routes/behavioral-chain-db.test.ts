/**
 * Behavioral AI / AI CRO / Revenue Leak : chaine complete sur la vraie base de donnees.
 *
 * snippet (jeton de site) -> echange de jeton signe -> session -> evenements (public, sans
 * authentification) -> statut -> insights -> revenue-leak -> CRO, avec isolation entre
 * organisations. Les tables viennent de initBehavioralCroTables (absentes de la production
 * avant ce correctif). Aucune IA n'est appelee : le quota IA est refuse, le chemin
 * « signaux mesures uniquement » est celui verifie.
 */
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
// Aucune IA : le quota est refuse, les signaux mesurés restent servis.
vi.mock("../services/ai-engine.js", () => ({
  checkAIQuota: vi.fn().mockResolvedValue({ allowed: false }),
  recordCompletedUsageDeferred: vi.fn(),
}));
vi.mock("../services/ai-provider.js", () => ({ aiChat: vi.fn() }));
vi.mock("../services/ga4-service.js", () => ({
  getGA4ConversionPages: vi.fn().mockResolvedValue({ rows: [], totals: [], currencyCode: null }),
}));

import { pool } from "@workspace/db";
import { initDataTables } from "../services/init-data-tables.js";
import { initBehavioralCroTables } from "../services/init-behavioral-cro-tables.js";
import behavioralRouter, { publicBehavioralRouter, behavioralOriginAllowlist, loadBehavioralCorsAllowlist } from "./behavioral.js";
import croRouter from "./cro.js";
import revenueLeakRouter from "./revenue-leak.js";

const SUFFIX = randomUUID().slice(0, 8);
const ORG_A = `bhv_a_${SUFFIX}`;
const ORG_B = `bhv_b_${SUFFIX}`;
const SITE_A = `https://site-a-${SUFFIX}.example.test`;
const TABLES = [
  "behavior_events", "behavior_sessions", "behavior_insights", "behavior_site_tokens",
  "cro_recommendations", "cro_experiments", "revenue_leak_resolutions",
];

let dbOk = false;
beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
  if (dbOk) { await initDataTables(); await initBehavioralCroTables(); }
}, 120_000);
afterAll(async () => {
  if (!dbOk) return;
  for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]).catch(() => {});
});

function appFor(orgId: string) {
  const app = express();
  app.use(express.json());
  app.use(publicBehavioralRouter);
  app.use((req, _res, next) => {
    Object.assign(req, { orgId, orgContext: { role: "owner" }, orgDb: (sql: string, values?: unknown[]) => pool.query(sql, values) });
    next();
  });
  app.use(behavioralRouter);
  app.use(croRouter);
  app.use(revenueLeakRouter);
  return app;
}

let nonceSeq = 0;
const nonce = () => `n${Date.now().toString(36)}${(nonceSeq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const browserHeaders = (siteUrl: string) => ({ Origin: new URL(siteUrl).origin, "Sec-Fetch-Site": "cross-site" });

async function exchange(app: express.Express, siteUrl: string, plain: string) {
  const ts = Date.now();
  const n = nonce();
  const origin = new URL(siteUrl).origin;
  const sig = createHmac("sha256", plain).update(`${siteUrl}|${origin}|${ts}|${n}`).digest("hex");
  return request(app).post("/behavioral/token").set(browserHeaders(siteUrl))
    .send({ siteKey: siteUrl, siteToken: plain, ts, nonce: n, sig });
}

describe("Behavioral AI / CRO / Revenue Leak : tables additives", () => {
  it("module separe, additif, sans DROP/TRUNCATE/DELETE ni cle etrangere sur org_id", () => {
    const src = readFileSync(new URL("../services/init-behavioral-cro-tables.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|DROP COLUMN/i);
    expect(src).not.toMatch(/REFERENCES/i);
    for (const t of TABLES.filter(t => t !== "behavior_site_tokens")) expect(src).toContain(`"${t}"`);
  });

  it("schema, index, RLS et 4 politiques tenant ; rejouable sans erreur", async () => {
    if (!dbOk) return;
    await initBehavioralCroTables();
    await initBehavioralCroTables();
    for (const t of TABLES) {
      const cols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [t]);
      expect(cols.rows.map(r => r.column_name)).toEqual(expect.arrayContaining(["org_id"]));
    }
    // Colonnes lues / ecrites par le code (Drizzle + SQL des routes).
    const need: Record<string, string[]> = {
      behavior_events: ["id", "session_id", "site_url", "page", "event_type", "element", "x_pos", "y_pos", "scroll_depth", "time_on_page", "metadata", "created_at"],
      behavior_sessions: ["id", "site_url", "user_agent", "device_type", "country", "page_views", "bounce", "engagement_score", "rage_clicks", "exit_page", "started_at", "ended_at"],
      behavior_insights: ["id", "site_url", "insight_type", "severity", "title", "description", "affected_pages", "estimated_impact", "ai_suggestion", "status", "created_at"],
      behavior_site_tokens: ["token_hash", "site_url", "created_at", "last_used_at"],
      cro_recommendations: ["id", "site_url", "page", "type", "priority", "title", "description", "implementation", "estimated_uplift", "status", "ai_generated", "source", "metadata", "created_at", "updated_at"],
      cro_experiments: ["id", "site_url", "page", "name", "hypothesis", "variant_a", "variant_b", "status", "winner", "conversion_a", "conversion_b", "confidence", "started_at", "ended_at", "created_at"],
      revenue_leak_resolutions: ["id", "site_url", "page", "event_type", "resolved_observed_events", "resolved_affected_sessions", "resolved_at"],
    };
    for (const [t, expected] of Object.entries(need)) {
      const cols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [t]);
      expect(cols.rows.map(r => r.column_name), t).toEqual(expect.arrayContaining(expected));
    }
    for (const t of TABLES.filter(t => t !== "behavior_site_tokens")) {
      const rls = await pool.query<{ rowsecurity: boolean }>("SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename=$1", [t]);
      expect(rls.rows[0]?.rowsecurity, t).toBe(true);
      const pol = await pool.query<{ policyname: string }>("SELECT policyname FROM pg_policies WHERE tablename=$1", [t]);
      expect(pol.rows.map(r => r.policyname).sort(), t).toEqual(["tenant_delete", "tenant_insert", "tenant_select", "tenant_update"]);
    }
    const uidx = await pool.query("SELECT 1 FROM pg_indexes WHERE tablename='behavior_site_tokens' AND indexname='behavior_site_tokens_site_url_uidx'");
    expect(uidx.rowCount).toBe(1);
  }, 120_000);

  it("RLS : une organisation ne voit ni n'ecrit les lignes d'une autre (role app_user)", async () => {
    if (!dbOk) return;
    const c = await pool.connect();
    try {
      const su = await c.query<{ s: boolean }>("SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user");
      if (!su.rows[0]?.s) return;
      await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user NOLOGIN NOBYPASSRLS; END IF; END $$`);
      for (const t of ["behavior_events", "cro_recommendations", "revenue_leak_resolutions"]) {
        await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO app_user`);
      }
      for (const org of [ORG_A, ORG_B]) {
        await c.query(`INSERT INTO behavior_events (id, org_id, session_id, site_url, page, event_type) VALUES ($1,$2,'s','https://x.test','/','click')`, [`rls_${org}`, org]);
        await c.query(`INSERT INTO cro_recommendations (id, org_id, site_url, page, type, title) VALUES ($1,$2,'https://x.test','/','cta','t')`, [`rls_${org}`, org]);
        await c.query(`INSERT INTO revenue_leak_resolutions (id, org_id) VALUES ($1,$2)`, [`rls_${org}`, org]);
      }
      const asOrg = async (org: string, fn: () => Promise<void>) => {
        await c.query("BEGIN");
        try {
          await c.query("SET LOCAL ROLE app_user");
          await c.query("SELECT set_config('app.current_org_id', $1, true)", [org]);
          await fn();
        } finally { await c.query("ROLLBACK"); }
      };
      await asOrg(ORG_A, async () => {
        for (const t of ["behavior_events", "cro_recommendations", "revenue_leak_resolutions"]) {
          const r = await c.query(`SELECT org_id FROM ${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
          expect(r.rows.map(x => x.org_id), t).toEqual([ORG_A]);
        }
        await expect(c.query(`INSERT INTO cro_recommendations (id, org_id, site_url, page, type, title) VALUES ('x',$1,'u','/','t','t')`, [ORG_B]))
          .rejects.toThrow(/row-level security/);
      });
      await asOrg(ORG_A, async () => {
        expect((await c.query(`UPDATE cro_recommendations SET status='dismissed' WHERE org_id=$1`, [ORG_B])).rowCount).toBe(0);
        expect((await c.query(`DELETE FROM behavior_events WHERE org_id=$1`, [ORG_B])).rowCount).toBe(0);
      });
    } finally { c.release(); }
  }, 60_000);
});

describe("Behavioral AI : chaine complete avec jeton de site", () => {
  it("snippet -> jeton -> session -> evenements -> statut -> insights -> revenue-leak -> CRO", async () => {
    if (!dbOk) return;
    const a = appFor(ORG_A);

    // Etat vide honnete avant tout evenement.
    const snip = await request(a).get("/behavioral/snippet").query({ siteUrl: SITE_A });
    expect(snip.status).toBe(200);
    const m = /\)\(window,document,'([^']+)','([^']+)','([0-9a-f]{64})'\)/.exec(snip.body.snippet);
    expect(m, "le snippet embarque l'URL du site, l'API et le jeton").toBeTruthy();
    const plain = m![3]!;
    // Seule l'empreinte est stockee, jamais le jeton en clair.
    const tok = await pool.query("SELECT token_hash, org_id FROM behavior_site_tokens WHERE site_url=$1", [SITE_A]);
    expect(tok.rows[0].org_id).toBe(ORG_A);
    expect(tok.rows[0].token_hash).not.toBe(plain);
    // L'allowlist CORS est alimentee, y compris apres un redemarrage (chargement depuis la base).
    expect(behavioralOriginAllowlist.has(new URL(SITE_A).origin)).toBe(true);
    behavioralOriginAllowlist.clear();
    await loadBehavioralCorsAllowlist();
    expect(behavioralOriginAllowlist.has(new URL(SITE_A).origin)).toBe(true);

    const status0 = await request(a).get("/behavioral/status").query({ siteUrl: SITE_A });
    expect(status0.body).toMatchObject({ installed: false, totalEvents: 0, status: "snippet_not_installed" });
    const empty = await request(a).get("/revenue-leak").query({ siteUrl: SITE_A });
    expect(empty.body).toMatchObject({ noData: true, opportunities: [] });
    expect(empty.body.financial.estimatedLoss).toBeNull();

    // Ingestion publique : refus sans jeton, sans Origin valide, avec un mauvais HMAC.
    const ts = Date.now();
    expect((await request(a).post("/behavioral/event").set(browserHeaders(SITE_A))
      .send({ sessionId: "s", siteUrl: SITE_A, page: "/", eventType: "click", ts, nonce: nonce() })).status).toBe(401);
    const badSig = await request(a).post("/behavioral/token").set(browserHeaders(SITE_A))
      .send({ siteKey: SITE_A, siteToken: plain, ts, nonce: nonce(), sig: "00".repeat(32) });
    expect(badSig.status).toBe(403);
    const noOrigin = await request(a).post("/behavioral/token")
      .send({ siteKey: SITE_A, siteToken: plain, ts, nonce: nonce(), sig: "00" });
    expect(noOrigin.status).toBe(403);

    const tokenRes = await exchange(a, SITE_A, plain);
    expect(tokenRes.status).toBe(200);
    const sessionToken: string = tokenRes.body.sessionToken;
    const sid = `fp_${randomUUID()}`;
    const send = (body: Record<string, unknown>, headers = browserHeaders(SITE_A)) =>
      request(a).post("/behavioral/event").set(headers).send({ sessionId: sid, siteUrl: SITE_A, page: "/contact", sessionToken, ts: Date.now(), nonce: nonce(), ...body });

    const sess = await request(a).post("/behavioral/session").set(browserHeaders(SITE_A))
      .send({ id: sid, siteUrl: SITE_A, sessionToken, ts: Date.now(), nonce: nonce(), deviceType: "mobile", userAgent: "vitest" });
    expect(sess.status).toBe(201);

    // Validation : type inconnu, charge trop grande, origine d'un autre site, rejeu de nonce.
    expect((await send({ eventType: "drop_table" })).status).toBe(400);
    expect((await send({ eventType: "click", metadata: { x: "y".repeat(5000) } })).status).toBe(400);
    expect((await send({ eventType: "click" }, browserHeaders("https://evil.example.test"))).status).toBe(403);
    const fixed = nonce();
    expect((await send({ eventType: "page_view", nonce: fixed })).status).toBe(201);
    expect((await send({ eventType: "page_view", nonce: fixed })).status).toBe(403);

    // Coordonnees fractionnaires (ecran HiDPI) : arrondies, jamais perdues.
    expect((await send({ eventType: "click", xPos: 12.5, yPos: 40.25, element: "btn" })).status).toBe(201);
    expect((await send({ eventType: "scroll_depth", scrollDepth: 12 })).status).toBe(201);
    for (let i = 0; i < 12; i++) expect((await send({ eventType: "rage_click", xPos: 10, yPos: 10 })).status).toBe(201);
    for (let i = 0; i < 6; i++) expect((await send({ eventType: "form_abandon", element: "form" })).status).toBe(201);

    const stored = await pool.query("SELECT count(*)::int AS n FROM behavior_events WHERE org_id=$1 AND site_url=$2", [ORG_A, SITE_A]);
    expect(stored.rows[0].n).toBe(21);
    const sessRow = await pool.query("SELECT rage_clicks, device_type FROM behavior_sessions WHERE id=$1 AND org_id=$2", [sid, ORG_A]);
    expect(sessRow.rows[0]).toMatchObject({ rage_clicks: 12, device_type: "mobile" });

    const status1 = await request(a).get("/behavioral/status").query({ siteUrl: SITE_A });
    expect(status1.body).toMatchObject({ installed: true, totalEvents: 21, status: "active" });

    // Analyse : signaux mesurés, jamais de chiffre inventé, IA explicitement absente.
    const gen = await request(a).post("/behavioral/generate-insights").send({ siteUrl: SITE_A });
    expect(gen.body).toMatchObject({ ok: true, aiGenerated: false, count: 2 });
    const insights = await request(a).get("/behavioral/insights").query({ siteUrl: SITE_A });
    expect(insights.status).toBe(200);
    expect(insights.body.insights.map((i: { insightType: string }) => i.insightType).sort()).toEqual(["form_abandon", "rage_clicks"]);
    expect(insights.body.analysis.pageViews).toBe(1);
    expect(insights.body.sessionStats).toBeNull();

    // Revenue Leak : observations mesurees, aucune perte financiere inventee.
    const rl = await request(a).get("/revenue-leak").query({ siteUrl: SITE_A });
    expect(rl.status).toBe(200);
    expect(rl.body.noData).toBe(false);
    const kinds = rl.body.opportunities.map((o: { eventType: string }) => o.eventType).sort();
    expect(kinds).toEqual(expect.arrayContaining(["form_abandon", "rage_click"]));
    for (const o of rl.body.opportunities) {
      expect(o.estimatedRevenueLoss).toBeNull();
      expect(o.financialClassification).toBe("unmeasured");
    }
    const target = rl.body.opportunities[0];
    expect((await request(a).patch(`/revenue-leak/${target.id}/resolve`)).body).toMatchObject({ ok: true, id: target.id });
    const rl2 = await request(a).get("/revenue-leak").query({ siteUrl: SITE_A });
    expect(rl2.body.opportunities.some((o: { id: string }) => o.id === target.id)).toBe(false);

    // CRO : recommandations persistees depuis les evenements, statut modifiable.
    const cro = await request(a).get("/cro").query({ siteUrl: SITE_A });
    expect(cro.status).toBe(200);
    expect(cro.body.recommendations.length).toBeGreaterThanOrEqual(2);
    const rec = cro.body.recommendations[0];
    const patched = await request(a).patch(`/cro/recommendations/${rec.id}`).send({ status: "in_progress" });
    expect(patched.body.recommendation.status).toBe("in_progress");

    // ── Isolation entre organisations ─────────────────────────────────────────
    const b = appFor(ORG_B);
    expect((await request(b).get("/behavioral/insights").query({ siteUrl: SITE_A })).status).toBe(404);
    expect((await request(b).get("/behavioral/status").query({ siteUrl: SITE_A })).status).toBe(404);
    expect((await request(b).get("/revenue-leak").query({ siteUrl: SITE_A })).status).toBe(404);
    expect((await request(b).get("/cro").query({ siteUrl: SITE_A })).status).toBe(404);
    expect((await request(b).post("/behavioral/generate-insights").send({ siteUrl: SITE_A })).status).toBe(404);
    expect((await request(b).get("/behavioral/snippet").query({ siteUrl: SITE_A })).status).toBe(403);
    expect((await request(b).patch(`/cro/recommendations/${rec.id}`).send({ status: "dismissed" })).status).toBe(404);
    const bRl = await request(b).get("/revenue-leak");
    expect(bRl.body.opportunities.filter((o: { siteUrl: string }) => o.siteUrl === SITE_A)).toEqual([]);
    const bCro = await request(b).get("/cro");
    expect(bCro.body.recommendations.filter((r: { siteUrl: string }) => r.siteUrl === SITE_A)).toEqual([]);
  }, 120_000);
});
