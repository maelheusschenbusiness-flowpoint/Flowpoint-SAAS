/**
 * pg-init-contract-db.test.ts
 *
 * Trois defauts d'initialisation PostgreSQL, confirmes par mesure :
 *
 * 1. migrate.mjs sortait en 1 sur une base vierge :
 *      [5/8] init-missions
 *        ✗ relation "organizations" does not exist
 *    Les initialiseurs de domaine (missions, automation, monitors) tournaient
 *    AVANT initDataTables, qui cree `organizations` — table que init-missions
 *    lit. L'ordre est corrige dans migrate.ts ; ce test verrouille le contrat
 *    dont depend cet ordre : initDataTables pose les tables de base.
 *
 * 2. `connectors` n'etait creee par AUCUN initialiseur, seulement par
 *    migrations/002 et 005 — qui ne s'executent pas en production et se
 *    contredisent. runCanonicalSystemSeeds() en a besoin : sur une base
 *    vierge, migrate.mjs sortait en 1 a l'etape des seeds.
 *
 * 3. migrations/002 cree sso_providers avec `provider TEXT NOT NULL`, schema
 *    anterieur au contrat actuel. sso-service.ts insere sans `provider` :
 *    sur toute base issue de ces migrations, la creation d'un fournisseur SSO
 *    echouait en 23502. La colonne est conservee, la contrainte levee.
 *
 * Sans PostgreSQL, la suite s'ignore proprement.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) => {
  return importOriginal<typeof import("@workspace/db")>();
});

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pool } from "@workspace/db";
import type { PoolClient } from "pg";

let dbUp = false;
/** true quand le test a lui-meme ajoute la colonne legacy `provider`. */
let addedProviderCol = false;

async function columns(table: string): Promise<Map<string, string>> {
  const c = await pool.connect();
  try {
    const r = await c.query(
      `SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1`, [table]);
    return new Map((r.rows as Array<{ column_name: string; is_nullable: string }>)
      .map((x) => [x.column_name, x.is_nullable]));
  } finally { c.release(); }
}

/** Le DDL de reconciliation embarque dans initDataTables et migrations/022. */
const RELAX_PROVIDER_SQL = `
  DO $$
  BEGIN
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sso_providers'
        AND column_name = 'provider' AND is_nullable = 'NO'
    ) THEN
      ALTER TABLE public.sso_providers ALTER COLUMN provider DROP NOT NULL;
    END IF;
  END $$`;

beforeAll(async () => {
  let c: PoolClient;
  try { c = (await pool.connect()) as unknown as PoolClient; }
  catch { dbUp = false; return; }
  try {
    const r = await c.query(`SELECT to_regclass('public.sso_providers') IS NOT NULL AS ok`);
    dbUp = (r.rows[0] as { ok: boolean } | undefined)?.ok === true;
  } finally { c.release(); }
});

afterAll(async () => {
  if (!dbUp || !addedProviderCol) return;
  const c = await pool.connect();
  try { await c.query(`ALTER TABLE public.sso_providers DROP COLUMN IF EXISTS provider`); }
  finally { c.release(); }
});

