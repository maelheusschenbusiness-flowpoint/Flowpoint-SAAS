-- Rapport abandons du tunnel — SQL reproductibles, LECTURE SEULE, agrégés, sans donnée personnelle.
-- Exécuter chaque requête dans une transaction READ ONLY (BEGIN READ ONLY; ... ROLLBACK;).
-- Aucun identifiant de visiteur n'est renvoyé : uniquement des comptages.
-- Fenêtre : :depuis (inclus) et :jusqua (exclu) ; remplacer par des dates, ex. '2026-10-19' et '2026-11-19'.
-- Exclusion des visiteurs de test : préfixes fp-test-, fp-cert- (les parcours de certification UUID ne sont PAS
-- exclusibles par identifiant : voir défaut D6 du rapport).

-- Q1. Volumes par étape : lignes (après déduplication jour) et visiteurs distincts, première/dernière date.
SELECT etape,
       count(*)                      AS lignes,
       count(DISTINCT visiteur_id)   AS visiteurs_distincts,
       count(*) FILTER (WHERE visiteur_id IS NULL) AS lignes_sans_visiteur,
       count(org_ref)                AS lignes_avec_org,
       min(created_at)::date         AS premiere,
       max(created_at)::date         AS derniere
  FROM funnel_events
 WHERE created_at >= :depuis::date AND created_at < :jusqua::date
   AND (visiteur_id IS NULL OR visiteur_id !~* '^fp-(test|cert)-')
 GROUP BY etape
 ORDER BY min(created_at);

-- Q2. Entonnoir de cohorte par visiteur (tarifs -> clic -> inscription -> paiement -> essai).
-- « atteint » = le visiteur a au moins une ligne de l'étape dans la fenêtre (non exigé dans l'ordre).
WITH v AS (
  SELECT visiteur_id,
         bool_or(etape='landing_vue')            AS landing,
         bool_or(etape='tarifs_vus')             AS tarifs,
         bool_or(etape='cta_clique')             AS cta,
         bool_or(etape='signup_started')         AS signup_page,
         bool_or(etape='signup_form_engaged')    AS engaged,
         bool_or(etape='signup_form_completed')  AS completed,
         bool_or(etape='checkout_started')       AS co_started,
         bool_or(etape='checkout_payment_failed') AS pay_failed,
         bool_or(etape='checkout_completed')     AS co_completed,
         bool_or(etape IN ('trial_activated','subscription_activated')) AS activated
    FROM funnel_events
   WHERE created_at >= :depuis::date AND created_at < :jusqua::date
     AND visiteur_id IS NOT NULL AND visiteur_id !~* '^fp-(test|cert)-'
   GROUP BY visiteur_id)
SELECT count(*) AS visiteurs_total,
       count(*) FILTER (WHERE landing)      AS landing,
       count(*) FILTER (WHERE tarifs)       AS tarifs,
       count(*) FILTER (WHERE cta)          AS cta,
       count(*) FILTER (WHERE signup_page)  AS signup_page,
       count(*) FILTER (WHERE engaged)      AS engaged,
       count(*) FILTER (WHERE completed)    AS completed,
       count(*) FILTER (WHERE co_started)   AS co_started,
       count(*) FILTER (WHERE pay_failed)   AS pay_failed,
       count(*) FILTER (WHERE co_completed) AS co_completed,
       count(*) FILTER (WHERE activated)    AS activated,
       -- transitions « sans suite observée » (formulation : jamais « abandon » certain)
       count(*) FILTER (WHERE signup_page AND NOT engaged)                 AS page_sans_saisie,
       count(*) FILTER (WHERE engaged AND NOT completed)                   AS saisie_sans_envoi_accepte,
       count(*) FILTER (WHERE completed AND NOT co_started)                AS inscrit_sans_paiement_ouvert,
       count(*) FILTER (WHERE co_started AND NOT co_completed)             AS paiement_ouvert_sans_suite
  FROM v;

-- Q3. Cohérence des sources : étapes dont la ligne n'a pas de visiteur (conversions hors consentement ou
-- métadonnée non reliée) — mesure du « non relié ».
SELECT etape, count(*) AS lignes, count(*) FILTER (WHERE visiteur_id IS NULL) AS sans_visiteur
  FROM funnel_events
 WHERE created_at >= :depuis::date AND created_at < :jusqua::date
   AND etape IN ('checkout_started','checkout_completed','trial_activated','subscription_activated')
 GROUP BY etape;

-- Q4. Familles d'étapes inattendues (ex. noms absents du code de la branche) : écart code / base.
SELECT etape, count(*) FROM funnel_events GROUP BY etape ORDER BY 2 DESC;

-- Q5. Organisations réelles créées dans la fenêtre vs lignes d'activation (rapprochement SANS e-mail en sortie).
SELECT (SELECT count(*) FROM organizations
         WHERE created_at >= :depuis::date AND created_at < :jusqua::date
           AND NOT (owner_email ~* '(flowpoint[.-]test|^fp-cert|^cert|^test|example\.)' OR name ~* '^(fp-cert|cert\b|test\b)')) AS orgs_non_synthetiques,
       (SELECT count(*) FROM funnel_events
         WHERE created_at >= :depuis::date AND created_at < :jusqua::date
           AND etape IN ('trial_activated','subscription_activated')) AS lignes_activation;

-- Q6. File AI Lab (jalons) : statut, dernier code, nombre — aucun fp_lid lu.
SELECT stage, status, last_status, count(*) AS n, min(created_at)::date AS premier, max(created_at)::date AS dernier
  FROM conversion_event_outbox GROUP BY 1,2,3 ORDER BY 1,2,3;

-- Q7. Retours de page (étapes navigateur) : lignes par jour et visiteurs, pour vérifier la déduplication jour.
SELECT created_at::date AS jour, etape, count(*) AS lignes, count(DISTINCT visiteur_id) AS visiteurs
  FROM funnel_events
 WHERE created_at >= :depuis::date AND created_at < :jusqua::date
 GROUP BY 1,2 HAVING count(*) <> count(DISTINCT visiteur_id) ORDER BY 1,2;
