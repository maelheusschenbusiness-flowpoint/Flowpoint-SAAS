# Procédure finale — bascule de `flowpoint.pro` vers Render

## Périmètre et autorisations

Cette procédure vise uniquement le service Web Render marketing déjà existant
et le PostgreSQL Render déjà existant. Elle ne crée pas de service, base,
instance, plan ou add-on payant. Elle ne touche pas à `app.flowpoint.pro`, aux
branches protégées, aux données Replit, ni à la publication Replit.

Le code et ce document sont préparés dans une PR. Les contrôles PostgreSQL
Render en lecture seule ont été effectués par l’utilisateur le 26 novembre 2026 ;
leurs résultats et les seuls contrôles restants sont consignés dans le
[rapport de préparation actualisé](./flowpoint-render-readiness.md).
Cette mise à jour ne réalise aucun changement DNS, secret Render, déploiement,
schéma, écriture de base, audit, formulaire ou e-mail réel. Toute bascule DNS et toute activation d’écriture en production
restent soumises à une autorisation explicite distincte.

**Le service Replit et toutes les données historiques Replit restent actifs et
intacts pendant toute la migration.** Ne pas le désactiver, le dépublier, le
modifier ou le republier pour cette procédure.

## Valeurs DNS observées en lecture seule

Relevé via DNS public le 24 novembre 2026. Les TTL publics diminuent avec le
temps; vérifier à nouveau les enregistrements dans Namecheap juste avant une
opération autorisée.

| Nom | État observé | Rôle dans la procédure |
| --- | --- | --- |
| Serveurs DNS | `dns1.registrar-servers.com`, `dns2.registrar-servers.com` | Namecheap est actuellement autoritaire. Vérifier dans le compte que les serveurs n’ont pas changé. |
| `@` A | `34.111.179.208`, TTL public d’environ 30 minutes | Valeur de retour à l’origine Replit; la conserver dans une note avant toute modification. |
| `@` AAAA | Aucun enregistrement observé | Ne pas en créer. Render indique que son service custom-domain utilise IPv4. |
| `www` CNAME | `flowpoint.pro.`, TTL public d’environ 30 minutes | Cet alias existe déjà. Le conserver tel quel; le changement de l’apex fera suivre sa résolution à Render. Render peut enregistrer son alias automatique et rediriger `www` vers l’apex. |
| `@` MX | Les cinq serveurs Google Workspace étaient présents | Ne modifier ni les MX ni leur priorité. |
| `@` TXT | SPF Google/Resend et validations Replit/Google présents | Préserver tous les TXT existants; ne pas remplacer la ligne SPF ni recopier des valeurs dans le code. |

**Enregistrement Render requis pour l’apex chez Namecheap :**

| Type | Host | Valeur cible | TTL |
| --- | --- | --- | --- |
| `A` | `@` | `216.24.57.1` | `1 min` (recommandation de Render) |

Render documente cette IP comme son load balancer pour un domaine racine avec
Namecheap. Au moment de la bascule, remplacer les anciens enregistrements `A`
de `@` par cette valeur; ne pas conserver deux origines en parallèle. Ne pas
ajouter de `AAAA`, de CNAME `www`, de redirection URL, ni de nouvel enregistrement
MX/TXT. Si Render affiche une exigence de vérification supplémentaire dans le
tableau de bord, copier exactement le nom et la valeur qu’il fournit; ne pas
inventer de jeton DNS.

## Étapes dans Render — avant tout changement DNS

1. Ouvrir le service Web existant qui sert
   `flowpoint-marketing-staging.onrender.com`. Ne pas créer de service, base,
   Blueprint, environnement partagé ou plan supérieur.
2. Vérifier que le dépôt, la branche et le SHA sont ceux de la PR approuvée vers
   `marketing-render-staging`, puis lancer un déploiement manuel de ce SHA dans
   le service existant. Garder les déploiements automatiques désactivés.
3. Dans **Settings → Build & Deploy**, confirmer le répertoire `marketing`, le
   démarrage `corepack pnpm start`, le contrôle `/healthz` et le build :
   `corepack pnpm install --frozen-lockfile && VITE_ANALYTICS_DISABLED=false corepack pnpm run build`.
   Ne pas appliquer le `render.yaml` du dépôt.
4. Dans **Settings → Custom Domains**, conserver le domaine Render
   `flowpoint-marketing-staging.onrender.com`, puis ajouter `flowpoint.pro`.
   Render peut aussi créer automatiquement son alias `www` et le rediriger vers
   l’apex; cette paire automatique est autorisée. Ne pas ajouter manuellement
   un second alias.
