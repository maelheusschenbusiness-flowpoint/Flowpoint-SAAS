# Certification du VRAI Stripe (mode TEST) — inscription -> carte -> SetupIntent -> 3DS -> webhook -> souscription unique

> **Lire d'abord.**
> 1. La suite `docs/CERTIFICATION-NAVIGATEUR.md` (#395) utilise un **faux Stripe en mémoire** et un **stub de Stripe.js** : elle ne prouve rien contre le vrai Stripe. Ce document décrit la campagne qui le fait.
> 2. **Rien de ce qui touche Stripe n'a été exécuté dans la session de rédaction** : elle n'atteint ni `js.stripe.com`, ni `hooks.stripe.com`, ni `api.stripe.com` et ne dispose d'aucune clé Stripe. Ce qui a été exécuté (compilation, tests unitaires, garde-fous) est listé au §10 ; le reste est **préparé, non exécuté**.
> 3. **Mode R (`flowpoint-test.onrender.com`) : valable seulement APRÈS fusion et déploiement de la branche d'intégration.** La version actuellement déployée est Test-Replit `994e598`, **sans** les correctifs (#391, #393, #367, #371, #374, #376, #379…). Un NO-GO en Mode R avant déploiement ne dit rien sur le code corrigé. Le **Mode L** (application de cette branche lancée localement) est donc le mode de référence.
> 4. **Jamais de Stripe LIVE.** Tous les scripts et la suite refusent une clé qui ne commence pas par `sk_test_` / `pk_test_`, un environnement qui contient une clé `*_live_`, un compte dont `livemode` n'est pas `false`, et un secret de webhook identique à celui de production. Aucun secret n'est écrit dans le dépôt, les journaux ou les rapports.
> 5. Cibles refusées : `flowpoint.pro`, `app.flowpoint.pro`, `www.flowpoint.pro`. Cibles admises : `127.0.0.1`, `localhost`, `flowpoint-test.onrender.com`. Base SQL : jamais le projet Supabase de production `sejbsuuaeokyuxuoaxzd` ; seulement une base locale jetable ou « Flowpoint test » (`rrjllaiodpvtsphrtdqd`).

## 1. Contenu

| Élément | Chemin |
|---|---|
| Suite Playwright (vrai Payment Element, vrai 3DS) | `artifacts/api-server/tests/browser/certification-stripe/*.stripe.ts` |
| Configuration Playwright | `playwright.certification-stripe.config.mjs` |
| Garde de clés, configuration, calcul des vérifications | `artifacts/api-server/tools/certification-stripe/{garde-cles,config,verifications,nettoyage,rejeu,journal-listen}.ts` |
| Script de preuves côté Stripe (lecture seule) | `.../verifier-stripe.ts` |
| Script de nettoyage (dry-run par défaut) | `.../nettoyer-stripe.ts` |
| Rejeu signé d'un événement vers l'application locale | `.../rejouer-evenement.ts` |
| Analyse du journal de `stripe listen` | `.../analyser-journal-listen.ts` |
| Bilan anti-faux-vert du rapport Playwright | `.../bilan-rapport.ts` |
| SQL de vérification (lecture seule) + enveloppe | `.../sql/verification-lecture-seule.sql`, `.../verifier-base.sh` |
| Tests unitaires (vitest) | `.../*.test.ts` |
| Vérification de types | `artifacts/api-server/tsconfig.certification-stripe.json` |

**Convention de nommage.** Les fichiers de la suite s'appellent `*.stripe.ts` (et non `*.spec.ts` / `*.test.ts`) : vitest ne les collecte pas (`include` = `src|tests|tools/**/*.test.ts`) et `scripts/verifier-tests-orphelins.mjs` (qui ne regarde que `*.test.*` / `*.spec.*`) ne les compte pas comme orphelins — même principe que les `*.cert.ts` de #395. Les tests unitaires des scripts, eux, sont des `*.test.ts` normaux, exécutés par vitest et par la CI.

**Chemin réel de l'URL de webhook.** `src/app.ts` (l.127-129) enregistre **deux** chemins : `/api/webhooks/stripe` (canonique) et `/api/billing/webhook` (historique, endpoint actif du tableau de bord Stripe). Le gestionnaire (`routes/stripe-webhook.ts`, `handleStripeWebhook`) lit en mode test `STRIPE_TEST_WEBHOOK_SECRET`, refuse (503) si la clé n'est pas de test, et refuse (400) un événement dont `livemode` ne correspond pas à son mode. En mode test, `STRIPE_WEBHOOK_SECRET` n'est **pas** lu.

## 2. Accès et secrets nécessaires (liste exacte)

| # | Élément | Mode | Où il vit | Remarque |
|---|---|---|---|---|
| 1 | `STRIPE_TEST_SECRET_KEY` = `sk_test_…` du compte Stripe de TEST | L et R | Environnement local du propriétaire | Lue par les scripts et la suite (preuves). L'application lit `STRIPE_TEST_KEY` **ou** `STRIPE_TEST_SECRET_KEY`. |
| 2 | `STRIPE_TEST_PUBLISHABLE_KEY` = `pk_test_…` | L | Environnement de l'application | Servie au navigateur ; `pk_live_` est ignorée par le serveur. |
| 3 | `STRIPE_TEST_WEBHOOK_SECRET` = `whsec_…` | L | Environnement de l'application ET de la suite | Fourni par la CLI : `stripe listen --print-secret` (secret **local** du listener). |
| 4 | `STRIPE_TEST_PRICE_ID_STANDARD`, `_PRO`, `_ULTRA` (ids `price_…` du compte de TEST) | L | Environnement de l'application | Sans eux, le plan retombe sur son prix LIVE et Stripe refuse (l'application le journalise au démarrage). `STRIPE_TEST_PRICE_ID_PRO` sert aussi à la preuve « price attendu ». |
| 5 | Base PostgreSQL jetable | L | Machine du propriétaire | `artifacts/api-server/tests/browser/certification/harness/pg-jetable.sh start` (cluster local + migration du dépôt). |
| 6 | `JWT_SECRET` (≥ 32 caractères, valeur jetable), `SESSION_SECRET` | L | Environnement de l'application | Valeurs arbitraires locales. |
| 7 | CLI Stripe (`stripe`) connectée au compte de TEST | L | Machine du propriétaire | `stripe login` (compte de test) ; `stripe listen --forward-to …`. |
| 8 | **Boîte de réception de test** : une adresse réelle dédiée `nom@domaine.tld` qui supporte l'adressage `+` | L (facultatif), R (obligatoire) | `CERT_STRIPE_EMAIL_BASE` | La suite génère `nom+fp-cert-<run>-<scénario>@domaine.tld`. En Mode L les e-mails sont capturés sur disque (`TEST_MAIL_DIR`) et rien n'est envoyé ; en Mode R l'application envoie réellement (Resend) : le lien magique est lu à la main dans cette boîte. |
| 9 | **Compte Google de test** (jamais un compte personnel ou client) | R (et L si `GOOGLE_CLIENT_ID/SECRET` de test configurés) | Propriétaire | Google bloque l'automatisation (CAPTCHA, 2FA) : parcours **manuel** (§6, scénario G1). La `redirect_uri` du domaine testé doit être déclarée dans la console Google. |
| 10 | Mode R : accès au tableau de bord Stripe TEST (endpoint de webhook, rejeu manuel) | R | Propriétaire | Pour lire les livraisons et rejouer un événement. |
| 11 | Mode R : variable d'environnement de la base `DATABASE_URL_VERIF` du projet « Flowpoint test » | R | Environnement local du propriétaire | Lecture seule via `verifier-base.sh` ; **jamais** `sejbsuuaeokyuxuoaxzd`. |

