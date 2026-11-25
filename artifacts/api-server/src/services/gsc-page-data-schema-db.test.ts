/**
 * gsc_page_data est absente de la base de production : le bloc
 * `missing-production-tables-v3` qui la cree y est deja enregistre comme applique.
 * Elle est donc creee dans la partie de initDataTables qui s'execute a chaque
 * migration. Verrouille : emplacement (hors du bloc v3), schema, RLS, idempotence.
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { initDataTables } from "./init-data-tables.js";

let dbOk = false;
beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
});

describe("gsc_page_data : creation additive hors du bloc v3", () => {
  it("la creation precede le bloc conditionnel missing-production-tables-v3", () => {
    const src = readFileSync(new URL("./init-data-tables.ts", import.meta.url), "utf8");
    const first = src.indexOf("CREATE TABLE IF NOT EXISTS gsc_page_data");
    const v3 = src.indexOf('hasMigration("missing-production-tables-v3")');
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(v3);
    expect(src).not.toMatch(/DROP TABLE[^;]*gsc_page_data/i);
  });

  it("schema, index unique, RLS et 4 politiques ; rejouable sans erreur", async () => {
    if (!dbOk) return;
    await initDataTables();
    await initDataTables();
    const cols = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='gsc_page_data'");
    expect(cols.rows.map(r => r.column_name).sort()).toEqual(
      ["clicks", "created_at", "ctr", "date", "id", "impressions", "org_id", "page", "position", "updated_at"]);
    const idx = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND tablename='gsc_page_data'");
    expect(idx.rows.map(r => r.indexname)).toContain("gsc_page_data_org_page_date_idx");
    const rls = await pool.query<{ rowsecurity: boolean }>(
      "SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename='gsc_page_data'");
    expect(rls.rows[0]?.rowsecurity).toBe(true);
    const pol = await pool.query<{ policyname: string }>(
      "SELECT policyname FROM pg_policies WHERE tablename='gsc_page_data'");
    expect(pol.rows.map(r => r.policyname).sort()).toEqual(["tenant_delete", "tenant_insert", "tenant_select", "tenant_update"]);
  }, 60_000);
});