5. Vérifier que Render a enregistré l’apex et, le cas échéant, son alias
   automatique. L’alias `www` est acceptable seulement si Render l’ajoute
   automatiquement sans nouveau coût hors des ressources/domaines inclus déjà
   payés. Si un coût supplémentaire est affiché, arrêter avant toute bascule.
   Le certificat TLS peut rester en attente tant que le DNS ne pointe pas vers
   Render; ne pas présenter le site au public avant que TLS soit actif.
6. Dans **Environment**, configurer les variables ci-dessous dans le service
   existant seulement après l’autorisation de configurer la production. Les
   valeurs secrètes ne doivent être saisies que dans l’interface sécurisée,
   jamais dans Git, les journaux ou le chat. Ne pas copier des identifiants
   Replit.

| Variable | Préparation de production |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | URL existante du PostgreSQL Render; vérifier en lecture seule que le schéma et le rôle sont corrects avant de l’utiliser. |
| `PUBLIC_AUDIT_DATABASE_URL` | URL vers le PostgreSQL existant. Elle peut viser la même base que `DATABASE_URL` si les tables de quotas approuvées y existent déjà. Ne pas créer de base ni écrire le schéma sans approbation. |
| `SESSION_SECRET` | Secret propre au service d’au moins 32 caractères. |
| `PUBLIC_AUDIT_ENABLED` | `true` pour la bascule et le service public uniquement après validation de tous les contrôles en lecture seule ci-dessous. Si un contrôle ne peut pas être confirmé, ne pas basculer le DNS. |
| `PUBLIC_AUDIT_TEST_MODE` | `false` pour le profil de production. |
| `PUBLIC_AUDIT_DAILY_LIMIT` | `10` audits globaux par jour UTC. |
| `PUBLIC_AUDIT_NETWORK_DAILY_LIMIT` | `5` audits par IP normalisée exacte et par jour UTC. |
| `PUBLIC_AUDIT_MAX_CONCURRENT` | `2`. La limite visiteur est fixée à 3 par jour dans le code. |
| `VITE_ANALYTICS_DISABLED` | `false` pendant le build partagé; les contrôles de domaine gardent staging et les hôtes inconnus hors tracking. |
| `RESEND_API_KEY` | Clé Resend autorisée pour le service, entrée comme secret; les e-mails restent non testés jusqu’à autorisation. |
| `RESEND_FROM_EMAIL` | Adresse expéditrice déjà vérifiée chez Resend. |
| `CONTACT_TO_EMAIL` | `support@flowpoint.pro`, ou destinataire approuvé. |

### Porte de sécurité obligatoire pour l’audit gratuit

    Les contrôles PostgreSQL de `flowpoint_audit_staging` ont été exécutés en lecture seule par l’utilisateur le 26 novembre 2026 et sont clôturés : 9/9 colonnes conformes; DELETE, USAGE du schéma, résolution des tables et index de purge conformes; clés, contraintes, droits SELECT/INSERT/UPDATE et absence de RLS confirmés. Le rôle et la base n’ont pas de limite de connexion spécifique; max_connections vaut 103, avec 8 connexions au relevé précédent. Deux slots et zéro compteur au relevé précédent. **Ne pas relancer ces contrôles PostgreSQL.** Aucun accès ni changement à une base de production.

    Quatre valeurs du profil pilote sont à corriger/expliciter sur le service Render staging :

    ```text
    PUBLIC_AUDIT_TEST_MODE=false
    PUBLIC_AUDIT_DAILY_LIMIT=10
    PUBLIC_AUDIT_NETWORK_DAILY_LIMIT=5
    PUBLIC_AUDIT_MAX_CONCURRENT=2
    ```

    Le contrôle de longueur du secret est réussi sans en exposer la valeur. `PUBLIC_AUDIT_ENABLED=true` est déjà signalé sur le service Render mesuré. Ce processus effectue des purges périodiques; aucune variable ou base n’a été modifiée ici.

    Le code utilise `trust proxy = 1`, puis `req.ip` normalisé et pseudonymisé. Deux contrôles staging ont envoyé 62 GET à `/api/public-audit/quota` avec X-Forwarded-For distincts; aucune requête POST d’audit. Les réponses HTTP 200 et les compteurs de limiteur qui diminuent/se réinitialisent selon le processus ne certifient pas que l’IP retenue est le visiteur plutôt qu’un proxy partagé. **Ne pas basculer l’audit sur flowpoint.pro avant une observation Render qui confirme l’IP retenue et la résistance aux en-têtes falsifiés.** Ne pas exposer d’adresse IP dans une route publique.

    Voir le [rapport de préparation](./flowpoint-render-readiness.md) pour les replis du code, l’analyse du proxy et les conditions de fusion. Aucun merge, déploiement, changement DNS, accès à une base de production ou modification des branches `Flowpoint` / `Test-Replit` n’a été effectué. Replit reste la cible de `flowpoint.pro` jusqu’à une bascule explicitement autorisée.

    7. Avant DNS, vérifier en lecture seule la paire de domaines dans Render, puis
   le staging :
   - l’URL `.onrender.com` répond 200 et garde
     `X-Robots-Tag: noindex, nofollow`;
   - le rendu SSR, les routes publiques, le favicon et les erreurs 404 sont
     corrects;
   - aucune requête de tracking ne part depuis le domaine staging;
   - le service et PostgreSQL restent sur les ressources existantes.
