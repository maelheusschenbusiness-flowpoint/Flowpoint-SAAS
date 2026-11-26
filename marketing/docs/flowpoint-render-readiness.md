# État de préparation — PR #556

État relevé le 26 novembre 2026. La PR reste ouverte vers
`marketing-render-staging`. Les résultats PostgreSQL portent uniquement sur
`flowpoint_audit_staging`, depuis le Web Shell de
`flowpoint-marketing-staging`; ils ne certifient aucune base de production.

## PostgreSQL staging — vérifications clôturées

Tous les contrôles communiqués sont acquis. Ne pas les relancer :

- 9/9 colonnes conformes au schéma du moteur.
- `quota_delete`, `public_usage`, `quota_resolution_ok`,
  `slots_resolution_ok` et `purge_index_conforme` sont `true`.
- SELECT/INSERT/UPDATE, clés primaires, contraintes et absence de RLS confirmés.
- Limites du rôle et de la base : `-1` (pas de limite spécifique);
  `max_connections=103`, 8 connexions au relevé précédent.
- Deux slots et zéro compteur au relevé précédent; c’est l’état initial attendu.

Aucune nouvelle commande SQL ou écriture PostgreSQL n’est demandée ni effectuée.
Aucune base de production n’a été consultée.

## Quatre variables Render à régler

Render rapporte `production=true`, `session_secret_min_32=true` et
`audit_enabled_now=true`. Les indicateurs `test_mode_false`, `global_10`,
`network_5` et `concurrency_2` sont faux; ils ne révèlent pas les valeurs brutes.

Valeurs par défaut effectives dans le code :

- Le test mode n’est actif que si `PUBLIC_AUDIT_TEST_MODE` vaut exactement
  `"true"`; une variable absente agit donc comme test mode false.
- La limite globale retombe à 10 si `PUBLIC_AUDIT_DAILY_LIMIT` est absente,
  invalide ou non positive. Une autre valeur positive est utilisée, jusqu’à
  10 000 en mode production.
- La limite réseau retombe à 5 si `PUBLIC_AUDIT_NETWORK_DAILY_LIMIT` est
  absente, invalide ou non positive. Une autre valeur positive est utilisée,
  jusqu’à 500 en mode production.
- La simultanéité retombe à 2 si `PUBLIC_AUDIT_MAX_CONCURRENT` est absente,
  invalide ou non positive; une valeur positive différente est utilisée,
  plafonnée à 4.

Les valeurs de repli sont sûres, mais les indicateurs false ne permettent pas
de confirmer qu’elles sont les valeurs actives. Pour le profil pilote attendu,
configurer exactement :

```text
PUBLIC_AUDIT_TEST_MODE=false
PUBLIC_AUDIT_DAILY_LIMIT=10
PUBLIC_AUDIT_NETWORK_DAILY_LIMIT=5
PUBLIC_AUDIT_MAX_CONCURRENT=2
```

Ne jamais afficher ni copier `SESSION_SECRET`. L’audit est déjà activé sur le
service Render mesuré. Son démarrage déclenche une purge DELETE et une purge
horaire; aucune variable n’a été changée ici.

## Proxy et IP client — non certifiés pour la production publique

Le code de la PR configure Express avec `trust proxy = 1`. Le moteur lit
`req.ip`, normalise l’adresse avec `ipaddr.process`, puis en stocke uniquement
une clé HMAC.

Deux vérifications limitées au staging ont envoyé au total 62 requêtes GET à
`/api/public-audit/quota`, avec des valeurs `X-Forwarded-For` distinctes. Aucun
POST d’audit n’a été lancé. Les réponses étaient HTTP 200; une série a montré
des compteurs `RateLimit-Remaining` qui diminuaient sur certains processus et
se réinitialisaient sur d’autres. Cela révèle que le limiteur en mémoire est
propre aux processus/instances et que le routage répartit les requêtes. Ces
résultats ne certifient pas que `req.ip` correspond à l’adresse réelle du
visiteur plutôt qu’à une adresse de proxy partagée.

**Ne pas déclarer le contrôle IP réussi et ne pas exposer l’audit sur
`flowpoint.pro` avant une observation Render qui confirme le client réellement
retenu et résiste à un `X-Forwarded-For` falsifié.** Le code seul et les tests
de limiteur en mémoire ne permettent pas de distinguer l’IP client de celle
d’un proxy. Ne pas créer une route publique qui révèle l’adresse; une
instrumentation temporaire nécessite une décision séparée.

## Préparation de la fusion et de la bascule

- La PR #556 demeure ouverte; aucune fusion n’a été effectuée.
- Le SHA de code examiné n’avait aucun check-run GitHub attaché. Les contrôles
  locaux déjà réussis ne remplacent pas les checks et revues exigés par la
  branche cible.
- Avant fusion autorisée : régler les quatre variables ci-dessus, lever le
  blocage d’observation proxy/IP, puis attendre les validations et approbations
  requises.
- Avant déploiement manuel autorisé : vérifier le SHA approuvé et `/healthz`
  sur le service Render existant.
- Avant bascule autorisée : vérifier SSR, routes SEO, noindex et absence de
  tracking sur staging; confirmer domaines/TLS, retour arrière et disponibilité
  de Replit. Aucun audit POST réel n’est lancé par ces contrôles.

`flowpoint.pro` reste servi par Replit. Aucun DNS, service public, base de
production, branche `Flowpoint` ou `Test-Replit` n’a été modifié. Aucune
infrastructure payante n’a été créée.