### Comment fournir les clés sans jamais les écrire en chat

* **Par défaut (recommandé)** : le propriétaire exécute tout sur sa machine et exporte les variables dans **son** shell (ou un fichier `.env.stripe-cert` **hors dépôt**, `chmod 600`, `set -a; source …; set +a`). Aucune clé ne transite par la conversation.
* **Si l'exécution doit se faire dans la session cloud** : le propriétaire peut choisir d'enregistrer la clé via l'outil sécurisé `request_credential` pour l'hôte `api.stripe.com` (formulaire privé ; la valeur n'est jamais vue par l'agent, le proxy l'injecte dans les requêtes). Les scripts exigent alors la présence de `STRIPE_TEST_SECRET_KEY` dans l'environnement : y mettre une **valeur factice au bon format** (`sk_test_` + 24 caractères quelconques) — le proxy la remplace — ; le garde `livemode === false` (`balance.retrieve`) reste l'arbitre final. Cet outil ne couvre **pas** les secrets qui doivent exister dans le processus (`STRIPE_TEST_WEBHOOK_SECRET`, `JWT_SECRET`, base de données) : le Mode L complet reste donc un mode « machine du propriétaire ». **Cette session n'a pas appelé `request_credential`.**
* Ne jamais coller une clé, un `whsec_`, une URL de base ou un jeton dans un commentaire de PR, un ticket ou le chat. Les scripts masquent toute valeur secrète dans leurs messages d'erreur (`masquerSecrets`).
* Hygiène : cadrer la campagne dans un shell **sans** `STRIPE_LIVE_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (la suite refuse de démarrer sinon).

## 3. Hôtes réseau à autoriser (environnement de la session cloud)

Pour exécuter la suite depuis la session (sinon : machine du propriétaire, sans restriction) :

| Hôte | Rôle |
|---|---|
| `js.stripe.com` | Stripe.js et iframes du Payment Element (`/v3/`, `elements-inner-payment-*`) |
| `m.stripe.network` | iframe « controller » / métriques de Stripe.js |
| `m.stripe.com`, `r.stripe.com`, `q.stripe.com` | télémétrie et anti-fraude de Stripe.js |
| `hooks.stripe.com` | page d'authentification 3DS (de test ou réelle) |
| `api.stripe.com` | API appelée par le navigateur (confirmation du SetupIntent) et par les scripts de preuve |
| `b.stripecdn.com`, `files.stripe.com`, `merchant-ui-api.stripe.com` | ressources statiques / configuration d'éléments |
| `flowpoint-test.onrender.com` (Mode R) ou `127.0.0.1` (Mode L) | l'application testée |

**Liste à confirmer par un passage réel.** Stripe documente `js.stripe.com`, `m.stripe.network`, `hooks.stripe.com`, `api.stripe.com` ; les autres hôtes ci-dessus dépendent de la version de Stripe.js. Le test nominal enregistre les hôtes réellement joints par le navigateur dans `artifacts/api-server/tests/browser/certification-stripe/.out/hotes-reseau.txt` : après le premier passage, **cette liste fait foi** pour l'allowlist de l'environnement. Aucune entrée avec caractère générique n'est requise (`*.stripe.com` est un choix de réglages, pas du code).

## 4. Mode L — application intégrée en local (mode de référence)

```bash
# 0. Branche d'intégration + dépendances
git fetch origin integration/test-replit-20261108 && git checkout integration/test-replit-20261108   # ou cette branche
pnpm install --frozen-lockfile

# 1. Base PostgreSQL jetable (jamais distante) + migration du dépôt
H=artifacts/api-server/tests/browser/certification/harness
$H/pg-jetable.sh start                       # affiche l'URL ; $H/pg-jetable.sh url pour la relire
export DATABASE_URL=$($H/pg-jetable.sh url)
export DATABASE_URL_VERIF="$DATABASE_URL"    # pour verifier-base.sh

# 2. Environnement de TEST (dans CE shell uniquement ; rien dans le dépôt)
unset STRIPE_LIVE_API_KEY STRIPE_SECRET_KEY STRIPE_WEBHOOK_SECRET STRIPE_WEBHOOK_SECRET_RENDER PUBLIC_STRIPE_API_KEY STRIPE_PUBLISHABLE_KEY
export NODE_ENV=development                  # PAS « production » : l'application refuse de démarrer avec sk_test_ en production
export PORT=8080 PUBLIC_URL=http://127.0.0.1:8080 PUBLIC_BASE_URL=http://127.0.0.1:8080
export JWT_SECRET="$(openssl rand -hex 32)" SESSION_SECRET="$(openssl rand -hex 32)"
export STRIPE_TEST_MODE=true
export STRIPE_TEST_SECRET_KEY=sk_test_…      # ne pas coller dans le chat
export STRIPE_TEST_KEY="$STRIPE_TEST_SECRET_KEY"
export STRIPE_TEST_PUBLISHABLE_KEY=pk_test_…
export STRIPE_TEST_PRICE_ID_STANDARD=price_… STRIPE_TEST_PRICE_ID_PRO=price_… STRIPE_TEST_PRICE_ID_ULTRA=price_…
export TEST_MAIL_DIR=/tmp/fp-stripe-mails ENABLE_TEST_MAILER=true     # e-mails capturés, rien n'est envoyé
export CERT_STRIPE_REEL=1 CERT_STRIPE_BASE_URL=http://127.0.0.1:8080 CERT_STRIPE_EMAIL_BASE=nom@domaine.tld

# 3. Webhook : la CLI fournit un whsec LOCAL et relaie les événements réels du compte de test
export STRIPE_TEST_WEBHOOK_SECRET=$(stripe listen --print-secret)
stripe listen --forward-to localhost:8080/api/billing/webhook 2>&1 | tee /tmp/stripe-listen.log &   # ou /api/webhooks/stripe

# 4. Application (build + démarrage) dans un second terminal avec les mêmes variables
pnpm --filter ./artifacts/api-server run dev
# Au démarrage, le journal doit afficher « [Stripe] mode: TEST | webhook: TEST | publishable: TEST (pk_test…) » et aucune erreur « price » live.

# 5. Suite navigateur (vrai Stripe)
npx playwright test -c playwright.certification-stripe.config.mjs --trace off
npx tsx artifacts/api-server/tools/certification-stripe/bilan-rapport.ts      # NO-GO si un test est saute ou échoue

# 6. Preuves par scénario (voir §7) puis nettoyage (§8)
```

Notes :
* `stripe listen --print-secret` : option de la CLI à confirmer pour la version installée ; à défaut, lancer `stripe listen` et copier le `whsec_` affiché **dans le shell**, pas dans le chat.
* Si le serveur local a besoin de plus de variables (Resend, Google…), elles sont inutiles pour ce parcours : les e-mails sont capturés et Google est hors suite automatisée.
* La suite refuse de s'exécuter si l'environnement contient une clé live ou si une variable requise manque (§9 « skip propre »).

## 5. Mode R — `flowpoint-test.onrender.com` (APRÈS déploiement de l'intégration)

Préconditions, **toutes** à vérifier avant d'interpréter un résultat :

1. La branche d'intégration est fusionnée dans `Test-Replit` **et** déployée (Render) ; le commit déployé n'est plus `994e598`. (Contrôle : `GET /api/health` / journal de déploiement Render.)
2. `render.yaml` : le service test a `STRIPE_TEST_MODE=true`, `STRIPE_TEST_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `STRIPE_TEST_PUBLISHABLE_KEY`, `STRIPE_TEST_PRICE_ID_*` renseignés **dans Render** (jamais dans Git).
3. Le tableau de bord Stripe TEST contient un **endpoint** `https://flowpoint-test.onrender.com/api/billing/webhook` (ou `/api/webhooks/stripe`) abonné au minimum à : `setup_intent.succeeded`, `payment_intent.succeeded`, `customer.subscription.created|updated|deleted`, `invoice.payment_succeeded|payment_failed`, `checkout.session.completed` ; son secret de signature est celui de `STRIPE_TEST_WEBHOOK_SECRET`.
4. Isolation prouvée (comme exigé par #395 §3) : `pk_test_…` dans la page de paiement, base « Flowpoint test », e-mails de test. **En cas de doute : ne rien soumettre.**

```bash
export CERT_STRIPE_REEL=1 CERT_STRIPE_BASE_URL=https://flowpoint-test.onrender.com CERT_STRIPE_EMAIL_BASE=nom@domaine.tld
export STRIPE_TEST_SECRET_KEY=sk_test_…          # preuves côté Stripe ; ne pas coller dans le chat
npx playwright test -c playwright.certification-stripe.config.mjs --trace off 01-nominal 02-3ds 03-refus 04-onglet-ferme 05-double-clic
```

Particularités du Mode R : l'application envoie de **vrais** e-mails (Resend) à `nom+fp-cert-…@domaine.tld` (lien magique à relire dans la boîte) ; le scénario 6 (rejeu signé) n'est pas disponible (pas de `whsec_` exportable d'un endpoint) : le rejeu se fait depuis le tableau de bord Stripe (§6, S3) ; la preuve de livraison est `pending_webhooks = 0` côté API **et** la liste des livraisons de l'endpoint dans le tableau de bord (non lisible par API publique : à confirmer).

## 6. Matrice des scénarios

**Cartes de test OFFICIELLES Stripe** (à confirmer dans la documentation Stripe « Testing » avant la campagne ; les comportements sur *SetupIntent* peuvent différer de ceux sur paiement) : date d'expiration future quelconque (ex. `12 / 34`), CVC à 3 chiffres quelconque, code postal quelconque.

| Carte | Numéro | Comportement attendu (Stripe) | Certitude |
|---|---|---|---|
| Succès | `4242 4242 4242 4242` | Succès, sans authentification | sûr |
| 3DS requis | `4000 0025 0000 3155` | 3DS2 requis (challenge), y compris pour enregistrer la carte | sûr (à confirmer pour SetupIntent) |
| 3DS requis sur toutes les transactions | `4000 0027 6000 3184` | Authentification demandée à chaque opération (cité par #395 §7) | à confirmer |
| Refus générique | `4000 0000 0000 0002` | `card_declined` | sûr |
| Refus « fonds insuffisants » | `4000 0000 0000 9995` | `card_declined` / `insufficient_funds` | **à confirmer** : décrite pour les paiements ; son effet à l'enregistrement d'une carte (SetupIntent) peut être un succès suivi d'un échec au premier prélèvement |
| 3DS réussi puis refus | `4000 0084 0000 1629` | Authentification requise **puis** refus de la carte | **à confirmer** (l'énoncé de mission le range sous « échec d'authentification ») ; l'**échec d'authentification** proprement dit se teste avec la carte 3155 et le bouton « Fail authentication » du faux écran 3DS |

Chaque scénario nécessite un **e-mail neuf** (`nom+fp-cert-<run>-<scénario>@domaine.tld`, généré). Les preuves sont : `P-Stripe` = `verifier-stripe.ts` (ou `exigerPreuvesStripe` dans la suite), `P-SQL` = `verifier-base.sh`, `P-Journal` = `analyser-journal-listen.ts` (Mode L), `P-Capture` = capture d'écran Playwright / journal de la console.

| # | Scénario | Fichier / mode | Actions | Résultat attendu | Preuves | GO / NO-GO |
|---|---|---|---|---|---|---|
| N1 | Nominal e-mail, carte 4242 | `01-nominal` L, R | `/pricing.html` plan pro -> `signin.html` -> récapitulatif -> `checkout-payment.html` -> carte 4242 dans l'iframe réelle -> « Démarrer l'essai gratuit » | Retour `checkout-return.html` « Compte activé » ; **1** customer, **1** souscription `trialing`, `trial_end` ≈ +14 j, price attendu, quantité 1, moyen de paiement par défaut rattaché ; `setup_intent.succeeded` et `customer.subscription.created` émis et livrés 2xx ; organisation `trialing` | P-Stripe, P-Journal ou tableau de bord, P-SQL, e-mail d'activation (capturé en L, reçu en R) | **GO** : toutes les lignes `OK`, 0 écart. **NO-GO** : une ligne `FAIL`, une 4xx/5xx de webhook, une 2ᵉ souscription |
| N2 | 3DS requis, authentification réussie | `02-3ds` L, R | carte `4000 0025 0000 3155` -> faux écran 3DS (hooks.stripe.com) -> « Complete authentication » | Idem N1 | idem N1 + capture de l'écran 3DS | idem N1 |
| N3 | 3DS échoué / abandonné | `02-3ds` L, R | carte 3155 -> « Fail authentication » (puis, variante : fermer la fenêtre 3DS) | Message d'erreur sur la page de paiement, URL inchangée ; **aucune** souscription vivante ; au plus 1 customer ; organisation **absente ou non `trialing`** ; aucun « Compte activé » | P-Stripe (cas négatif), P-SQL (org non premium) | **NO-GO** si une souscription existe ou si la page affiche un faux succès |
| N4 | Carte refusée puis reprise | `03-refus` L, R | carte 0002 (puis 9995, à confirmer) -> message -> même page, carte 4242 | Message clair, bouton redevenu actif, aucune souscription avant la reprise ; après reprise : état N1, **1** seule souscription | P-Stripe avant et après | **NO-GO** si une souscription apparaît avant la reprise ou si l'on en compte 2 |
| N5 | 3DS réussi puis refus (4000 0084 0000 1629, à confirmer) | `02-3ds` L, R | carte 1629 -> 3DS -> réussite | Aucune souscription (ou comportement documenté de Stripe consigné) | P-Stripe (cas négatif) | NO-GO si souscription créée alors que Stripe a refusé la carte |
| S1 | **Onglet fermé juste après `confirmSetup`** (PR #393) | `04-onglet-ferme` L (listener actif), R | la suite **bloque** `/api/public/finalize-checkout` côté navigateur, attend la réponse 200 de `…/setup_intents/seti_…/confirm`, **ferme l'onglet** | Le **webhook seul** crée la souscription : 1 customer, 1 souscription `trialing`, organisation `trialing`, e-mail d'activation | P-Stripe (jusqu'à 3 min), P-SQL, P-Journal | **NO-GO** si aucune souscription après 3 min (c'était le défaut avant #393) ou si 2 |
| S2 | Double clic / deux onglets | `05-double-clic-deux-onglets` L, R | double clic sur le bouton ; second onglet sur la même page de paiement, confirmations simultanées | **1** souscription, **1** customer, stable 15 s après | P-Stripe + stabilité, P-SQL (`une seule organisation`) | **NO-GO** dès la 2ᵉ souscription ou le 2ᵉ customer |
| S3 | **Rejeu manuel d'un événement** (idempotence) | L : `06-webhook-retard-rejeu` (rejeu ×3 signé) ; R : tableau de bord | R : Développeurs -> Webhooks -> endpoint -> événement `setup_intent.succeeded` -> « Resend » (plusieurs fois). L : `rejouer-evenement.ts --event evt_… --fois 3` ou `stripe events resend evt_…` (à confirmer) | Toujours **1** souscription ; chaque réponse 2xx ; une seule ligne `billing_events` par `stripe_event_id` (UNIQUE) | P-Stripe après chaque rejeu, P-SQL (ligne 11 et liste des événements) | **NO-GO** si le nombre de souscriptions augmente |
| S4 | **Webhook en retard** | `06-webhook-retard-rejeu` L (`CERT_STRIPE_LISTENER_ARRETE=1`) | Arrêter `stripe listen`, confirmer la carte (finalize bloqué), constater l'absence de souscription, puis rejouer l'événement | Avant rejeu : 0 souscription (carte enregistrée mais compte non activé, pas de faux succès) ; après : 1 | P-Stripe avant / après | **NO-GO** si une souscription apparaît sans webhook (donc sans signature) ou si 2 après rejeu |
| G1 | **Inscription Google** (manuel) | R (ou L avec identifiants Google de test) | `signin.html` -> « Continuer avec Google » avec le compte Google de test -> mêmes étapes carte (4242) | Même état final que N1 pour l'e-mail du compte Google | P-Stripe (`verifier-stripe.ts --email <adresse Google>`), P-SQL, capture du consentement Google | idem N1. Nettoyage : `--email-exact` |
| M1 | **Lien magique** | R (boîte réelle), L (fichier capturé) | Ouvrir le lien reçu après N1 | Session ouverte, dashboard, essai visible (date de fin ≈ +14 j) ; lien à usage unique | capture du dashboard | NO-GO si 401/403/500 sur le parcours nominal |

## 7. Preuves : commandes

```bash
T=artifacts/api-server/tools/certification-stripe
EMAIL=nom+fp-cert-<run>-nominal-1@domaine.tld     # affichée par la suite en cas d'échec ; sinon voir « .out/rapport.json »

# Côté Stripe (lecture seule, clé sk_test_ lue dans l'environnement, jamais affichée)
npx tsx $T/verifier-stripe.ts --email "$EMAIL" --price "$STRIPE_TEST_PRICE_ID_PRO" --since 2026-11-08T00:00:00Z
#   OK/FAIL par ligne : 1 customer ; 1 souscription ; trialing ; trial_end ~ création+14 j ; price ; quantité ;
#   moyen de paiement par défaut rattaché ; aucune souscription orpheline ; setup_intent.succeeded et
#   customer.subscription.created émis ; pending_webhooks = 0 (évènements livrés à un endpoint enregistré).
#   Code de sortie : 0 GO, 1 NO-GO, 2 refus (clé non test, compte live, argument manquant).

# Côté base (lecture seule ; refuse la production ; transaction READ ONLY)
DATABASE_URL_VERIF=… artifacts/api-server/tools/certification-stripe/verifier-base.sh "$EMAIL" sub_… [seti_…]
#   une seule organisation, un seul utilisateur, subscription_status=trialing, stripe_subscription_id = Stripe,
#   stripe_customer_id, trial_ends_at ~ +14 j, trial_consumed_at, pending_signups consommé, aucune appartenance parasite,
#   funnel_events (idempotence du checkout_completed du SetupIntent), aucun billing_events « failed ».

# Livraison du webhook (Mode L) : journal de la CLI
npx tsx $T/analyser-journal-listen.ts /tmp/stripe-listen.log --requis setup_intent.succeeded,customer.subscription.created
```

Mode L et `pending_webhooks` : les événements relayés par `stripe listen` ne sont **pas** comptés comme livraisons d'un endpoint enregistré ; en Mode L la preuve de livraison est donc le **journal du listener** (réponses `[200]`), et le test ne contrôle pas `pending_webhooks`. En Mode R, il est exigé égal à 0.

**À confirmer.** L'API publique Stripe n'expose pas, à notre connaissance, la liste des tentatives de livraison par endpoint (visible dans le tableau de bord, « Event deliveries ») : `pending_webhooks = 0` est le substitut disponible par API ; l'historique des tentatives et leurs codes de réponse se relèvent dans le tableau de bord (capture d'écran jointe au rapport). Idem pour le format exact des lignes de `stripe listen` attendu par l'analyseur (testé sur le format documenté, à re-vérifier avec la version installée).

## 8. Nettoyage (dry-run par défaut)

```bash
# Liste ce qui serait fait (rien n'est modifié)
npx tsx $T/nettoyer-stripe.ts --email-base nom@domaine.tld --since 2026-11-08T00:00:00Z
# Applique : annule les souscriptions de campagne et supprime ces customers de TEST
npx tsx $T/nettoyer-stripe.ts --email-base nom@domaine.tld --since 2026-11-08T00:00:00Z --apply
# Parcours Google : adresse exacte du compte de test
npx tsx $T/nettoyer-stripe.ts --email-exact compte.google.test@gmail.com --since 2026-11-08T00:00:00Z --apply
```

Périmètre : uniquement les customers **créés après `--since`** dont l'e-mail correspond à `nom+fp-cert-<…>@domaine.tld` (ou aux adresses exactes passées). Un customer « réel » ou un alias `nom+famille@…` n'est jamais touché (couvert par les tests). Le script refuse toute clé non `sk_test_` et tout compte `livemode != false`. La base jetable se détruit par `pg-jetable.sh destroy` ; la base « Flowpoint test » n'est **pas** nettoyée par ces scripts (écritures interdites ici).

## 9. Skip propre et anti-faux-vert

* Sans `CERT_STRIPE_REEL=1`, sans l'une des variables requises, avec une clé live dans l'environnement ou une cible de production : **tous les tests sont sautés** avec l'annotation `skip` qui énumère **chaque** raison (visible dans `rapport.json`). Une cible de production fait même échouer le chargement de la configuration.
* Un test sauté n'est pas un succès : `bilan-rapport.ts` rend **NO-GO** s'il y a un test sauté, un échec, ou aucun test exécuté. Le critère GO exige donc `passés = total, sautés = 0, échecs = 0`.
* Les preuves Stripe sont réinterrogées jusqu'à 120-180 s (les webhooks sont asynchrones) puis échouent avec la liste des lignes `FAIL`.

## 10. Ce qui a été exécuté dans la session de rédaction (08/11/2026)

* `tsc -p artifacts/api-server/tsconfig.certification-stripe.json` (scripts + suite Playwright) : **0 erreur** ; `tsc -p artifacts/api-server/tsconfig.json --noEmit` : inchangé, **0 erreur**.
* `vitest run tools/certification-stripe` : **36 tests passés** (garde de clés live/test, configuration et saut explicite, adresses `+`, calcul des vérifications avec un faux client Stripe en mémoire — deux customers, deux souscriptions, status, `trial_end`, price, quantité, moyen de paiement, orpheline, événements, `livemode` —, nettoyage dry-run/apply, rejeu local seulement, analyse du journal `stripe listen`, bilan anti-faux-vert).
* Exécution réelle des scripts : `verifier-stripe.ts` et `nettoyer-stripe.ts` avec une clé `sk_live_` -> **refus, code 2**, clé jamais affichée ; clé absente -> refus ; `STRIPE_LIVE_API_KEY` présent dans l'environnement -> refus ; `rejouer-evenement.ts` vers `flowpoint-test.onrender.com` -> refus ; `verifier-base.sh` avec l'identifiant du projet de production ou un hôte inconnu -> refus.
* Suite Playwright : `playwright test -c playwright.certification-stripe.config.mjs` sans variables -> **10 sautés** (annotation avec toutes les raisons), `bilan-rapport.ts` -> **NO-GO (sautés = 10)** ; avec `CERT_STRIPE_BASE_URL=https://app.flowpoint.pro` -> **chargement refusé** (production).
* SQL de vérification exécuté sur une base PostgreSQL **jetable locale** (schéma réel du dépôt) : cas vide (NO-GO), cas nominal semé (11 lignes `t`), écriture refusée par la transaction en lecture seule.
* `pnpm --filter ./artifacts/api-server run test:orphans` : **0 orphelin**.
* **Non exécuté** (exige les accès du §2) : tout ce qui appelle js/api/hooks.stripe.com (Payment Element réel, 3DS, webhooks réels), `verifier-stripe.ts` et `nettoyer-stripe.ts` contre un compte réel, le rejeu d'événements réels, le Mode R, le parcours Google, l'envoi réel d'e-mails.

## 11. Points à confirmer au premier passage réel

1. Sélecteurs internes du Payment Element (`input[name="number"|"expiry"|"cvc"|"postalCode"]`, onglet « Carte », bouton « Complete authentication » / « Fail authentication » dans l'iframe hooks.stripe.com) : écrits d'après la structure documentée de Stripe ; corriger `support/stripe-reel.ts` (`saisirCarte`, `repondre3ds`) si Stripe a modifié l'interface.
2. Numéros de cartes et comportement sur SetupIntent (tableau du §6, colonne « Certitude »).
3. Liste réelle des hôtes réseau (`.out/hotes-reseau.txt`).
4. Format des lignes de `stripe listen` et option `--print-secret`.
5. Disponibilité d'un historique des tentatives de livraison par API (sinon : tableau de bord).
6. `trial_end` : la tolérance de ±6 h autour de « création de la souscription + 14 j » est un choix de la campagne ; l'essai est fixé par le serveur (`TRIAL_DAYS = 14`, `signup-subscription.ts`). Aucune règle commerciale (prix, essai de 14 jours, carte obligatoire) n'est modifiée par ce travail.
