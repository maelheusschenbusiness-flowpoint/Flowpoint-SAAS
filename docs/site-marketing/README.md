# Paquet de correctifs du site marketing flowpoint.pro (2026-11-08)

Application Replit « Flowpoint Site Internet » (replId `f84710ef-853d-4e10-ae71-9633c111c9e9`). Ce dossier ne contient QUE de la documentation et des patches. Rien n'a été modifié ni publié côté Replit (lecture seule : `list_app_files` / `read_app_file`). Aucun prix, aucune obligation de carte, aucune durée d'essai n'est modifié.

Source : état de l'app Replit lu le 2026-11-08, audit `BILAN-CORRECTIONS-ET-AUDIT-SITE-2026-11-08.md` section 2, et dépôt SaaS `Test-Replit` (`artifacts/api-server/src/lib/plans.ts`, `lib/config.ts`, `FLOWPOINT_AI_CONTEXT.md`).

## Contenu

| Fichier | Sujet | Statut |
|---|---|---|
| `patches/01-plan-param-and-seller-ref.patch` | Boutons de tarifs `?plan=standard\|pro\|ultra`, propagation de `fp_ref` | prêt, dépend du patch SaaS pour l'effet complet |
| `patches/saas-signin-plan-param.patch` | **Dépôt SaaS** : `signin.html` lit `?plan=` | à appliquer plus tard sur la branche d'intégration (après la PR #374) |
| `patches/02-performance-and-server.patch` | gzip/brotli, cache, HEAD, `/pricing/`, www→apex, http→https | prêt |
| `patches/03-consent-and-cookies.patch` | consentement (Translate, `googtrans`, `fp_lid`, lecture cookie, bouton Refuser) | **position juridique à valider** |
| `patches/04-legal-pages-and-policy.patch` | tableau des cookies, sous-traitants corrigés, 4 pages légales distinctes | **champs « À COMPLÉTER PAR L'ÉDITEUR »** |
| `patches/05-claims-variant-a.patch` | promesses alignées sur le produit (variante A) | **EN ATTENTE D'APPROBATION COMMERCIALE** |
| `patches/06-quick-wins-contact-chat.patch` | échappement HTML + validation du formulaire de contact, `new URL(referer)` protégé, limite du chat | prêt |
| `CLAIMS-VS-REALITY.md` | tableau « promesse du site vs réalité », variantes A/B | décision propriétaire |
| `APPROVAL-CHECKLIST.md` | cases à cocher avant publication | à remplir |
| `tests/` | tests exécutables (tsx / node) | voir plus bas |

## Appliquer (dans l'ordre 01 → 06)

