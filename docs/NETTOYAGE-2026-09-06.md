# Nettoyage FlowPoint — 6 septembre 2026

Nettoyage fondé sur `flowpoint-project-complete-2026-09-06.tar.gz`, sans ajout de fonctionnalité ni changement volontaire des parcours utilisateurs.

## Changements

- Suppression de 34 fichiers résiduels dans l’export : anciennes archives, captures de sorties Git, patch de test, copies `billing-files/`, caches TypeScript, deux fichiers de configuration locale et packages vides.
- Ce total inclut les cinq modèles MongoDB, leur connecteur et le cron DataForSEO sans appelant. Les imports et références applicatives ont été vérifiés avant suppression. La dépendance Mongoose et ses dépendances exclusives ont été retirées du verrouillage, sans mise à jour des versions conservées.
- Suppression de 10 fonctions locales que TypeScript identifie comme inutilisées, d’imports nommés inutilisés et de la table de rangs de rôles non utilisée. Aucun middleware appliqué aux routes n’a été supprimé.
- Simplification équivalente de `isDemoMode()` : le résultat dépendait déjà uniquement de `NODE_ENV`.
- `src/frontend/dashboard.js` et `src/frontend/fp-backend.js` sont désormais des liens symboliques relatifs vers les fichiers canoniques dans `artifacts/flowpoint-export/`. Les anciens chemins restent accessibles. La version servie de `fp-backend.js`, avec ses protections de session, est conservée. Garder ces liens lors de l’import dans Replit.
- Aucun des 26 fichiers du frontend servi n’a changé de contenu.
- `run-tests.sh` appelle désormais la suite Vitest existante depuis n’importe quel dossier. Le post-merge n’appelle plus la commande DB `push-force` inexistante ; les migrations existantes restent disponibles séparément.
- Dans l’archive livrée uniquement, la valeur `ADMIN_KEY` embarquée dans `.replit` a été retirée : configurer cette valeur via Replit Secrets. L’original n’a pas été modifié.

Les migrations SQL, les fonctionnalités métier, les tests et la documentation existants sont conservés. Les fichiers dont l’utilisation reste ambiguë ne sont pas supprimés. Ce nettoyage ne corrige pas les bugs fonctionnels préexistants.

## Vérification avant / après

- Build backend esbuild : réussi après nettoyage.
- Suite Vitest configurée : 1 456 tests recensés ; 1 410 réussis, 6 échecs, 40 en attente/ignorés, exactement les mêmes statuts avant et après. 69 fichiers de tests passent ; 10 fichiers sont en échec, notamment à cause des suites nécessitant PostgreSQL local indisponible.
- Les six assertions déjà en échec concernent `billing-legacy-customer` (2), `finalize-checkout-path-c`, `team-aggregates`, `team-member-removal-security` et `billing-quote`.
- Contrôle TypeScript avec `--noUnusedLocals` : avertissements TS6133 réduits de 95 à 67 ; autres diagnostics inchangés. La vérification complète des types reste en échec sur le code préexistant.
- Syntaxe des fichiers JavaScript du frontend et des deux scripts shell modifiés : valide.
- Diff Git : aucun défaut d’espacement détecté.

Ces vérifications ne constituent pas une certification des paiements réels ni de la production.

## Commandes

```sh
pnpm install --frozen-lockfile
pnpm --filter @workspace/api-server build
bash run-tests.sh
```

L’archive ne contient ni dépendances installées, ni build généré, ni données de production. Le build doit être régénéré à l’installation.
