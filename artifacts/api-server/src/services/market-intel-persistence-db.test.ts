import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

const enabled = process.env["CI"] === "true" && !!process.env["DATABASE_URL"];
const suite = describe.skipIf(!enabled);

suite("Market Intelligence persistence — ephemeral PostgreSQL CI", () => {
  it("migrates the report table with tenant RLS and hides other organizations' rows", async () => {
    const orgA = `mi-a-${randomUUID()}`;
    const orgB = `mi-b-${randomUUID()}`;
    const idA = randomUUID();
    const idB = randomUUID();
    try {
      const schema = await pool.query<{ rls: boolean; policies: string[] }>(
        `SELECT c.relrowsecurity AS rls,
                ARRAY(SELECT p.policyname FROM pg_policies p
                       WHERE p.schemaname='public' AND p.tablename='ai_market_reports'
                       ORDER BY p.policyname) AS policies
           FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname='public' AND c.relname='ai_market_reports'`
      );
      expect(schema.rows[0]?.rls).toBe(true);
      expect(schema.rows[0]?.policies).toEqual(["tenant_delete", "tenant_insert", "tenant_select", "tenant_update"]);

      await pool.query(
        `INSERT INTO ai_market_reports (id, org_id, title, summary, data)
         VALUES ($1,$2,'A','snapshot A','{}'),($3,$4,'B','snapshot B','{}')`,
        [idA, orgA, idB, orgB]
      );
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL ROLE app_user");
        await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgA]);
        const visible = await client.query<{ id: string }>(
          `SELECT id FROM ai_market_reports WHERE id IN ($1,$2) ORDER BY id`, [idA, idB]
        );
        expect(visible.rows.map((row) => row.id)).toEqual([idA]);
      } finally {
        await client.query("ROLLBACK").catch(() => undefined);
        client.release();
      }
    } finally {
      await pool.query(`DELETE FROM ai_market_reports WHERE id IN ($1,$2)`, [idA, idB]);
    }
  });
});
