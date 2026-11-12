/**
 * quarantine-table-rls-db.test.ts
 *
 * `ai_usage_logs_idempotency_quarantine` porte `org_id` et etait creee SANS
 * RLS, contrairement a la regle du depot — toute table portant org_id active
 * RLS a sa creation.
 *
 * Constat du 13/10/2026 sur la production Supabase : le Security Advisor la
 * signalait en ERROR, « is public, but RLS has not been enabled », SEULE table
 * du schema public dans ce cas, et le role `anon` — dont la cle est publique
 * par construction, elle part dans le navigateur — y detenait SELECT, INSERT,
 * UPDATE, DELETE et TRUNCATE. La table etait vide (0 ligne, 0 organisation),
 * donc rien n'avait fuite ; mais elle se remplit d'org_id et de cles
 * d'idempotence des qu'un double debit est mis en quarantaine.
 *
 * La passe RLS generique aurait pose la protection — elle active RLS sur toute
 * table et pose 4 policies sur celles qui portent org_id — mais elle ne tourne
 * ni sur le chemin rapide de demarrage, celui de la production, ni sans
 * migrate.mjs, qui n'est pas cable en Pre-Deploy. La protection est donc posee
 * la ou la table est creee.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { AI_USAGE_IDEMPOTENCY_STATEMENTS } from "./ai-usage-idempotency-schema.js";

const TABLE = "ai_usage_logs_idempotency_quarantine";
const ORG_A = randomUUID();
const ORG_B = randomUUID();
let roleUsable = false;

beforeAll(async () => {
  for (const step of AI_USAGE_IDEMPOTENCY_STATEMENTS) {
    await pool.query(step.sql).catch(() => { /* DDL idempotent, deja pose */ });
  }
  const c = await pool.connect();
  try {
    await c.query("SET ROLE app_user");
    await c.query("RESET ROLE");
    roleUsable = true;
  } catch { roleUsable = false; } finally { c.release(); }
});

afterAll(async () => {
  await pool.query(`DELETE FROM ${TABLE} WHERE org_id = ANY($1::text[])`, [[ORG_A, ORG_B]]).catch(() => {});
});

/** Une transaction comme withOrgDb en ouvre une. */
async function asOrgUser<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL "app.current_org_id" = '${orgId}'`);
    await c.query("SET LOCAL ROLE app_user");
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

const row = (org: string) => [`log_${randomUUID().slice(0, 8)}`, org, `idem_${randomUUID().slice(0, 8)}`, "kept", 2];

describe("protection de la table de quarantaine", () => {
  it("RLS est active ET forcee", async () => {
    const res = await pool.query<{ rls: boolean; forced: boolean }>(
      `SELECT c.relrowsecurity AS rls, c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = $1`,
      [TABLE]
    );
    expect(res.rows[0]?.rls).toBe(true);
    expect(res.rows[0]?.forced).toBe(true);
  });

  it("les quatre policies tenant_* isolent sur la variable que l'application pose", async () => {
    const res = await pool.query<{ policyname: string; predicat: string }>(
      `SELECT policyname, COALESCE(qual, with_check, '') AS predicat
         FROM pg_policies WHERE schemaname = 'public' AND tablename = $1 ORDER BY policyname`,
      [TABLE]
    );
    expect(res.rows.map((r) => r.policyname)).toEqual([
      "tenant_delete", "tenant_insert", "tenant_select", "tenant_update",
    ]);
    for (const r of res.rows) {
      expect(r.predicat).toContain("app.current_org_id");
      expect(r.predicat).toContain("org_id");
    }
  });

  it("l'invariant du Security Advisor est satisfait : org_id ⇒ RLS + policy sur org_id", async () => {
    // La requete du linter Supabase, reduite a cette table.
    const res = await pool.query<{ n: string }>(
      `SELECT count(*) AS n
         FROM pg_tables t
        WHERE t.schemaname = 'public' AND t.tablename = $1
          AND (NOT t.rowsecurity
               OR NOT EXISTS (SELECT 1 FROM pg_policies p
                               WHERE p.schemaname='public' AND p.tablename=t.tablename
                                 AND COALESCE(p.qual,'')||COALESCE(p.with_check,'') ~ 'org_id'))`,
      [TABLE]
    );
    expect(Number(res.rows[0]?.n)).toBe(0);
  });

  it("rejouer le DDL ne duplique rien", async () => {
    for (const step of AI_USAGE_IDEMPOTENCY_STATEMENTS) {
      await pool.query(step.sql).catch(() => {});
    }
    const res = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM pg_policies WHERE schemaname='public' AND tablename=$1`, [TABLE]
    );
    expect(Number(res.rows[0]?.n)).toBe(4);
  });
});

describe("isolation sous app_user", () => {
  it("le role app_user est utilisable ici", () => {
    // Sans bascule de role, le pool superuser contourne RLS : les tests
    // suivants ne prouveraient rien.
    expect(roleUsable, "SET ROLE app_user indisponible").toBe(true);
  });

  it("ecriture et relecture dans sa propre organisation", async () => {
    const vu = await asOrgUser(ORG_A, async (c) => {
      await c.query(
        `INSERT INTO ${TABLE} (log_id, org_id, idempotency_key, kept_log_id, group_size) VALUES ($1,$2,$3,$4,$5)`,
        row(ORG_A)
      );
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${TABLE}`);
      return r.rows[0]!.n;
    });
    expect(vu).toBe(1);
  });

  it("les lignes d'une autre organisation sont invisibles", async () => {
    await pool.query(
      `INSERT INTO ${TABLE} (log_id, org_id, idempotency_key, kept_log_id, group_size) VALUES ($1,$2,$3,$4,$5)`,
      row(ORG_B)
    );
    expect(await asOrgUser(ORG_A, async (c) => {
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${TABLE}`);
      return r.rows[0]!.n;
    })).toBe(0);
    expect(await asOrgUser(ORG_B, async (c) => {
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${TABLE}`);
      return r.rows[0]!.n;
    })).toBe(1);
  });

  it("ecrire pour une autre organisation est refuse", async () => {
    await expect(
      asOrgUser(ORG_A, (c) =>
        c.query(
          `INSERT INTO ${TABLE} (log_id, org_id, idempotency_key, kept_log_id, group_size) VALUES ($1,$2,$3,$4,$5)`,
          row(ORG_B)
        )
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("CONTROLE NEGATIF — RLS desactivee, l'autre organisation redevient visible", async () => {
    // Reproduit l'etat de production dans une transaction annulee : sans ce
    // controle, les tests ci-dessus pourraient passer parce que la table est
    // vide, et non parce que l'isolation fonctionne.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(
        `INSERT INTO ${TABLE} (log_id, org_id, idempotency_key, kept_log_id, group_size) VALUES ($1,$2,$3,$4,$5)`,
        row(ORG_B)
      );
      await c.query(`ALTER TABLE ${TABLE} DISABLE ROW LEVEL SECURITY`);
      await c.query(`SET LOCAL "app.current_org_id" = '${ORG_A}'`);
      await c.query("SET LOCAL ROLE app_user");
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${TABLE}`);
      expect(r.rows[0]!.n).toBeGreaterThan(0);   // sans RLS, tout est visible
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    // RLS est toujours active apres l'annulation.
    const after = await pool.query<{ rls: boolean }>(
      `SELECT relrowsecurity AS rls FROM pg_class WHERE relname = $1`, [TABLE]
    );
    expect(after.rows[0]?.rls).toBe(true);
  });
});
