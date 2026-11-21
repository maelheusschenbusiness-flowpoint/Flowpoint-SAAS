# Corrections du lot 2 — 21 novembre 2026

| Add-on | Défaut | Correction | Preuve |
|---|---|---|---|
| Agency Portfolio Priorities | Le motif affichait « N critical technical issues » pour le total des problèmes de l'audit (compte mobile + bureau, pas une gravité). | Libellé : « N technical issues flagged by the latest audit ». Logique de priorité inchangée. | `agency-portfolio-priorities.test.ts` |
| GBP Performance & Leads | Les 4 requêtes passaient par le pool global (rôle superuser, RLS contournée) avec seulement un filtre `org_id` manuel. | Toutes passent par `req.orgDb` (transaction `SET LOCAL ROLE app_user` + `app.current_org_id`) ; le filtre `org_id` reste en seconde garde. | `gbp-performance.test.ts` : aucun appel au pool global ; preuve RLS ci-dessous |
| Local Presence Optimizer | `PUT /local-presence/settings` écartait en silence un critère inconnu (ex. `website`) et enregistrait un réglage différent de celui demandé. | 400 explicite `INVALID_TRACKED_FIELDS` / `INVALID_LOCATION_ID` ; rien n'est enregistré. | `local-presence-optimizer.test.ts` (4 tests) |

## Preuve d'isolation entre organisations (PostgreSQL 16 jetable, rôle `app_user` NOBYPASSRLS, politiques identiques à `applyTenantRls` et `ensureGbpPerformanceSettingsSchema`)
- Organisation A, requête **sans filtre** `org_id` : voit uniquement sa fiche (`locA`) et ses réglages (`orgA`).
- Organisation A tente d'écrire les réglages de B : `new row violates row-level security policy`. Les réglages de B restent `{"x":"B"}`.
- Sans contexte d'organisation : 0 ligne visible.

Limite : cette preuve couvre le mécanisme (rôle + politiques) ; la suite PostgreSQL de CI de la route (`gbp-performance-postgres.test.ts`) continue de valider le SQL et les filtres avec un `orgDb` adossé au pool, car la base de CI n'a pas forcément le rôle `app_user`.