describe("initialisation PostgreSQL — contrat de schema", () => {
  it("1 — initDataTables pose les tables de base dont dependent les initialiseurs de domaine", async () => {
    if (!dbUp) return;
    const c = await pool.connect();
    try {
      // `users` n'est volontairement PAS dans cette liste : il est pose par
      // initPhase1Users, appele au demarrage du serveur et non par migrate.mjs.
      for (const t of ["organizations", "org_settings", "user_prefs", "audits", "monitors"]) {
        const r = await c.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [`public.${t}`]);
        expect((r.rows[0] as { ok: boolean }).ok, t).toBe(true);
      }
    } finally { c.release(); }
  });

  it("2 — `connectors` existe avec les colonnes utilisees par le code", async () => {
    if (!dbUp) return;
    const cols = await columns("connectors");
    expect(cols.size).toBeGreaterThan(0);
    // runCanonicalSystemSeeds : INSERT (id, provider, status, connected, config)
    // routes/connectors.ts   : SELECT org_id ... WHERE provider = $1
    for (const col of ["id", "org_id", "provider", "status", "connected", "config"]) {
      expect(cols.has(col), col).toBe(true);
    }
  });

  it("3 — la colonne legacy sso_providers.provider est conservee mais non contraignante", async () => {
    if (!dbUp) return;
    const c = await pool.connect();
    try {
      // Reconstituer l'etat d'une base issue de migrations/002.
      const before = await columns("sso_providers");
      if (!before.has("provider")) {
        await c.query(`ALTER TABLE public.sso_providers ADD COLUMN provider TEXT`);
        addedProviderCol = true;
      }
      await c.query(`UPDATE public.sso_providers SET provider = 'legacy' WHERE provider IS NULL`);
      await c.query(`ALTER TABLE public.sso_providers ALTER COLUMN provider SET NOT NULL`);
      expect((await columns("sso_providers")).get("provider")).toBe("NO");

      // L'INSERT du contrat actuel echoue dans cet etat.
      await expect(c.query(
        `INSERT INTO sso_providers (id, org_id, type, name, enabled, default_role, created_at)
         VALUES ('sso_before','org_t','saml','N',true,'member',NOW())`,
      )).rejects.toMatchObject({ code: "23502" });

      // Reconciliation : la contrainte tombe, la colonne reste.
      await c.query(RELAX_PROVIDER_SQL);
      const after = await columns("sso_providers");
      expect(after.has("provider")).toBe(true);
      expect(after.get("provider")).toBe("YES");

      // Le meme INSERT passe desormais.
      await c.query(
        `INSERT INTO sso_providers (id, org_id, type, name, enabled, default_role, created_at)
         VALUES ('sso_after','org_t','saml','N',true,'member',NOW())`);
      const chk = await c.query(`SELECT provider FROM sso_providers WHERE id = 'sso_after'`);
      expect((chk.rows[0] as { provider: string | null }).provider).toBeNull();

      // Rejouable sans effet.
      await c.query(RELAX_PROVIDER_SQL);
      expect((await columns("sso_providers")).get("provider")).toBe("YES");

      await c.query(`DELETE FROM sso_providers WHERE id IN ('sso_before','sso_after')`);
    } finally { c.release(); }
  });
});

describe("isolation inter-organisations — invariant de schema", () => {
  it("4 — toute table portant org_id a RLS active et une policy d'isolation sur org_id", async () => {
    if (!dbUp) return;
    const c = await pool.connect();
    try {
      // Pas un seuil numerique : l'invariant est verifie table par table.
      // Mesure avant correction, sur une base installee par migrate.mjs seul :
      // 37 tables sensibles sans RLS ni policy (audits, monitors, reports,
      // missions, team_members, org_secrets, connectors, notifications…).
      const r = await c.query(`
        WITH sensibles AS (
          SELECT cl.relname AS table_name, cl.relrowsecurity AS rls
          FROM pg_class cl
          JOIN pg_namespace n ON n.oid = cl.relnamespace
          JOIN information_schema.columns col
            ON col.table_schema = 'public' AND col.table_name = cl.relname
           AND col.column_name = 'org_id'
          WHERE n.nspname = 'public' AND cl.relkind = 'r'
        ), pol AS (
          SELECT tablename,
                 COUNT(*)::int AS policies,
                 BOOL_OR(COALESCE(qual,'') || COALESCE(with_check,'') ~ 'org_id') AS isolated
          FROM pg_policies WHERE schemaname = 'public' GROUP BY tablename
        )
        SELECT s.table_name, s.rls, COALESCE(p.policies,0) AS policies,
               COALESCE(p.isolated,false) AS isolated
        FROM sensibles s LEFT JOIN pol p ON p.tablename = s.table_name
        WHERE NOT s.rls OR COALESCE(p.policies,0) = 0 OR NOT COALESCE(p.isolated,false)
        ORDER BY s.table_name
      `);
      const failing = (r.rows as Array<{ table_name: string; rls: boolean; policies: number; isolated: boolean }>)
        .map((x) => `${x.table_name}(rls=${x.rls},policies=${x.policies},isolated=${x.isolated})`);
      expect(failing, `tables sensibles non isolees : ${failing.join(", ")}`).toEqual([]);

      // Garde-fou : la requete doit bien voir des tables sensibles, sinon
      // l'assertion ci-dessus passerait pour une raison vide.
      const total = await c.query(
        `SELECT COUNT(DISTINCT table_name)::int AS n FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'org_id'`);
      expect((total.rows[0] as { n: number }).n).toBeGreaterThan(50);
    } finally { c.release(); }
  });
});
