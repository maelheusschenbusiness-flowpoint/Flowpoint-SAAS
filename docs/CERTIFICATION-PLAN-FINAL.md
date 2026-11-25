# Plan de certification final — build beta `cert/flowpoint-integration-final`

CERT ONLY — DO NOT MERGE. Cette branche regroupe #545, #546, #547, #548, #551, #517, #542 et un commit isole `cert-only: unhide for beta certification` (crmIntegration debloque). Deploiement unique : service Render `Flowpoint-Test` pointe sur cette branche, Stripe en mode TEST uniquement.

Regles : Stripe TEST uniquement, jamais de cle LIVE ; aucun secret dans les rapports (noms de variables seulement) ; chaque verification consigne OK / KO / BLOQUE avec la preuve (capture ou reponse API). Pre-requis commun : organisation de test Pro ou Ultra avec l'add-on achete via Stripe TEST (ou plan Ultra qui l'inclut).

## 1. Market Intelligence (`marketIntelligence`) — 8 verifications
1. Achat Stripe TEST : l'add-on apparait en Beta, achetable Pro/Ultra, prix 49 EUR/mois ; webhook active le droit.
2. Sans l'add-on : `GET /api/market-intelligence/*` refuse (403 addon requis), aucune donnee.
3. Au demarrage : la table `ai_market_reports` existe (init-market-intel-tables, une seule fois dans les logs).
4. Generation d'un rapport : declenche, statut passe a termine, enregistre dans `ai_market_reports` avec l'org correcte.
5. Honnetete des donnees : aucune donnee concurrente inventee ; sans donnees reelles (DataForSEO) le rapport l'indique explicitement.
6. Isolation : un rapport d'une org n'est jamais lisible depuis une autre org.
7. Liste / relecture d'un rapport existant apres redemarrage du service.
8. Quota / erreurs : echec fournisseur ou credits IA epuises = message clair, pas de rapport vide presente comme reussi.

