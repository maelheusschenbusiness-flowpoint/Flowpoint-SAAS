# Proposition : hachage des clés API et des jetons de session (constat C-12)

Document de proposition rédigé le 2026-11-08. **Rien n'est migré** : appliquer ce plan invaliderait des sessions et des clés réelles s'il était mal séquencé.

## État constaté dans le code

- Jetons de session : colonne `user_sessions.token`, en clair (`services/sessions.ts` : `INSERT`, `getSession`, `deleteSession` comparent directement `token = $1`). Une fuite de la base (sauvegarde, requête de support, injection SQL) donne des sessions immédiatement utilisables.
- Clés API `fp_pub_` / `fp_sec_` : stockées en clair dans `user_prefs.settings` (`settings->>'publicApiKey'`, `settings->>'secretApiKey'`), recherchées par `middlewares/orgContext.ts` (`WHERE settings->>'secretApiKey' = $1`). Aucun index dédié, comparaison par égalité SQL.
- Jetons magiques et d'invitation : certains sont déjà hachés (`routes/team.ts` : `hashToken`, SHA-256) ; le modèle existe donc dans le code.

## Cible

Stocker `sha256(jeton)` (hex) au lieu du jeton. Les jetons de session et les clés ont 192 à 256 bits d'entropie : un SHA-256 simple suffit (pas besoin de bcrypt/argon2, qui seraient trop lents sur chaque requête). L'identifiant présenté par le client reste le jeton en clair ; seul le stockage change. Un préfixe lisible (`fp_sec_ab12…`) est conservé dans une colonne à part pour l'affichage dans l'interface.

## Migration progressive, sans invalidation

1. **Schéma (migration SQL versionnée, additive)** : `user_sessions.token_hash text` + index unique ; pour les clés, un champ `settings.secretApiKeyHash` / `publicApiKeyHash` (ou une table `api_keys(org_id, kind, key_hash, key_prefix, created_at, last_used_at)` à terme). Aucune colonne existante n'est supprimée ni modifiée.
2. **Double écriture** : à la création d'une session ou d'une clé, écrire le hash **et** le clair. Déployer d'abord sur l'environnement de test.
3. **Double lecture** : `getSession` / `orgContext` cherchent d'abord par hash ; à défaut, par clair (anciennes lignes), et **recopient le hash à la volée** (« lazy backfill »). Les sessions et clés existantes continuent de fonctionner.
4. **Backfill par lots** : script idempotent `UPDATE … SET token_hash = encode(sha256(token::bytea),'hex') WHERE token_hash IS NULL` par tranches (par exemple 5 000 lignes), hors heures de pointe, exécuté d'abord sur une copie restaurée de la base (voir `docs/runbook-migration-v1.md`), jamais directement en production sans autorisation distincte.
5. **Mesure** : compter les lectures par chemin « clair » (log / métrique) jusqu'à zéro, sur une durée supérieure à la durée de vie maximale d'une session.
6. **Bascule** : lecture par hash uniquement ; arrêter d'écrire le clair. Conserver le clair 1 à 2 semaines pour un retour arrière.
7. **Purge** : `UPDATE … SET token = NULL` (ou valeur factice) puis suppression de la colonne dans une migration ultérieure ; supprimer `settings.secretApiKey` / `publicApiKey` en clair. Les clés API sont affichées une seule fois à la création : prévoir une régénération par l'utilisateur plutôt qu'un affichage ultérieur.

## Points d'attention

- Comparer les hash en temps constant (`keysEqual` de `lib/auth-token.ts`) lorsque la recherche n'est pas faite par index unique.
- Les journaux masquent déjà les jetons (`lib/logger.ts`), mais vérifier qu'aucune requête SQL journalisée ne contient le clair.
- Les sauvegardes antérieures à la purge contiennent encore le clair : à traiter par la durée de rétention (voir le rapport de vérification des sauvegardes).
- Le cache mémoire des sessions (`sessions.ts`) doit être indexé par hash, pas par clair.
- Pas de rotation forcée nécessaire si la fuite n'est pas suspectée ; en cas de suspicion, invalider toutes les sessions (`DELETE FROM user_sessions`) est plus simple que la migration.
