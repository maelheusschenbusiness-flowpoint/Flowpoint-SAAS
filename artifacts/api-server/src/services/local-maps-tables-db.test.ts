/**
 * local_opportunities et local_visibility_scores etaient lues par
 * GET /api/local-maps/opportunities et /visibility-scores sans qu'aucun CREATE TABLE
 * n'existe (relation absente, HTTP 500). Elles sont creees dans la partie de
 * initDataTables qui s'execute a chaque migration. Verrouille : emplacement (hors du
 * bloc v3), schema, requetes des routes, RLS (isolation entre deux organisations en
 * app_user) et idempotence.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { initDataTables } from "./init-data-tables.js";

const TABLES = ["local_opportunities", "local_visibility_scores"];
const ORG_A = `ldm_test_a_${Date.now()}`;
const ORG_B = `ldm_test_b_${Date.now()}`;

let dbOk = false;
beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
});
afterAll(async () => {
  if (!dbOk) return;
  for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]).catch(() => {});
});

describe("Local Domination Maps : tables additives hors du bloc v3", () => {
  it("la creation precede le bloc conditionnel missing-production-tables-v3 et reste non destructive", () => {
    const src = readFileSync(new URL("./init-data-tables.ts", import.meta.url), "utf8");
    const v3 = src.indexOf('hasMigration("missing-production-tables-v3")');
    for (const t of TABLES) {
      const first = src.indexOf(`CREATE TABLE IF NOT EXISTS ${t}`);
      expect(first).toBeGreaterThan(0);
      expect(first).toBeLessThan(v3);
      expect(src).not.toMatch(new RegExp(`(DROP TABLE|TRUNCATE|DELETE FROM)[^;\`]*${t}`, "i"));
    }
  });

  it("schema, index, RLS et 4 politiques ; rejouable sans erreur ; requetes des routes", async () => {
    if (!dbOk) return;
    await initDataTables();
    await initDataTables();
    for (const t of TABLES) {
      const cols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1", [t]);
      const names = cols.rows.map(r => r.column_name);
      expect(names).toEqual(expect.arrayContaining(["id", "org_id", "score", "created_at"]));
      const rls = await pool.query<{ rowsecurity: boolean }>(
        "SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename=$1", [t]);
      expect(rls.rows[0]?.rowsecurity).toBe(true);
      const pol = await pool.query<{ policyname: string }>("SELECT policyname FROM pg_policies WHERE tablename=$1", [t]);
      expect(pol.rows.map(r => r.policyname).sort()).toEqual(["tenant_delete", "tenant_insert", "tenant_select", "tenant_update"]);
    }
    // Requetes exactes de routes/local-maps.ts
    const o = await pool.query(`SELECT * FROM local_opportunities WHERE org_id=$1 ORDER BY score DESC LIMIT 20`, [ORG_A]);
    const v = await pool.query(`SELECT * FROM local_visibility_scores WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20`, [ORG_A]);
    expect(o.rows).toEqual([]);
    expect(v.rows).toEqual([]);
  }, 60_000);

  it("RLS : une organisation ne voit ni n'ecrit les lignes d'une autre (role app_user)", async () => {
    if (!dbOk) return;
    await initDataTables();
    const c = await pool.connect();
    try {
      const su = await c.query<{ s: boolean }>("SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user");
      if (!su.rows[0]?.s) return; // CREATE ROLE / SET ROLE exigent un superuser
      await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user NOLOGIN NOBYPASSRLS; END IF; END $$`);
      for (const t of TABLES) await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO app_user`);
      const asOrg = async (org: string, fn: () => Promise<void>) => {
        await c.query("BEGIN");
        try {
          await c.query("SET LOCAL ROLE app_user");
          await c.query("SELECT set_config('app.current_org_id', $1, true)", [org]);
          await fn();
        } finally { await c.query("ROLLBACK"); }
      };
      // Insertion hors transaction de role : une ligne par organisation, par table.
      for (const org of [ORG_A, ORG_B]) {
        await c.query(`INSERT INTO local_opportunities (org_id, title, score) VALUES ($1, 'opp', 70)`, [org]);
        await c.query(`INSERT INTO local_visibility_scores (org_id, score) VALUES ($1, 55)`, [org]);
      }
      await asOrg(ORG_A, async () => {
        // Meme sans filtre org_id, seule la ligne de A est visible.
        const o = await c.query(`SELECT org_id FROM local_opportunities WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
        expect(o.rows.map(r => r.org_id)).toEqual([ORG_A]);
        const v = await c.query(`SELECT org_id FROM local_visibility_scores WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
        expect(v.rows.map(r => r.org_id)).toEqual([ORG_A]);
        // Ecriture pour une autre organisation refusee.
        await expect(c.query(`INSERT INTO local_opportunities (org_id, title) VALUES ($1, 'x')`, [ORG_B])).rejects.toThrow(/row-level security/);
      });
      await asOrg(ORG_A, async () => {
        const u = await c.query(`UPDATE local_visibility_scores SET score=1 WHERE org_id=$1`, [ORG_B]);
        expect(u.rowCount).toBe(0);
        const d = await c.query(`DELETE FROM local_opportunities WHERE org_id=$1`, [ORG_B]);
        expect(d.rowCount).toBe(0);
      });
      const still = await c.query(`SELECT count(*)::int AS n FROM local_opportunities WHERE org_id=$1`, [ORG_B]);
      expect(still.rows[0].n).toBe(1);
    } finally { c.release(); }
  }, 60_000);
});
