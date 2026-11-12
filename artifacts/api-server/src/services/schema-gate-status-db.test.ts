/**
 * schema-gate-status-db.test.ts
 *
 * La porte de deploiement (migrate.mjs) refuse une base dont l'isolation est
 * incomplete. Encore faut-il savoir si elle a tourne.
 *
 * Constat du 13/10/2026 sur le service de production : aucune commande
 * Pre-Deploy n'est configuree, et le serveur journalise pourtant a chaque
 * demarrage « Schema already migrated — skipping full init (Pre-Deploy
 * completed) ». Ce chemin est choisi sur un seul signal — la table `audits`
 * existe — qui ne dit rien de migrate.mjs. Un operateur lisant ce journal
 * conclut l'inverse de la realite.
 *
 * Ces tests fixent trois choses, sur PostgreSQL reel :
 *   1. l'estampille distingue « la porte a reussi » de « ce bloc de DDL est
 *      passe », que init-data-tables ecrit deja dans la meme table ;
 *   2. l'audit d'isolation detecte reellement une table non isolee — verifie
 *      en creant la table dans une transaction annulee, donc sans toucher la
 *      base ;
 *   3. la sonde de demarrage ne leve jamais, meme base injoignable : elle
 *      observe, elle ne decide pas.
 */

import { vi, describe, it, expect, afterAll } from "vitest";

vi.mock("@workspace/db", async (importOriginal) =>
  importOriginal<typeof import("@workspace/db")>()
);

const warnings: unknown[][] = [];
vi.mock("../lib/logger.js", () => ({
  logger: {
    warn: (...a: unknown[]) => { warnings.push(a); },
    info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
  },
}));

import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  SCHEMA_GATE_MIGRATION_ID,
  stampSchemaGate,
  readSchemaGate,
  auditTenantIsolation,
  reportSchemaGateStatus,
} from "./schema-gate-status.js";

afterAll(async () => {
  await pool
    .query(`DELETE FROM schema_migrations WHERE migration_id = $1`, [SCHEMA_GATE_MIGRATION_ID])
    .catch(() => {});
});

describe("estampille de la porte", () => {
  it("l'identifiant est distinct des blocs de migration ordinaires", () => {
    // init-data-tables ecrit des identifiants de blocs dans la meme table.
    // « ce bloc est passe » et « la porte complete a reussi » ne sont pas la
    // meme garantie : le prefixe les separe.
    expect(SCHEMA_GATE_MIGRATION_ID.startsWith("__gate__")).toBe(true);
  });

  it("avant toute execution, la porte est inconnue", async () => {
    await pool.query(`DELETE FROM schema_migrations WHERE migration_id = $1`, [SCHEMA_GATE_MIGRATION_ID]);
    expect(await readSchemaGate(pool)).toBeNull();
  });

  it("apres estampillage, l'horodatage est lisible", async () => {
    await stampSchemaGate(pool);
    const ranAt = await readSchemaGate(pool);
    expect(ranAt).toBeInstanceOf(Date);
    expect(Date.now() - (ranAt as Date).getTime()).toBeLessThan(60_000);
  });

  it("un rejeu met l'horodatage a jour sans dupliquer la ligne", async () => {
    await stampSchemaGate(pool);
    await stampSchemaGate(pool);
    const res = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM schema_migrations WHERE migration_id = $1`,
      [SCHEMA_GATE_MIGRATION_ID]
    );
    expect(Number(res.rows[0]?.n)).toBe(1);
  });
});

describe("audit d'isolation en lecture seule", () => {
  it("detecte une table portant org_id sans RLS — et rien n'est ecrit en base", async () => {
    const table = `gate_probe_${randomUUID().slice(0, 8)}`;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`CREATE TABLE ${table} (id serial PRIMARY KEY, org_id text NOT NULL)`);
      const gaps = await auditTenantIsolation({
        query: (sql: string, params?: unknown[]) => client.query(sql, params as never[]) as never,
      });
      const found = gaps.find((g) => g.table === table);
      expect(found).toBeDefined();
      expect(found!.rls).toBe(false);
      expect(found!.isolated).toBe(false);
    } finally {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    // La table n'existe plus : l'audit n'a rien laisse derriere lui.
    const after = await pool.query<{ present: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${table}`]
    );
    expect(after.rows[0]?.present).toBe(false);
  });

  it("une table correctement isolee n'est pas signalee", async () => {
    const gaps = await auditTenantIsolation(pool);
    // org_settings est isolee par la passe RLS : si elle apparait, l'audit
    // signale a tort, ou la base a un vrai probleme — les deux doivent se voir.
    expect(gaps.map((g) => g.table)).not.toContain("org_settings");
  });
});

describe("sonde de demarrage — elle observe, elle ne decide pas", () => {
  it("avertit quand la porte n'a jamais tourne", async () => {
    await pool.query(`DELETE FROM schema_migrations WHERE migration_id = $1`, [SCHEMA_GATE_MIGRATION_ID]);
    warnings.length = 0;
    await reportSchemaGateStatus(pool);
    const texts = warnings.map((w) => JSON.stringify(w));
    expect(texts.some((t) => t.includes("n'a JAMAIS tourne"))).toBe(true);
  });

  it("ne leve jamais, meme avec une base injoignable", async () => {
    const broken = {
      query: () => Promise.reject(Object.assign(new Error("down"), { code: "ECONNREFUSED" })),
    };
    await expect(reportSchemaGateStatus(broken as never)).resolves.toBeUndefined();
  });
});
