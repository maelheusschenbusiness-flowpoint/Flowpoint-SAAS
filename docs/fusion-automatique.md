# Fusion automatique des PR vers `Test-Replit`

Écrit le 18/10/2026, après dix approbations manuelles en une journée.

## Ce qui est automatisé, et ce qui ne peut pas l'être

L'attente et le clic de fusion disparaissent. La revue, non — et c'est
délibéré. GitHub interdit à l'auteur d'approuver sa propre PR pour une raison
de fond : garantir un **second jugement**. Faire approuver automatiquement par
un robot ne satisfait pas cette règle, elle la contourne en gardant son
apparence : l'auteur déclencherait sa propre validation.

Le workflow `.github/workflows/fusion-automatique.yml` ne fait donc qu'une
chose : demander à GitHub d'activer **sa** fusion automatique sur la PR.
GitHub fusionne ensuite de lui-même, et seulement quand toutes les conditions
du ruleset `Protect Test-Replit` sont réunies :

| Condition | Qui la vérifie |
|---|---|
| `Types, build, tests` vert | GitHub (contrôle obligatoire) |
| revue obtenue, par un autre que l'auteur | GitHub (règle `pull_request`) |
| branche à jour | GitHub (`strict_required_status_checks_policy`) |

Si une seule manque, la PR reste ouverte indéfiniment. Aucune protection n'est
touchée, et rien n'est contourné.

**Le gain réel** : au lieu de surveiller la CI puis de revenir fusionner, il
reste une seule action — approuver. La fusion suit toute seule, même plusieurs
minutes plus tard.

## Les deux gardes, et pourquoi elles existent

**Pas de fork.** Ce dépôt est **public**. Sans cette garde, un contributeur
extérieur pourrait faire fusionner son code automatiquement dans
`Test-Replit`. Une PR venant d'un fork est donc refusée, et reste à traiter à
la main.

**Pas de `Flowpoint`.** Le déclencheur est restreint à `Test-Replit`, et une
garde explicite revérifie la cible. La production n'est jamais concernée.

## Pourquoi `pull_request_target` et pas `pull_request`

Contre-intuitif, mais c'est le choix sûr **ici** : avec `pull_request_target`,
le fichier de workflow exécuté est celui de la branche **de base**. Une PR ne
peut donc pas modifier ce workflow pour s'accorder plus de droits. Avec
`pull_request`, le workflow viendrait de la PR elle-même.

Le danger habituel de `pull_request_target` est d'exécuter le code de la PR
avec un jeton privilégié. Ce workflow **ne fait aucun `checkout`** : il se
borne à un appel d'API. C'est ce qui rend ce déclencheur approprié, et un test
de ce dépôt vérifierait l'absence de `checkout` si l'on venait à l'ajouter.

## Prérequis : un réglage de dépôt

Le réglage **« Allow auto-merge »** doit être actif (Settings → General →
Pull Requests). Il est aujourd'hui à `false`.

Ce n'est pas une protection : il autorise seulement l'usage de la
fonctionnalité. Il n'abaisse aucune exigence, et GitHub continue d'imposer la
CI et la revue. Tant qu'il est inactif, le workflow échoue proprement en le
disant, et rien d'autre ne change.

## Ce qui reste manuel, et l'arbitrage si l'on veut aller plus loin

Il reste une approbation par PR. Pour la supprimer, il faudrait abaisser
`required_approving_review_count` à `0` sur `Protect Test-Replit` — c'est-à-dire
**retirer la revue obligatoire**. Conséquence : n'importe quel commit poussé
sur une branche puis ouvert en PR atteindrait `Test-Replit` sans qu'aucun œil
humain ne l'ait vu, la CI seule faisant barrage. Et `Test-Replit` est la source
des promotions vers la production.

Cette modification touche une protection. Elle n'est pas appliquée, et ne le
sera pas sans autorisation explicite.

Un intermédiaire existe : approuver automatiquement une classe **étroite et
vérifiable** de PR — par exemple celles ne touchant que `docs/**` ou que des
fichiers `*.test.ts`, et provenant du dépôt lui-même. Cela reste une revue de
nom seulement, mais sur un périmètre où la CI est réellement le juge. À
décider, pas à supposer.
