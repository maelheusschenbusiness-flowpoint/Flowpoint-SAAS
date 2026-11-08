# Certification fournisseur de Global Monitoring en QA

État au 8 novembre 2026 : aucun monitor QA préexistant et explicitement autorisé n’a été confirmé. L’inventaire Better Stack en lecture seule a trouvé un monitor sans marqueur QA/test/synthétique. Aucun monitor n’a été créé, modifié, mis en pause ou supprimé.

## Comportement déjà vérifié localement

En environnement local sans configuration Better Stack, la route renvoie `503/configured=false` et l’interface n’invente aucune métrique. Ce test fail-closed ne certifie pas le chemin de succès du fournisseur et ne bloque pas les tests ni les certifications des autres add-ons. Global Monitoring reste `coming_soon` tant que sa certification fournisseur n’est pas complète.

## Preuve fournisseur encore nécessaire

- Identifier un monitor qui existe déjà dans un espace Better Stack QA isolé et qui est explicitement autorisé pour une lecture de test.
- Lire ses données via le parcours Global Monitoring de Test-Replit; vérifier que l’ID et le propriétaire correspondent à l’organisation QA, que les valeurs affichées proviennent de la réponse fournisseur réelle et que la portée régionale reflète exactement la réponse reçue.
- Ne pas compter un agrégat multi-région comme plusieurs sondes indépendantes.
- Conserver une preuve expurgée des secrets, l’ID du monitor QA, son propriétaire et les résultats observés. Ne revendiquer la certification que pour les comportements effectivement vérifiés.

## Limites impératives

- Ne jamais utiliser Production, une organisation client, un domaine client ou un monitor de production.
- Ne créer, modifier, mettre en pause ou supprimer aucun monitor, même pour les besoins de test.
- Ne pas utiliser le token Better Stack configuré tant que son compte et son périmètre QA ne sont pas attestés.
- Si aucun monitor QA préexistant et autorisé n’est disponible, arrêter uniquement la certification fournisseur de Global Monitoring; poursuivre normalement les autres add-ons.
- Garder Global Monitoring indisponible à l’achat (`coming_soon`) jusqu’à la preuve fournisseur réelle.
