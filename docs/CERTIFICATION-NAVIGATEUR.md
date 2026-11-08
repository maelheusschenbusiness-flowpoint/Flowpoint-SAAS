# Certification navigateur — visiteur -> abonnement

Objectif : prouver, dans un vrai navigateur et de façon reproductible, le parcours
**visiteur → tarifs → choix du plan → inscription (e-mail ET Google) → création du compte →
paiement (SetupIntent, essai de 14 jours, carte obligatoire) → retour → lien magique → dashboard → abonnement**.

Ce document explique comment lancer la suite en local, contre l'environnement de test, la matrice des
parcours, les critères GO / NO-GO et ce qui n'est vérifiable qu'avec de vrais services.

> Ne vise **jamais** la production (`flowpoint.pro`, `app.flowpoint.pro`, `www.flowpoint.pro`). La configuration
> Playwright et `support/cible.ts` refusent ces hôtes.

## 1. Contenu

| Élément | Chemin |
|---|---|
| Configuration Playwright (3 profils) | `playwright.certification.config.mjs` |
| Suite (fichiers `*.cert.ts`) | `artifacts/api-server/tests/browser/certification/` |
| Harnais local (API + base jetable + faux Stripe/Google/e-mails) | `artifacts/api-server/tests/browser/certification/harness/` |
| Job CI manuel | `.github/workflows/certification-navigateur.yml` |

Les fichiers s'appellent `*.cert.ts` (et non `*.spec.ts`) pour ne pas être comptés comme tests orphelins par
`scripts/verifier-tests-orphelins.mjs` : ils ne tournent pas sous vitest.

Profils : **bureau-1440** (1440×900), **iphone-13** et **pixel-7** (émulation d'appareil sous Chromium).
Trace, vidéo et capture automatique sont **désactivées** (`--trace off`) ; les captures d'écran des étapes clés sont
écrites par le test dans `.out/captures/<profil>/`.

## 2. Lancer en local (aucun service réel)

Prérequis : Node 20+, pnpm 10, PostgreSQL (`apt-get install -y postgresql`), Chromium de Playwright.

```bash
pnpm install --frozen-lockfile
H=artifacts/api-server/tests/browser/certification/harness

$H/run-local.sh up                       # base jetable + serveur sur http://127.0.0.1:4321
export DATABASE_URL=$($H/pg-jetable.sh url)

npx playwright test -c playwright.certification.config.mjs --trace off
# un profil / un fichier :
npx playwright test -c playwright.certification.config.mjs --project=iphone-13 03-google
# rejouer aussi les comportements cibles encore « fixme » (voir §5) :
CERT_RUN_PENDING=1 npx playwright test -c playwright.certification.config.mjs

$H/run-local.sh down                     # arrête le serveur
$H/run-local.sh destroy                  # + supprime la base jetable
```

Rapports : `artifacts/api-server/tests/browser/certification/.out/` (`rapport-html/`, `rapport.json`, `captures/`).
Ouvrir le rapport HTML : `npx playwright show-report artifacts/api-server/tests/browser/certification/.out/rapport-html`.

Si la version de Chromium installée ne correspond pas à `@playwright/test` (cas de certaines sessions),
pointer un binaire existant : `FP_CERT_CHROMIUM=/chemin/vers/chrome-headless-shell`.

### Ce que fait le harnais

* **Base** : cluster PostgreSQL temporaire (`/tmp/fp-cert-pg`, port libre, `127.0.0.1` uniquement), rôles Supabase factices,
  migration **du dépôt depuis zéro** (comme la CI). Le compte applicatif est super-utilisateur, comme `POSTGRES_USER`
  du conteneur de la CI : la RLS est vérifiée par les tests vitest d'isolation, pas par cette suite.
* **Serveur** : la vraie application (`src/app.ts`, mêmes pages statiques et routes) avec `NODE_ENV=test`,
  `STRIPE_TEST_MODE=true`. Le démarrage refuse `NODE_ENV=production` et toute base non locale.
* **Stripe** : `setStripeForTesting` (mécanisme existant de `stripe-factory.ts`) installe un faux Stripe **en mémoire**
  (`fake-stripe.ts` : clients, SetupIntents, moyens de paiement, souscriptions avec essai). Toute méthode non modélisée
  lève `FAKE_STRIPE_UNIMPLEMENTED:<méthode>`. Cartes : `4242…` réussit, `4000 0000 0000 0002` est refusée.
  Côté navigateur, `https://js.stripe.com/**` est remplacé par un **stub** (`stripe-js-stub.js`, route Playwright) :
  champ carte local, `confirmSetup` appelle le faux Stripe. Les webhooks sont livrés **signés** (`/__fake/webhook`).
* **E-mails** : hook existant `TEST_MAIL_DIR` + `ENABLE_TEST_MAILER=true` (`services/mailer.ts`) — fichiers JSON, jamais Resend
  ni SMTP. Le jeton du lien magique est lu dans le fichier capturé.
* **Google** : les appels sortants du callback (`oauth2.googleapis.com/token`, `googleapis.com/oauth2/v3/userinfo`) sont
  interceptés dans le processus du serveur ; l'écran Google est simulé côté Playwright (le test intercepte la réponse de
  `/api/auth/google/login`, relève l'URL Google réelle — `client_id`, `redirect_uri`, `scope`, `state` — puis renvoie le
  navigateur vers le callback local avec le même `state` et le cookie de state). Tout hôte externe est aussi bloqué côté serveur.
