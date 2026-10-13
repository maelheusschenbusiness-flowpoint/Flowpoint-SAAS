# Configuration Render — en vigueur et cible

Relevé le 13/10/2026 par l'API Render, en lecture seule. Aucun service, aucune
variable et aucun Blueprint n'a été modifié. `render.yaml`, à la racine, décrit
la configuration **cible** ; il n'est pas appliqué et ne doit pas l'être en
l'état — voir « Appliquer le Blueprint » plus bas.

## Services du dépôt Flowpoint-SAAS

| Service | Branche | Auto-déploiement | Plan | Région | État |
|---|---|---|---|---|---|
| `Flowpoint-Main` — production | `Flowpoint` | oui, sur commit | starter | oregon | en service |
| `flowpoint-test` | `Test-Replit` | oui, sur commit | 0.5c-512mb | oregon | en service |
| `Flowpoint-SAAS` — ancien | `Flowpoint` | oui | free | oregon | **suspendu** |
| `Flowpoint-SAAS-CronJob1` | `Flowpoint` | oui | starter | oregon | **suspendu** |
| `Flowpoint-SAAS-CronJob2` | `Flowpoint` | oui | starter | oregon | **suspendu** |
| `Flowpoint-SAAS-CronJob3` | `Flowpoint` | oui | starter | oregon | **suspendu** |

`starter` et `0.5c-512mb` désignent la même taille ; l'API rapporte l'ancien nom
pour l'un, le nouveau pour l'autre. `render.yaml` reprend pour chaque service la
chaîne exacte que l'API rapporte, afin qu'une adoption ne redimensionne rien.

## Écarts entre la configuration en vigueur et la cible

| Paramètre | En vigueur | Cible | Condition d'activation |
|---|---|---|---|
| Pre-Deploy, `Flowpoint-Main` | **aucun** | `cd artifacts/api-server && pnpm run migrate` | **commenté dans le fichier.** `migrate.mjs` sur une copie restaurée, en succès, d'abord |
| Pre-Deploy, `flowpoint-test` | **aucun** | idem, **actif dans le fichier** | aucune — un refus bloque un déploiement de test, pas la production |
| Health check, `Flowpoint-Main` | `/api/healthz` | `/api/healthz/ready` | PR #151 fusionnée et déployée, puis certification d'une indisponibilité PostgreSQL réelle sur test |
| Health check, `flowpoint-test` | **aucun** | `/api/healthz/ready` | PR #151 fusionnée |

Tout le reste — commandes de build et de démarrage, branches, plans, régions,
nombre d'instances, déclencheur d'auto-déploiement — est repris **à l'identique**.
Le fichier ne propose aucune autre modification.

### Pourquoi le Pre-Deploy est un écart à risque

