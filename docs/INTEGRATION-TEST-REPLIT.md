# Integration des 29 PR de correction (#359 a #387) — branche `integration/test-replit-20261108`

Cette branche n'est PAS `Test-Replit`. Elle contient les 29 PR fusionnees dans un ordre determine, les conflits
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
