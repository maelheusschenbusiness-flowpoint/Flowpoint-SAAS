/**
 * ai-usage-idempotency-schema.ts
 *
 * Source UNIQUE du schéma dont dépend l'idempotence de la facturation IA.
 *
 * recordCompletedUsage() insère dans ai_usage_logs en ON CONFLICT ciblé et
 * n'incrémente ai_monthly_usage que si la ligne a réellement été insérée :
 * sans l'index UNIQUE ci-dessous, un requestId rejoué débiterait les crédits
 * une seconde fois — et, l'ON CONFLICT étant ciblé, son absence fait désormais
 * échouer l'écriture au lieu de la dédoubler silencieusement.
 *
 * Deux initialiseurs créent ce schéma et ne s'exécutent PAS toujours tous les
 * deux : migrate.mjs (Pre-Deploy) enchaîne initDataTables puis initAiMigration,
 * tandis que le démarrage en « fast path » (schéma déjà migré) n'exécute que
 * initAiMigration. Les deux doivent donc produire exactement le même état, d'où
 * cette liste partagée — chaque appelant l'exécute avec SA politique d'erreur
 * (tolérante côté init-data-tables, stricte côté init-ai-migration).
 *
 * Portée de l'unicité : (org_id, idempotency_key), pas idempotency_key seul.
 * ai_usage_logs est en FORCE ROW LEVEL SECURITY avec isolation par org ; un
 * index global rejetterait une insertion à cause d'une ligne invisible au
 * tenant, et deux organisations ayant utilisé la même clé rendent l'index
 * global tout simplement incréable. Voir migrations/019_*.sql.
 */

/** Nom de l'index dont dépend l'idempotence du débit des crédits IA. */
export const AI_USAGE_IDEMPOTENCY_INDEX = "ai_usage_logs_org_idem_uidx";

/** Index global hérité de la migration 016 — remplacé par l'index scopé. */
export const AI_USAGE_IDEMPOTENCY_LEGACY_INDEX = "ai_usage_logs_idempotency_key_idx";

/**
 * DDL idempotent, dans l'ordre. Les doublons déjà présents sont mis en
 * QUARANTAINE et jamais supprimés : la clé de la ligne non canonique est
 * conservée dans idempotency_key_quarantined et tracée dans
 * ai_usage_logs_idempotency_quarantine pour réconciliation manuelle de la
 * facturation passée. Sans cette étape, la création de l'index échouerait sur
 * toute base ayant réellement subi le double débit.
 */
export const AI_USAGE_IDEMPOTENCY_STATEMENTS: ReadonlyArray<{ label: string; sql: string }> = [
  {
    label: "ai_usage_logs.idempotency_key",
    sql: `ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
  },
  {
    label: "ai_usage_logs.idempotency_key_quarantined",
    sql: `ALTER TABLE public.ai_usage_logs ADD COLUMN IF NOT EXISTS idempotency_key_quarantined TEXT`,
  },
  {
    label: "ai_usage_logs_idempotency_quarantine table",
    sql: `
      CREATE TABLE IF NOT EXISTS public.ai_usage_logs_idempotency_quarantine (
        log_id          TEXT PRIMARY KEY,
        org_id          TEXT        NOT NULL,
        idempotency_key TEXT        NOT NULL,
        kept_log_id     TEXT        NOT NULL,
        group_size      INTEGER     NOT NULL,
        quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )`,
  },
  {
    label: "ai_usage_logs duplicate idempotency keys quarantined (no row deleted)",
    sql: `
      WITH ranked AS (
        SELECT id, org_id::text AS org_text, idempotency_key,
               first_value(id) OVER (PARTITION BY org_id, idempotency_key ORDER BY created_at, id) AS kept_id,
               count(*)        OVER (PARTITION BY org_id, idempotency_key)                        AS group_size
        FROM public.ai_usage_logs WHERE idempotency_key IS NOT NULL
      ),
      losers AS (SELECT * FROM ranked WHERE group_size > 1 AND id <> kept_id),
      -- Une CTE modifiante est exécutée exactement une fois et jusqu'au bout,
      -- qu'elle soit référencée ou non par la requête principale.
      trace AS (
        INSERT INTO public.ai_usage_logs_idempotency_quarantine
          (log_id, org_id, idempotency_key, kept_log_id, group_size)
        SELECT id, org_text, idempotency_key, kept_id, group_size FROM losers
        ON CONFLICT (log_id) DO NOTHING
        RETURNING log_id
      )
      UPDATE public.ai_usage_logs AS l
         SET idempotency_key_quarantined = COALESCE(l.idempotency_key_quarantined, l.idempotency_key),
             idempotency_key             = NULL
        FROM losers
       WHERE l.id = losers.id`,
  },
  {
    label: `${AI_USAGE_IDEMPOTENCY_INDEX} (unicité du rejeu, scopée à l'org)`,
    sql: `
      CREATE UNIQUE INDEX IF NOT EXISTS ${AI_USAGE_IDEMPOTENCY_INDEX}
        ON public.ai_usage_logs (org_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL`,
  },
  {
    label: `${AI_USAGE_IDEMPOTENCY_LEGACY_INDEX} dropped (global index replaced)`,
    sql: `DROP INDEX IF EXISTS public.${AI_USAGE_IDEMPOTENCY_LEGACY_INDEX}`,
  },
];

/** true si l'index d'idempotence est bien en place. */
export async function aiUsageIdempotencyIndexExists(
  client: { query: (sql: string) => Promise<{ rows: Array<Record<string, unknown>> }> },
): Promise<boolean> {
  const res = await client.query(
    `SELECT count(*)::text AS n FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'ai_usage_logs'
        AND indexname = '${AI_USAGE_IDEMPOTENCY_INDEX}'`
  );
  return Number(res.rows[0]?.["n"] ?? 0) > 0;
}
