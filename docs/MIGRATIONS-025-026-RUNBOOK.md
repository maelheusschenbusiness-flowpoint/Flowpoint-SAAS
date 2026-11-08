# Runbook — migrations 025 et 026 (base de TEST « Flowpoint test », puis production)

Base de ce document : branche `integration/test-replit-20261108` (PR #390). Aucune migration n'a ete appliquee par
l'auteur de ce document, nulle part. Chaque etape marquee **[PROPRIETAIRE]** exige son accord explicite et son execution.

## 1. Comment le schema est reellement construit

- Les fichiers `artifacts/api-server/migrations/*.sql` (dont 025 et 026) ne sont executes **ni** par `pnpm run migrate`
  (`src/migrate.ts` n'y fait reference que dans un commentaire), **ni** par la CI (`.github/workflows/ci.yml` lance
  `pnpm run migrate` sur un PostgreSQL vierge), **ni** au demarrage : aucun code ne lit ce repertoire (verifie par recherche).
- Le schema vient des services `init-*` (`init-data-tables.ts`, `init-rls-migration.ts`, `init-schema-reconcile.ts`...) au demarrage et
  via `migrate.ts` (qui rejoue le RLS). `README.md` du repertoire le documente.
- Consequence : 025 et 026 sont des **etapes manuelles**. Sur une base creee par `migrate` (CI, local) 026 est un no-op (les 4 policies
  existent deja) et 025 cree l'index (base vide).

## 2. Etat releve sur la base de TEST (lecture seule, 2026-11-08, ref `rrjllaiodpvtsphrtdqd`, PostgreSQL 17.11)

| Controle | Resultat |
|---|---|
| Organisations | 10 (0 `deleted`) ; 119 tables |
| Doublons `lower(owner_email)` (non supprimees) | **0 groupe** -> 025 creera l'index |
| `owner_email` vide/NULL | **8/10** (colonne `NOT NULL`, valeur `''`) : hors index partiel, sans effet sur l'unicite |
| `trialing` sans `stripe_subscription_id` (A-09) | **0** (0 organisation `trialing`) |
| Index `organizations_owner_email_active_uniq` | absent |
| `activity_logs` | 24 lignes, 64 kB ; RLS **activee**, **FORCE** actif ; **4 policies tenant_* deja presentes**, definition identique a 026 -> **026 serait un no-op** |
| `organizations` | 136 kB ; RLS activee, 0 policy (par conception) ; index : pkey, owner, slug, sub_status, stripe_cust |
| Colonnes attendues | toutes presentes (`organizations.owner_email/status/subscription_status/stripe_subscription_id/...`, `activity_logs.org_id`) |
| Tables RLS sans policy | 8 : `pending_signups, organizations, funnel_events, schema_migrations, conversion_event_outbox, checkout_subscription_claims, users, magic_link_tokens` (hors perimetre 026) |
| Roles | `postgres` (connexion MCP) BYPASSRLS ; `app_user/anon/authenticated` non BYPASSRLS ; `service_role/supabase_admin` BYPASSRLS |

Le projet de production n'a pas ete interroge (interdit). Les memes controles doivent y etre rejoues par le proprietaire (etape 1).

## 3. Sauvegarde : plan realiste

Les deux projets Supabase sont dans l'organisation au plan **free** : pas de sauvegardes quotidiennes ni de PITR (reserves aux plans
Pro/Team/Enterprise ; la documentation recommande `supabase db dump` pour le plan gratuit). **La sauvegarde est donc a la charge du proprietaire.**
025/026 ne modifient aucune ligne : le risque porte sur le schema (index/policies) et sur le traitement manuel des doublons (etape 3 de 025).