## 2. CRM Integrations (`crmIntegration`) — 10 verifications (parties HubSpot BLOQUEES tant que le proprietaire n'a pas pose les variables HubSpot)
1. Achat Stripe TEST (debloque par le commit cert-only) : achetable Pro/Ultra, prix 29 EUR/mois.
2. Sans l'add-on : routes `/api/crm/*` refusees.
3. Tables CRM creees au demarrage (init-crm-tables, une fois).
4. Sans configuration : `GET /api/crm/status` indique clairement « non configure » (pas de faux connecte).
5. [BLOQUE HubSpot] Connexion OAuth : redirection HubSpot, callback `/api/crm/oauth/hubspot/callback`, jetons chiffres en base.
6. [BLOQUE HubSpot] Synchronisation des contacts : compteurs reels, erreurs affichees.
7. [BLOQUE HubSpot] Webhook `/api/crm/webhook/hubspot` : signature valide acceptee, invalide rejetee.
8. Boutons du dashboard CRM : chaque bouton produit un resultat ou une erreur explicite (correctif #548).
9. Deconnexion : jetons supprimes, statut revient a non connecte.
10. Isolation par organisation et absence de jeton en clair dans les reponses API et les logs.

## 3. AI GBP Posting (`aiGbpPosting`) — 9 verifications (publication BLOQUEE tant que Google n'est pas connecte)
1. Achat Stripe TEST : Beta, Pro/Ultra, 29 EUR/mois.
2. Tables `gbp_post_queue` / `gbp_media_assets` presentes au demarrage.
3. Creation d'un brouillon de post (STANDARD, EVENT, OFFER) et validation des champs.
4. Generation IA du texte (cle IA configuree) ; sans cle : erreur claire.
5. Planification / approbation : statuts brouillon, approuve, planifie coherents.
6. [BLOQUE Google] Publication reelle : le post existe chez Google, identifiant `postName` enregistre.
7. Honnetete : Google non connecte = `GOOGLE_NOT_CONNECTED`, post en echec avec message ; jamais « publie » sans identifiant Google.
8. Codes d'erreur Google (403, 429, 5xx) restitues et affiches, post marque echec avec raison.
9. Isolation org et reprise apres redemarrage (post interrompu = `GBP_PUBLISH_INTERRUPTED`).

## 4. Behavioral AI / Revenue Leak AI / AI CRO (`behavioralAI`, `revenueLeak`, `aiCro`) — 9 verifications
1. Achat Stripe TEST des trois add-ons (Ultra inclut Behavioral AI) ; statuts Beta corrects.
2. Tables comportementales creees au demarrage et allowlist CORS rechargee (init-behavioral-cro-tables).
3. Enregistrement d'un site : jeton de site genere ; snippet servi.
4. Ingestion : evenements recus avec jeton valide ; jeton invalide ou origine non autorisee rejetes.
5. Sans donnees : Behavioral / Revenue Leak / CRO affichent « pas assez de donnees », aucune analyse inventee.
6. Avec donnees : sessions et analyses coherentes avec les evenements envoyes.
7. Revenue Leak : opportunites listees, bouton Resolu fonctionnel, attribution GA4 uniquement si GA4 connecte.
8. AI CRO : recommandations, changement d'etat (accepte / rejete) persiste.
9. Isolation par organisation et propriete du site.

## 5. AI Forecasting (`aiForecasting`) — 7 verifications
1. Achat Stripe TEST : Beta, Pro/Ultra (inclus Ultra), 39 EUR/mois.
2. Sans l'add-on : routes de prevision refusees.
3. Signe de la croissance correct (hausse / baisse) sur des series connues.
4. Previsions perimees exclues de l'affichage.
5. Valeurs nulles / donnees insuffisantes : message explicite, pas de NaN ni de 0 trompeur.
6. Pas de courbes passees fabriquees : seules les donnees reelles apparaissent.
7. Isolation org et stabilite des identifiants (stable-id) entre deux generations.

## 6. Local Domination Maps et Zapier / Make — deja certifies, regression seule
1. LDM : achat Stripe TEST Pro/Ultra puis scan carte ; tables presentes.
2. Zapier / Make : achat Stripe TEST Pro/Ultra ; inscription et declenchement d'un webhook sans erreur 500.
3. Verifier l'absence de regression sur le catalogue (statut available, plans Pro/Ultra).

## 7. Lot 2 — Local Presence Optimizer, GBP Performance & Leads, Agency Portfolio Priorities, Local Landing Opportunities (Google BLOQUE tant que Google n'est pas connecte)
Voir `docs/GOOGLE-CERTIFICATION-TEST-PLAN-LOT2.md` pour le detail. Garde prix : chaque add-on n'apparait que si sa variable de prix Stripe TEST est posee.
1. Sans variable de prix : add-on invisible et non achetable.
2. Avec variable de prix TEST : visible, achetable (Local Presence Optimizer : Pro/Ultra seulement).
3. [BLOQUE Google] Local Presence Optimizer et GBP Performance & Leads : donnees GBP reelles apres synchronisation.
4. Agency Portfolio Priorities et Local Landing Opportunities : dependent de GSC ; sans GSC, etat vide honnete.
5. Erreurs Google typees (API non activee, quota, non connecte) affichees telles quelles.
Note : `seoContentDecayRadar` n'est pas present dans le code de cette branche (cle validee, `inBranch=false`) : rien a certifier.

## 8. Regression commune (smoke)
Connexion, tableau de bord, catalogue `/api/plans/catalog` (statuts conformes a `addon-catalog.reference.json`), tunnel Standard/Pro/Ultra en Stripe TEST, aucun `COMING_SOON` achetable.

## Variables d'environnement (noms seulement)
- Base : `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `PUBLIC_URL`
- Stripe TEST : `STRIPE_TEST_MODE`, `STRIPE_TEST_KEY`, `STRIPE_TEST_WEBHOOK_SECRET` et les prix TEST des add-ons (`STRIPE_TEST_PRICE_ID_ADDON_*`, dont `..._AI_CRO`, `..._REVENUE_LEAK`, `..._BEHAVAI`, `..._FORECAST`, `..._KDE`)
- Lot 2 / lot 1 (prix, garde prix) : `STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PORTFOLIO_PRIORITIES`, `..._LOCAL_LANDING`, `..._LOCAL_PRESENCE`, `..._GBP_PERFORMANCE`
- Google : `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`
- CRM : `CRM_TOKEN_ENCRYPTION_KEY`, `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, optionnels `CRM_OAUTH_REDIRECT_BASE`, `CRM_WEBHOOK_PUBLIC_URL`
- Donnees / IA : `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `ANTHROPIC_API_KEY` (ou `GEMINI_API_KEY`)
- Behavioral : `PUBLIC_BASE_URL`
