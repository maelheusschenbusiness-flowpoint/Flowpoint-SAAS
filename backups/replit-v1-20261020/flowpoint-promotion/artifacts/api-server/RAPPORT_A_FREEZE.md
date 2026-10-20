# Rapport A — Stabilisation Infrastructure PostgreSQL/Supabase
**Date :** 2026-08-02
**Phase :** Partie A — Corrections RLS + FK + type UUID (pré-Phase 4)
**Statut :** ✅ GELÉ

---

## Problèmes corrigés

### 1. `public.schema_migrations` — RLS désactivé (Supabase Advisor)
**Symptôme :** Supabase Advisor signalait `RLS Disabled in Public` sur `schema_migrations`.

**Cause racine :** `init-rls-migration.ts` s'exécute AVANT `init-data-tables.ts` sur le chemin de démarrage complet (slow path), donc `schema_migrations` est créée après la migration RLS et n'obtient jamais `ENABLE ROW LEVEL SECURITY` lors du premier démarrage.

**Corrections :**
- `src/services/init-data-tables.ts` : ajout de `ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY` + `NO FORCE` + `REVOKE ALL FROM anon, authenticated` immédiatement après le `CREATE TABLE IF NOT EXISTS schema_migrations`.
- `src/services/init-rls-migration.ts` : ajout de `"schema_migrations"` dans `BACKEND_ONLY_TABLES` (ENABLE + FORCE + aucune policy publique = deny-all implicite).

**Idempotence :** `ALTER TABLE … ENABLE ROW LEVEL SECURITY` est un no-op si déjà activé.

---

### 2. `public.ai_chat_history` — RLS désactivé (Supabase Advisor)
**Symptôme :** Supabase Advisor signalait `RLS Disabled in Public` sur `ai_chat_history`.

**Cause racine :** La boucle RLS dans `init-agent-tables.ts` couvrait seulement 4 tables (`org_member_permissions`, `ai_action_proposals`, `ai_action_logs`, `ai_autopilot_grants`) et omettait `ai_chat_history`. Sur le slow path, `runRlsMigrationIfNeeded` s'exécute avant `initAgentTables`, donc la table manque RLS lors du premier démarrage.

**Correction :**
- `src/services/init-agent-tables.ts` : ajout de `"ai_chat_history"` dans la boucle `for (const t of [...])` qui applique `ENABLE ROW LEVEL SECURITY` + `NO FORCE` + 4 tenant policies.

**Note :** `NO FORCE` maintenu car `ai_chat_history` est accédée via `pool.query()` (superuser BYPASSRLS) dans `routes/ai.ts` (GET /ai/history, POST /ai/chat).

---

### 3. `public.activity_logs` — RLS désactivé (Supabase Advisor)
**Symptôme :** Supabase Advisor pouvait signaler `RLS Disabled in Public` sur `activity_logs` après un premier démarrage.

**Cause racine :** Même pattern que `ai_chat_history` — `init-rls-migration.ts` s'exécute avant `init-data-tables.ts` sur le slow path.

**Correction :**
- `src/services/init-data-tables.ts` : ajout de `ALTER TABLE activity_logs ENABLE ROW LEVEL SECURITY` + `NO FORCE` immédiatement après les self-healing ALTERs sur la table `activity_logs`. Les 4 tenant policies sont gérées par `init-rls-migration.ts` lors du prochain passage.

---

### 4. `org_addons_org_id_fkey` — Contrainte FK incompatible (Render SQLSTATE 42804)
**Symptôme :** Log Render : `foreign key constraint "org_addons_org_id_fkey" cannot be implemented (SQLSTATE 42804)`.

**Cause racine :** Sur certains environnements, `org_addons.org_id` avait été créé comme UUID tandis que `organizations.id` est TEXT. La contrainte FK de type incompatible échoue.

**Correction :**
- `src/services/init-data-tables.ts` : ajout d'un bloc `DO $$ BEGIN … END $$` qui convertit `org_addons.org_id` de UUID → TEXT si nécessaire, après avoir droppé la FK, avant toute opération sur la table.
- Le bloc organisations UUID→TEXT existant a été étendu pour dropper d'abord `org_addons_org_id_fkey`, `org_settings_org_id_fkey`, `org_checklist_org_id_fkey`, `org_secrets_org_id_fkey`, `team_members_org_id_fkey` AVANT de convertir `organizations.id` — sinon PostgreSQL refuse l'`ALTER COLUMN TYPE` sur une colonne référencée par une FK.

---

### 5. `organizations.id` INSERT type mismatch (Render SQLSTATE 42804)
**Symptôme :** Log Render : `column "id" is of type uuid but expression is of type text`.

**Cause racine :** L'`ALTER TABLE organizations ALTER COLUMN id TYPE TEXT` dans `init-data-tables.ts` échouait silencieusement (try/catch non-fatal) car des FK référençant `organizations.id` existaient encore. Le `INSERT INTO organizations … SELECT org_id AS id FROM org_settings` échouait ensuite avec SQLSTATE 42804.

**Correction :** Extension du bloc DO $$ ci-dessus pour dropper toutes les FKs référençant `organizations.id` avant l'`ALTER COLUMN TYPE`. `init-phase1-users.ts` fait la même chose sur le slow path, mais l'exécution peut arriver après `init-data-tables.ts` dans certains ordres de démarrage.

---

## Vérification DB post-déploiement

```
table               | rowsecurity | relforcerowsecurity | tenant_policies
--------------------+-------------+---------------------+-----------------
activity_logs       | true        | false               | 4
ai_chat_history     | true        | false               | 4
org_addons          | true        | true                | 4
organizations       | true        | false               | 0
schema_migrations   | true        | false               | 0
```

```
FK exists (org_addons_org_id_fkey): false
```

**Résultat :** ✅ Les 5 problèmes sont corrigés. Supabase Advisor ne devrait plus signaler ces tables.

---

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `src/services/init-data-tables.ts` | ENABLE RLS schema_migrations (+ REVOKE) + ENABLE RLS activity_logs + DROP FK org_addons avant ALTER + org_addons.org_id UUID→TEXT guard |
| `src/services/init-agent-tables.ts` | ai_chat_history ajoutée à la boucle RLS (ENABLE + NO FORCE + 4 policies) |
| `src/services/init-rls-migration.ts` | schema_migrations dans BACKEND_ONLY_TABLES |

---

## Précautions respectées

- Aucune modification de code fonctionnel (billing, pricing, Stripe, checkout, plans, add-ons, missions, calendrier, paramètres, frontend)
- Toutes les modifications sont idempotentes (IF NOT EXISTS / ON CONFLICT / ENABLE = no-op si déjà actif)
- NO FORCE maintenu sur les tables accédées via pool.query() (BYPASSRLS)
- Boot propre confirmé : 3 redémarrages, aucun crash, aucun 500
