/**
 * sla_targets sur une vraie base : la DDL livree par initDataTables, ses contraintes et
 * son upsert. Se saute si aucune base n'est joignable (la CI en fournit une).
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { initDataTables } from "./init-data-tables.js";

const A = `sla-a-${randomUUID()}`;
const B = `sla-b-${randomUUID()}`;
let ok = false;
beforeAll(async () => {
  try { await pool.query("SELECT 1"); await initDataTables(); ok = true; } catch { ok = false; }
}, 120_000);
afterAll(async () => { if (ok) await pool.query(`DELETE FROM sla_targets WHERE org_id = ANY($1)`, [[A, B]]); });

const UPSERT = `INSERT INTO sla_targets (org_id, monitor_id, target_pct, updated_by) VALUES ($1,$2,$3,$4)
  ON CONFLICT (org_id, monitor_id) DO UPDATE SET target_pct = EXCLUDED.target_pct, updated_by = EXCLUDED.updated_by, updated_at = NOW()`;

describe("sla_targets (SQL réel)", () => {
  it("une seule ligne par (organisation, moniteur) ; l'upsert met à jour", async (ctx) => {
    if (!ok) return ctx.skip();
    await pool.query(UPSERT, [A, "m1", 99.5, "u1"]);
    await pool.query(UPSERT, [A, "m1", 99.9, "u2"]);
    const r = await pool.query(`SELECT target_pct, updated_by FROM sla_targets WHERE org_id = $1 AND monitor_id = 'm1'`, [A]);
    expect(r.rows).toHaveLength(1);
    expect(Number(r.rows[0].target_pct)).toBe(99.9);
    expect(r.rows[0].updated_by).toBe("u2");
  });
  it("deux organisations peuvent cibler le même identifiant de moniteur sans collision", async (ctx) => {
    if (!ok) return ctx.skip();
    await pool.query(UPSERT, [A, "shared", 99.9, null]);
    await pool.query(UPSERT, [B, "shared", 95, null]);
    const a = await pool.query(`SELECT target_pct FROM sla_targets WHERE org_id = $1 AND monitor_id = 'shared'`, [A]);
    const b = await pool.query(`SELECT target_pct FROM sla_targets WHERE org_id = $1 AND monitor_id = 'shared'`, [B]);
    expect([Number(a.rows[0].target_pct), Number(b.rows[0].target_pct)]).toEqual([99.9, 95]);
  });
  it("la base refuse une cible hors bornes", async (ctx) => {
    if (!ok) return ctx.skip();
    for (const bad of [89.9, 100, 0, -1]) {
      await expect(pool.query(UPSERT, [A, "bad", bad, null])).rejects.toMatchObject({ code: "23514" });
    }
  });
  it("RLS : sous le rôle applicatif, une organisation ne voit ni n'écrit chez l'autre", async (ctx) => {
    if (!ok) return ctx.skip();
    const t = await pool.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'sla_targets'`);
    expect(t.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    await pool.query(UPSERT, [A, "rls", 99, null]);
    await pool.query(UPSERT, [B, "rls", 98, null]);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try { await client.query("SET LOCAL ROLE app_user"); } catch { await client.query("ROLLBACK"); return ctx.skip(); }
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [A]);
      const seen = await client.query(`SELECT org_id FROM sla_targets WHERE monitor_id = 'rls'`);
      expect(seen.rows.map(r => r.org_id)).toEqual([A]);
      await expect(client.query(`INSERT INTO sla_targets (org_id, monitor_id, target_pct) VALUES ($1,'x',99)`, [B]))
        .rejects.toMatchObject({ code: "42501" });
      await client.query("ROLLBACK");
      await client.query("BEGIN");
      await client.query("SET LOCAL ROLE app_user");
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [A]);
      const del = await client.query(`DELETE FROM sla_targets WHERE org_id = $1`, [B]);
      expect(del.rowCount).toBe(0); // la ligne de B est invisible pour A
    } finally { await client.query("ROLLBACK").catch(() => {}); client.release(); }
    const still = await pool.query(`SELECT 1 FROM sla_targets WHERE org_id = $1 AND monitor_id = 'rls'`, [B]);
    expect(still.rows).toHaveLength(1);
  });
});
