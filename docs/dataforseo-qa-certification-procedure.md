# Procédure — certification externe DataForSEO (bêta 2.0)

État au 8 novembre 2026 : aucune requête réelle DataForSEO n’a été exécutée. Le runner local post-fusion a utilisé une base PostgreSQL jetable et un environnement sans identifiants fournisseur; il certifie seulement les parcours locaux et les états sans fournisseur. Cette procédure prépare une certification QA, elle n’en constitue pas le résultat.

## Périmètre Beta 2.0 confirmé dans le code

| Fonction | Route FlowPoint | Appel DataForSEO | Conditions |
|---|---|---|---|
| Backlink Intelligence — résumé | `GET /api/seo/backlinks?domain=...` | `/backlinks/summary/live` | Add-on `backlinkIntelligence` actif; domaine valide |
| Advanced SEO Lab — analyse de contenu | `POST /api/seo/content-optimization` avec `{url}` | `/content_analysis/summary/live` | Droit d’écriture et add-on `advancedSeoLab` actif; requête préparée avec le mot-clé `seo local`, France, français |
| Advanced SEO Lab — missions SEO | `POST /api/seo/generate-missions` avec `{domain}` | `/dataforseo_labs/google/keyword_difficulty/live` | Droit d’écriture, add-on `advancedSeoLab` actif et mots-clés GSC récents dans l’organisation QA; le service envoie au plus 20 mots-clés |

Ce périmètre ne certifie pas les autres routes DataForSEO de FlowPoint. Les tests d’état `not_configured` ne prouvent pas que les identifiants fonctionnent ni que les données réelles sont correctement mappées.

## Conditions préalables — arrêt si une condition manque

1. Utiliser uniquement Test-Replit et une organisation QA interne, jamais Production, une organisation cliente ou des données client.
2. Faire confirmer explicitement le compte DataForSEO QA, le domaine/page autorisés et le budget disponible avant tout appel. Les appels fournisseur peuvent être facturés; ne pas supposer un prix ou un solde.
3. Le code lit d’abord les clés DataForSEO scellées à l’organisation (`org_secrets`), puis peut retomber sur `DATAFORSEO_LOGIN` et `DATAFORSEO_PASSWORD` globaux. Vérifier que chaque source possible est QA uniquement ou absente; ne jamais afficher ni journaliser les valeurs.
4. Activer uniquement les add-ons nécessaires sur l’organisation QA. Pour `generate-missions`, disposer d’au moins un mot-clé GSC récent QA; sans cela, la route répond 422 et n’appelle pas DataForSEO.
5. Utiliser un domaine contrôlé ou explicitement autorisé, jamais le fixture `.invalid` des tests ni un site client. Pour l’analyse de contenu, choisir une page publique QA non sensible.

## Parcours contrôlé

1. Capturer l’identifiant pseudonymisé de l’organisation QA, les add-ons actifs et les compteurs de quota avant le test.
2. Vérifier séparément les refus de permissions et d’add-on. En l’absence de configuration DataForSEO, vérifier que Backlink renvoie `available=false`, `reason=not_configured` et des métriques nulles; les routes Advanced SEO doivent renvoyer le statut d’indisponibilité prévu. Aucune métrique synthétique ne doit être présentée comme réelle.
3. Après autorisation et prévol, faire un seul appel contrôlé par route dans le périmètre ci-dessus. Arrêter si le résultat, la facturation ou l’organisation cible sont ambigus; ne pas relancer automatiquement.
4. Comparer les champs renvoyés par FlowPoint à la réponse fournisseur expurgée : backlinks/domaines/rang pour le résumé; score, nombre de mots, titres et recommandations pour l’analyse; mot-clé, difficulté et volume pour les missions. `estimatedClicks` dans les missions est une estimation FlowPoint calculée à 8 % du volume, pas une valeur DataForSEO.
5. Vérifier le propriétaire QA, l’activité enregistrée et l’évolution des quotas/usage; s’assurer qu’aucune autre organisation n’a reçu les données. N’attribuer une consommation qu’aux appels attendus et réussis, selon le contrat d’usage réellement observé.
6. Conserver une preuve expurgée : SHA de code, date, route, statut HTTP, référence de tâche fournisseur si disponible, champs comparés, compteurs avant/après et résultat QA. Ne pas enregistrer d’identifiants, d’en-têtes Authorization, de données client ou de réponse brute contenant des données personnelles.

## Arrêt et conclusion

Arrêter si le compte n’est pas QA, si l’autorisation de coût ou le domaine manque, si la source des identifiants n’est pas clairement QA, si les mots-clés GSC requis sont absents, si les quotas ne correspondent pas ou si la réponse ne contient pas de données vérifiables. Ne jamais remplacer un résultat vide/erreur par une métrique inventée.

La certification ne peut être marquée réussie qu’après les appels réels autorisés, la comparaison des données et la vérification des permissions, quotas et traces d’organisation. Aucun de ces appels n’a été fait le 8 novembre 2026.
