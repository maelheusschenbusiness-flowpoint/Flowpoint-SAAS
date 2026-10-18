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

## Le mécanisme qui fonctionne, vérifié le 18/10/2026

Au moment d'ouvrir la PR, on arme la fusion automatique de GitHub :

```bash
gh pr merge <numero> --repo <depot> --auto --merge
```

GitHub fusionne ensuite **de lui-même**, dès que toutes les conditions du
ruleset sont réunies. Aucune surveillance, aucun clic ultérieur.

**Preuve** — PR #173 : fusion automatique armée à 15:06 alors que la CI était
`pending` ; CI verte ; fusionnée par GitHub à **15:08:15** (commit `72cbc337`),
sans aucune intervention.

## Le workflow a été retiré, et voici pourquoi

Un workflow `fusion-automatique.yml` avait été ajouté (PR #172) pour armer la
fusion automatique à l'ouverture de chaque PR, y compris celles qu'on n'ouvre
pas soi-même. Mesure après fusion : **il ne s'est jamais enregistré ni
déclenché** — l'API Actions ne connaît qu'un seul workflow, `ci.yml`, et aucune
exécution n'existe pour la PR #173.

La cause de ce non-enregistrement n'est pas établie. Ce qui l'est, en revanche,
c'est qu'il n'aurait de toute façon pas pu agir : le réglage de dépôt
`default_workflow_permissions` vaut **`read`**, et un bloc `permissions:` ne
peut que *restreindre* ce maximum, jamais l'élargir. Le jeton n'aurait pas eu
le droit d'écrire sur la PR.

Un workflow inerte est pire qu'aucun workflow : il laisse croire à une
capacité qui n'existe pas. Il a donc été retiré.

### Ce qu'il faudrait pour le faire revivre

Passer `default_workflow_permissions` à `write` pour tout le dépôt. Sur un
dépôt **public**, cela élargit le jeton de *tous* les workflows, pas seulement
celui-là. Le gain serait limité aux PR qu'on n'ouvre pas soi-même — puisque
pour les autres, la commande ci-dessus suffit et ne coûte rien.

C'est un arbitrage à trancher, pas une évidence. Il n'est pas appliqué.

## L'approbation obligatoire a été retirée — décision du 18/10/2026

Sur autorisation explicite, et **sur `Test-Replit` uniquement** :

| Changement | Avant | Après |
|---|---|---|
| `Protect Test-Replit` → `required_approving_review_count` | `1` | **`0`** |
| Réglage de dépôt `allow_auto_merge` | `false` | **`true`** |

Un diff avant/après des deux rulesets a été produit : c'est le **seul** champ
modifié, et `Protect Flowpoint` est strictement inchangée.

### Ce qui garde encore la branche

Retirer la revue ne laisse pas la porte ouverte. Restent en vigueur :

- le contrôle obligatoire **`Types, build, tests`**, en mode strict (la branche
  doit être à jour) — c'est désormais le seul juge du contenu ;
- `require_extra_approval_for_unattributed_changes` : une PR dont les commits
  ne sont pas rattachés à un compte GitHub exige **toujours** une approbation.
  C'est précisément le cas où un œil humain a le plus de valeur, et il a été
  conservé à dessein ;
- `deletion` et `non_fast_forward` : la branche ne peut être ni supprimée ni
  réécrite ;
- **aucun acteur de contournement** sur `Test-Replit` ;
- la garde anti-fork du workflow : ce dépôt est public, et une PR venant d'un
  fork n'est jamais fusionnée automatiquement.

### Ce que cela change dans le risque, dit franchement

La CI est maintenant le dernier rempart avant `Test-Replit`, qui alimente la
production par promotions sélectives. Deux conséquences à garder en tête :

1. **Un trou dans la CI devient un trou dans la branche.** Un défaut qu'aucun
   test ne couvre passera sans que personne ne le voie. C'est l'argument pour
   continuer à écrire un test par défaut constaté, plutôt qu'après coup.
2. **La promotion vers `Flowpoint` reste le vrai point de contrôle.** Elle
   exige toujours une approbation, et `Protect Flowpoint` n'a pas été touchée.
   C'est là que la relecture humaine se concentre désormais.

