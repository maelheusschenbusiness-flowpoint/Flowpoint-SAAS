# Bilan des corrections et complément d'audit (site marketing + tunnel) — 8 novembre 2026

Complète `AUDIT-GLOBAL-FLOWPOINT-2026-11-08.md`. Toutes les PR visent `Test-Replit`. **Aucune n'est fusionnée.** `Flowpoint` (production) n'a été ni modifiée ni déployée. Aucune donnée client, Stripe réel, secret ou variable Render n'a été modifié. LEDGER / VAULT / SHIELD n'ont pas été touchés.

Légende : [D] démontré (observé ou lu dans le code), [H] hypothèse, [C] choix commercial.

## 1. Pourquoi le site était inaccessible lors du premier audit
- **Cause prouvée** : le proxy de sortie de la session répondait `403 Forbidden` au `CONNECT flowpoint.pro:443`, avant tout échange avec le site. L'environnement « FLOWPOINT » n'autorisait que Smartlead et MillionVerifier. Des domaines non autorisés (`example.com`, `onrender.com`) échouaient de la même façon.
- Cela ne prouve rien sur l'accessibilité pour de vrais visiteurs. Après ajout de `flowpoint.pro`, `www.flowpoint.pro`, `app.flowpoint.pro` et `flowpoint-test.onrender.com`, `flowpoint.pro` répond 200 et `app.flowpoint.pro` redirige vers `/signin.html`.
- **Réserve** : `www.flowpoint.pro` ne répond pas depuis la session (connexion réinitialisée pendant le handshake TLS, ce n'est pas une erreur de certificat). Cause amont non tranchée [H].

## 2. Complément d'audit — site marketing (production, lecture seule)
Preuves : 37 captures et rapports bruts dans `site-audit/marketing-rendu/` du dossier de travail de la session. Les échecs de chargement de ressources tierces (Stripe, Google, Replit) viennent du réseau de la session, pas du site.

| Gravité | Constat | Statut |
|---|---|---|
| P1 | Aucune compression (JS 598 Ko, CSS 199 Ko) et `cache-control: private, max-age=0` sur les actifs | [D] |
| P1 | Script `i.replit.com/script.js` chargé avant tout consentement (dans le HTML, non observable car bloqué) ; Google Translate pose un cookie sans consentement | [D] code |
| P1 | GA4, Apollo (identification de visiteurs B2B), Replit, Translate absents de la liste des sous-traitants ; la politique parle de données « anonymisées » ; MongoDB Atlas cité alors que le site utilise PostgreSQL | [D] |
| P1 | UTM propagés seulement avec consentement : sans lui, l'attribution est perdue | [D] |
| P1 | Promesses non tenues par le produit : « 30 langues » (11 réelles), heatmaps Local, gestion des avis, CRO, webhooks, white-label, partage de rapports | [D] contenu, état produit via l'audit global |
| P1 | Méta de `/pricing` : « Starter, Pro, Agency » alors que la page affiche Standard / Pro / Ultra ; mots-clés 10/50 sur la page de tarifs contre 50/500 pour l'assistant du site ; heatmaps dès Standard pour l'assistant contre Ultra seul sur la page | [D] |
| P1 | Les boutons « Try for free » pointent tous vers `https://app.flowpoint.pro/signin.html` sans `?plan=` : le plan choisi sur le site est perdu | [D] code |
| P1 | La carte bancaire n'est jamais mentionnée à côté de « 14-day free trial » ; les conditions légales disent « moyen de paiement valide » | [D] / [C] |
| P1/P2 | `www.flowpoint.pro` ne répond pas depuis la session | [H] |
| P2 | `HEAD` renvoie 404 sur toutes les routes (cause : le serveur ne traite que `GET` — `server/static.ts` et `server/index.ts`) ; `/pricing/` avec slash final : 404 | [D] ; correctif d'une ligne à deux endroits |
| P2 | Pas de CSP ; formulaire de contact : HTML non échappé dans l'email au support, pas de captcha ; chat IA public sans limite de longueur de message ; une dépendance `braces` remplacée par un fork tiers | [D] code |
| P2 | Accessibilité : 33 problèmes de contraste sur la home, pas de `<main>` sur 15 pages, cibles tactiles < 44 px ; pas de lien « Se connecter » ; JSON-LD sans `SoftwareApplication`/`Offer` ; hreflang anglais seul ; sitemap statique de 16 URLs (le sitemap réellement servi en compte 54) | [D] |
| P2 | Page légale unique pour mentions, confidentialité, CGV, cookies ; pas d'adresse postale de l'éditeur ; `fp_ref` (code vendeur) jamais transmis du site vers l'application ; `signup_started` jamais émis par le site | [D] |
| Info | Lighthouse home (mobile simulé) : performance 78, accessibilité 95, bonnes pratiques 96, SEO 100 ; TTFB 120-350 ms ; 55 liens internes tous en 200 ; aucune image sans `alt` | [D] |

**G-02 tranché** : c'est le bandeau du site (`CookieBanner.tsx`) qui pose `fp_analytics_consent=accepted|refused` (Domain=.flowpoint.pro, 1 an). La valeur `accepted` correspond à ce que lit le SaaS. Lecture de code, confirmée par l'observation du cookie après « Accept ». Le site lit toutefois son propre consentement dans le localStorage, pas le cookie.

## 3. Complément d'audit — tunnel sur l'environnement de test
Environnement `flowpoint-test` (Test-Replit, commit `994e598`). Isolation : Stripe en mode test prouvé (`pk_test_`, journal « mode: TEST »). Isolation de la base prouvée après coup : 5 lignes fictives `audit-tunnel-*@example.invalid` dans la base de test, 0 en production (deux comptages en lecture seule). Aucune carte, aucun lien magique, aucune connexion Google n'a été testé.

- **A-01 confirmé par l'observation** : « Start Pro » ne change pas l'URL ; le plan est stocké dans `fp_cart`, le compteur Panier passe de 0 à 1.
- Plan conservé jusqu'à `signin`, mais UTM et `fp_lid` perdus entre les tarifs et `signin`.
- 8 champs obligatoires ; plan choisi deux fois ; lien Google sans le plan ; `state` OAuth non signé (C-07 confirmé).
- P1 nouveaux : `success.html` ouverte directement affiche « Payment confirmed ! Subscription activated » ; `checkout-return` avec un intent invalide affiche « Payment recorded ». Non corrigés par les PR ci-dessous.
- P2 : erreurs mélangées français/anglais ; un nouvel intent Stripe à chaque chargement de la page de paiement ; message « désactivez votre bloqueur de pub » pour tout échec de Stripe.js.
- **Écart de branches** : `Test-Replit` a 1 141 commits que `Flowpoint` n'a pas, et `Flowpoint` en a 43 que `Test-Replit` n'a pas. La production charge `funnel-tracking.js` ; le test non (404). Le test ne mesure donc pas le tunnel de production.
- **Non testé, accès manquants** : `js.stripe.com` et `hooks.stripe.com` (carte, SetupIntent, finalize), une boîte de réception de test (le lien magique est un vrai envoi), un compte Google de test, et la lecture des événements de suivi côté serveur.
- Aucune estimation de conversion n'est présentée comme une mesure. Les événements de suivi n'ont pas été comptés en production.

## 4. PR de correction (29, toutes vers `Test-Replit`, non fusionnées)
CI « Types, build, tests » : succès sur toutes d'après les agents ; #361, #368, #374 et #384, qui étaient en cours, vérifiées par moi (succès).

| Domaine | PR | Constat |
|---|---|---|
| Sécurité | #362 | C-01 CORS liste blanche, cookie `SameSite=Lax`, contrôle d'origine CSRF (exception callback Apple ajoutée) |
| | #366 | C-06 : déjà corrigé ; test de non-régression ajouté |
| | #359 / #364 | C-02 / C-03 SSRF webhooks / concurrents |
| | #370 | C-05 isolation inter-organisations GBP, ids en UUID |
| | #373 | C-04 garde de rôle sur toutes les routes d'écriture (+ test d'inventaire) |
| | #382 | C-08 détection RLS, tests d'isolation (126 tables), inventaire `pool.query` |
| | #367 | C-07 OAuth : `state`, nonce, `email_verified` |
| | #360 / #365 / #378 / #380 / #381 / #383 | C-09, C-13 / C-14 / C-15 / C-16 / C-11 / C-17, C-18, C-12 (docs) |
| Inscription | #371 | A-07, A-08, A-10, A-11 (Google) |
| | #379 | A-06 comptes en double (verrou + index unique conditionnel) |
| | #374 | A-01, A-02, A-04, A-11 front du tunnel |
| Facturation | #363 / #376 / #385 | B-01 / B-03 / B-05, B-07, B-09 |
| Fonctions | #375 | D-01 publication Google réelle, erreurs typées |
| | #361 / #368 / #372 | D-02 CRO / D-03 heatmaps / D-04, D-06 |
| | #369 / #377 / #384 | D-05 rapports / D-07 automatisations / D-08 endpoints |
| Tests | #386 | tests périmés réparés + vrai bug (`store.getFilteredActivity`) |
| | #387 | glob, 21 exclusions documentées, garde-fou CI, audit des dépendances (non bloquant) |

## 5. Ordre de fusion et conflits connus (à traiter avant de fusionner)
- `vitest.config.ts` : #387 remplace la liste blanche par un glob ; toute PR qui ajoute une ligne à `include` entre en conflit trivial (supprimer leur ligne). Fusionner #386 puis #387.
- #367 avant #371 (empilées). #370 avant #375 (même bloc `catch`).
- **Migration 025 en doublon** : `025_organizations_owner_email_unique.sql` (#379) et `025_rls_activity_logs_tenant_policies.sql` (#382) : renuméroter avant fusion. Aucune migration n'est appliquée automatiquement ; l'index unique de #379 exige d'abord le script de détection de doublons.
- #362 et #367 : mêmes lignes `sameSite` dans `auth.ts` ; #363 et #385 : blocs voisins de `billing-service.ts`.
- `funnel-tracking.js` n'existe pas sur `Test-Replit` : #374 ajoute `pricing-funnel.js`. À réconcilier avec #306 / #307 à la promotion vers `Flowpoint`.

## 6. Décisions qui vous reviennent
1. B-04 : lecture seule après annulation ? Durée de la grâce `past_due` (horodatage « impayé depuis » absent).
2. A-09 : essai activé sans souscription Stripe si l'onglet est fermé — créer la souscription depuis le webhook (touche le cœur de la facturation).
3. « ∞ crédits IA » pour Ultra (plafond réel 10 000 000) ; quotas missions et posts GBP (mensuel ou stock) ; mention de la carte bancaire sur le site marketing.
4. RLS en production : rôle de connexion sans BYPASSRLS puis `RLS_ENFORCEMENT=strict`, à essayer d'abord sur `Test-Replit`.
5. A-03 : 8 champs avant la carte (non modifié, choix commercial).

## 7. Reste à traiter (non corrigé)
- **Site marketing (Replit, lecture seule, rien modifié)** : tous les constats de la section 2.
- **Produit** : A-05 (session après paiement), A-13, A-14, `success.html` / `checkout-return` en faux succès, D-09 (ukrainien, 11 langues), D-11, `POST /reports/send-invoice` répond `sent:true` sans envoyer, `POST /addons/ai-credits/buy` et `POST /ai-credits/consume` (paiement/garde à auditer), `req.me?.plan ?? "Pro"` dans `crm.ts`, `integrations.ts`, `permissions.ts`, colonne `language` absente du schéma pour `POST /keywords`, `GET /sessions` qui expose les sessions de toute l'organisation.
- **Infrastructure** : E-01 (sauvegardes : plan Supabase gratuit, à confirmer dans Database > Backups), E-02 à E-08, E-12 ; C-12 et C-18 en documentation seulement.
- **AI Lab / acquisition** : F-01 à F-12 (nettoyage des PR, alerte d'expiration Claude Max, rapport de campagne), G-03 à G-07 (Smartlead, délivrabilité, RGPD).
- **Dette de tests** : `lot_c_billing.test.ts` et `billing-isolation.test.cjs` périmés ; mock de `e2e-ailab-transmission` ; durées de `stripe-webhook-pending-activation` ; 2 failles `high` (zod, body-parser) à mettre à jour.
- **Non exécuté** : parcours Stripe complet, Google OAuth réel, Apple Sign-In réel, tests sur PostgreSQL 17 en local (version 16 locale), parcours navigateur de bout en bout sur les PR fusionnées.

## 8. Écarts de méthode à connaître
- Le premier envoi des briefs d'audit n'avait pas inclus les règles de lecture seule ; elles ont été transmises par message juste après. Aucune écriture n'a été constatée.
- L'audit initial lisait un checkout parti de `Flowpoint` : plusieurs constats (C-06, B-01, B-03, D-01, D-03, D-04, D-06, A-12) étaient déjà en partie corrigés sur `Test-Replit`. Les agents ont corrigé uniquement ce qui restait.
- Le chiffre « 198 templates d'automatisation » était faux : la bibliothèque en compte 284 sur 79 événements.
- Des lectures SQL ont eu lieu (2 `SELECT` sur la base de test par un agent ; 2 comptages de contrôle par moi, dont un sur la production, sans donnée personnelle). L'environnement « FLOWPOINT » a reçu 4 hôtes autorisés.
