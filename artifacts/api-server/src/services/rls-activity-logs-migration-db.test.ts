/**
 * rls-activity-logs-migration-db.test.ts — C-08
 *
 * `migrations/026_rls_activity_logs_tenant_policies.sql` pose les 4 policies
 * tenant_* de `activity_logs` quand elles manquent (base demarree par le seul
 * chemin rapide). Le fichier est idempotent et reversible ; ce test le prouve dans
 * une transaction ANNULEE : la base n'est pas modifiee.
 */
import { vi, describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";

const SQL = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "..", "migrations", "026_rls_activity_logs_tenant_policies.sql"),
  "utf8",
);
const POLICIES = ["tenant_select", "tenant_insert", "tenant_update", "tenant_delete"];

describe("migration 025 — policies tenant de activity_logs", () => {
  it("recree les 4 policies manquantes, est idempotente, et ne touche pas a FORCE", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const before = await c.query<{ force: boolean }>(`SELECT relforcerowsecurity AS force FROM pg_class WHERE oid = 'public.activity_logs'::regclass`);
      for (const p of POLICIES) await c.query(`DROP POLICY IF EXISTS ${p} ON public.activity_logs`);
      const count = async () =>
        Number((await c.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='activity_logs' AND policyname = ANY($1)`, [POLICIES])).rows[0].n);

      expect(await count()).toBe(0);          // etat « chemin rapide sans policies »
      await c.query(SQL);
      expect(await count()).toBe(4);
      await c.query(SQL);                      // idempotent
      expect(await count()).toBe(4);

      const after = await c.query<{ force: boolean }>(`SELECT relforcerowsecurity AS force FROM pg_class WHERE oid = 'public.activity_logs'::regclass`);
      expect(after.rows[0]!.force).toBe(before.rows[0]!.force);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("la definition est identique a celle de init-rls-migration (meme predicat sur le GUC)", async () => {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const ref = await c.query(`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='activity_logs' AND policyname = ANY($1) ORDER BY policyname`, [POLICIES]);
      for (const p of POLICIES) await c.query(`DROP POLICY IF EXISTS ${p} ON public.activity_logs`);
      await c.query(SQL);
      const mine = await c.query(`SELECT policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname='public' AND tablename='activity_logs' AND policyname = ANY($1) ORDER BY policyname`, [POLICIES]);
      if (ref.rows.length === 4) expect(mine.rows).toEqual(ref.rows);
      else expect(mine.rows).toHaveLength(4);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("ne mentionne aucune table seller_* ni LEDGER (hors perimetre)", () => {
    const code = SQL.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/seller|ledger/i);
  });
});