**Option 1 (recommandee) — export logique, execute par le proprietaire.** Le client `pg_dump` doit etre de version >= celle du serveur (17).
```bash
export DATABASE_URL='postgresql://...'      # lu depuis le gestionnaire de secrets, jamais ecrit dans un fichier/commit
STAMP=$(date +%Y%m%d-%H%M)
pg_dump "$DATABASE_URL" -Fc --no-owner -t public.organizations -t public.activity_logs -f "bk-025-026-$STAMP.dump"   # schema + donnees
pg_restore -l "bk-025-026-$STAMP.dump" | head      # le fichier doit etre lisible
# alternative Supabase CLI (base entiere) :
supabase db dump --db-url "$DATABASE_URL" -f "bk-schema-$STAMP.sql"
supabase db dump --db-url "$DATABASE_URL" --data-only -f "bk-data-$STAMP.sql"
```
Le fichier contient des e-mails : le stocker chiffre, hors depot, et le supprimer apres validation.
**Option 2 (repli) — tables horodatees** : `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v suffix=AAAAMMJJ -f artifacts/api-server/migrations/rollback/backup_025_026.sql`
(copie `organizations`, `activity_logs` et la definition des policies ; RLS activee, droits retires a anon/authenticated ; a supprimer apres validation ; non execute ici).

**Restauration verifiee localement** (base jetable, PostgreSQL 16 local) : `pg_restore --data-only` sur une base au schema identique redonne exactement
les donnees d'avant migration (empreintes md5 identiques) ; la restauration depuis les tables `bak_` aussi. Test : `scripts/test-migrations-025-026-local.sh`.

## 4. Ordre d'execution

