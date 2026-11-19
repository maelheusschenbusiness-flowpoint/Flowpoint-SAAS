-- diagnostic-rejets-outbox-lecture-seule.sql — rejets 400 vers AI Lab, LECTURE SEULE.
--
-- A lancer sur la base du SaaS qui emet (flowpoint-test, puis production), jamais
-- pour modifier : transaction READ ONLY. Aucun fp_lid n'est lu (la colonne est
-- effacee a la cloture d'une ligne, et n'est de toute facon pas selectionnee).
--
--   psql "$DATABASE_URL" -v jours=7 -f artifacts/api-server/tools/conversion/diagnostic-rejets-outbox-lecture-seule.sql
--
-- Lecture des resultats :
--  1. Par etape et par statut : combien de jalons distincts, combien d'appels
--     (attempts) — un jalon refuse en 400 est rejoue 5 fois (15/60/180/360 min),
--     donc N rejets comptes cote AI Lab = environ N/5 jalons distincts.
--  2. Cadence des rejets 400 epuises par jour : un pic isole suit un run de
--     certification ; un flux continu est un probleme de synchronisation reel.
--  3. Inscriptions reelles portant un fp_lid vs jalons `signup` livres : l'ecart
--     est la perte d'attribution reelle (a lire hors comptes de test).

\set ON_ERROR_STOP on
BEGIN READ ONLY;

\echo '1. Jalons par etape et statut'
SELECT stage, status, coalesce(last_status, '') AS dernier_statut,
       count(*) AS jalons_distincts, sum(attempts) AS appels, min(created_at)::date AS du, max(created_at)::date AS au
  FROM conversion_event_outbox
 WHERE created_at >= now() - make_interval(days => :jours)
 GROUP BY stage, status, last_status
 ORDER BY stage, status, last_status;

\echo '2. Rejets 400 epuises, par jour et par etape'
SELECT closed_at::date AS jour, stage, count(*) AS jalons_abandonnes, sum(attempts) AS appels
  FROM conversion_event_outbox
 WHERE last_status = 'rejected:400:exhausted' AND closed_at >= now() - make_interval(days => :jours)
 GROUP BY 1, 2 ORDER BY 1, 2;

\echo '3. Inscriptions avec fp_lid (organisations creees) vs jalons signup livres'
SELECT (SELECT count(*) FROM organizations
         WHERE created_at >= now() - make_interval(days => :jours) AND fp_lid IS NOT NULL) AS organisations_avec_fp_lid,
       (SELECT count(*) FROM conversion_event_outbox
         WHERE stage = 'signup' AND status = 'delivered' AND created_at >= now() - make_interval(days => :jours)) AS jalons_signup_livres,
       (SELECT count(*) FROM conversion_event_outbox
         WHERE stage = 'signup' AND status = 'rejected' AND last_status = 'rejected:400:exhausted'
           AND created_at >= now() - make_interval(days => :jours)) AS jalons_signup_abandonnes_400;

ROLLBACK;
