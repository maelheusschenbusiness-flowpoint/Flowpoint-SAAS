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

  it("CONTROLE NEGATIF — avec l'ancienne variable, app_user ne verrait rien", async () => {
    // Refait exactement la situation d'avant : la policy lit app.org_id, que
    // l'application ne pose pas. Sans ce controle, les tests ci-dessus
    // pourraient passer pour une raison etrangere a la correction.
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`DROP POLICY IF EXISTS "usage_events_org_isolation" ON usage_events`);
      await c.query(`CREATE POLICY "usage_events_org_isolation" ON usage_events
                       USING (org_id = current_setting('app.org_id', true))
                       WITH CHECK (org_id = current_setting('app.org_id', true))`);
      await c.query(`INSERT INTO usage_events (org_id, kind) VALUES ($1,'audit_created')`, [ORG_A]);
      await c.query(`SET LOCAL "${TENANT_GUC}" = '${ORG_A}'`);
      await c.query("SET LOCAL ROLE app_user");
      const r = await c.query<{ n: number }>(`SELECT count(*)::int AS n FROM usage_events`);
      expect(r.rows[0]!.n).toBe(0);     // la ligne existe, la policy ne la voit pas
    } finally {
      await c.query("ROLLBACK").catch(() => {});
      c.release();
    }
    // La policy correcte est toujours en place apres l'annulation.
    const res = await pool.query<{ predicat: string }>(
      `SELECT COALESCE(qual,'') AS predicat FROM pg_policies
        WHERE tablename='usage_events' AND policyname='usage_events_org_isolation'`
    );
    expect(res.rows[0]!.predicat).toContain(TENANT_GUC);
  });
});