Aucune commande Pre-Deploy n'existe aujourd'hui : `migrate.mjs` ne tourne donc
jamais automatiquement, et ni l'audit d'isolation inter-organisations ni le
durcissement RLS ne sont appliqués en production. Le serveur journalise pourtant
à chaque démarrage « Schema already migrated — skipping full init (Pre-Deploy
completed) », sur le seul constat que la table `audits` existe (PR #150 corrige
ce message et rend l'état observable).

Une fois le Pre-Deploy actif, `migrate.mjs` **refuse** le déploiement quand une
table portant `org_id` n'est pas isolée ou qu'une table d'identité manque. C'est
l'objectif, et c'est aussi le risque : sur une base dont l'état n'a pas été
mesuré, cette commande bloquerait **tous** les déploiements, y compris un
correctif urgent. D'où l'ordre : copie restaurée → `migrate.mjs` en succès →
`flowpoint-test` → `Flowpoint-Main`.

### Pourquoi le health check change, et ce qui reste à certifier

`/api/healthz` ne touche pas la base. Chaque étape d'initialisation du schéma
étant non fatale, un serveur dont tout a échoué y répond `ok` et est mis en
ligne. `/api/healthz/deep` est l'inverse : il renvoie 503 dès qu'un seul de ses
six contrôles tiers tombe — Stripe, OpenAI, BetterStack, DataForSEO, Resend,
Google OAuth — et ferait redémarrer une instance saine parce qu'un tiers est en
panne. Aucun des deux ne convient.

`/api/healthz/ready` (PR #151) ne regarde que PostgreSQL et la validité du
schéma, tolère **3 échecs consécutifs** de la base et refuse **immédiatement** un
schéma invalide. Vérifié en arrêtant réellement PostgreSQL sous le serveur :
200, 200, puis 503 au troisième appel, et retour à 200 au redémarrage.

**Ce qui n'est pas certifié** : la réaction de **Render** à ces 503. Le nombre
d'échecs que Render tolère avant de remplacer une instance, et son délai entre
deux interrogations, ne sont pas documentés de façon à être déduits ; ils se
mesurent. Avant de changer la sonde en production, il faut provoquer une
indisponibilité PostgreSQL sur `flowpoint-test` et observer ce que Render fait.
Si Render remplace l'instance au premier 503, une coupure de base plus longue
que la tolérance déclencherait une boucle de redémarrage — c'est l'unique raison
pour laquelle cet écart reste conditionnel.

## Aucun Blueprint ne lit ce dépôt aujourd'hui — vérifié

Un Blueprint ne peut se synchroniser qu'à partir d'un `render.yaml` présent dans
le dépôt. Il n'y en avait aucun, sur aucune des deux branches :

```
render.yaml sur Flowpoint    : ABSENT (HTTP 404)
render.yaml sur Test-Replit  : ABSENT (HTTP 404)
```

Aucun Blueprint ne peut donc être en train de piloter ces services, et **ajouter
ce fichier sur `Test-Replit` n'active rien par lui-même** : il faut créer un
Blueprint explicitement dans le tableau de bord. Second indice concordant : les
quatre services de ce dépôt ne portent aucun `environmentId`, contrairement aux
deux services de l'Acquisition Engine, qui en ont un — l'API expose les
environnements, pas les Blueprints, mais la différence est nette.

## Appliquer le Blueprint — ce qui se passerait, vérifié dans la documentation

Les six services ont été créés **à la main** dans le tableau de bord. La
documentation Render est explicite : créer un Blueprint sur un dépôt dont les
noms de services existent déjà **ne les adopte pas** — « Render appends a suffix
to the name of each new resource to prevent collisions with your existing
resources ».

Conséquence directe, et réponse à la question posée :

- **Oui, un Blueprint appliqué en l'état créerait de nouveaux services** —
  `Flowpoint-Main-1`, `flowpoint-test-1` ou équivalents — avec leurs propres
  variables d'environnement, vides ;
- **non, il ne modifierait pas les services de production** : le trafic
  continuerait d'être servi par les services d'origine, intacts ;
- le risque réel n'est donc pas la casse, c'est la **duplication silencieuse** :
  deux services sur la même branche, en auto-déploiement, dont l'un déploie sans
  être surveillé, et une facturation en double.

La seule voie sûre est l'inverse : **ajouter chaque service existant au
Blueprint depuis sa propre page Render** (« You can add an existing Render
resource to your Blueprint »), après quoi chaque synchronisation leur applique
ce fichier. Une ressource ne doit être gérée que par un seul Blueprint.

Les variables d'environnement non déclarées dans le fichier sont **conservées** :
« The resource retains any existing environment variable values that aren't
overwritten by the Blueprint ». `render.yaml` ne déclare que les variables sans
lesquelles le service ne démarre pas ou dont dépend le parcours payant, toutes
en `sync: false` — aucune valeur n'y figure. L'inventaire complet vit dans
`GET /api/diagnostics`, qui réduit chaque variable à `set`/`not_set`.

## Services volontairement absents du fichier

`Flowpoint-SAAS` (ancien service, plan free) et les trois cron jobs sont
**suspendus**, et un Blueprint ne sait pas exprimer « suspendu » : les décrire
exposerait à une réactivation lors d'une adoption.

Pour les cron jobs, il y a une raison plus forte. Leurs commandes de démarrage
visent des cibles qui **n'existent plus dans le dépôt** :

| Cron | Planification | Commande | Cible |
|---|---|---|---|
| CronJob1 | `0 9 * * *` | `npm run cron` | **script `cron` absent** du `package.json` |
| CronJob2 | `0 9 1 * *` | `node monthly-cron.js` | **fichier absent** |
| CronJob3 | `0 3 * * *` | `node src/cron/monthlyMonitoringReport.js` | **fichier absent** |

Les réactiver en l'état les ferait échouer immédiatement. Les décrire ici
reviendrait à graver une configuration cassée. Conséquence fonctionnelle à
trancher séparément : **les rapports mensuels de monitoring ne tournent pas.**

## Ordre d'intervention

1. Fusionner #150 (observabilité de la porte) — rend l'état du schéma lisible
   dans les journaux de production, sans rien bloquer.
2. Vérifier une sauvegarde restaurable, puis exécuter `migrate.mjs` sur la copie
   restaurée (runbook, phases 1 et 2). **Bloquant.**
3. Fusionner #151, déployer sur `flowpoint-test`, pointer sa sonde sur
   `/api/healthz/ready`, provoquer une indisponibilité PostgreSQL et **mesurer**
   la réaction de Render.
4. Fusionner #152 (policies RLS alignées) — préalable à toute décision sur
   `GRANT app_user`.
5. Activer le Pre-Deploy sur `flowpoint-test`, observer un déploiement complet.
6. Seulement ensuite : Pre-Deploy et sonde de disponibilité sur
   `Flowpoint-Main`, hors heures de pointe.
7. Statuer sur les trois cron jobs et sur l'ancien service suspendu.

Chaque étape de 3 à 7 est une modification de configuration Render : elle vous
appartient, et aucune n'est faite depuis cette session.
