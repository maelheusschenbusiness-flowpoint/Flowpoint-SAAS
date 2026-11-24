/**
 * CRM Integrations : crm_oauth_states, crm_contacts, crm_webhook_events (absentes de la production)
 * sont creees par initCrmTables (additif, idempotent). Verrouille : schema lu par crm-core.ts,
 * RLS + 4 politiques tenant, isolation entre deux organisations (role app_user), absence de
 * table crm_tokens / de stockage en clair, et index de verrou de synchronisation.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { initDataTables } from "./init-data-tables.js";
import { initCrmTables } from "./init-crm-tables.js";

const TABLES = ["crm_oauth_states", "crm_contacts", "crm_webhook_events"];
const ORG_A = `crm_test_a_${Date.now()}`;
const ORG_B = `crm_test_b_${Date.now()}`;

let dbOk = false;
beforeAll(async () => {
  try { await pool.query("SELECT 1"); dbOk = true; } catch { dbOk = false; }
});
afterAll(async () => {
  if (!dbOk) return;
  for (const t of TABLES) await pool.query(`DELETE FROM ${t} WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]).catch(() => {});
});

describe("CRM : tables additives", () => {
  it("source non destructive, sans table crm_tokens", () => {
    const src = readFileSync(new URL("./init-crm-tables.ts", import.meta.url), "utf8");
    for (const t of TABLES) {
      expect(src).toContain(`CREATE TABLE IF NOT EXISTS ${t}`);
      expect(src).not.toMatch(new RegExp(`(DROP TABLE|TRUNCATE|DELETE FROM)[^;\`]*${t}`, "i"));
    }
    expect(src).not.toMatch(/CREATE TABLE[^;]*crm_tokens/i);
    expect(src).not.toMatch(/REFERENCES/i);
  });

  it("schema, index, RLS, 4 politiques ; rejouable ; requetes de crm-core", async () => {
    if (!dbOk) return;
    await initDataTables();
    await initCrmTables();
    await initCrmTables();
    for (const t of TABLES) {
      const rls = await pool.query<{ rowsecurity: boolean }>("SELECT rowsecurity FROM pg_tables WHERE schemaname='public' AND tablename=$1", [t]);
      expect(rls.rows[0]?.rowsecurity).toBe(true);
      const pol = await pool.query<{ policyname: string }>("SELECT policyname FROM pg_policies WHERE tablename=$1", [t]);
      expect(pol.rows.map(r => r.policyname).sort()).toEqual(["tenant_delete", "tenant_insert", "tenant_select", "tenant_update"]);
    }
    const idx = await pool.query<{ indexname: string }>("SELECT indexname FROM pg_indexes WHERE tablename IN ('crm_contacts','crm_sync_logs')");
    expect(idx.rows.map(r => r.indexname)).toEqual(expect.arrayContaining(["crm_contacts_org_provider_ext_idx", "crm_sync_logs_one_running_idx"]));
    const none = await pool.query<{ n: number }>("SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name='crm_tokens'");
    expect(none.rows[0]!.n).toBe(0);
    // Requetes exactes de crm-core.ts
    await pool.query(`DELETE FROM crm_oauth_states WHERE expires_at < NOW()`);
    const st = await pool.query(`DELETE FROM crm_oauth_states WHERE state_hash=$1 AND provider=$2 AND expires_at > NOW() RETURNING org_id`, ["x", "hubspot"]);
    expect(st.rows).toEqual([]);
    const ct = await pool.query(`SELECT id, name, email, phone, status, source, created_at FROM crm_contacts WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`, [ORG_A]);
    expect(ct.rows).toEqual([]);
  }, 60_000);

  it("RLS : une organisation ne voit ni n'ecrit les lignes d'une autre (role app_user)", async () => {
    if (!dbOk) return;
    await initDataTables();
    await initCrmTables();
    const c = await pool.connect();
    try {
      const su = await c.query<{ s: boolean }>("SELECT rolsuper AS s FROM pg_roles WHERE rolname = current_user");
      if (!su.rows[0]?.s) return;
      await c.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user NOLOGIN NOBYPASSRLS; END IF; END $$`);
      for (const t of TABLES) await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO app_user`);
      for (const org of [ORG_A, ORG_B]) {
        await c.query(`INSERT INTO crm_contacts (id, org_id, provider, external_id, name) VALUES ($1,$2,'hubspot','1','n')`, [`c_${org}`, org]);
        await c.query(`INSERT INTO crm_webhook_events (provider, event_id, org_id) VALUES ('hubspot',$1,$2)`, [`e_${org}`, org]);
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
        const r = await c.query(`SELECT org_id FROM crm_contacts WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
        expect(r.rows.map(x => x.org_id)).toEqual([ORG_A]);
        const w = await c.query(`SELECT org_id FROM crm_webhook_events WHERE org_id = ANY($1)`, [[ORG_A, ORG_B]]);
        expect(w.rows.map(x => x.org_id)).toEqual([ORG_A]);
        await expect(c.query(`INSERT INTO crm_contacts (id, org_id) VALUES ('x', $1)`, [ORG_B])).rejects.toThrow(/row-level security/);
      });
      await asOrg(ORG_A, async () => {
        expect((await c.query(`DELETE FROM crm_contacts WHERE org_id=$1`, [ORG_B])).rowCount).toBe(0);
      });
    } finally { c.release(); }
  }, 60_000);
});
