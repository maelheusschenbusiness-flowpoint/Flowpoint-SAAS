-- 019_ai_usage_logs_idempotency_org_scope.sql
--
-- PROBLÈME CORRIGÉ
-- recordCompletedUsage() insère dans ai_usage_logs avec `ON CONFLICT DO NOTHING`
-- et n'incrémente ai_monthly_usage que si la ligne a réellement été insérée.
-- Toute l'idempotence de la facturation IA repose donc sur un index UNIQUE
-- portant sur la clé d'idempotence (ai_usage_logs.idempotency_key).
-- Or cet index n'existe dans aucune base réellement déployée :
--   * init-data-tables.ts (seul schéma appliqué en production — voir
--     "migrations/*.sql don't auto-run in prod") ne le créait pas ;
--   * la migration 016 le créait, mais globalement et sans jamais être exécutée.
-- Conséquence : un rejeu du même requestId insérait une 2e ligne et
-- re-incrémentait l'agrégat → crédits IA débités deux fois.
--
-- PORTÉE DE L'UNICITÉ : (org_id, idempotency_key), pas idempotency_key seul.
--   1. ai_usage_logs est en FORCE ROW LEVEL SECURITY avec isolation par org.
--      Un index global rejetterait une insertion à cause d'une ligne invisible
--      au tenant : la consommation d'une org serait silencieusement perdue
--      (ON CONFLICT DO NOTHING) à cause d'une autre org.
--   2. Les crédits sont comptés par organisation : un double débit n'a de sens
--      qu'à l'intérieur d'une org.
--   3. Le chemin de reprise déjà en place lit la clé en la scopant à l'org
--      (routes/ai.ts : WHERE org_id::text = $1 AND idempotency_key = $2) ;
--      une collision inter-org y serait indétectable.
--   4. Cohérent avec ai_monthly_usage UNIQUE (org_id, month).
--
-- DOUBLONS HISTORIQUES — AUCUNE DONNÉE N'EST SUPPRIMÉE
-- Les bases existantes peuvent déjà contenir des doublons (c'est exactement le
-- défaut corrigé ici). Créer l'index échouerait. La migration met donc en
-- quarantaine les doublons au lieu de les détruire :
--   * aucune ligne n'est supprimée, aucun crédit déjà compté n'est recalculé ;
--   * la clé des lignes non canoniques est déplacée dans
--     idempotency_key_quarantined (valeur conservée, index partiel l'ignore) ;
--   * chaque déplacement est tracé dans ai_usage_logs_idempotency_quarantine
--     pour audit et réconciliation manuelle de la facturation passée.
-- La ligne conservée dans chaque groupe est la plus ancienne (created_at, id).

BEGIN;

ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

ALTER TABLE ai_usage_logs
  ADD COLUMN IF NOT EXISTS idempotency_key_quarantined TEXT;

CREATE TABLE IF NOT EXISTS ai_usage_logs_idempotency_quarantine (
  log_id          TEXT PRIMARY KEY,
  org_id          TEXT        NOT NULL,
  idempotency_key TEXT        NOT NULL,
  kept_log_id     TEXT        NOT NULL,
  group_size      INTEGER     NOT NULL,
  quarantined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Quarantaine des doublons (org_id, idempotency_key) ──────────────────────
WITH ranked AS (
  SELECT id,
         org_id::text AS org_text,
         idempotency_key,
         first_value(id) OVER (
           PARTITION BY org_id, idempotency_key ORDER BY created_at, id
         ) AS kept_id,
         count(*) OVER (PARTITION BY org_id, idempotency_key) AS group_size
  FROM ai_usage_logs
  WHERE idempotency_key IS NOT NULL
),
losers AS (
  SELECT * FROM ranked WHERE group_size > 1 AND id <> kept_id
),
-- Une CTE modifiante est exécutée exactement une fois et jusqu'au bout,
-- qu'elle soit référencée ou non par la requête principale.
trace AS (
  INSERT INTO ai_usage_logs_idempotency_quarantine
    (log_id, org_id, idempotency_key, kept_log_id, group_size)
  SELECT id, org_text, idempotency_key, kept_id, group_size FROM losers
  ON CONFLICT (log_id) DO NOTHING
  RETURNING log_id
)
UPDATE ai_usage_logs AS l
   SET idempotency_key_quarantined = COALESCE(l.idempotency_key_quarantined, l.idempotency_key),
       idempotency_key             = NULL
  FROM losers
 WHERE l.id = losers.id;

-- ── L'index qui rend le rejeu réellement idempotent ─────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_logs_org_idem_uidx
  ON ai_usage_logs (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- L'index global de la migration 016 (jamais appliqué en production) est
-- remplacé : il exposait la table RLS aux collisions inter-org décrites ci-dessus.
DROP INDEX IF EXISTS ai_usage_logs_idempotency_key_idx;

COMMIT;

-- Vérification post-migration (lecture seule) :
--   SELECT count(*) FROM ai_usage_logs_idempotency_quarantine;
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'ai_usage_logs_org_idem_uidx';
