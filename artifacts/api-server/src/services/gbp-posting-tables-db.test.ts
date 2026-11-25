/**
 * AI GBP Posting : gbp_post_queue / gbp_media_assets absentes de la production, et
 * colonnes de publication reelle absentes de gbp_posts. Verrouille : schema, RLS
 * (4 politiques, isolation entre organisations en app_user), idempotence, rattrapage
 * d'un gbp_posts "ancien schema", requetes exactes des routes.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { initGbpPostingTables } from "./init-gbp-posting-tables.js";

const TABLES = ["gbp_post_queue", "gbp_media_assets"];
const ORG_A = `gbp_test_a_${Date.now()}`;
const ORG_B = `gbp_test_b_${Date.now()}`;

let dbOk = false;
beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
});
afterAll(async () => {
  if (!dbOk) return;
  for (const t of [...TABLES, "gbp_posts"]) await pool.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]).catch(() => {});
});

describe("AI GBP Posting : tables additives", () => {
  it("source additive : aucune operation destructive ni FK sur org_id", () => {
    const src = readFileSync(new URL("./init-gbp-posting-tables.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/DROP TABLE|TRUNCATE|DROP COLUMN|REFERENCES/i);
    for (const t of TABLES) expect(src).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
  });

  it("schema, RLS, 4 politiques, rejouable, colonnes de publication, requetes des routes", async () => {
    if (!dbOk) return;
    await initGbpPostingTables();
    await initGbpPostingTables();
    for (const t of TABLES) {
      const rls = await pool.query<{ rowsecurity: boolean }>(
        "SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename=$1", [t]);
      expect(rls.rows[0]?.rowsecurity).toBe(true);
      const pol = await pool.query<{ policyname: string }>("SELECT policyname FROM pg_policies WHERE tablename=$1", [t]);
      expect(pol.rows.map(r => r.policyname).sort()).toEqual(["tenant_delete", "tenant_insert", "tenant_select", "tenant_update"]);
    }
    const cols = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='gbp_posts'");
    expect(cols.rows.map(r => r.column_name)).toEqual(expect.arrayContaining(
      ["offer_terms", "approved_at", "google_post_id", "generation_options", "last_error_code", "last_error_message"]));
    // Requetes exactes de routes/gbp-posts.ts
    const q = await pool.query(
      `SELECT q.*, p.content, p.post_type, p.location_name
       FROM gbp_post_queue q JOIN gbp_posts p ON p.id=q.post_id AND p.org_id=q.org_id
       WHERE q.org_id=$1 ORDER BY q.scheduled_for ASC LIMIT 20`, [ORG_A]);
    const m = await pool.query(`SELECT * FROM gbp_media_assets WHERE org_id=$1 ORDER BY created_at DESC LIMIT 50`, [ORG_A]);
    expect(q.rows).toEqual([]);
    expect(m.rows).toEqual([]);
  }, 60_000);

  it("RLS : une organisation ne voit ni n'ecrit les lignes d'une autre (role app_user)", async () => {
    if (!dbOk) return;
    await initGbpPostingTables();
    const c = await pool.connect();
    try {
      const su = await c.query<{ s: boolean }>("SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user");
      if (!su.rows[0]?.s) return;
      await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user NOLOGIN NOBYPASSRLS; END IF; END $$`);
      for (const t of TABLES) await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO app_user`);
      for (const org of [ORG_A, ORG_B]) {
        await c.query(`INSERT INTO gbp_post_queue (org_id, post_id) VALUES ($1, 'p')`, [org]);
        await c.query(`INSERT INTO gbp_media_assets (org_id, url) VALUES ($1, 'https://x/y.jpg')`, [org]);
      }
      await c.query("BEGIN");
      try {
        await c.query("SET LOCAL ROLE app_user");
        await c.query("SELECT set_config('app.current_org_id', $1, true)", [ORG_A]);
        for (const t of TABLES) {
          const r = await c.query(`SELECT org_id FROM ${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
          expect(r.rows.map(x => x.org_id)).toEqual([ORG_A]);
        }
        await expect(c.query(`INSERT INTO gbp_media_assets (org_id, url) VALUES ($1, 'x')`, [ORG_B])).rejects.toThrow(/row-level security/);
      } finally { await c.query("ROLLBACK"); }
    } finally { c.release(); }
  }, 60_000);
});
