/**
 * rls-cross-org-isolation-db.test.ts — C-08
 *
 * Isolation entre organisations, mesuree sur la base PostgreSQL de la CI avec le
 * role applicatif `app_user` (NOSUPERUSER, NOBYPASSRLS) atteint comme en
 * production-cible : `withOrgDb()` = BEGIN, GUC `app.current_org_id`, `SET LOCAL ROLE app_user`.
 *
 * Pour CHAQUE table de locataire (colonne org_id + RLS + policies tenant_*) :
 *   - des lignes des organisations A et B sont posees par le role de connexion ;
 *   - sous withOrgDb(A) : on ne voit AUCUNE ligne de B ; on ne peut ni modifier, ni
 *     supprimer, ni inserer une ligne de B ;
 *   - sans GUC (requete non scopee) : on ne voit AUCUNE ligne.
 *
 * Le premier test echoue bruyamment si `SET ROLE app_user` est indisponible : sans
 * bascule de role, le role de connexion superuser contourne RLS et tous les tests
 * suivants « passeraient » sans rien prouver (c'est exactement le defaut C-08).
 *
 * LIMITE ASSUMEE : ce test couvre les acces via orgDb/withOrgDb. Les acces
 * `pool.query` bruts ne sont PAS soumis a RLS (voir pool-query-inventory.test.ts).
 */
import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);
vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

import { pool, withOrgDb, probeAppUserRole, getRlsEnforcementStatus } from "@workspace/db";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const ORG_C = randomUUID();

interface TenantTable { name: string; columns: Array<{ name: string; type: string; nullable: boolean; hasDefault: boolean }> }

let tables: TenantTable[] = [];
/** Tables dont on a pu poser une ligne A et une ligne B generiquement. */
const testable: TenantTable[] = [];
const skipped: Array<{ table: string; reason: string }> = [];

/** Valeur SQL generique pour une colonne NOT NULL sans defaut ; null = type non gere. */
function literalFor(col: { name: string; type: string }, org: string): string | null {
  if (col.name === "org_id") return `'${org}'`;
  switch (col.type) {
    case "text": case "character varying": case "character": case "citext":
      return `'x-' || gen_random_uuid()::text`;
    case "uuid": return `gen_random_uuid()`;
    case "integer": case "bigint": case "smallint": case "numeric": case "double precision": case "real":
      return `0`;
    case "boolean": return `false`;
    case "timestamp with time zone": case "timestamp without time zone": case "date":
      return `now()`;
    case "jsonb": case "json": return `'{}'`;
    case "ARRAY": return `'{}'`;
    default: return null;
  }
}

/**
 * Valeurs imposees par des contraintes que le generateur ne devine pas (unicite,
 * CHECK). La cle de ligne reste unique par appel (gen_random_uuid).
 */
const UNIQ = `'x-' || gen_random_uuid()::text`;
const OVERRIDES: Record<string, Record<string, string>> = {
  custom_domains: { domain: `'x-' || gen_random_uuid()::text || '.example.test'` },
  team_invitations: { token_hash: UNIQ },
  team_members: { id: UNIQ },
  funnel_steps: { position: "1" },
  organic_campaign_goals: { target_position: "1" },
};

function insertSql(t: TenantTable, org: string): string | null {
  const over = OVERRIDES[t.name] ?? {};
  const cols = t.columns.filter((c) => c.name === "org_id" || (!c.nullable && !c.hasDefault) || c.name in over);
  const vals: string[] = [];
  for (const c of cols) {
    const v = over[c.name] ?? literalFor(c, org);
    if (v === null) return null;
    vals.push(v);
  }
  return `INSERT INTO public."${t.name}" (${cols.map((c) => `"${c.name}"`).join(", ")}) VALUES (${vals.join(", ")})`;
}

