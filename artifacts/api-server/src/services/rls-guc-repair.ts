/**
 * Une policy ne protege que si elle lit la variable que l'application pose.
 *
 * `withOrgDb()` ouvre chaque transaction par
 *   SET LOCAL "app.current_org_id" = '<org>'
 * puis, quand le role le permet, bascule sur `app_user` pour que RLS
 * s'applique. Les policies doivent donc lire `app.current_org_id`. Quatre-
 * vingt-cinq d'entre elles le font. Trois lisaient
 * `current_setting('app.org_id')` — une variable que personne ne pose jamais.
 *
 * Mesure en environnement certifie, une ligne inseree, lue sous `app_user` :
 *
 *   GUC posee par l'application (app.current_org_id) → 0 ligne sur 1
 *   GUC attendue par la policy   (app.org_id)        → 1 ligne sur 1
 *
 * Tant que `SET ROLE app_user` echoue — c'est le cas en production, le
 * connecteur n'etant pas membre du role — la divergence est invisible : le
 * pool superuser contourne RLS. Le jour ou le role devient utilisable, ces
 * tables deviennent silencieusement vides pour l'application et refusent les
 * ecritures. C'est le genre de defaut qui attend une correction de securite
 * pour se declencher.
 *
 * `ai_recommendations` portait la meme policy fautive, mais aussi les
 * `tenant_*` correctes : les policies permissives se combinent en OU, elle
 * n'etait donc pas cassee. Elle est corrigee quand meme — laisser une policy
 * branchee sur une variable morte, c'est laisser croire qu'elle protege.
 *
 * Les CREATE POLICY d'origine sont gardes par `IF NOT EXISTS` : corriger le SQL
 * ne repare aucune base existante, puisque la policy fautive est deja la. D'ou
 * la reparation explicite ci-dessous, appelee par le chemin de schema.
 */

import { logger } from "../lib/logger.js";

/** La seule variable que `withOrgDb()` pose. */
export const TENANT_GUC = "app.current_org_id";

export type Queryable = {
  query: (
    sql: string,
    params?: unknown[]
  ) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number | null }>;
};

type KnownPolicy = {
  table: string;
  policy: string;
  /** La policy controle-t-elle aussi les ecritures (WITH CHECK) ? */
  withCheck: boolean;
};

/**
 * Les policies a reparer, nommement. Rien n'est reecrit a partir du texte des
 * catalogues : reconstruire une policy arbitraire depuis son predicat est le
 * genre d'astuce qui casse ce qu'elle pretend reparer. Toute divergence hors de
 * cette liste est detectee et signalee, pas modifiee.
 */
export const KNOWN_MISALIGNED: readonly KnownPolicy[] = [
  { table: "usage_events",            policy: "usage_events_org_isolation",       withCheck: true  },
  { table: "ai_usage_pending_writes", policy: "org_isolation",                    withCheck: false },
  { table: "ai_recommendations",      policy: "ai_recommendations_org_isolation",  withCheck: false },
];

export type MisalignedPolicy = {
  table: string;
  policy: string;
  predicate: string;
  /** La table a-t-elle, par ailleurs, une policy branchee sur la bonne GUC ? */
  alsoCorrectlyIsolated: boolean;
};

/**
 * Toute policy qui lit une variable `app.*` autre que celle de l'application.
 * `alsoCorrectlyIsolated` separe ce qui est casse de ce qui est seulement
 * trompeur : les policies permissives se combinent en OU.
 */
export async function findMisalignedOrgPolicies(db: Queryable): Promise<MisalignedPolicy[]> {
  const res = await db.query(
    `WITH p AS (
       SELECT tablename, policyname,
              COALESCE(qual,'') || ' ' || COALESCE(with_check,'') AS predicat
         FROM pg_policies WHERE schemaname = 'public'
     ), correctes AS (
       SELECT DISTINCT tablename FROM p WHERE predicat LIKE '%' || $1 || '%'
     )
     SELECT p.tablename, p.policyname, p.predicat,
            (c.tablename IS NOT NULL) AS aussi_correcte
       FROM p LEFT JOIN correctes c ON c.tablename = p.tablename
      WHERE p.predicat LIKE '%current_setting(''app.%'
        AND p.predicat NOT LIKE '%' || $1 || '%'
      ORDER BY p.tablename, p.policyname`,
    [TENANT_GUC]
  );
  return res.rows.map((r) => ({
    table: String(r["tablename"]),
    policy: String(r["policyname"]),
    predicate: String(r["predicat"]).trim(),
    alsoCorrectlyIsolated: r["aussi_correcte"] === true,
  }));
}

/**
 * Repose les policies connues sur la bonne variable. Idempotent : une policy
 * deja correcte n'est pas touchee, une table absente est ignoree — ces deux
 * tables sont creees paresseusement, au premier usage.
 */
export async function repairOrgGucPolicies(db: Queryable): Promise<{ repaired: string[] }> {
  const repaired: string[] = [];

  for (const known of KNOWN_MISALIGNED) {
    try {
      const existing = await db.query(
        `SELECT COALESCE(qual,'') || ' ' || COALESCE(with_check,'') AS predicat
           FROM pg_policies
          WHERE schemaname = 'public' AND tablename = $1 AND policyname = $2`,
        [known.table, known.policy]
      );
      const predicate = existing.rows[0]?.["predicat"];
      if (predicate === undefined) continue;                       // policy absente
      if (String(predicate).includes(TENANT_GUC)) continue;        // deja correcte

      const using = `(org_id = current_setting('${TENANT_GUC}', true))`;
      await db.query(`DROP POLICY IF EXISTS "${known.policy}" ON public."${known.table}"`);
      await db.query(
        `CREATE POLICY "${known.policy}" ON public."${known.table}" ` +
        `USING ${using}` + (known.withCheck ? ` WITH CHECK ${using}` : "")
      );
      repaired.push(`${known.table}.${known.policy}`);
      logger.info({ table: known.table, policy: known.policy, guc: TENANT_GUC },
        "[rls-guc] policy reposee sur la variable que l'application pose");
    } catch (err) {
      // Une reparation de policy ne doit pas faire echouer la pose du schema :
      // l'etat d'avant est fail-closed (la policy refuse tout), pas ouvert.
      logger.error({ err, table: known.table, policy: known.policy },
        "[rls-guc] reparation impossible — la policy reste branchee sur une variable morte");
    }
  }

  // Ce qui reste est hors de la liste connue : on le signale, on n'y touche pas.
  try {
    const residuel = await findMisalignedOrgPolicies(db);
    for (const m of residuel) {
      const niveau = m.alsoCorrectlyIsolated ? "warn" : "error";
      logger[niveau]({ table: m.table, policy: m.policy, predicate: m.predicate },
        m.alsoCorrectlyIsolated
          ? "[rls-guc] policy branchee sur une variable que l'application ne pose pas — table isolee par ailleurs"
          : "[rls-guc] policy branchee sur une variable que l'application ne pose pas — table INVISIBLE sous app_user");
    }
  } catch (err) {
    logger.warn({ err }, "[rls-guc] detection des divergences indisponible");
  }

  return { repaired };
}
