-- avant-apres-lecture-seule.sql — comparaison AVANT/APRES du tunnel, LECTURE SEULE.
--
-- Usage (base de lecture, jamais d'ecriture) :
--   psql "$DATABASE_URL" -v change="'2026-12-01'" -v days=7 \
--        -f artifacts/api-server/tools/conversion/avant-apres-lecture-seule.sql
--
--   change : date de mise en production du changement (UTC), premier jour « apres ».
--   days   : longueur de chaque fenetre, en jours (7 par defaut recommande).
--
-- Fenetres : avant = [change - days, change), apres = [change, change + days), UTC.
-- Une fenetre « apres » encore en cours est lue telle quelle (jours a venir = 0) ;
-- l'endpoint GET /api/admin/conversion/before-after la declare `complete: false`,
-- ce script ne le fait pas : comparer la colonne `fin` a l'heure de la lecture.
--
-- Resultat 1 : famille CONSENTEMENT — visiteurs distincts par etape (dedup
--   visiteur+etape) et cohorte « a aussi l'etape precedente ». Visiteurs de test
--   (fp-test-*) exclus. Aucun identifiant n'est affiche, seulement des comptes.
-- Resultat 2 : famille TRANSACTIONNELLE — evenements Stripe distincts (cle
--   d'idempotence), pour tout le monde. Ne s'additionne pas au resultat 1.
-- Methode et limites : docs/CONVERSION-COMPARAISON-AVANT-APRES.md
--
-- Aucune ecriture : transaction READ ONLY, ni DDL ni DML.

\set ON_ERROR_STOP on
BEGIN READ ONLY;
SET LOCAL TIME ZONE 'UTC';

WITH p AS (SELECT :change::date AS change, :days::int AS days),
fen AS (
  SELECT 'avant' AS fenetre, (change - days)::timestamptz AS debut, change::timestamptz AS fin FROM p
  UNION ALL
  SELECT 'apres', change::timestamptz, (change + days)::timestamptz FROM p
),
v AS (
  SELECT w.fenetre, f.visiteur_id, array_agg(DISTINCT f.etape) AS e
    FROM fen w
    JOIN funnel_events f
      ON f.created_at >= w.debut AND f.created_at < w.fin
     AND f.visiteur_id IS NOT NULL AND f.visiteur_id NOT LIKE 'fp-test-%'
     AND f.etape IN ('tarifs_vus','cta_clique','signup_started','signup_submitted',
                     'signup_form_completed','checkout_started','checkout_completed')
   GROUP BY w.fenetre, f.visiteur_id
)
SELECT fen.fenetre, fen.debut::date AS debut, fen.fin::date AS fin,
       count(*) FILTER (WHERE 'tarifs_vus' = ANY(v.e))                                            AS tarifs_vus,
       count(*) FILTER (WHERE 'cta_clique' = ANY(v.e))                                            AS cta_clique,
       count(*) FILTER (WHERE 'cta_clique' = ANY(v.e) AND 'tarifs_vus' = ANY(v.e))                AS cta_apres_tarifs,
       count(*) FILTER (WHERE 'signup_started' = ANY(v.e))                                        AS signup_started,
       count(*) FILTER (WHERE 'signup_started' = ANY(v.e) AND 'cta_clique' = ANY(v.e))            AS started_apres_cta,
       count(*) FILTER (WHERE 'signup_submitted' = ANY(v.e))                                      AS signup_submitted,
       count(*) FILTER (WHERE 'signup_form_completed' = ANY(v.e))                                 AS signup_form_completed,
       count(*) FILTER (WHERE 'signup_form_completed' = ANY(v.e) AND 'signup_started' = ANY(v.e)) AS completed_apres_started,
       count(*) FILTER (WHERE 'checkout_started' = ANY(v.e))                                      AS checkout_started,
       count(*) FILTER (WHERE 'checkout_started' = ANY(v.e) AND 'signup_form_completed' = ANY(v.e)) AS checkout_apres_completed,
       count(*) FILTER (WHERE 'checkout_completed' = ANY(v.e))                                    AS checkout_completed,
       count(*) FILTER (WHERE 'checkout_completed' = ANY(v.e) AND 'checkout_started' = ANY(v.e)) AS paiement_apres_checkout
  FROM fen LEFT JOIN v USING (fenetre)
 GROUP BY fen.fenetre, fen.debut, fen.fin
 ORDER BY fen.fenetre;

WITH p AS (SELECT :change::date AS change, :days::int AS days),
fen AS (
  SELECT 'avant' AS fenetre, (change - days)::timestamptz AS debut, change::timestamptz AS fin FROM p
  UNION ALL
  SELECT 'apres', change::timestamptz, (change + days)::timestamptz FROM p
)
SELECT fen.fenetre, f.etape,
       count(DISTINCT COALESCE(f.cle_idempotence, f.id::text)) AS evenements,
       count(DISTINCT COALESCE(f.cle_idempotence, f.id::text)) FILTER (WHERE f.visiteur_id IS NOT NULL) AS relies_a_un_visiteur_consenti
  FROM fen
  JOIN funnel_events f
    ON f.created_at >= fen.debut AND f.created_at < fen.fin
   AND (f.visiteur_id IS NULL OR f.visiteur_id NOT LIKE 'fp-test-%')
   AND f.etape IN ('trial_activated','subscription_activated','payment_succeeded')
 GROUP BY fen.fenetre, f.etape
 ORDER BY fen.fenetre, f.etape;

ROLLBACK;
