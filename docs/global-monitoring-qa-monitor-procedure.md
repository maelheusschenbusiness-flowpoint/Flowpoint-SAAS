# Procédure — monitor synthétique QA pour Global Monitoring

État au 4 novembre 2026 : aucun monitor QA autorisé n’a été confirmé. L’inventaire Better Stack effectué en lecture seule a retourné un monitor et aucun candidat explicitement marqué QA/test/synthétique. Son nom et sa cible ne sont pas reproduits ici. Aucun monitor n’a été créé, modifié, mis en pause ou supprimé.

## Limites de sécurité

- Ne jamais utiliser Production, une organisation client, un domaine client ou des identifiants de production.
- L’unique token Better Stack actuellement configuré n’est pas attesté comme étant limité à QA. Ne pas l’utiliser pour créer une ressource.
- Avant toute création, confirmer l’existence d’un compte/espace Better Stack QA séparé et d’une organisation QA interne dans le service Test-Replit. Le monitor doit être créé via l’API de ce service afin que `bs_monitor_ownership` enregistre le bon propriétaire.
- Demander une autorisation explicite juste avant l’appel de création externe, en présentant l’environnement, l’organisation QA, le nom et la cible exacts.
- Ne jamais modifier un monitor préexistant. La suppression ou la modification ultérieure d’un monitor QA créé nécessitera sa propre autorisation.

## Cible synthétique proposée

Utiliser `https://example.com/`, domaine réservé à la documentation et aux exemples, sans compte client ni données utilisateur. Le monitor doit porter un nom clair comme `Beta 2 Global Monitoring QA — Synthetic`. La fréquence et les régions devront être choisies parmi les valeurs acceptées par Better Stack au moment de la création; ne pas présenter un agrégat multi-région comme plusieurs sondes indépendantes.

La route locale `/api/qa/fixture/:id` ne convient pas à une cible hébergée sur Render : son garde-fou la désactive explicitement sur Render et sur les déploiements. Ne pas assouplir ce garde-fou.

## Étapes après autorisation

1. Vérifier le nom du service Test-Replit et de l’organisation interne QA sans consulter ni toucher aux environnements Production ou client.
2. Vérifier que le compte Better Stack utilisé est bien le compte QA isolé; sinon arrêter.
3. Créer un seul monitor synthétique via le service Test-Replit, avec les valeurs présentées dans la demande d’autorisation.
4. Vérifier que son identifiant apparaît dans `bs_monitor_ownership` pour l’organisation QA et qu’aucune autre organisation ne le voit.
5. Lire le monitor réel depuis le parcours Global Monitoring QA et vérifier les statuts, l’uptime disponible et la portée de mesure affichée.
6. Conserver la preuve (réponse API expurgée des secrets, ID du monitor QA, propriétaire QA et résultat du parcours). N’attribuer aucune certification sur la seule base d’une réponse UI synthétique.
