/**
 * La porte de deploiement a-t-elle tourne sur cette base ?
 *
 * migrate.mjs pose le schema, durcit RLS et refuse la migration quand une
 * table portant org_id n'est pas isolee ou qu'une table d'identite manque.
 * C'est la porte. Mesure du 13/10/2026 sur le service de production :
 *
 *   - aucune commande Pre-Deploy n'est configuree sur le service Render ;
 *   - le serveur journalise pourtant, a chaque demarrage,
 *       « [startup] Schema already migrated — skipping full init
 *          (Pre-Deploy completed) »
 *     alors que ce chemin est choisi sur un seul signal : l'existence de la
 *     table `audits`. Elle existe depuis des mois. Le message affirme donc
 *     quelque chose qui n'a jamais eu lieu.
 *
 * Consequence : l'audit d'isolation et le durcissement RLS ne tournent jamais
 * en production, et rien ne le dit. Un operateur qui lit les journaux conclut
 * l'inverse de la realite.
 *
 * Ce module ne change aucun comportement de schema. Il rend l'etat observable :
 *
 *  1. migrate.mjs estampille la base quand il a reussi — un marqueur distinct
 *     des identifiants de blocs que init-data-tables ecrit deja dans la meme
 *     table ;
 *  2. le demarrage lit cet horodatage et le journalise, en WARN quand la porte
 *     n'a jamais tourne ;
 *  3. le demarrage rejoue l'audit d'isolation en LECTURE SEULE et journalise ce
 *     que la porte aurait refuse — sans jamais refuser de demarrer. Un serveur
 *     qui s'arrete sur un ecart d'isolation ferait tomber un service en ligne ;
 *     la porte, elle, peut refuser, parce qu'elle tourne avant la mise en ligne.
 */

import { logger } from "../lib/logger.js";

/** Le strict minimum attendu d'un pool ou d'un client pg. */
export type Queryable = {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

/**
 * Marqueur de la porte, dans la table que init-data-tables tient deja. Le
 * prefixe `__gate__` le distingue des identifiants de blocs de migration :
 * ceux-la disent « ce bloc de DDL est passe », celui-ci dit « la porte
 * complete a reussi », ce qui n'est pas la meme garantie.
 */
export const SCHEMA_GATE_MIGRATION_ID = "__gate__/migrate.mjs";

/** Appele par migrate.mjs, et seulement par lui, apres un succes complet. */
export async function stampSchemaGate(db: Queryable): Promise<void> {
  await db.query(
    `INSERT INTO schema_migrations (migration_id, executed_at)
     VALUES ($1, NOW())
     ON CONFLICT (migration_id) DO UPDATE SET executed_at = NOW()`,
    [SCHEMA_GATE_MIGRATION_ID]
  );
}

/** `null` = la porte n'a jamais tourne sur cette base. */
export async function readSchemaGate(db: Queryable): Promise<Date | null> {
  try {
    const res = await db.query(
      `SELECT executed_at FROM schema_migrations WHERE migration_id = $1`,
      [SCHEMA_GATE_MIGRATION_ID]
    );
    const value = res.rows[0]?.["executed_at"];
    return value instanceof Date ? value : value ? new Date(String(value)) : null;
  } catch {
    // Table absente : la porte n'a pas tourne, et c'est la seule conclusion utile.
    return null;
  }
}

export type IsolationGap = {
  table: string;
  rls: boolean;
  policies: number;
  isolated: boolean;
};

/**
 * L'audit de migrate.mjs, en lecture seule : toute table portant org_id doit
 * avoir RLS active ET au moins une policy qui isole sur org_id. Un compte de
 * policies ne dirait rien de ce qui est reellement protege.
 */
export async function auditTenantIsolation(db: Queryable): Promise<IsolationGap[]> {
  const res = await db.query(`
    WITH sensibles AS (
      SELECT c.relname AS table_name, c.relrowsecurity AS rls
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN information_schema.columns col
        ON col.table_schema = 'public' AND col.table_name = c.relname AND col.column_name = 'org_id'
      WHERE n.nspname = 'public' AND c.relkind = 'r'
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
  return res.rows.map((r) => ({
    table: String(r["table_name"]),
    rls: r["rls"] === true,
    policies: Number(r["policies"] ?? 0),
    isolated: r["isolated"] === true,
  }));
}

/**
 * Etape de demarrage : dire ce qui est, sans rien refuser.
 *
 * Toute erreur est avalee — une sonde d'observabilite ne doit jamais empecher
 * un service de demarrer. Elle journalise alors son propre echec.
 */
export async function reportSchemaGateStatus(db: Queryable): Promise<void> {
  try {
    const ranAt = await readSchemaGate(db);
    if (ranAt === null) {
      logger.warn(
        { remediation: "Pre-Deploy: cd artifacts/api-server && pnpm run migrate" },
        "[schema-gate] la porte de deploiement (migrate.mjs) n'a JAMAIS tourne sur cette base — " +
        "l'audit d'isolation et le durcissement RLS n'ont donc jamais ete appliques ici"
      );
    } else {
      logger.info({ ranAt: ranAt.toISOString() }, "[schema-gate] derniere execution reussie de migrate.mjs");
    }

    const gaps = await auditTenantIsolation(db);
    if (gaps.length === 0) {
      logger.info("[schema-gate] isolation : toute table portant org_id a RLS active et une policy sur org_id");
      return;
    }
    logger.warn(
      { gaps: gaps.length, tables: gaps.map((g) => g.table) },
      `[schema-gate] ${gaps.length} table(s) portant org_id sans RLS ou sans policy d'isolation — ` +
      "migrate.mjs REFUSERAIT cette base ; le serveur continue de demarrer"
    );
    for (const gap of gaps) {
      logger.warn({ table: gap.table, rls: gap.rls, policies: gap.policies, isolated: gap.isolated },
        "[schema-gate] table sensible non isolee");
    }
  } catch (err) {
    logger.warn({ err }, "[schema-gate] sonde d'observabilite indisponible — demarrage inchange");
  }
}
