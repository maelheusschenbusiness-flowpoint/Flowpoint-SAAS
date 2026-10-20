# FlowPoint — Database Migrations

Ce document décrit comment gérer les migrations de base de données sur FlowPoint :
ordre d'exécution, vérifications avant/après, et règles de sécurité.

---

## Principe général

Les migrations sont **découplées du déploiement applicatif** :

- Le serveur API (`pnpm start`) ne touche jamais à la structure de la base.
- Seul le runner de migration (`pnpm migrate`) applique des changements DDL.
- Cette séparation évite toute modification accidentelle lors d'un redémarrage ou rollback.

---

## Fichiers concernés

| Fichier | Rôle |
|---|---|
| `src/migrate.ts` | Entrypoint autonome — compile et exécute les migrations, puis quitte |
| `src/services/init-rls-migration.ts` | Logique de migration RLS (idempotente) |
| `src/services/init-rls-setup.ts` | Provision du rôle `app_user` (local dev uniquement) |
| `migrations/013_supabase_cloud_rls.sql` | SQL de référence — appliqué par `init-rls-migration.ts` |

---

## Déclencher une migration

### Option A — commande directe (recommandée)

```bash
# Depuis la racine du monorepo
pnpm --filter @workspace/api-server run migrate

# Depuis artifacts/api-server/
pnpm run migrate
```

La commande :
1. Recompile le code TypeScript → `dist/migrate.mjs`
2. Lance le runner qui vérifie l'état avant, applique les changements manquants, affiche l'état après
3. Quitte avec le code `0` (succès) ou `1` (erreur)

### Option B — Render one-off job

Dans le dashboard Render → **Jobs** → créer un job avec la commande :
```
node --enable-source-maps ./dist/migrate.mjs
```
S'assurer que le build a été effectué au préalable (step `pnpm run build`).

### Option C — pre-deploy hook Render

Dans `render.yaml` ou les settings du service, ajouter en *pre-deploy command* :
```
pnpm --filter @workspace/api-server run build && node --enable-source-maps ./dist/migrate.mjs
```
Cela garantit que la migration tourne **avant** le démarrage du nouveau serveur, et bloque le déploiement si elle échoue (exit code 1).

---

## Ce que fait la migration RLS (010-013)

La migration RLS est **idempotente** : relancer sans risque autant de fois que nécessaire.

### Sentinel check (< 1 ms)

Avant toute action, le runner vérifie si `audits.org_id` existe dans la base cible.
- **Colonne présente** → migration déjà appliquée → sortie immédiate, aucun DDL exécuté.
- **Colonne absente** → migration nécessaire → exécution complète.

### Étapes (exécutées seulement si nécessaire)

| Étape | Description |
|---|---|
| 1 | Découverte des tables existantes dans `pg_tables` |
| 2 | `ALTER TABLE … ADD COLUMN IF NOT EXISTS org_id text NOT NULL DEFAULT 'default'` sur ~50 tables tenant |
| 3 | `ALTER TABLE … ENABLE ROW LEVEL SECURITY` sur toutes les tables publiques |
| 4 | `DROP POLICY IF EXISTS` sur toutes les policies existantes (nettoyage idempotent) |
| 5 | Découverte des tables ayant `org_id` via `information_schema.columns` |
| 6 | Création de 4 policies par table tenant : `tenant_select`, `tenant_insert`, `tenant_update`, `tenant_delete` |
| 7 | `GRANT` des permissions aux rôles Supabase (`anon`, `authenticated`, `service_role`) |

### Condition d'isolation tenant

```sql
org_id = current_setting('app.current_org_id', true)
```

Cette valeur est injectée par le middleware `dbContext.ts` via `SET LOCAL app.current_org_id = $1`
sur chaque requête authentifiée.

---

## Vérifications avant migration

```bash
# État RLS de la base cible
psql "$DATABASE_URL" -c "
  SELECT
    (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public' AND rowsecurity=true) AS rls_tables,
    (SELECT COUNT(*) FROM pg_policies WHERE schemaname='public')                    AS policies,
    (SELECT COUNT(*) FROM pg_tables WHERE schemaname='public')                      AS total_tables;
"

# Vérifier si audits.org_id existe déjà (= migration déjà appliquée)
psql "$DATABASE_URL" -c "
  SELECT column_name FROM information_schema.columns
  WHERE table_schema='public' AND table_name='audits' AND column_name='org_id';
"
```

## Vérifications après migration

Le runner affiche automatiquement un résumé en fin d'exécution :

```
Post-migration state
============================================================
  Tables total      : 145
  Tables with RLS   : 145  (target: 145)
  Policies          : 508  (target: 508)
  Columns w/ org_id : 127

✓ Migration successful
```

Via l'API (endpoint admin, requiert `x-admin-key`) :

```bash
curl https://api.flowpoint.pro/api/admin/db-check \
  -H "x-admin-key: $ADMIN_KEY"
# → rls.rls_enabled_tables: 145, rls.total_policies: 508
```

---

## Valeurs cibles (production Supabase)

| Métrique | Valeur attendue |
|---|---|
| Tables totales | 145 |
| Tables avec RLS | 145 |
| Policies tenant | 508 (4 × 127 tables avec org_id) |
| Tables sans org_id | 18 (tables système : `_schema_migrations`, etc.) |

---

## Ajouter une nouvelle migration

1. Créer un fichier SQL dans `migrations/` (ex. `014_add_feature_x.sql`)
2. Écrire le SQL de façon **idempotente** (`IF NOT EXISTS`, `IF EXISTS`, `ON CONFLICT DO NOTHING`)
3. Ajouter une nouvelle fonction dans `src/services/init-rls-migration.ts` ou créer un fichier `src/services/init-feature-x-migration.ts`
4. L'importer dans `src/migrate.ts` et l'appeler dans la séquence
5. Documenter les vérifications avant/après dans ce README

---

## Règles de sécurité

- **Ne jamais** appeler `runRlsMigrationIfNeeded()` depuis `src/index.ts` (serveur API).
- **Toujours** tester la migration sur un environnement de staging avant production.
- **Toujours** vérifier les compteurs après exécution (tables RLS, policies).
- Le runner est non-fatal par conception : les erreurs DDL isolées (table inexistante, etc.) sont loggées et ignorées — vérifier les logs si le compte de tables/policies est anormal.
- La clé Supabase `service_role` bypass le RLS — utiliser exclusivement pour les migrations et l'administration, jamais dans le code applicatif.