8. Lire les instructions DNS affichées pour `flowpoint.pro`. Si elles
   contredisent la valeur A indiquée plus haut ou demandent un coût, une autre
   ressource, ou une modification de base, ne pas continuer avant une décision.

## Étapes chez Namecheap — uniquement après approbation DNS explicite

1. Dans **Domain List → Manage → Nameservers**, confirmer que les serveurs
   restent `dns1.registrar-servers.com` et `dns2.registrar-servers.com`. Si
   Namecheap n’est plus l’autorité DNS, ne pas éditer cette zone; arrêter et
   identifier l’autorité actuelle.
2. Ouvrir **Advanced DNS → Host Records**. Enregistrer la zone actuelle et le
   TTL avant toute modification. Vérifier le relevé ci-dessus dans l’interface.
3. Modifier seulement l’enregistrement `A`, hôte `@`, en remplaçant
   `34.111.179.208` par `216.24.57.1`; choisir le TTL `1 min` si disponible.
   S’il existe plusieurs A records, un AAAA `@`, une redirection de domaine,
   ou un autre enregistrement inattendu, s’arrêter au lieu de supprimer
   d’autres lignes.
4. Ne pas ajouter d’enregistrement DNS pour `www`, ni modifier le CNAME `www`
   existant, les MX, les TXT, le SPF, les enregistrements de vérification ou
   les noms de serveurs. Le CNAME `www → flowpoint.pro` existe déjà et suivra
   l’apex vers Render.
5. Après propagation, vérifier avec un résolveur public que `A flowpoint.pro`
   renvoie uniquement `216.24.57.1`, et que les MX/TXT préexistants sont
   toujours présents. Revenir dans Render et cliquer **Verify** pour
   `flowpoint.pro`; attendre la vérification et l’émission TLS avant le
   contrôle de production.

## Vérifications après la bascule

Tant que le DNS se propage, des visiteurs peuvent atteindre des caches pointant
encore vers Replit. Garder les deux services disponibles. Vérifier
`https://flowpoint.pro` : négociation TLS, accueil SSR, pages publiques,
canonical `https://flowpoint.pro`, favicon et absence de l’en-tête
`X-Robots-Tag: noindex`. Vérifier que `https://www.flowpoint.pro` redirige vers
`https://flowpoint.pro`, puis vérifier l’URL `.onrender.com` pour
`noindex, nofollow` et l’absence de trackers. Le code garde une politique
noindex et sans tracking si un hôte alternatif atteint directement l’application
au lieu d’être redirigé.

Limiter les premières vérifications à des requêtes GET. Ne pas appeler l’audit,
soumettre le formulaire de contact/de lead, déclencher un e-mail, créer une
conversation persistante, ou envoyer un événement commercial réel pendant
cette validation. Si l’audit ne peut pas être activé à cause d’un contrôle
manquant, ne pas effectuer la bascule.

Les envois de formulaire reçus sur Replit pendant la propagation restent dans
la base Replit; les nouveaux envois sur Render restent dans le PostgreSQL
Render. Comparer leurs volumes et suivre le plan
[`flowpoint-replit-data-migration.md`](./flowpoint-replit-data-migration.md)
seulement si une copie est nécessaire et autorisée. Ne rien supprimer de
l’historique.

## Retour arrière

Si Render échoue, garder Replit actif. Après autorisation DNS explicite,
remettre uniquement l’enregistrement `A @` à la valeur relevée avant la
bascule (`34.111.179.208`) et restaurer son TTL antérieur. Ne pas supprimer ou
réinitialiser le PostgreSQL Render; identifier d’abord les leads reçus sur
Render et les réconcilier séparément après autorisation. Les caches DNS peuvent
retarder le retour complet.

Ne désactiver aucun service avant que le fonctionnement Render ait été validé
explicitement et qu’une autorisation distincte ait été donnée. Il n’existe
aucune opération de suppression Replit dans cette procédure.

## Sources

- [Render — custom domains](https://render.com/docs/custom-domains)
- [Render — Namecheap DNS](https://render.com/docs/configure-namecheap-dns)
- [Namecheap — host records](https://www.namecheap.com/support/knowledgebase/article.aspx/434/2237/how-do-i-set-up-host-records-for-a-domain/)