* **Limiteurs par IP** (10 authentifications / 15 min) : chaque test envoie un `X-Forwarded-For` distinct (`trust proxy = 1`),
  les limiteurs ne sont ni contournés ni désactivés.

## 3. Lancer contre `flowpoint-test.onrender.com` (Stripe en mode test)

```bash
CERT_BASE_URL=https://flowpoint-test.onrender.com \
  npx playwright test -c playwright.certification.config.mjs --trace off 01-tarifs
```

* Seuls les parcours **en lecture** (`01-tarifs`) tournent à distance. Les autres écrivent des comptes ou lisent la base
  jetable : ils se sautent d'eux-mêmes hors local (`test.skip(!IS_LOCAL)`).
* Réseau : le navigateur doit pouvoir joindre `js.stripe.com`, `hooks.stripe.com` (et `m.stripe.network`, `r.stripe.com`)
  — à autoriser dans le réseau de la session, **ou** exécuter depuis la machine du propriétaire.
* Avant toute soumission : prouver l'isolation — clé publique `pk_test_…` dans la page de paiement (jamais `pk_live_…`),
  base « Flowpoint test », e-mails de test. En cas de doute : ne rien soumettre.
* Il faut : une **boîte de réception de test** (adresse réelle dédiée, lue à la main ou par API), un **compte Google de test**,
  des cartes de test Stripe officielles uniquement.
* Le passage complet contre le test est **manuel** (check-list §6) : `CERT_ALLOW_REMOTE_WRITES=1` n'est pas implémenté
  volontairement, pour ne pas écrire par mégarde sur un environnement partagé.

## 4. Matrice des parcours et états

