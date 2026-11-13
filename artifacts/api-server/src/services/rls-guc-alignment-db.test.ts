/**
 * rls-guc-alignment-db.test.ts
 *
 * Une policy ne protege que si elle lit la variable que l'application pose.
 * `withOrgDb()` pose `app.current_org_id` ; trois policies lisaient
 * `app.org_id`, que personne ne pose. Mesure avant correction, une ligne
 * inseree, lue sous `app_user` :
 *
 *   GUC posee par l'application → 0 ligne sur 1
 *   GUC attendue par la policy  → 1 ligne sur 1
 *
 * La divergence etait invisible tant que `SET ROLE app_user` echoue — le pool
 * superuser contourne RLS. Elle se serait declenchee le jour ou le role devient
 * utilisable, c'est-a-dire au moment meme ou l'on renforce la securite.
 *
 * Les tests exercent les acces sous `app_user` : lecture, ecriture, et
 * isolation entre deux organisations.
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
import {
  TENANT_GUC,
  KNOWN_MISALIGNED,
  findMisalignedOrgPolicies,
  repairOrgGucPolicies,
} from "./rls-guc-repair.js";
import { recordUsageEvent } from "./usage-events.js";

const ORG_SEED = randomUUID();
const ORG_A = randomUUID();
const ORG_B = randomUUID();

/** Le role est-il reellement utilisable ici ? Sinon RLS ne s'applique pas. */
let roleUsable = false;

beforeAll(async () => {
  // recordUsageEvent cree la table au premier usage (creation paresseuse) ;
  // il n'echoue jamais. C'est la voie publique, on ne touche pas aux internes.
  await recordUsageEvent(ORG_SEED, "audit_created");
  await repairOrgGucPolicies(pool);
  const c = await pool.connect();
  try {
    await c.query("SET ROLE app_user");
    await c.query("RESET ROLE");
    roleUsable = true;
  } catch { roleUsable = false; } finally { c.release(); }
});

afterAll(async () => {
  await pool.query(`DELETE FROM usage_events WHERE org_id = ANY($1::text[])`, [[ORG_SEED, ORG_A, ORG_B]]).catch(() => {});
});

/** Une transaction comme withOrgDb en ouvre une : GUC posee, puis bascule de role. */
async function asOrgUser<T>(orgId: string, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(`SET LOCAL "${TENANT_GUC}" = '${orgId}'`);
    await c.query("SET LOCAL ROLE app_user");
    return await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }
}

