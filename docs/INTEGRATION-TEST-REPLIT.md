# Integration de 39 PR (#359-#387, #391-#395, #397-#401) — branche `integration/test-replit-20261108`

Cette branche n'est PAS `Test-Replit`. Elle contient les 29 PR #359-#387 puis, empilees dessus, les 5 PR #391, #392, #394, #393, #395 (voir section 9), fusionnees dans un ordre determine, les conflits
resolus et les corrections semantiques en commits SEPARES. Rien n'est fusionne dans `Test-Replit`, aucune branche
de PR n'a ete modifiee, aucune migration n'a ete appliquee hors base jetable locale.

Base : `Test-Replit` @ 994e598. Les 29 PR partent toutes de ce commit. #371 contient le commit de #367 ; #387 contient celui de #386
(fusionner l'une apres l'autre est donc sans doublon).

## 1. Ordre d'integration et justification

| # | PR | Raison de la position |
|---|----|----------------------|
| 1-2 | #386, #387 | Infrastructure de tests d'abord : #387 remplace la liste blanche de `vitest.config.ts` par un glob. Toutes les autres PR ajoutaient une ligne `include` dans ce fichier (27 conflits garantis) ; apres #387 ces lignes sont caduques et supprimees. #386 est empilee sous #387. |
| 3-9 | #378, #365, #360, #366, #359, #364, #380 | Socle securite sans dependance metier : config/JWT, logs, comparaisons constantes, SSRF (#359/#364/#380 partagent `url-fetcher.ts`). |
| 10-12 | #362, #367, #371 | CORS/CSRF/cookie, puis OAuth (#371 empilee sur #367) : touchent tous `auth.ts`. |
| 13-16 | #363, #385, #379, #383 | Facturation/quotas, comptes en double, hygiene du depot. |
| 17-26 | #370, #375, #361, #368, #372, #369, #377, #384, #374, #381 | Metier. #375 apres #370 (meme `gbp-posts.ts`) ; les PR touchant `dashboard.js` sont groupees pour resoudre les cles i18n a la suite. |
| 27 | #382 | RLS / inventaire `pool.query` : apres toutes les PR qui ajoutent des acces bruts, pour regenerer le baseline une fois. |
| 28 | #373 | Garde de role : apres toutes les PR qui ajoutent des routes, pour que son inventaire voie l'ensemble. |
| 29 | #376 | Garde d'abonnement (`planGate`) : en dernier, elle s'applique a toutes les routes deja presentes. |

Les graphes de dependances (empilement) : #386 -> #387 ; #367 -> #371. Dependances de fichiers sans empilement :
#359/#364/#380 (`url-fetcher.ts`), #360/#378 (`requireAuth.ts`), #360/#362/#367/#371 (`auth.ts`), #363/#385 (`billing-service.ts`),
#368/#372/#385 (`local-maps*.ts`), #370/#375 (`gbp-posts.ts`, `gbp-posting-service.ts`), #361/#368/#369/#372/#377/#384 (`dashboard.js`),
#377/#385 (`automation.ts`), #373/#376/#385 (`planGate`/routes), #379/#382 (migration 025).

## 2. Conflits git et leur resolution

| Fichier | PR | Nature | Decision |
|---|---|---|---|
| `artifacts/api-server/vitest.config.ts` | 27 PR | Lignes `include` ajoutees dans une liste supprimee par #387 | Version glob de #387 conservee ; 28 lignes `include` abandonnees (les fichiers sont couverts par le glob ; le garde-fou orphelins confirme 0 orphelin). |
| `middlewares/requireAuth.ts` | #378 + #360 | Imports adjacents | Les deux imports conserves. |
| `routes/auth.ts` | #360 + #362 | Imports adjacents | Les deux conserves. |
| `services/url-fetcher.ts` | #359 + #380 | Signature de `pinnedRequest` : #359 `init?: PinnedRequestInit`, #380 `method` positionnel | Signature de #359 retenue ; `probeUrlPinned` de #380 appelle `pinnedRequest(url, signal, { method })`. |
| `services/billing-service.ts` | #363 + #385 | Imports de `usage-events.js` | Fusionnes en un seul import. |
| `routes/gbp-posts.ts` | #370 + #375 | Bloc `catch` de `/publish` : 404 inter-org (#370) vs erreurs typees (#375) | Branche 404 `GBP_POST_NOT_FOUND_OR_ALREADY_PUBLISHED` conservee AVANT le mapping de #375 (ce code n'est pas dans `GBP_PUBLISH_ERRORS` : sinon 500). |
| `routes/local-maps.ts` | #385 + #368 | Les deux ajoutent le meme `requireQuota("heatmaps")` | Version en ligne de #385 conservee (comportement identique). |
| `dashboard.js` (x2 copies) | #361/#368, #372, #369/#377, #377/#384 | Cles i18n EN ajoutees au meme endroit | Union des cles ; `cmp` confirme les deux copies identiques, `node --check` OK. |
| `migrations/025_*.sql` | #379 + #382 | Meme numero (pas de conflit git, noms differents) | Voir section 3. |

