# Diagnostic IP proxy Render — staging uniquement

Cette sonde temporaire sert uniquement à valider le staging existant
`flowpoint-marketing-staging.onrender.com`. Elle est inactive par défaut,
refuse tout autre hôte, n’écrit aucune donnée, ne lance aucun audit et ne crée
aucune ligne de quota. Elle ne renvoie aucune adresse, aucun cookie, ni aucune
clé ou valeur secrète. Les empreintes HMAC sont calculées avec `SESSION_SECRET`
et ne sont jamais enregistrées.

Le journal applicatif existant ne conserve que la méthode, le chemin, le statut
et la durée; la sonde n’écrit aucune donnée de requête dans les journaux.

## Activation temporaire

Sur le service Render staging existant uniquement :

1. Déployer manuellement le SHA de cette branche sur le staging. Ne pas changer
   la branche configurée, les DNS, la base, ni le service de production.
2. Ajouter dans l’environnement privé du service :
   - `PUBLIC_AUDIT_IP_DIAGNOSTIC=true`
   - `PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN` : valeur aléatoire d’au moins 32
     caractères, gardée dans un gestionnaire de secrets et jamais envoyée dans
     un message ou ajoutée à une URL.
3. Ne pas changer `PUBLIC_AUDIT_ENABLED` ni les paramètres PostgreSQL.

La route exige également `NODE_ENV=production`, le nom d’hôte staging exact et
le jeton transmis dans l’en-tête `X-Proxy-Diagnostic-Token`. Elle retourne 404
si une de ces conditions manque, et limite chaque processus à 16 réponses.

## Requêtes minimales

Depuis un premier réseau, envoyer un GET normal :

```sh
curl --fail-with-body --silent --show-error \
  -H "X-Proxy-Diagnostic-Token: ${PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN}" \
  https://flowpoint-marketing-staging.onrender.com/api/internal/proxy-ip-diagnostic
```

Depuis le même réseau, refaire une seule requête en tentant d’usurper
`X-Forwarded-For` avec une adresse de test réservée :

```sh
curl --fail-with-body --silent --show-error \
  -H "X-Proxy-Diagnostic-Token: ${PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN}" \
  -H "X-Forwarded-For: 198.51.100.77" \
  https://flowpoint-marketing-staging.onrender.com/api/internal/proxy-ip-diagnostic
```

Depuis un second réseau réellement distinct (par exemple le réseau mobile),
envoyer un GET normal. Les résultats JSON contiennent seulement :

- `requestIpMatchesEdgeClient` : comparaison entre Express `req.ip` et
  `CF-Connecting-IP` fourni par l’entrée Cloudflare;
- `spoofedForwardedForSelected` : indique si `req.ip` est devenu le canari
  `X-Forwarded-For`;
- `requestIpFingerprint` et `edgeClientFingerprint` : empreintes HMAC pour
  comparer les observations sans afficher les adresses.

Résultat attendu : sur chaque réseau, `requestIpMatchesEdgeClient=true`;
l’ajout du canari ne change pas `requestIpFingerprint` et
`spoofedForwardedForSelected=false`; deux réseaux à sorties Internet distinctes
doivent produire des `edgeClientFingerprint` distinctes. Si les réseaux
partagent volontairement la même sortie NAT, ce dernier résultat n’est pas une
preuve de regroupement par proxy.

Ne pas publier les en-têtes de requête, jetons ou adresses. Les corps JSON
ci-dessus peuvent être partagés après contrôle. Les appels sont exclusivement
des GET vers cette sonde, pas vers `/api/public-audit` ni `/api/public-audit/quota`.

## Désactivation et suppression

Après les trois requêtes :

1. Passer `PUBLIC_AUDIT_IP_DIAGNOSTIC=false` et supprimer
   `PUBLIC_AUDIT_IP_DIAGNOSTIC_TOKEN` dans l’environnement privé du staging.
2. Déployer ensuite le code final sans cette sonde. Ne pas fusionner cette
   branche de test.
3. Mettre à jour la PR #556 avec le résultat résumé en booléens et empreintes
   seulement, puis supprimer la branche de test.

Render décrit le chemin public par Cloudflare et son load balancer, et indique
que les requêtes publiques avec un `CF-Connecting-IP` client falsifié sont
refusées par Cloudflare. Cela motive la comparaison, mais ne remplace pas
l’observation du service staging :
https://render.com/articles/host-pocketbase-on-render
