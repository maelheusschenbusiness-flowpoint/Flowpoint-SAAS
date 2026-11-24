/**
 * Market Intelligence : ai_market_reports etait lue (GET /reports) et ecrite
 * (POST /report/generate) sans aucun CREATE TABLE en production. Verrouille : creation
 * idempotente, schema, RLS (4 politiques, isolation entre organisations en app_user),
 * et generation de rapport de bout en bout sur donnees reelles (GSC + classements).
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { initDataTables } from "./init-data-tables.js";
import { initMarketIntelTables } from "./init-market-intel-tables.js";
import { generateMarketReport, getMarketDashboard } from "./market-intel-service.js";

const ORG_A = `mi_test_a_${Date.now()}`;
const ORG_B = `mi_test_b_${Date.now()}`;
const TABLES = ["ai_market_reports", "competitor_rankings", "industry_signals", "gsc_keyword_data"];

let dbOk = false;
beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
  if (dbOk) { await initDataTables(); await initMarketIntelTables(); }
}, 120_000);
afterAll(async () => {
  if (!dbOk) return;
  for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]).catch(() => {});
});

describe("Market Intelligence : tables additives", () => {
  it("script non destructif, sans FK sur org_id", () => {
    const src = readFileSync(new URL("./init-market-intel-tables.ts", import.meta.url), "utf8");
    expect(src).toContain("CREATE TABLE IF NOT EXISTS ai_market_reports");
    expect(src).not.toMatch(/DROP TABLE|TRUNCATE|DELETE FROM|REFERENCES/i);
  });

  it("schema, index, RLS et 4 politiques ; rejouable", async () => {
    if (!dbOk) return;
    await initMarketIntelTables();
    await initMarketIntelTables();
    const cols = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='ai_market_reports'");
    expect(cols.rows.map(r => r.column_name)).toEqual(
      expect.arrayContaining(["id", "org_id", "title", "summary", "data", "generated_at"]));
    for (const t of ["ai_market_reports", "competitor_rankings", "industry_signals"]) {
      const rls = await pool.query<{ rowsecurity: boolean }>(
        "SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename=$1", [t]);
      expect(rls.rows[0]?.rowsecurity).toBe(true);
      const pol = await pool.query<{ policyname: string }>("SELECT policyname FROM pg_policies WHERE tablename=$1", [t]);
      expect(pol.rows.map(r => r.policyname).sort()).toEqual(["tenant_delete", "tenant_insert", "tenant_select", "tenant_update"]);
    }
  }, 60_000);

  it("generateMarketReport persiste un rapport reel (GSC + classements) relu par la requete de la route", async () => {
    if (!dbOk) return;
    const today = new Date().toISOString().slice(0, 10);
    const old = new Date(Date.now() - 35 * 86400_000).toISOString().slice(0, 10);
    await pool.query(
      `INSERT INTO gsc_keyword_data (org_id, keyword, date, impressions, clicks) VALUES
         ($1,'seo local',$2,400,20),($1,'seo local',$3,300,10)`, [ORG_A, today, old]);
    await pool.query(
      `INSERT INTO competitor_rankings (org_id, competitor_domain, keyword, position, checked_at) VALUES
         ($1,'rival.example','seo local',3, NOW()),($1,'rival.example','seo local',8, NOW() - INTERVAL '7 days')`, [ORG_A]);

    const dash = await getMarketDashboard(ORG_A);
    expect(dash.trends[0]).toMatchObject({ keyword: "seo local", growth_rate: 100, trend_direction: "up" });
    expect(dash.competitor_movements[0]).toMatchObject({ type: "ranking_gain", previous_position: 8, current_position: 3 });

    const empty = await getMarketDashboard(ORG_B);
    expect(empty.trends).toEqual([]);

    const report = await generateMarketReport(ORG_A);
    const saved = await pool.query(
      `SELECT id, title, summary, data, generated_at FROM ai_market_reports WHERE org_id=$1 ORDER BY generated_at DESC, id DESC LIMIT 20`, [ORG_A]);
    expect(saved.rows).toHaveLength(1);
    expect(saved.rows[0].id).toBe(report["id"]);
    expect(saved.rows[0].data.trends[0].keyword).toBe("seo local");
    const none = await pool.query(`SELECT id FROM ai_market_reports WHERE org_id=$1`, [ORG_B]);
    expect(none.rows).toEqual([]);
  }, 60_000);

  it("RLS : une organisation ne voit ni n'ecrit les rapports d'une autre (role app_user)", async () => {
    if (!dbOk) return;
    const c = await pool.connect();
    try {
      const su = await c.query<{ s: boolean }>("SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user");
      if (!su.rows[0]?.s) return;
      await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user NOLOGIN NOBYPASSRLS; END IF; END $$`);
      await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ai_market_reports TO app_user`);
      for (const org of [ORG_A, ORG_B]) {
        await c.query(`INSERT INTO ai_market_reports (id, org_id, title) VALUES ($1,$2,'t')`, [`rls_${org}`, org]);
      }
      await c.query("BEGIN");
      try {
        await c.query("SET LOCAL ROLE app_user");
        await c.query("SELECT set_config('app.current_org_id', $1, true)", [ORG_A]);
        const r = await c.query(`SELECT org_id FROM ai_market_reports WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
        expect(r.rows.map(x => x.org_id)).toEqual([ORG_A]);
        await expect(c.query(`INSERT INTO ai_market_reports (id, org_id, title) VALUES ('x', $1, 'x')`, [ORG_B])).rejects.toThrow(/row-level security/);
      } finally { await c.query("ROLLBACK"); }
    } finally { c.release(); }
  }, 60_000);
});