## 3. Migration en doublon

`025_organizations_owner_email_unique.sql` (#379) garde le numero 025 ; `025_rls_activity_logs_tenant_policies.sql` (#382) devient
`026_rls_activity_logs_tenant_policies.sql` (git mv, SQL inchange, idempotent, non destructif). Les references (`rls-activity-logs-migration-db.test.ts`)
sont mises a jour. Dernier numero sur `Test-Replit` : 024. Les fichiers `migrations/*.sql` ne sont executes ni par `pnpm run migrate` ni au demarrage
(voir `migrations/README.md`) : seuls les tests DB les lisent. Il n'y a donc aucun risque pour `migrate` ni la CI ; l'application sur une base reelle reste
une decision humaine, dans l'ordre 025 puis 026.

## 4. Conflits semantiques (invisibles pour git) et corrections (commits separes)

| Interaction | Constat | Correction |
|---|---|---|
| #373 x #384 | `POST /auth/sessions/:id/revoke` (#384) tombait sous la garde par defaut owner/admin/member : un viewer ne pouvait plus terminer SA session, contrairement a l'intention de #384 | Exception documentee dans `writeRoleGuard.ts`, liste figee de l'inventaire et test de classification mis a jour (d04d96f). |
| #373 x #377/#385 | `write-role-guard.test.ts` mockait `planGate` sans `requireQuota` (ajoute sur `/automation/workflows`) | Mock complete (5a80109). |
| #377 x #385 | `quota-coverage-db.test.ts` creait un workflow `manual`/actions vides, refuse par #377 (D-07) | Le test utilise un evenement emis + une action executable ; le plafond 429 reste verifie (8e94493). |
| #377 x #385 | `automation-honesty.test.ts` : meme mock `planGate` incomplet | Mock complete (8e94493). |
| #368 x #385 | `local-maps-scan.test.ts` attendait `heatmapQuota` dans la source | Regex acceptant les deux formes (8e94493). |
| #382 x autres | Baseline `pool.query` perime (+8 acces) | Regenere apres revue : 5 acces filtres par `org_id`, 3 volontairement globaux (2 recuperations cron de `gbp_posts` de #375, 1 recherche utilisateur pre-organisation a l'inscription Google) (729012f). |
| #362 x #367 | Callback Apple `form_post` | Verifie : l'exception CSRF (`/api/auth/apple/callback`) correspond a la route de #367, le cookie d'etat Apple est `SameSite=None` en prod. Pas de correction. |
| #373/#376 x routes de #369 (`/reports/share/:token`), #377, #375, #385 | Seules routes GET publiques ou ecritures deja sous la garde par defaut | Verifie par l'inventaire (261+ routes) ; pas de correction. |
| Erreur de ma part | Le merge de #368 (f9e054d) a commite par erreur des marqueurs de conflit dans `vitest.config.ts` ; corrige par 20eee50 | L'etat intermediaire f9e054d..5a80109 n'est donc pas valide ; utiliser le resultat final. Ne pas fusionner commit par commit. |

## 5. Tests

Local : PostgreSQL 16.15 (la CI est en PG17), base jetable 127.0.0.1, roles Supabase factices comme `ci.yml`. Sequence : `pnpm install --frozen-lockfile`,
`pnpm run migrate` depuis zero (771 etapes OK, 0 echec, 133 tables), `typecheck`, `build`, `vitest run --no-file-parallelism --testTimeout=60000`, `test:certification`,
garde-fou orphelins.

| | Baseline `Test-Replit` | Integration |
|---|---|---|
| migrate depuis zero | OK | OK |
| typecheck | 0 erreur | 0 erreur |
| build | OK | OK |
| vitest | 252 fichiers OK, 1 en echec ; 3178 tests OK, 2 echecs, 25 ignores | 303 fichiers OK, 1 en echec ; 3863 tests OK, 2 echecs, 6 ignores |
| `test:certification` | script absent | OK (rc=0) |
| orphelins | script absent | 0 orphelin (327 fichiers : 306 executes, 21 exclus avec raison) |
| dashboard.js x2 | — | `cmp` identiques |

Les 2 echecs sont IDENTIQUES dans les deux colonnes : `stripe-webhook-pending-activation.test.ts` (duree ~1010-1015 ms pour un seuil a 1000). Ils ne sont pas
repares ni relaches ; ils echouent sur `Test-Replit` seul en local. Aucune regression due a l'integration. Les tests d'inventaire des roles, CSRF, d'isolation RLS et de
migration font partie de cette suite complete et passent. CI GitHub (PG17) : voir la PR brouillon.

## 6. Risques restants

- L'integration ne prouve pas le comportement en production : pas de test contre Supabase/Stripe/Google reels.
- 2 echecs de duree preexistants (seuil 1000 ms) : possibles aussi en CI selon la machine.
- Les migrations 025 et 026 ne sont pas executees automatiquement ; a appliquer manuellement (025 d'abord) apres sauvegarde. 025 ajoute un index unique : lancer d'abord
  `migrations/diagnostics/025_detect_duplicate_org_owner_email.sql` pour detecter les doublons existants.
- #376 (garde d'abonnement) et #373 (garde de role) durcissent l'acces : possibles refus (403/402) inattendus pour des comptes en statut limite ; a verifier sur Test avant la production.
- #385 et #368 appliquent un quota heatmaps (2/10/50) : des organisations deja au-dessus ne peuvent plus en creer.
- Les validations intermediaires par etape (typecheck a chaque merge) n'ont pas ete systematiques : typecheck execute apres #380, #385, #375 et sur le resultat final ; l'etat final est complet.

## 9. Second lot : PR #391 a #395 (empilees, base = branche d'integration)

Ordre de fusion : **#391, #392, #394, #393, #395**. Chaque PR part de la tete d'origine f0adcf7 ; merges `--no-ff`, typecheck apres #391/#392/#394 puis apres #393.

| PR | Branche | Contenu |
|---|---|---|
| #391 | fix/faux-succes-paiement-20261108 | `success.html`, `checkout-return.html`, `checkout-payment.html`, `fp-locale.js` (plus de faux succes de paiement) ; ajoute jsdom (devDependency) |
| #392 | fix/credits-ia-sessions-20261108 | credits IA atomiques, sessions, plan Pro par defaut, send-invoice, colonne `language`, garde de role |
| #394 | fix/webhook-credits-ia-verification-20261108 | `services/ai-credit-verification.ts` : controle pack/montant/organisation des credits IA dans `stripe-webhook.ts` |
| #393 | fix/essai-sans-souscription-20261108 | A-09 : souscription d'essai creee par le webhook (`services/signup-subscription.ts`), blocs 3a/3b de `public-billing.ts` remplaces, diagnostic `migrations/diagnostics/a09_trialing_sans_souscription.sql` |
| #395 | test/certification-parcours-20261108 | certification navigateur (harnais, 7 fichiers `*.cert.ts`, `playwright.certification.config.mjs`, workflow manuel `certification-navigateur.yml`) ; aucun code applicatif |

### Conflits git
Aucun conflit textuel : les cinq merges ont abouti automatiquement, y compris `stripe-webhook.ts` entre #393 et #394 (zones disjointes), `pool-query-baseline.json` (+4 lignes de chaque cote, ajouts distincts) et `pnpm-lock.yaml` (jsdom de #391 ; `pnpm install --frozen-lockfile` reussit sans regeneration).

### Conflits semantiques
| Interaction | Verification / correction |
|---|---|
| #393 x #394 (`case payment_intent/setup_intent.succeeded`) | Relu apres merge : la branche `ai_credits` (#394, verification pack/montant/org, 422 si rejet) s'execute AVANT le chemin d'inscription (#393, `provisionSubscriptionFromIntent` sans `.catch`, `activateNewSignup(requireSubscription)`) ; les deux restent actives. Tests des deux PR verts ensemble. |
| #392 x inventaires (garde de role / abonnement / CSRF) | Suites `write-role-*`, planGate, CSRF vertes ; #392 ne modifie que l'exception documentee de `writeRoleGuard.ts`. |
| Baseline `pool.query` | Les deux PR ajoutent des entrees ; test de baseline vert sans regeneration. |
| **Course A-09 (#393 seule) — corrigee** | `trial-subscription-webhook-db.test.ts` « concurrence : 12 paires » echoue ~4 fois sur 6 sur la branche #393 seule (reproduit dans un worktree jetable) : sous 24 requetes simultanees l'ancrage `persistOrgData` de `finalize-checkout` expire (`timeout exceeded when trying to connect`), l'erreur est avalee (non fatale) et le webhook ne repare pas (jeton deja consomme) : organisation `trialing` sans `stripe_subscription_id`. Correction (commit e3ef9e3d) : ancrage rejoue 3 fois (300/600 ms). 6/6 verts ensuite. A reporter sur la PR #393 si elle est fusionnee seule. |
| Certification x #391/#393 | `CERT_RUN_PENDING=1` : 159 passes (bureau-1440, iPhone 13, Pixel 7 : 53 chacun) dont les 9 anciens `fixme` ; `pendingFix` retire (commit separe), 159 passes aussi sans la variable. Libelle accepte : « Paiement echoue ». |
| `dashboard.js` | #392 modifie `billing-files/12-dashboard.js` (source distincte, deja differente des copies avant integration). Les deux copies deployees (`src/frontend/dashboard.js` et `artifacts/flowpoint-export/dashboard.js`) restent identiques (`cmp`). |

### Tests locaux (PG 16.15 jetable, comme la CI sauf version)
| | Premiere integration (29 PR) | Etat final (34 PR) |
|---|---|---|
| migrate depuis zero | 771 etapes OK | 771 etapes OK, 0 echec |
| typecheck / build | OK | OK |
| vitest `--no-file-parallelism` | 3863 OK, 2 echecs | 3974 OK, 2 echecs, 6 ignores (313/316 fichiers OK) |
| echecs | `stripe-webhook-pending-activation` x2 (timing) | identiques, memes 2 tests |
| `test:certification` | OK | OK |
| orphelins | 0 | 0 (337 fichiers : 316 executes, 21 exclus avec raison ; les 7 `*.cert.ts` ne sont pas comptes) |
| certification navigateur | — | 159 passes, 0 echec, 0 fixme |
| `cmp` dashboard.js x2 | identiques | identiques |

CI GitHub (PG17) de la PR #390 sur le dernier commit de code `2de666a7915e32ddc15abbd89c389715a3639fc3` : check-run « Types, build, tests », run 42501658252, conclusion **success** (typecheck, build, vitest complet, certification, orphelins, tests ignores). Le commit suivant (documentation seule) a son propre run : voir la description de la PR #390.

## 10. Operations necessaires pour integrer (apres validation humaine)

```bash
# 1. Sortir du brouillon et fusionner en UN merge (pas squash/rebase)
gh pr ready 390
gh pr merge 390 --merge            # vers Test-Replit

# 2. Fermer les PR sources comme integrees
MSG="Integree via la PR d'integration #390 (integration/test-replit-20261108)"
for n in $(seq 359 387) 391 392 393 394 395; do gh pr close $n -c "$MSG"; done

# 3. Migrations MANUELLES sur la base cible (apres sauvegarde) - jamais automatiques
psql "$DATABASE_URL" -f artifacts/api-server/migrations/diagnostics/025_detect_duplicate_org_owner_email.sql   # diagnostic doublons : doit etre vide
psql "$DATABASE_URL" -f artifacts/api-server/migrations/diagnostics/a09_trialing_sans_souscription.sql        # diagnostic des essais orphelins (lecture seule) : traiter selon docs/ESSAI-SANS-NAVIGATEUR-A09.md
psql "$DATABASE_URL" -f artifacts/api-server/migrations/025_organizations_owner_email_unique.sql
psql "$DATABASE_URL" -f artifacts/api-server/migrations/026_rls_activity_logs_tenant_policies.sql
```
Les 5 PR du second lot sont empilees sur la branche d'integration (base = cette branche) : les fermer SANS les fusionner une a une, leur contenu est dans #390. Apres la fusion, tester le workflow
`certification-navigateur.yml` : il est en `workflow_dispatch` et n'est pas executable (404) tant qu'il n'est pas sur la branche par defaut ; a lancer apres fusion.

### Variables d'environnement / options nouvelles ou au comportement change
| Variable | Defaut | Effet |
|---|---|---|
| `RLS_ENFORCEMENT` | `warn` | `strict` : le demarrage echoue si l'isolation RLS n'est pas garantie ; `off` : silence les erreurs (etat expose par `/api/admin/db-check`). Ne pas passer en `strict` avant revue (la prod tourne en role BYPASSRLS). |
| `SECURITY_STRICT_STARTUP` | non defini (= faux) | `true` : les avertissements de configuration de securite deviennent fatals au demarrage. |
| `JWT_SECRET` | aucun (obligatoire hors `NODE_ENV=test`) | plus de secret de repli : absent => arret au demarrage. Verifier qu'il est pose sur Render AVANT le deploiement. |
| `API_SECRET_KEY` | optionnelle | absente : avertissement, credential de service desactive. |
| `ALLOW_UNAUTHENTICATED_DEV`, `ENABLE_DEV_AUTH` | non definis | ignores en production et sur Render (avertissement si poses). |
| `CERT_BASE_URL`, `CERT_ALLOW_REMOTE_WRITES`, `CERT_RUN_PENDING`, `FP_CERT_*`, `TEST_MAIL_DIR` | tests seulement | n'affectent pas l'application. |

### Retour arriere
Voir section 8 ; en plus : `git revert -m 1 <merge>` annule aussi le second lot (contenu dans #390). Cote donnees, le webhook A-09 cree desormais des souscriptions Stripe d'essai : le retour au code precedent ne les supprime pas (elles restent valides ; ne pas les annuler a la main). Le diagnostic a09 est en lecture seule.

### Risques supplementaires
- La CI/PG17 peut reveler des differences avec PG16 local ; la course A-09 ci-dessus etait sensible a la charge (pool de 5 s) : corrigee mais a surveiller.
- Les 2 echecs de timing preexistants peuvent aussi apparaitre en CI.
- La certification navigateur utilise un faux Stripe/Google : elle ne prouve pas l'integration reelle.

## 11. Troisieme lot : PR #397 a #401 (consolidation)

Ordre : **#397, #398, #399, #400, #401** (chaque merge `--no-ff`, typecheck apres chacun). Les 5 merges sont automatiques, sans conflit textuel (`stripe-webhook.ts` : #399 +19 lignes, #400 +30 lignes, zones disjointes ; `pool-query-baseline.json` : ajouts de #399 seuls ; `dashboard.js`/`fp-locale.js` : seul #401 les modifie, les deux copies restent identiques, `cmp` OK).

| PR | Branche | Contenu |
|---|---|---|
| #397 | fix/billing-verify-integration-20261108 | garde de propriete de `GET /billing/verify` (`services/billing-verify-guards.ts`) |
| #398 | test/certification-stripe-reel-20261108 | certification du VRAI Stripe (mode test), outils et doc ; ajouts seuls, rien d'execute ici |
| #399 | fix/credits-remboursements-20261108 | remboursements des credits IA (`ai-credit-refunds.ts`, migration 027, table creee aussi au demarrage) |
| #400 | fix/paniers-credits-abonnement-20261108 | paniers credits IA + abonnement (`ai-credit-cart.ts`) |
| #401 | fix/regle-annulation-past-due-20261108 | regle annulation / past_due : mode lecture seule (`resolveAccessMode`, 402 `SUBSCRIPTION_READ_ONLY`), migration past_due_since, grace `PAST_DUE_GRACE_DAYS` |

### Decisions et corrections d'integration
| Sujet | Constat | Decision |
|---|---|---|
| Migrations en doublon | #399 et #401 ajoutaient toutes deux `027_*` | #399 garde `027_ai_credit_refunds.sql` ; #401 devient **`028_organizations_past_due_since.sql`** (git mv + references : ARCHITECTURE.md, message de `org-data.ts`). Aucun autre doublon introduit (010 et 014 etaient deja en double avant ce chantier). Ni `migrate` ni la CI n'executent `migrations/*.sql` ; `initDataTables` cree `ai_credit_refunds` et `past_due_since` avec `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` / `UPDATE ... WHERE past_due_since IS NULL` : idempotent. |
| Lecture seule x garde de role #373 x credits | Verifie par le nouveau test `middlewares/read-only-integration-matrix.test.ts` (14 cas sur les vrais chemins) | En lecture seule : `POST /ai-credits/consume`, add-ons, ecritures metier, `/me/settings` : 402 `SUBSCRIPTION_READ_ONLY`. Restent accessibles : lectures (`GET /billing/verify`, usage credits, exports de ses donnees), portail, reactivation, achats de credits (`/billing/checkout-ai-credits`, `/billing/ai-credits-intent`), `/billing/usage-events`, `DELETE /settings/data`. Webhook Stripe : jamais soumis aux gardes (avec ou sans organisation). |
| Certification #395 x #401 | `07-abonnement-etats` attendait un 402 sur les lectures d'un compte `past_due` hors grace / `canceled` hors periode, ce qui n'est plus vrai (lecture seule) ; une ligne `past_due` posee en SQL sans `past_due_since` reste en acces complet (pas de bascule brutale, decision de #401) | Test aligne sur la regle : lectures ouvertes + en-tete `X-FP-Access-Mode: read_only`, ecritures 402 `SUBSCRIPTION_READ_ONLY` (avec `past_due_since` pose a J-10) ; `expired` reste 402 `SUBSCRIPTION_REQUIRED` ; `SUBSCRIPTION_READ_ONLY` ajoute aux codes de garde-fou attendus. Aucune assertion relachee. |
| Test instable `google-signup-account-guard` (#371) | La regex `/Ada/i` etait appliquee a une URL contenant le jeton HEXADECIMAL aleatoire (a, d, a sont des chiffres hexa) : faux positif aleatoire, test faux par construction | Les cles de la redirection sont verifiees exactement, le jeton est verifie comme hexadecimal puis EXCLU du controle de donnees personnelles. 25 executions : 25 passees. |
| Test instable `trial-subscription-webhook-db` (#393) : 401 en concurrence | Cause racine : les recherches d'authentification de `finalize-checkout` (jeton, session, chemin C) avalent une erreur de pool (`timeout exceeded when trying to connect`, pool sature a 24 requetes) et laissent l'organisation non resolue : reponse 401 `auth_required` trompeuse (renvoie vers /login). Meme famille que la course d'ancrage corrigee precedemment | `finalize-checkout` repond desormais **503 `auth_lookup_unavailable` retryable** quand une recherche a echoue, 401 seulement si aucune recherche n'a echoue. Test deterministe ajoute (pool en echec : 503, pas 401 ; echoue sans le correctif). Mesure sous charge (6 processus en parallele) : 1 echec sur 30 avant, **0 sur 36** apres ; 20 executions sequentielles : 20 sur 20. |
| Test de position `finalize-checkout-path-c` | Un commentaire contenant le mot `auth_required` avant le bloc Path C cassait ce test de grep source | Commentaire reformule (aucune assertion modifiee). |

### Variables d'environnement nouvelles (en plus de la section 10)
| Variable | Defaut | Effet |
|---|---|---|
| `PAST_DUE_GRACE_DAYS` | `3` | grace d'acces complet depuis `past_due_since`, puis lecture seule ; entier 0..30, invalide : 3 + log `warn` |
| `PAST_DUE_RULE_ACTIVATED_AT` | demarrage du processus | ancre ISO des organisations `past_due` anterieures a la regle (evite une bascule brutale) |
| `STRIPE_TEST_PRICE_AI_50K` / `_200K` / `_500K` | non definies | prix de TEST des packs de credits IA (equivalents `STRIPE_PRICE_AI_*` en production) ; necessaires pour acheter des credits en mode test |
| `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_PUBLISHABLE_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `STRIPE_TEST_PRICE_ID_*`, `CERT_STRIPE_*` | non definies | campagne de certification Stripe reel (#398), hors application ; voir `docs/CERTIFICATION-STRIPE-REEL.md` |

### Migrations manuelles, dans l'ordre (apres sauvegarde)
1. diagnostics (lecture seule) : `migrations/diagnostics/025_detect_duplicate_org_owner_email.sql` (doit etre vide), `migrations/diagnostics/a09_trialing_sans_souscription.sql` ;
2. `025_organizations_owner_email_unique.sql`, `026_rls_activity_logs_tenant_policies.sql`, `027_ai_credit_refunds.sql`, `028_organizations_past_due_since.sql`.
027 et 028 sont aussi appliquees au demarrage par `initDataTables` (idempotent) : les appliquer a la main est facultatif mais sans risque. 025 et 026 ne le sont pas.

### Procedure « Operations necessaires pour integrer » (mise a jour)
La procedure de la section 10 s'applique avec : fermeture de `seq 359 387` et `391 392 393 394 395 397 398 399 400 401` ; migrations dans l'ordre 025, 026, 027, 028 apres les deux diagnostics. La PR docs migrations (runbook 025/026) viendra s'ajouter dans un lot suivant.

### Risques supplementaires
- Lecture seule : un compte `canceled` apres sa periode ou `past_due` hors grace ne peut plus ecrire (y compris consommer des credits IA) ; ses donnees et exports (GET) restent accessibles. A valider commercialement avant production.
- Les lignes `past_due` existantes sans `past_due_since` restent en acces complet jusqu'a l'ancre `PAST_DUE_RULE_ACTIVATED_AT` + grace.
- Tout ce qui touche le vrai Stripe (#398) n'a pas ete execute.

### Tests locaux et CI du lot 3
Resultats et sha final : voir la description de la PR #390 et la section « Resultats du lot 3 » ci-dessous.

## 7. Procedure de fusion recommandee (apres validation du proprietaire)

Option A (recommandee) : un seul merge de la PR d'integration, puis fermeture des 29 PR.

```
gh pr ready <PR_INTEGRATION>           # sort du brouillon (decision humaine)
gh pr merge <PR_INTEGRATION> --merge   # un seul commit de fusion dans Test-Replit
for n in $(seq 359 387); do gh pr close $n -c "Integree via la PR d'integration (integration/test-replit-20261108)"; done
```
Utiliser `--merge` (pas squash/rebase) conserve l'historique des PR et evite les conflits de re-fusion.

Option B : PR par PR dans l'ordre de la section 1 (#386, #387, #378, #365, #360, #366, #359, #364, #380, #362, #367, #371, #363, #385, #379, #383, #370, #375, #361, #368,
#372, #369, #377, #384, #374, #381, #382, #373, #376). Chaque fusion declenche les conflits listes en section 2 (a refaire ; `git diff origin/integration/test-replit-20261108` donne la
resolution) et les corrections semantiques de la section 4 doivent etre reportees (commits `fix(integration)`) apres #382/#373/#376. Plus long et plus risque.

## 8. Rollback

- Avant fusion : supprimer la branche `integration/test-replit-20261108` et fermer la PR brouillon ; `Test-Replit` n'a pas change.
- Apres fusion (option A) : `git revert -m 1 <sha_du_commit_de_fusion>` sur `Test-Replit` via une PR, puis rouvrir les 29 PR.
- Migrations : 025 et 026 sont idempotentes ; si appliquees, annuler par `DROP INDEX` (025) et `DROP POLICY` des 4 policies d'`activity_logs` (026) apres revue humaine.