beforeAll(async () => {
  await probeAppUserRole();

  // Certaines tables ont une cle etrangere org_id -> organizations(id). Les
  // organisations de test sont creees (et retirees en afterAll) ; si la table a
  // un autre schema, l'echec est ignore et ces tables sont simplement listees « ignorees ».
  for (const o of [ORG_A, ORG_B, ORG_C]) {
    await pool.query(`INSERT INTO organizations (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [o, `rls-test-${o.slice(0, 8)}`]).catch(() => {});
  }

  const res = await pool.query<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }>(`
    SELECT c.table_name, c.column_name, c.data_type, c.is_nullable, c.column_default
      FROM information_schema.columns c
      JOIN pg_class k ON k.relname = c.table_name AND k.relkind = 'r'
      JOIN pg_namespace n ON n.oid = k.relnamespace AND n.nspname = 'public'
     WHERE c.table_schema = 'public'
       -- Chantier LEDGER/VAULT/SHIELD : les tables seller_* ne sont ni lues ni ecrites ici.
       AND c.table_name NOT LIKE 'seller\\_%'
       AND k.relrowsecurity
       AND c.table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id')
       AND c.is_generated = 'NEVER'
       AND c.identity_generation IS NULL
     ORDER BY c.table_name, c.ordinal_position`);
  const byTable = new Map<string, TenantTable>();
  for (const r of res.rows) {
    const t = byTable.get(r.table_name) ?? { name: r.table_name, columns: [] };
    t.columns.push({ name: r.column_name, type: r.data_type, nullable: r.is_nullable === "YES", hasDefault: r.column_default !== null });
    byTable.set(r.table_name, t);
  }
  tables = [...byTable.values()];

  for (const t of tables) {
    const a = insertSql(t, ORG_A);
    const b = insertSql(t, ORG_B);
    if (!a || !b) { skipped.push({ table: t.name, reason: "type de colonne non gere" }); continue; }
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SAVEPOINT s");
      try {
        await c.query(a);
        await c.query(b);
        await c.query("RELEASE SAVEPOINT s");
        await c.query("COMMIT");
        testable.push(t);
      } catch (e) {
        await c.query("ROLLBACK").catch(() => {});
        skipped.push({ table: t.name, reason: (e as Error).message.split("\n")[0]! });
      }
    } finally {
      c.release();
    }
  }
}, 120_000);

afterAll(async () => {
  for (const t of tables) {
    await pool.query(`DELETE FROM public."${t.name}" WHERE org_id::text = ANY($1::text[])`, [[ORG_A, ORG_B, ORG_C]]).catch(() => {});
  }
  await pool.query(`DELETE FROM organizations WHERE id::text = ANY($1::text[])`, [[ORG_A, ORG_B, ORG_C]]).catch(() => {});
}, 120_000);

describe("precondition : RLS reellement appliquee dans cet environnement", () => {
  it("SET ROLE app_user fonctionne — sinon ce fichier ne prouve RIEN", () => {
    const s = getRlsEnforcementStatus();
    expect(s.mode, `mode RLS = ${s.mode} (${s.reasons.join("; ")})`).toBe("enforced");
    expect(s.isolationGuaranteed).toBe(true);
  });

  it("le role de transaction est bien app_user, non superuser, sans BYPASSRLS", async () => {
    const r = await withOrgDb(ORG_A, (c) =>
      c.query<{ u: string; su: boolean; by: boolean }>(
        `SELECT current_user AS u, r.rolsuper AS su, r.rolbypassrls AS by FROM pg_roles r WHERE r.rolname = current_user`));
    expect(r.rows[0]).toEqual({ u: "app_user", su: false, by: false });
  });

  it("la couverture est credible : beaucoup de tables de locataire testees", () => {
    console.info(`[rls-isolation] tables de locataire: ${tables.length}, testees: ${testable.length}, ignorees: ${skipped.length} ${JSON.stringify(skipped)}`);
    expect(testable.length, `testees=${testable.length} ignorees=${JSON.stringify(skipped)}`).toBeGreaterThanOrEqual(100);
  });
});

describe("couverture des policies", () => {
  it("toute table portant org_id avec RLS a une policy lue sur le GUC, et ses 4 policies tenant_* si elle en a", async () => {
    const r = await pool.query<{ t: string; guc: number; tenant: number }>(
      `SELECT t.tablename AS t,
              (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename
                  AND (COALESCE(p.qual,'') || COALESCE(p.with_check,'')) LIKE '%app.current_org_id%') AS guc,
              (SELECT count(*)::int FROM pg_policies p WHERE p.schemaname='public' AND p.tablename=t.tablename
                  AND p.policyname IN ('tenant_select','tenant_insert','tenant_update','tenant_delete')) AS tenant
         FROM pg_tables t
        WHERE t.schemaname='public' AND t.rowsecurity
          AND t.tablename NOT LIKE 'seller\\_%'
          AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema='public' AND c.table_name=t.tablename AND c.column_name='org_id')`);
    const incomplete = r.rows
      .filter((x) => x.guc === 0 || (x.tenant > 0 && x.tenant < 4))
      .map((x) => `${x.t}(guc=${x.guc}, tenant=${x.tenant}/4)`);
    expect(incomplete).toEqual([]);
  });
});

describe("isolation inter-organisations via withOrgDb (toutes les tables de locataire)", () => {
  it("ne lit que les lignes de SON organisation", async () => {
    const leaks: string[] = [];
    for (const t of testable) {
      const own = await withOrgDb(ORG_A, (c) => c.query(`SELECT org_id FROM public."${t.name}" WHERE org_id::text = ANY($1::text[])`, [[ORG_A, ORG_B]]));
      const orgs = new Set(own.rows.map((r) => String(r.org_id)));
      if (orgs.has(ORG_B)) leaks.push(`${t.name}: A voit B`);
      if (!orgs.has(ORG_A)) leaks.push(`${t.name}: A ne voit pas ses propres lignes`);
    }
    expect(leaks).toEqual([]);
  });

  it("la meme requete, du point de vue de B, ne montre que B", async () => {
    const leaks: string[] = [];
    for (const t of testable) {
      const own = await withOrgDb(ORG_B, (c) => c.query(`SELECT org_id FROM public."${t.name}" WHERE org_id::text = ANY($1::text[])`, [[ORG_A, ORG_B]]));
      const orgs = new Set(own.rows.map((r) => String(r.org_id)));
      if (orgs.has(ORG_A)) leaks.push(`${t.name}: B voit A`);
    }
    expect(leaks).toEqual([]);
  });

  it("ne peut ni MODIFIER ni SUPPRIMER les lignes d'une autre organisation", async () => {
    const touched: string[] = [];
    for (const t of testable) {
      const upd = await withOrgDb(ORG_A, (c) => c.query(`UPDATE public."${t.name}" SET org_id = org_id WHERE org_id::text = $1`, [ORG_B]));
      if ((upd.rowCount ?? 0) !== 0) touched.push(`${t.name}: UPDATE a touche ${upd.rowCount} ligne(s) de B`);
      const del = await withOrgDb(ORG_A, (c) => c.query(`DELETE FROM public."${t.name}" WHERE org_id::text = $1`, [ORG_B]));
      if ((del.rowCount ?? 0) !== 0) touched.push(`${t.name}: DELETE a supprime ${del.rowCount} ligne(s) de B`);
    }
    expect(touched).toEqual([]);
    // Les lignes de B existent toujours (lues avec le role de connexion).
    for (const t of testable) {
      const r = await pool.query(`SELECT 1 FROM public."${t.name}" WHERE org_id::text = $1`, [ORG_B]);
      expect(r.rowCount, `${t.name}: ligne de B disparue`).toBeGreaterThan(0);
    }
  });

  it("ne peut pas INSERER une ligne au nom d'une autre organisation (WITH CHECK)", async () => {
    const accepted: string[] = [];
    for (const t of testable) {
      const sql = insertSql(t, ORG_B)!;
      try {
        await withOrgDb(ORG_A, (c) => c.query(sql));
        accepted.push(t.name);
      } catch (e) {
        expect((e as { code?: string }).code, `${t.name}: ${(e as Error).message}`).toBe("42501");
      }
    }
    expect(accepted).toEqual([]);
  });

  it("peut inserer dans SA propre organisation", async () => {
    const refused: string[] = [];
    for (const t of testable.slice(0, 10)) {
      try {
        // Organisation neuve : evite les cles primaires portees par org_id.
        await withOrgDb(ORG_C, (c) => c.query(insertSql(t, ORG_C)!));
      } catch (e) { refused.push(`${t.name}: ${(e as Error).message}`); }
    }
    expect(refused).toEqual([]);
  });

  it("sans GUC d'organisation, aucune ligne n'est visible", async () => {
    const visible: string[] = [];
    const c: PoolClient = await pool.connect();
    try {
      for (const t of testable) {
        await c.query("BEGIN");
        await c.query("SET LOCAL ROLE app_user");
        const r = await c.query(`SELECT count(*)::int AS n FROM public."${t.name}"`);
        await c.query("ROLLBACK");
        if (r.rows[0].n !== 0) visible.push(`${t.name}: ${r.rows[0].n}`);
      }
    } finally { c.release(); }
    expect(visible).toEqual([]);
  });

  it("un orgId hostile ne sort pas du GUC (injection par apostrophe)", async () => {
    const hostile = `x' OR '1'='1`;
    const t = testable[0]!;
    const r = await withOrgDb(hostile, (c) => c.query(`SELECT org_id FROM public."${t.name}"`));
    expect(r.rows.filter((row) => row.org_id === ORG_A || row.org_id === ORG_B)).toEqual([]);
  });
});