describe("alignement des policies sur la variable de l'application", () => {
  it("aucune policy ne lit une variable que l'application ne pose pas", async () => {
    const divergentes = await findMisalignedOrgPolicies(pool);
    const cassees = divergentes.filter((d) => !d.alsoCorrectlyIsolated);
    expect(cassees).toEqual([]);
    expect(divergentes).toEqual([]);
  });

  it("les trois policies connues lisent app.current_org_id", async () => {
    for (const known of KNOWN_MISALIGNED) {
      const res = await pool.query<{ predicat: string }>(
        `SELECT COALESCE(qual,'') || ' ' || COALESCE(with_check,'') AS predicat
           FROM pg_policies WHERE schemaname='public' AND tablename=$1 AND policyname=$2`,
        [known.table, known.policy]
      );
      if (res.rowCount === 0) continue;   // table creee paresseusement
      expect(res.rows[0]!.predicat).toContain(TENANT_GUC);
      expect(res.rows[0]!.predicat).not.toMatch(/current_setting\('app\.org_id'/);
    }
  });

  it("la reparation est idempotente — un second passage ne touche rien", async () => {
    const second = await repairOrgGucPolicies(pool);
    expect(second.repaired).toEqual([]);
  });

  it("une policy branchee sur une variable morte est detectee, et nommee", async () => {
    // Posee dans une transaction annulee : la base n'est pas modifiee.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`CREATE TABLE guc_probe (id serial PRIMARY KEY, org_id text NOT NULL)`);
      await c.query(`ALTER TABLE guc_probe ENABLE ROW LEVEL SECURITY`);
      await c.query(`CREATE POLICY guc_probe_iso ON guc_probe USING (org_id = current_setting('app.inexistante', true))`);
      const found = await findMisalignedOrgPolicies({
        query: (sql: string, params?: unknown[]) => c.query(sql, params as never[]) as never,
      });
      const mine = found.find((f) => f.table === "guc_probe");
      expect(mine).toBeDefined();
      expect(mine!.alsoCorrectlyIsolated).toBe(false);
      expect(mine!.predicate).toContain("app.inexistante");
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    const after = await pool.query<{ present: boolean }>(
      `SELECT to_regclass('public.guc_probe') IS NOT NULL AS present`
    );
    expect(after.rows[0]?.present).toBe(false);
  });
});

describe("acces sous app_user — lecture, ecriture, isolation", () => {
  it("le role app_user est utilisable dans cet environnement", () => {
    // Si ce test echoue, les trois suivants ne prouveraient rien : sans
    // bascule de role, le pool superuser contourne RLS et tout « passe ».
    expect(roleUsable, "SET ROLE app_user indisponible — RLS non applicable ici").toBe(true);
  });

  it("app_user ecrit dans son organisation (WITH CHECK satisfait)", async () => {
    const inserted = await asOrgUser(ORG_A, async (c) => {
      const r = await c.query(`INSERT INTO usage_events (org_id, kind) VALUES ($1,'audit_created') RETURNING id`, [ORG_A]);
      return r.rowCount;
    });
    expect(inserted).toBe(1);
  });

  it("app_user relit ce qu'il vient d'ecrire — c'est ce qui etait casse", async () => {
    const seen = await asOrgUser(ORG_A, async (c) => {
      await c.query(`INSERT INTO usage_events (org_id, kind) VALUES ($1,'audit_created')`, [ORG_A]);
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM usage_events`);
      return r.rows[0]!.n;
    });
    expect(seen).toBe(1);
  });

  it("app_user ne voit pas les lignes d'une autre organisation", async () => {
    // Ligne de B posee par le pool (superuser), hors RLS.
    await pool.query(`INSERT INTO usage_events (org_id, kind) VALUES ($1,'audit_created')`, [ORG_B]);
    const vuDepuisA = await asOrgUser(ORG_A, async (c) => {
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM usage_events`);
      return r.rows[0]!.n;
    });
    expect(vuDepuisA).toBe(0);

    const vuDepuisB = await asOrgUser(ORG_B, async (c) => {
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM usage_events`);
      return r.rows[0]!.n;
    });
    expect(vuDepuisB).toBe(1);
  });

  it("app_user ne peut pas ecrire pour une autre organisation", async () => {
    await expect(
      asOrgUser(ORG_A, (c) =>
        c.query(`INSERT INTO usage_events (org_id, kind) VALUES ($1,'audit_created')`, [ORG_B])
      )
    ).rejects.toThrow(/row-level security/i);
  });

  it("CONTROLE NEGATIF — sans la variable que l'application pose, app_user ne voit rien", async () => {
    // Deux controles negatifs, au niveau de la CONFIGURATION reelle : aucune
    // policy n'est touchee. Ils ne dependent donc pas du nombre de policies
    // portees par la table, et c'est ce qui les rend fiables.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`INSERT INTO usage_events (org_id, kind) VALUES ($1,'audit_created')`, [ORG_A]);

      // 1. Aucune variable de tenant posee : la ligne existe, elle reste invisible.
      await c.query("SET LOCAL ROLE app_user");
      const sansGuc = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM usage_events`);
      expect(sansGuc.rows[0]!.n, "une ligne est visible sans variable de tenant").toBe(0);
      await c.query("RESET ROLE");

      // 2. Seule l'ANCIENNE variable est posee : elle ne donne aucun acces.
      await c.query(`SET LOCAL "app.org_id" = '${ORG_A}'`);
      await c.query("SET LOCAL ROLE app_user");
      const ancienne = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM usage_events`);
      expect(ancienne.rows[0]!.n, "l'ancienne variable app.org_id ouvre encore l'acces").toBe(0);
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
  });

  it("CONTROLE NEGATIF — une table dont TOUTES les policies lisent la variable morte ne montre rien", async () => {
    // Refait la situation d'avant la correction. Le piege, et la raison pour
    // laquelle ce controle echouait : les policies PERMISSIVE s'additionnent en
    // OR. Mesure du 14/10/2026 sur une copie de production migree, `usage_events`
    // en portait CINQ — `usage_events_org_isolation` plus les quatre `tenant_*`
    // posees par la passe de durcissement. N'en casser qu'une ne prouvait donc
    // rien : `tenant_select` lisait toujours app.current_org_id et laissait
    // passer la ligne. On les remplace ici TOUTES par une seule, branchee sur la
    // variable morte, ce qui restitue l'intention d'origine du controle.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      const avant = await c.query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='usage_events'`
      );
      expect(avant.rowCount, "aucune policy sur usage_events : le controle ne prouverait rien").toBeGreaterThan(0);
      for (const row of avant.rows) {
        await c.query(`DROP POLICY IF EXISTS "${row.policyname}" ON usage_events`);
      }
      await c.query(`CREATE POLICY "usage_events_org_isolation" ON usage_events
                       USING (org_id = current_setting('app.org_id', true))
                       WITH CHECK (org_id = current_setting('app.org_id', true))`);
      const restantes = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='public' AND tablename='usage_events'`
      );
      expect(restantes.rows[0]!.n, "une policy survivante fausserait le controle").toBe(1);

      await c.query(`INSERT INTO usage_events (org_id, kind) VALUES ($1,'audit_created')`, [ORG_A]);
      await c.query(`SET LOCAL "${TENANT_GUC}" = '${ORG_A}'`);
      await c.query("SET LOCAL ROLE app_user");
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM usage_events`);
      expect(r.rows[0]!.n).toBe(0);     // la ligne existe, la policy ne la voit pas
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    // Les policies d'origine sont toutes revenues apres l'annulation, et la
    // policy nommee lit bien la variable que l'application pose.
    const res = await pool.query<{ predicat: string }>(
      `SELECT COALESCE(qual,'') AS predicat FROM pg_policies
        WHERE tablename='usage_events' AND policyname='usage_events_org_isolation'`
    );
    expect(res.rows[0]!.predicat).toContain(TENANT_GUC);
  });

  it("aucune policy permissive n'ouvre une table portant org_id", async () => {
    // Deux trous reels mesures le 14/10/2026 sur une copie de production :
    //   google_product_connections.tenant_insert : WITH CHECK (true) pour PUBLIC.
    //     SELECT, UPDATE et DELETE isolaient, l'INSERT acceptait n'importe quel
    //     org_id — une organisation pouvait ecrire une ligne attribuee a une autre.
    //   seller_commissions_app_user_all : FOR ALL USING (true) pour app_user.
    //     Les PERMISSIVE s'additionnent en OR : elle annulait les quatre tenant_*
    //     et ouvrait les commissions de toutes les organisations.
    // Le contexte rend ces trous serieux : anon et authenticated disposent des
    // droits DML complets sur 121 tables publiques (defaut Supabase), donc RLS est
    // la seule barriere.
    const r = await pool.query<{ tablename: string; policyname: string; cmd: string }>(
      `SELECT p.tablename, p.policyname, p.cmd
         FROM pg_policies p
         JOIN information_schema.columns c
           ON c.table_schema = 'public' AND c.table_name = p.tablename AND c.column_name = 'org_id'
        WHERE p.schemaname = 'public'
          AND p.permissive = 'PERMISSIVE'
          AND (COALESCE(p.qual,'') = 'true' OR COALESCE(p.with_check,'') = 'true')
        ORDER BY 1, 2`
    );
    const ouvertes = r.rows.map((x) => `${x.tablename}.${x.policyname}[${x.cmd}]`);
    expect(ouvertes, "des policies ouvrent une table portant org_id").toEqual([]);
  });

  it("l'INSERT de google_product_connections exige l'organisation courante", async () => {
    const r = await pool.query<{ with_check: string | null }>(
      `SELECT with_check FROM pg_policies
        WHERE schemaname='public' AND tablename='google_product_connections' AND policyname='tenant_insert'`
    );
    if (r.rowCount === 0) return;           // table absente de cette base
    expect(r.rows[0]!.with_check ?? "").toContain(TENANT_GUC);
    expect(r.rows[0]!.with_check ?? "").not.toBe("true");
  });

  it("aucune policy ne redonne a app_user un acces global aux commissions", async () => {
    const r = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_policies
        WHERE schemaname='public' AND tablename='seller_commissions'
          AND policyname='seller_commissions_app_user_all'`
    );
    expect(r.rows[0]!.n).toBe(0);
  });

  it("toute policy d'isolation de usage_events lit la variable que l'application pose", async () => {
    // Corollaire de ce qui precede : puisque les permissives s'additionnent, il
    // ne suffit pas qu'UNE policy soit correcte — aucune ne doit ouvrir plus.
    const r = await pool.query<{ policyname: string; qual: string | null }>(
      `SELECT policyname, qual FROM pg_policies
        WHERE schemaname='public' AND tablename='usage_events' AND cmd <> 'INSERT'`
    );
    expect(r.rowCount).toBeGreaterThan(0);
    for (const row of r.rows) {
      expect(row.qual ?? "", `${row.policyname} n'isole pas sur ${TENANT_GUC}`).toContain(TENANT_GUC);
    }
  });
});