| # | Fichier | Parcours / état | Bureau | iPhone 13 | Pixel 7 |
|---|---|---|---|---|---|
| 1 | `01-tarifs` | clic sur chaque plan -> parcours direct, plan conservé (PR #374) ; essai 14 j / carte annoncés ; pas de débordement | oui | oui | oui |
| 2 | `02-inscription-email` | 8 validations, compte existant, serveur injoignable, honeypot, plan conservé, rejeu sans doublon d'organisation (PR #379) | oui | oui | oui |
| 3 | `03-google` | départ (plan, `client_id`, `redirect_uri`, `scope`, `state` lié au cookie, PR #367), retour sans donnée personnelle dans l'URL, state forgé / rejoué, e-mail non vérifié, refus, membre invité (PR #371), propriétaire existant | oui | oui | oui |
| 4 | `04-paiement` | nominal (SetupIntent, essai 14 j, finalize, e-mail), carte refusée puis reprise, intent invalide, 500, Stripe.js absent, jeton perdu avant / après la confirmation (chemin C), intent non confirmé ; **cibles** : webhook seul, `success.html`, `redirect_status=failed` | oui | oui | oui |
| 5 | `05-lien-magique-dashboard` | lien -> session -> dashboard (plan, essai 14 j, aucune 401/403/500 inattendue, console propre), usage unique, lien invalide | oui | oui | oui |
| 6 | `06-suivi-conversion` | `cta_clique`, `signup_started`, `signup_form_engaged`, `checkout_started`, `checkout_completed`, `trial_activated` avec consentement ; **aucun** sans consentement ou consentement refusé ; UTM / `fp_lid` conservés ; idempotence | oui | oui | oui |
| 7 | `07-abonnement-etats` | trialing, active, past_due (grâce / terminé), canceled (période valide / terminée), expired : `hasPaidAccess`, 402 `SUBSCRIPTION_REQUIRED` hors période payée, régularisation (`/me`, `/billing/*`, `/plans/*`) toujours ouverte (PR #376) | oui | oui | oui |

Réponses d'API que le produit renvoie volontairement (402 `ADDON_REQUIRED`, 403 `PLAN_REQUIRED`, 401 d'un visiteur anonyme)
ne sont pas comptées comme erreurs ; tout autre 4xx/5xx de `/api/*` ou erreur console de l'origine testée fait échouer le test.
Les messages d'erreur qui désignent un hôte tiers (polices, analytics) sont ignorés : ils relèvent du réseau, pas du produit.

## 5. Tests « comportement cible » (`test.fixme`)

Certains comportements sont corrigés par des PR en cours. Le test décrit **le comportement attendu** ; tant que la PR n'est pas
dans la branche testée il est sauté (`test.fixme`) **avec la référence de la PR**. Ils échouent aujourd'hui : c'est vérifié
(`CERT_RUN_PENDING=1`), ce n'est pas un moyen de masquer un échec.

| Test | PR / branche | Pourquoi |
|---|---|---|
| webhook `setup_intent.succeeded` seul : souscription d'essai créée | `fix/essai-sans-souscription-20261108` | le webhook active le compte (`isTrial: true`) sans créer de souscription |
| `success.html` direct : aucun « Abonnement activé » | `fix/faux-succes-paiement-20261108` | la page affiche le succès sans `session_id` ni vérification |
| `checkout-return.html?redirect_status=failed` sans session : pas de « Paiement enregistré » | `fix/faux-succes-paiement-20261108` | un 401 est présenté comme paiement enregistré |

**Vérifié le 08/11/2026** : `fix/faux-succes-paiement-20261108` (561743d4) et `fix/essai-sans-souscription-20261108` (bd139cfd) fusionnées localement (non poussées) sur cette branche dans un clone d'essai jetable, `CERT_RUN_PENDING=1` : les 3 tests cibles passent sur les 3 profils (le libellé « Paiement échoué » remplace « Erreur de finalisation » sur `redirect_status=failed` ; les tests l'acceptent).

Quand ces branches sont dans la branche testée : fusion **locale non poussée** dans un clone d'essai, `CERT_RUN_PENDING=1`, puis retirer
l'appel `pendingFix(...)` des tests devenus verts (ils entrent alors dans la barrière GO).

## 6. Critères GO / NO-GO

**GO** (tous) :

1. Suite locale : 3 profils, **0 échec**, 0 `fixme` non justifié par une PR listée au §5 (ou §5 vide).
2. `CERT_RUN_PENDING=1` sur la branche qui contient les PR du §5 : **0 échec**.
3. Aucun 5xx, aucune erreur JavaScript de page, aucune erreur console de l'origine sur le parcours nominal (§4, #5).
4. Compte créé = **1** organisation, **1** utilisateur, **1** souscription, quel que soit le rejeu ; essai de 14 jours (`trial_ends_at` ≈ J+14).
5. Aucune ligne `funnel_events` sans consentement.
6. Check-list réelle ci-dessous passée une fois sur `flowpoint-test.onrender.com`.

**NO-GO** : un seul échec de 1–5, un faux succès de paiement (page « confirmé » sans souscription), un compte sans souscription, ou un
événement de suivi émis sans consentement.

## 7. Ce qui n'est vérifiable qu'avec de vrais services (check-list manuelle)

| Service | À vérifier à la main (environnement de test, cartes de test) |
|---|---|
| **Stripe test réel** | `pk_test_…` servi ; Payment Element réel (champs, SCA 3DS `4000 0027 6000 3184`, carte refusée réelle) ; SetupIntent réel ; essai 14 j visible dans le Dashboard Stripe ; webhooks réels (`setup_intent.succeeded`, `customer.subscription.created`) livrés à l'URL de test et signature acceptée ; aucune clé live |
| **Resend** | e-mail d'activation et lien magique réellement reçus (domaine d'envoi vérifié, SPF/DKIM, non classés en spam), rendu mobile |
| **Google** | consentement Google réel, `redirect_uri` déclarée dans la console Google pour le domaine de test, jeton `id_token` signé réel, compte Google de test déjà membre invité |
| **Apple** | « Sign in with Apple » (`/api/auth/apple/*`) : non configuré dans le harnais ; flux réel uniquement sur appareil Apple |
| **Navigateurs réels** | Safari iOS (ITP, cookies `SameSite=Lax` après retour de Google) et Chrome Android : le harnais n'émule que des tailles et agents Chromium |
| **Réseau** | CSP / CORS en production, polices tierces, analytics, bloqueurs de publicités |

## 8. Constats déjà observés par la suite (hors correction dans cette PR)

* P2 — `signin.html` : la liste « e-mails jetables » côté navigateur compare le domaine complet (`mailinator.com`) à des noms sans
  extension (`mailinator`) : elle ne se déclenche jamais ; le serveur refuse (même message). Aucune inscription n'est créée.
* P2 — langue par défaut : `fp-locale.js` lit `localStorage['fp:language']` et retombe sur `en`, même avec un navigateur `fr-FR` ;
  un visiteur français voit donc l'interface anglaise tant qu'il n'a pas choisi. La suite fixe `fr` pour ses assertions.
* Info — le dashboard d'un compte en essai interroge au chargement des routes d'add-ons non possédés (402 `ADDON_REQUIRED`,
  403 `PLAN_REQUIRED`) : comportement voulu côté API, mais la console du navigateur affiche ces erreurs.
* Info — le dashboard annonce l'essai par sa **date de fin** (« Essai gratuit · Expire le … »), pas par un nombre de jours restants.