Les patches 01 à 06 sont **cumulatifs** : 02 s'applique sur le résultat de 01, etc. Depuis la racine de l'app Replit (copie ou Git de l'app) :

```bash
for p in docs/site-marketing/patches/0*.patch; do patch -p1 --dry-run < "$p" && patch -p1 < "$p"; done
npm install compression@^1.8.2 && npm install -D @types/compression   # met aussi à jour package-lock.json (le patch 02 ne touche que package.json)
npm run check          # tsc
npm run build && npm start
```

Notes de fidélité : pour les petits fichiers (`index.ts`, `static.ts`, `Pricing.tsx`, `funnel-tracking.ts`, `fp-lid.ts`, `CookieBanner.tsx`, `App.tsx`, `GoogleAnalytics.tsx`, `ApolloTracker.tsx`, `analytics.ts`, `routes.ts`) le patch est calculé sur le fichier complet lu. Pour les gros fichiers (`LegalInfo.tsx`, `seo-metadata.ts`, `structured-data-content.ts`, `Features.tsx`, `Benefits.tsx`, `chat/flowpoint-context.ts`, `chat/routes.ts`, `client/index.html`) il est calculé sur des **extraits** contenant les lignes exactes autour des modifications : `patch` peut annoncer un décalage de lignes (« offset ») ; c'est normal. Si un hunk échoue, appliquez-le à la main (le bloc `+` est autonome).

Pour appliquer sans Git Replit : mcp `update_app_using_prompt` n'a PAS été utilisé ; le propriétaire applique les patches dans l'éditeur Replit (Shell) puis publie.

## Tester en local

```bash
npm run dev                                           # http://localhost:5000
npx tsx docs/site-marketing/tests/signup-url.test.ts  # patch 01
npx tsx docs/site-marketing/tests/consent.test.ts     # patch 03
npx tsx docs/site-marketing/tests/claims.test.ts      # patch 05
npx tsx docs/site-marketing/tests/contact.test.ts     # patch 06 (importe server/routes.ts)
curl -sI -H 'Accept-Encoding: gzip' http://localhost:5000/assets/<fichier>.js   # patch 02 : Content-Encoding + Cache-Control immutable
curl -sI http://localhost:5000/pricing ; curl -sI http://localhost:5000/pricing/   # HEAD 200 puis 301
```
Le SaaS : `node docs/site-marketing/tests/saas-signin-plan-param.check.mjs artifacts/flowpoint-export/signin.html` sur la branche où `saas-signin-plan-param.patch` est appliqué.

## Publier (action du propriétaire uniquement)

1. Remplir `APPROVAL-CHECKLIST.md` ; ne publier 05 qu'après choix A/B. 2. Appliquer dans Replit, `npm run check`, `npm run build`. 3. Prévisualiser (aucun envoi de formulaire en production). 4. Publier depuis Replit (Deploy). 5. Vérifier avec les `curl` ci-dessus sur `https://flowpoint.pro`.
Le patch SaaS `signin` doit être déployé AVANT ou EN MÊME TEMPS que le patch 01 pour que `?plan=` ait un effet ; sans lui, `?plan=` est simplement ignoré par `signin.html` (aucune régression).

## Ce qui a été vérifié

Environnement jetable (hors Replit) : React 18.3, Express 5, TypeScript 5.6.3, compression 1.8.2 installés depuis npm.
- Les 6 patches s'appliquent dans l'ordre sur une copie des fichiers lus ; le résultat est identique octet pour octet à l'arbre de travail (`diff -r`).
- `tsc --strict --noEmit` : OK sur `App.tsx`, `Pricing.tsx`, `CookieBanner.tsx`, `GoogleAnalytics.tsx`, `ApolloTracker.tsx`, `funnel-tracking.ts`, `fp-lid.ts`, `consent.ts`, `signup-url.ts`, `analytics.ts`, `LegalInfo.tsx` (extrait équilibré), `seo-metadata.ts`, `public-paths.ts`. **Limites** : les modules non lus (kit `ui/`, hooks, autres pages, `@shared/*`) sont remplacés par des déclarations ambiantes `any` ; les extraits de `Features.tsx` / `Benefits.tsx` sont des fragments non compilés. Le build Vite complet de l'app n'a PAS pu être exécuté (≈ 350 fichiers non lus) : lancez `npm run build` avant de publier.
- Serveur : `server/index.ts` + `static.ts` patchés sont bundlés (esbuild, CJS comme `script/build.ts`) avec des stubs pour `routes`, `seo-metadata`, `vite` et lancés en `NODE_ENV=production`. Avant → après (mêmes requêtes `curl`) :
  - `HEAD /pricing` : 404 → 200 ; `GET /pricing/` : 404 → 301 vers `/pricing?…` ; `Host: www.flowpoint.pro` : 200 → 301 vers `https://flowpoint.pro/…` ; `X-Forwarded-Proto: http` : 200 → 301 https ; hôte interne (health check) : inchangé 200.
  - Actif JS haché de 600 004 octets (stand-in de la taille réelle, react-dom) : 600 004 → 139 367 octets transférés avec `Accept-Encoding: gzip, br` ; `Cache-Control` `public, max-age=0` → `public, max-age=31536000, immutable` ; HTML `no-cache`. Les chiffres CSS/HTML de la mesure sont irréalistes (contenu synthétique très répétitif) et ne sont pas à citer ; mesurez sur le vrai build.
  - Le flux SSE du chat (`/api/conversations…`) n'est pas compressé et reste incrémental.
- Tests : `signup-url` (liens par plan, rejet de valeurs inconnues, `fp_ref` conservé avec `plan`/`fp_vid`/`utm_*`/`fp_lid`, pas de stockage sans consentement), `consent` (repli cookie quand `localStorage` lève, `fp_lid` jamais écrit sans consentement et purgé), `claims`, `contact` (échappement HTML, injection d'en-tête dans le sujet, e-mail invalide) et `saas-signin-plan-param.check.mjs`. Chacun échoue sur les fichiers d'origine (vérifié pour signup-url, consent, contact).
- NON exécuté : navigateur réel, Replit, déploiement, Lighthouse après correctif, build Vite complet.

## Patch 01 : `?plan=` et `fp_ref`

- `Pricing.tsx` : chaque carte pointe vers `https://app.flowpoint.pro/signin.html?plan=<standard|pro|ultra>`. Le suivi existant (`addFunnelAttributionToSignupLink`, `installFpLidPropagation`) utilise `searchParams.set` : `plan` est conservé, `fp_vid`/`fp_source`/`utm_*`/`fp_lid` s'ajoutent comme avant.
- `fp_ref` (code vendeur `SELLER-XXXX`, format strict, alias `ref`) est copié de l'URL de la page vers le lien de l'app **sans consentement** (réécriture d'un lien, aucun stockage). Avec consentement, il est mémorisé (`flowpoint_funnel_seller_ref`) pour survivre à la navigation. **Choix du propriétaire** : le garder sans consentement (recommandé : code commercial, pas un identifiant de visiteur) ou le conditionner.
- **Contrat SaaS** (`saas-signin-plan-param.patch`, base : branche `fix/funnel-front-plan-direct-20261108`, PR #374, commit `f0bce1d`) : `signin.html` accepte `?plan=` **uniquement** si la valeur (insensible à la casse) vaut `standard`, `pro` ou `ultra`, sinon l'ignore ; il écrit `fp_cart = {plan, addons, _v:1, _updatedAt}` (mêmes clés que `pricing.html`) en conservant les add-ons existants ; `fpCartPlan()` de la PR #374 le relit, saute l'écran de choix et transmet le plan au lien Google. Ignoré au retour du callback Google (`?google_signup=1`, qui porte déjà son `?plan=`). Ne touche ni prix, ni carte, ni essai. Un seul fichier, +21 lignes.

## Patch 02 : performance

Compression (`compression`, SSE exclu), `Cache-Control` (hachés `immutable`, HTML `no-cache`, autres 24 h), `HEAD` aux deux endroits de `static.ts`/`index.ts`, `/pricing/` → 301, redirection www→apex et http→https (production, hôtes `flowpoint.pro`/`www.flowpoint.pro` seulement ; `DISABLE_CANONICAL_REDIRECT=1` coupe la règle si le proxy ne transmet pas `X-Forwarded-Proto`, sinon boucle possible : **tester sur le déploiement avant de garder**).
Hors code : le constat « www ne répond pas » est une réinitialisation TLS avant l'app. Il faut, dans Replit → Deployments → Settings → Domains, lier `www.flowpoint.pro` (enregistrement CNAME/A indiqué par Replit chez le registrar), ou ajouter une redirection www→apex chez le registrar. Le patch ne peut pas le corriger.
Non patché : lazy-load de `SupportChat` (importé statiquement par ~15 pages, modification transverse), Google Translate (déjà chargé uniquement si langue ≠ source, et maintenant après consentement).

## Patch 03 : consentement (propositions, pas de décision)

| Élément | Correctif | Décision propriétaire |
|---|---|---|
| Google Translate (`element.js`) + cookie `googtrans` | chargés seulement après « Accepter » ; `index.html` n'écrit plus `googtrans=/en/en` pour tout le monde | Alternative : un clic explicite sur le sélecteur de langue vaut demande de l'utilisateur ; à valider avec `LanguagePicker.tsx` (non lu : vérifier qu'il n'écrit pas le cookie avant consentement) |
| `sessionStorage flowpoint:marketing:fp_lid` | écrit seulement avec consentement ; lu dans l'URL pour la page courante (lien vers l'app) sans stockage | Sans consentement, l'identifiant de lead est perdu au changement de page |
| Lecture du consentement | `lib/consent.ts` : `localStorage`, repli sur le cookie `fp_analytics_consent` | — |
| Bouton « Refuser » | même taille, même couleur, même poids que « Accepter » | — |
| UTM | **position prudente proposée** : les paramètres `utm_*` déjà présents dans l'URL peuvent être recopiés dans le lien vers l'app au clic (réécriture d'un lien, aucun stockage ni cookie côté site) ; l'identifiant visiteur (`fp_vid`) et la mémorisation ne sont créés qu'avec consentement. Le code actuel ne recopie les UTM qu'avec consentement : **non modifié**, car la copie sans consentement est un choix juridique à valider (RGPD / ePrivacy, avis du conseil du propriétaire) | oui |
| Script `i.replit.com/script.js` (`data-website-id`) | **absent des sources lues** (`client/index.html`, `App.tsx`, `build.ts`, `vite.config.ts`). `window.umami` est seulement appelé après consentement (`analytics.ts`). Le script est donc injecté par la plateforme d'hébergement : désactiver l'option d'analytics du déploiement Replit (Deployments → Analytics) ou documenter. Non vérifiable en lecture seule | oui |

## Patch 04 : pages et politique

Routes ajoutées : `/privacy-policy`, `/cookie-policy`, `/terms-of-sale` (CGV + essai + remboursement), `/terms-of-service` ; `LegalInfo` filtre ses sections par prop `only` (les ancres `/legal-information#cookies` etc. continuent de marcher). Ajoutés aussi : `PUBLIC_PATHS`, `ROUTE_METADATA`. À faire à la main : ajouter les 4 URL à `client/public/sitemap.xml` (fichier non lu) et mettre à jour les liens du `Footer` (non lu) vers ces pages ; le lien du bandeau (`/legal-information#confidentialite`) reste valide.
Contenu : tableau des cookies (nom, finalité, durée, tiers, consentement) ; GA4, Apollo, Google Translate, Replit nommés ; « anonymisé » remplacé par « pseudonymisé » ; MongoDB Atlas retiré de la liste des sous-traitants (le site utilise PostgreSQL) et remplacé par un champ à compléter. Champs `À COMPLÉTER PAR L'ÉDITEUR` : adresse postale, fournisseurs de base de données de l'application, nom de la clé de stockage du thème, durée des cookies `fp_visitor_id`/`fp_source`, durée Apollo, présence réelle du script Replit. Rien n'a été inventé. Texte à faire relire juridiquement.
Non patché (une ligne chacun) : section « AI policy » de `LegalInfo` : « 10,000,000 AI tokens per month » vs crédits IA (plans.ts : 10 000 000 crédits, `aiTokens` 750 000) ; liste de sécurité de la section DPA « Regular encrypted backups » vs audit E-01 (sauvegardes à confirmer).

## Patch 05 : promesses (variante A) — voir `CLAIMS-VS-REALITY.md`

EN ATTENTE D'APPROBATION. Il aligne le site sur le produit ; aucune règle commerciale ne change. Ajoute, à côté des CTA de la page tarifs, la phrase factuelle : « 14-day free trial. A payment card is required to start it. » et « It is charged when the trial ends unless you cancel before. » (conforme aux CGV du site, section « Free trial policy »).

## Patch 06 : divers

Échappement HTML de `name`, `email`, `subject`, `message` dans l'e-mail de contact (le nom, le sujet et le message étaient aussi non échappés, pas seulement l'e-mail), validation (longueurs 120/200/5000, format d'e-mail, retours ligne retirés du sujet), `try/catch` autour de `new URL(referer)`, message du chat limité à 2000 caractères (413).

## Non patché, recettes

- **CSP en Report-Only** : ajouter dans `server/index.ts` `res.setHeader("Content-Security-Policy-Report-Only", "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://translate.google.com https://translate.googleapis.com https://assets.apollo.io https://i.replit.com; connect-src 'self' https://app.flowpoint.pro https://www.google-analytics.com https://*.google-analytics.com https://*.apollo.io; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.gstatic.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'self'")` puis observer les violations avant de passer en mode bloquant (`'unsafe-inline'` est nécessaire tant que `index.html` contient des scripts en ligne). Liste de tiers lue dans le code ; à compléter avec les mesures réelles.
- **`<main>` + lien d'évitement** : chaque page englobe `Navigation` et `Footer` dans le même `div` ; ajouter `<a href="#main-content" className="sr-only focus:not-sr-only …">` dans `Navigation` et `<main id="main-content">` autour du contenu entre `Navigation` et `Footer` de chaque page (15 fichiers non tous lus).
- **Lien « Se connecter »** : `Navigation.tsx` ; cible proposée `https://app.flowpoint.pro/login.html` (c'est l'URL de connexion donnée par l'assistant du site), à confirmer.
- **JSON-LD SoftwareApplication + Offer** (29/79/149 EUR) : à ajouter dans `ROUTE_JSON_LD["/tarifs"]` : un `SoftwareApplication` `name: "Flowpoint"` avec `offers` = trois `Offer` (`price` "29", "79", "149", `priceCurrency` "EUR", `url` `https://flowpoint.pro/pricing`).
- **Titres ≤ 60 caractères** : les 17 titres de `ROUTE_METADATA` font 60 caractères ou moins (le plus long : 55). Les titres des articles (`shared/resource-article-*.ts`) n'ont pas été lus.
- **hreflang** : le serveur émet `en` + `x-default` vers la même URL, ce qui est cohérent avec une stratégie « anglais par défaut ». Le français sert de traduction navigateur, pas d'URL distincte : ne pas ajouter d'hreflang `fr` sans pages françaises.
- **Contrastes** < 4,5:1 (`#697e98` sur blanc ≈ 3,9:1) : liste exacte à produire par axe sur le build ; cibles tactiles : `Navigation` utilise déjà `min-h-11` (44 px) ; les boutons de bascule « See more » et les liens du pied de page sont à mesurer.
- **Tableau `testimonials` inutilisé** : non localisé dans les fichiers lus (`HomeStorySections.tsx`, `HomePremiumSections.tsx`, `flowpoint-landing/` non lus) ; à chercher avec `grep -rn testimonials client/src` puis supprimer.
- **Dépendance `braces`** : l'override `braces → npm:@eriche/braces@3.0.3-patch.1` (npm et pnpm) est un fork tiers. À valider : `npm ls braces`, retirer l'override, `npm audit`, `npm run build`. Non patché (le lockfile n'a pas été lu).
