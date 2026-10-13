/**
 * checkout-post-tokens-rls-db.test.ts
 *
 * checkout_post_tokens porte `org_id` et un jeton de session (token_hash).
 * L'invariant verifie par migrate.mjs, etape 12, est donc le sien : RLS active
 * ET au moins une policy qui isole sur org_id.
 *
 * Le defaut : la table n'etait creee qu'au demarrage du serveur, avec
 * ENABLE + FORCE ROW LEVEL SECURITY et AUCUNE policy. Elle n'existait pas quand
 * migrate.mjs passait, donc l'audit ne la voyait pas ; et selon l'ordre dans
 * lequel se terminaient deux etapes de demarrage asynchrones, elle pouvait
 * rester sans policy jusqu'au demarrage suivant. Fail-closed, donc sans fuite,
 * mais l'invariant etait faux pendant cette fenetre.
 *
 * Ces tests posent l'invariant sur PostgreSQL reel, y compris apres la refonte
 * d'un schema ancien (DROP TABLE emporte les policies), et verifient que les
 * deux chemins d'initialisation appellent bien la meme fonction.
 */

import { vi, describe, it, expect, beforeAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool } from "@workspace/db";
import fs from "node:fs";
import path from "node:path";
import {
  ensureCheckoutPostTokensSchema,
  CHECKOUT_POST_TOKENS_TABLE,
} from "./init-checkout-post-tokens.js";

/** La requete d'audit de migrate.mjs, etape 12, reduite a cette table. */
async function auditIsolation(): Promise<{ rls: boolean; forced: boolean; policies: number; isolated: boolean }> {
  const res = await pool.query<{ rls: boolean; forced: boolean; policies: string; isolated: boolean | null }>(
    `SELECT c.relrowsecurity AS rls,
            c.relforcerowsecurity AS forced,
            (SELECT COUNT(*) FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = $1) AS policies,
            (SELECT BOOL_OR(COALESCE(p.qual,'') || COALESCE(p.with_check,'') ~ 'org_id')
               FROM pg_policies p
              WHERE p.schemaname = 'public' AND p.tablename = $1) AS isolated
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = $1`,
    [CHECKOUT_POST_TOKENS_TABLE]
  );
  const row = res.rows[0];
  return {
    rls: row?.rls === true,
    forced: row?.forced === true,
    policies: Number(row?.policies ?? 0),
    isolated: row?.isolated === true,
  };
}

beforeAll(async () => {
  await ensureCheckoutPostTokensSchema(pool);
});

describe("checkout_post_tokens — isolation posee des l'initialisation", () => {
  it("satisfait l'invariant de migrate.mjs : RLS active, forcee, et une policy sur org_id", async () => {
    const audit = await auditIsolation();
    expect(audit.rls).toBe(true);
    expect(audit.forced).toBe(true);
    expect(audit.policies).toBeGreaterThanOrEqual(1);
    expect(audit.isolated).toBe(true);
  });

  it("porte les quatre policies tenant_*, comme toute table a org_id", async () => {
    const res = await pool.query<{ policyname: string }>(
      `SELECT policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename = $1 AND policyname LIKE 'tenant_%'
        ORDER BY policyname`,
      [CHECKOUT_POST_TOKENS_TABLE]
    );
    expect(res.rows.map((r) => r.policyname)).toEqual([
      "tenant_delete", "tenant_insert", "tenant_select", "tenant_update",
    ]);
  });

  it("aucune policy n'ouvre la table : chacune exige la GUC d'organisation", async () => {
    const res = await pool.query<{ qual: string | null; with_check: string | null }>(
      `SELECT qual, with_check FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
      [CHECKOUT_POST_TOKENS_TABLE]
    );
    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) {
      const predicate = `${row.qual ?? ""}${row.with_check ?? ""}`;
      expect(predicate).toContain("app.current_org_id");
      expect(predicate).not.toMatch(/^\s*true\s*$/);
    }
  });

  it("l'appel est idempotent : rejouer ne laisse ni doublon ni trou", async () => {
    await ensureCheckoutPostTokensSchema(pool);
    await ensureCheckoutPostTokensSchema(pool);
    const audit = await auditIsolation();
    expect(audit.isolated).toBe(true);
    const res = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`,
      [CHECKOUT_POST_TOKENS_TABLE]
    );
    expect(Number(res.rows[0]?.n)).toBe(4);
  });

  it("un schema ancien est refait AVEC ses policies — un DROP TABLE emporte les siennes", async () => {
    await pool.query(`DROP TABLE IF EXISTS ${CHECKOUT_POST_TOKENS_TABLE}`);
    await pool.query(`
      CREATE TABLE ${CHECKOUT_POST_TOKENS_TABLE} (
        stripe_session_id TEXT PRIMARY KEY,
        org_id            TEXT NOT NULL,
        email             TEXT NOT NULL
      )
    `);
    // Etat de depart : ni RLS ni policy, et pas de token_hash.
    expect((await auditIsolation()).policies).toBe(0);

    await ensureCheckoutPostTokensSchema(pool);

    const cols = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'token_hash'`,
      [CHECKOUT_POST_TOKENS_TABLE]
    );
    expect(cols.rowCount).toBe(1);
    const audit = await auditIsolation();
    expect(audit.rls).toBe(true);
    expect(audit.forced).toBe(true);
    expect(audit.isolated).toBe(true);
  });
});

describe("les deux chemins d'initialisation posent la meme chose", () => {
  const read = (rel: string): string =>
    fs.readFileSync(path.join(import.meta.dirname ?? __dirname, rel), "utf8");

  it("init-data-tables (migrate) et le demarrage du serveur appellent la fonction partagee", () => {
    expect(read("./init-data-tables.ts")).toContain("ensureCheckoutPostTokensSchema(client)");
    expect(read("../index.ts")).toContain("ensureCheckoutPostTokensSchema(client)");
  });

  it("plus aucune definition concurrente de la table au demarrage", () => {
    // Deux CREATE TABLE pour la meme table, c'est deux verites : celle qui pose
    // les policies et celle qui les oublie.
    expect(read("../index.ts")).not.toContain("CREATE TABLE IF NOT EXISTS checkout_post_tokens");
  });
});
