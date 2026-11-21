# Plan de test fonctionnel avec de vraies connexions Google (lot 2) — 21 novembre 2026

Objectif : prouver, avec de vraies données Google Search Console (GSC) et Google Business Profile (GBP), que les 4 add-ons du lot 2 produisent des résultats réels. **Aucune donnée simulée, aucune insertion en base de test, aucune fixture ne sert de preuve de certification.** Lecture du code : Test-Replit `5206fb8c`+.

## 1. Ce que le code exige (vérifié dans le dépôt)
- Connexion unique « Google » (`/api/google/connect`, callback `/api/google/callback` ou `/api/google/oauth/callback`) ; variables d'environnement `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (URL du callback de l'environnement testé). Sans elles `/api/health` signale `google_oauth: degraded`.
- Scopes demandés (`GOOGLE_INTEGRATION_SCOPES`) : `openid`, `email`, `profile`, `webmasters.readonly`, `business.manage`, `analytics.readonly`.
- API Google appelées : Search Console (`searchconsole.googleapis.com`), My Business Account Management, My Business (v4 : avis, posts), Business Profile Performance (`businessprofileperformance.googleapis.com`, `fetchMultiDailyMetricsTimeSeries`), Analytics Data/Admin (GA4, lot 1).
- Données GSC : `syncGSCData` alimente `gsc_page_data` (pages, clics, impressions, CTR, position) ; GBP : `POST /api/google/sync` alimente `google_locations` (avec `raw_data.name` = ressource Google).

## 2. Ce qui manque aujourd'hui pour réaliser le test (à confirmer, non lisible depuis mes outils)
| # | Prérequis | Pourquoi | Qui |
|---|---|---|---|
| 1 | Les 3 variables `GOOGLE_*` présentes sur **Flowpoint-Test** (noms seulement à me confirmer ; jamais de valeur) | sans elles, aucune connexion possible | vous (Render) |
| 2 | URI de redirection `https://flowpoint-test.onrender.com/api/google/callback` enregistrée sur le client OAuth Google | sinon `redirect_uri_mismatch` | vous (Google Cloud) |
| 3 | Écran de consentement : mode « Test » avec votre compte Google comme utilisateur de test, ou application publiée/vérifiée (les scopes `business.manage` et `webmasters.readonly` sont sensibles) | sans cela, Google bloque ou limite le consentement | vous |
| 4 | API activées dans le projet Google Cloud : Search Console API, My Business Account Management API, My Business Business Information API, Business Profile Performance API, My Business API (v4) | sinon 403 `SERVICE_DISABLED` | vous |
| 5 | **Accès approuvé aux API Business Profile** pour ce projet (demande d'accès Google ; sans approbation le quota est 0 → 429) | les API GBP ne sont pas ouvertes par défaut | vous (formulaire Google) |
| 6 | Une propriété GSC **vérifiée** appartenant au compte de test, avec ≥ 28 jours de données et au moins un domaine pour lequel FlowPoint peut créer 2 audits | Agency Portfolio (clics par domaine), Local Landing (requêtes) | vous |
| 7 | Une fiche GBP **vérifiée** dans ce compte, avec ≥ 4 semaines de métriques de performance (délai Google de quelques jours) | GBP Performance, Local Presence | vous |
| 8 | Pour Local Presence : une fiche avec au moins un champ manquant réel (site, horaires, téléphone) pour observer une priorité | résultat non trivial | vous |
| 9 | Une session de navigateur sur la bêta pour effectuer le consentement OAuth (je ne peux pas me connecter à Google à votre place) | consentement interactif | vous, ~5 min |

## 3. Procédure (une fois 1–9 satisfaits)
1. Organisation jetable en essai sur la bêta ; achat des 4 add-ons par `POST /api/addons/:key/activate` (méthode déjà certifiée).
2. Vous cliquez « Connecter Google » dans le dashboard de cette organisation et acceptez les scopes ; vérification : `GET /api/google/status` → connecté, sans exposer de jeton.
3. `syncGSCData` (synchronisation GSC) puis `POST /api/google/sync` (fiches GBP).
4. Pour chaque add-on, relever la réponse réelle :
   - Agency Portfolio Priorities : `GET /api/agency-portfolio-priorities` → `monthlyOrganicClicks` non nul pour le domaine, rang cohérent avec 2 audits réels.
   - Local Landing Opportunities : requêtes GSC réelles locales → opportunités non vides, chaque ligne traçable à une requête GSC réelle.
   - Local Presence Optimizer : analyse de la fiche synchronisée → champs manquants identiques à ceux visibles dans l'interface Google.
   - GBP Performance & Leads : `GET /api/gbp-performance` → séries réelles, totaux égaux à ceux du tableau de bord Google pour la même période (écart toléré : 0 sur les jours finalisés).
5. Preuve de non-simulation : chaque nombre est comparé à sa source Google (capture du tableau Google, sans donnée personnelle de tiers) ; aucun enregistrement n'est inséré à la main.
6. Isolation : une 2e organisation jetable sans connexion Google ne voit aucune donnée de la première (200 avec états vides, jamais de données d'une autre organisation).
7. Déconnexion : `POST /api/google/disconnect` → plus de données, jetons supprimés.

## 4. Critères de réussite / échec
- **Réussi** : les 4 fonctions renvoient des résultats non vides, traçables à Google, identiques à la source, sans 5xx.
- **Échec** : tout écart non expliqué, tout 5xx, toute donnée d'une autre organisation. Le défaut est documenté (fichier/ligne/cause), corrigé sur branche isolée, puis seul le scénario concerné est rejoué.
- **Non concluant (ne pas certifier)** : quota GBP à 0, propriété sans données, fiche non vérifiée : l'add-on reste « À FINALISER ».