| # | Etape | Qui | Duree | Validation prealable |
|---|---|---|---|---|
| 1 | Diagnostics : `psql "$DATABASE_URL" -X -f artifacts/api-server/migrations/diagnostics/025_026_preflight_aggregates.sql` (agrege, sans PII). Si doublons, detail par `025_detect_duplicate_org_owner_email.sql` ; A-09 : `a09_trialing_sans_souscription.sql` (affiche des e-mails : ne pas coller dans un ticket) | PROPRIETAIRE (role lecture seule) | < 1 s | Accord pour lire la base cible |
| 2 | Sauvegarde (section 3) | PROPRIETAIRE | secondes (tables < 1 Mo en test) | Fichier controle |
| 3 | `025` : `psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f artifacts/api-server/migrations/025_organizations_owner_email_unique.sql` | PROPRIETAIRE | ms a quelques secondes | Go de l'etape 1 (0 groupe de doublons) ; accord ecrit |
| 4 | Verification : `.../diagnostics/025_026_postcheck.sql` : index `valide=t`, `unique=t` ; tests applicatifs (inscription, finalize-checkout) | PROPRIETAIRE | < 1 min | |
| 5 | `026` (seulement si `policies_tenant` < 4 a l'etape 1 ; sinon NE PAS L'EXECUTER, c'est un no-op) | PROPRIETAIRE | ms | Accord ecrit ; etat RLS/FORCE note |
| 6 | Verification : postcheck (4 policies, RLS/FORCE inchanges, lignes identiques) ; l'application doit lire `activity_logs` normalement | PROPRIETAIRE | < 1 min | |
| 7 | Retour arriere eventuel (section 6) | PROPRIETAIRE | ms | Decision ecrite |

Test (base `rrjllaiodpvtsphrtdqd`) : etapes 3 et 5 : 025 a executer ; 026 inutile (4 policies deja la). Production : meme sequence, apres validation sur la base de test.

## 5. Go / no-go

Avant 025 : GO si tables/colonnes presentes ; 0 groupe de doublons ; index absent (ou valide) ; aucune transaction > 1 min ;
sauvegarde verifiee. NO-GO si doublons (traiter a la main, decision metier : abonnement Stripe, membres) ou index `INVALIDE` (`DROP INDEX` puis rejouer).
Apres 025 : index valide+unique ; 0 erreur 23505 dans les logs d'inscription ; nombre d'organisations inchange.
Avant 026 : GO si RLS activee et `policies_tenant` = 0 (sinon no-op, ne rien faire) ; role de connexion du serveur connu.
**Attention au role de connexion** : `postgres`/`service_role` ignorent RLS ; si le serveur se connecte avec un role non BYPASSRLS il doit poser
`app.current_org_id` (via `req.orgDb`) sinon 0 ligne (teste localement : sans GUC 0 ligne, bon GUC 20 lignes, autre org 0).
Apres 026 : 4 policies, `rls_activee`/`force_rls` identiques, nombre de lignes identique, ecrans activite fonctionnels.

## 6. Retour arriere (testes localement)

- 025 : `psql "$DATABASE_URL" -f artifacts/api-server/migrations/rollback/025_organizations_owner_email_unique.down.sql` (`DROP INDEX IF EXISTS`, idempotent, aucune donnee touchee).
- 026 : **uniquement si l'etat avant etait « 0 policy »** :
  `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v confirm_pre_state_no_policies=yes [-v rls=on|off] [-v force=on|off] -f artifacts/api-server/migrations/rollback/026_rls_activity_logs_tenant_policies.down.sql`
  (refuse sans la variable de confirmation ; remet RLS/FORCE a l'etat releve ; defaut on/on).
- Donnees : jamais modifiees par 025/026 ; en cas de doublons traites a la main, restaurer depuis la sauvegarde (section 3).

## 7. Ce qui peut echouer

| Risque | Effet | Parade |
|---|---|---|
| Doublon cree entre le controle et l'index | erreur 23505, rien de modifie | rejouer apres traitement |
| Verrou `organizations` (SHARE pendant l'index : ecritures bloquees) | ms (table de quelques milliers de lignes) ; `lock_timeout` 5 s evite l'attente infinie | rejouer en heure creuse |
| `CREATE INDEX CONCURRENTLY` | non utilise : interdit en transaction/bloc DO, laisse un index invalide | detection de l'index invalide integree |
| Doublons avec espaces (`'a@x '`) ou ecritures differentes | non detectes par `lower()` (comportement de l'index aussi) | la normalisation est assuree par l'application |
| Role non BYPASSRLS sans GUC | `activity_logs` vide cote application | voir section 5 |
| Tables `bak_*` de repli | `org_id` + RLS sans policy : peuvent figurer dans la porte « isolation » | les supprimer apres validation |

## 8. Resultats des executions locales (PostgreSQL 16, base jetable, schema construit par `pnpm run migrate`)

`scripts/test-migrations-025-026-local.sh` : **24 controles, 0 echec**. Scenario avec doublons (casse differente) : NOTICE, index non cree, donnees
identiques, rejeu sans erreur, index cree apres traitement. Scenario propre : 025 x2 et 026 x2 idempotents, 4 policies, RLS/FORCE inchanges, doublon refuse,
`owner_email` vide hors index, comportement `app_user`, 026 ~57 ms (connexion comprise). Retour arriere 025/026 idempotent, refus sans confirmation, etat RLS restaure,
restauration `pg_restore` et tables `bak_` identiques aux donnees d'origine. Tests existants `signup-activation-concurrency-db` et `rls-activity-logs-migration-db` : 10/10.
Non execute localement : PostgreSQL 17 (CI) et la base Supabase (aucune ecriture autorisee).

## 9. Mecanisme d'application controlee (proposition, NON implementee, a decider par le proprietaire)

Les migrations manuelles n'ont aujourd'hui aucune trace (la table `schema_migrations` existe, RLS sans policy). Proposition : un workflow GitHub `workflow_dispatch`
(environnement protege, approbation du proprietaire, secret `DATABASE_URL` par environnement) qui execute preflight -> `pg_dump` en artefact chiffre -> migration -> postcheck, et
enregistre le numero dans `schema_migrations`. Alternative plus legere : un script `scripts/apply-manual-migration.sh` lance par le proprietaire. A defaut, conserver ce runbook.
