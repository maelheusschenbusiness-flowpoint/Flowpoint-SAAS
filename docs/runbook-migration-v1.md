# Runbook — migration PostgreSQL V1, sauvegarde et retour arrière

`docs/render-config-target.md` et `render.yaml` renvoient tous deux au
« runbook, phases 1 et 2 » comme prérequis **bloquant** du Pre-Deploy et de la
migration V1. Ce runbook n'existait pas. Ce fichier le pose.

Rédigé le 18/10/2026. Il ne déclenche rien : c'est la procédure à exécuter, et
les constats qui la motivent. Aucune commande ci-dessous n'a été lancée sur la
production.

## Ce qui est mesuré sur la base de production

Relevé le 18/10/2026 sur le projet Supabase `Flowpoint project`
(`sejbsuuaeokyuxuoaxzd`, PostgreSQL 17.6.1, eu-central-1, `ACTIVE_HEALTHY`),
par requêtes **en lecture seule** sur les catalogues :

| Mesure | Valeur |
|---|---|
| Tables `public` | 123 |
| Tables avec `org_id` sans RLS | **0** |
| Policies | 437 |
| Policies ouvertes à `anon` ou `public` sans filtre contextuel | **0** |
| Tables avec RLS et **zéro** policy | **10** |
| Avis de sécurité Supabase de niveau ERROR | **0** |

L'isolation tient donc : la seule policy dont l'expression est littéralement
`true` est `sellers.sellers_app_user_all`, limitée au rôle `app_user` sur une
table sans `org_id`. Pour `anon`, aucune policy ne s'applique à ces 10 tables —
le défaut est le refus, pas la fuite.

### Les 10 tables à RLS sans policy

`activity_logs`, `checkout_subscription_claims`, `competitor_map_results`,
`magic_link_tokens`, `my_table`, `organizations`, `pending_signups`,
`schema_migrations`, `seller_commissions`, `seller_financial_ledger`.

Trois d'entre elles ont RLS **forcée** (`relforcerowsecurity`) :
`checkout_subscription_claims`, `pending_signups`, `seller_financial_ledger`.
RLS forcée s'applique **aussi au propriétaire** de la table. Avec zéro policy,
aucun rôle n'y lit ni n'y écrit — propriétaire inclus. Les tables sont toutes
possédées par `postgres`.

**Conséquence, et sa limite.** Si le serveur se connecte en `postgres` (ce que
suggère la demande de `GRANT app_user TO postgres WITH SET TRUE`, mais qui
**n'est pas vérifié** : la valeur de `DATABASE_URL` n'est pas lisible depuis le
dépôt, et la vérification du rôle a été refusée par la politique d'accès), alors
l'inscription (`pending_signups`) et la réclamation d'abonnement après paiement
(`checkout_subscription_claims`) sont aujourd'hui **impossibles** en production.
C'est à confirmer avant toute conclusion — voir « À vérifier d'abord ».

La migration V1 du dépôt crée les policies manquantes : sur une base construite
depuis zéro par `pnpm run migrate`, on mesure 125 tables, 125 avec RLS, 483
policies et **0** table à `org_id` sans policy d'isolation.

## À vérifier d'abord — trois questions, avant toute écriture

1. **Sous quel rôle le serveur se connecte-t-il ?** Lire l'utilisateur de
   `DATABASE_URL` dans le tableau de bord Render (ne pas le copier ailleurs).
   Si c'est `postgres`, le point ci-dessus est un défaut actif, pas un risque.
2. **`Flowpoint-Main` et `flowpoint-test` visent-ils la même base ?** Il n'existe
   qu'un seul projet Supabase. Les deux services déclarent `DATABASE_URL` avec
   `sync: false`, donc leurs valeurs sont indépendantes — mais rien ne prouve
   qu'elles diffèrent. Si elles pointent sur la même base, le `preDeployCommand`
   prévu pour `flowpoint-test` exécuterait `migrate` **sur la production**.
   À régler avant toute adoption du Blueprint.
3. **La sauvegarde est-elle restaurable ?** Une sauvegarde non restaurée n'est
   pas une sauvegarde. Phase 1 ci-dessous.

## Phase 1 — sauvegarde, et preuve qu'elle se restaure

```bash
# 1. Capture. --no-privileges car les GRANT sont reposés separement (voir 3).
pg_dump "$URL_PRODUCTION" --no-owner --no-privileges -Fc -f flowpoint-$(date +%Y%m%d-%H%M).dump

# 2. Restauration dans une base NEUVE et distincte, jamais par-dessus l'original.
createdb flowpoint_restauration
pg_restore -d flowpoint_restauration --no-owner --no-privileges flowpoint-….dump
```

La restauration doit précéder tout le reste. Points connus, mesurés en
construisant la base de test locale :

- Les rôles Supabase doivent exister **avant** la restauration, sinon les
  objets qui les nomment échouent. Les créer en `NOLOGIN` :
  `app_user`, `anon`, `authenticated`, `service_role`, `authenticator`,
  `supabase_admin`.
- Après un `pg_dump --no-privileges`, les droits sont absents : il faut les
  reposer (`GRANT` sur toutes les tables et séquences à `app_user`, `anon`,
  `authenticated`, `service_role`) **après** la migration, sinon tout répond
  « permission denied ».
- `DATABASE_URL` doit être une URL **TCP** (`postgresql://user@127.0.0.1:port/base`) :
  `lib/env.ts` refuse la forme à socket Unix.

Critère de sortie de la phase 1 : la copie restaurée répond, et le nombre de
tables et de lignes des tables sensibles (`organizations`, `org_settings`,
`users`, `organization_members`) correspond à l'original.

## Phase 2 — la migration sur la copie restaurée, jamais ailleurs

```bash
cd artifacts/api-server
DATABASE_URL="…flowpoint_restauration" pnpm run migrate
```

Critères de sortie, à relever et à conserver :

- `0` étape en échec ;
- aucune table à `org_id` sans RLS ni policy d'isolation ;
- les 10 tables listées plus haut ont désormais des policies ;
- `GET /api/healthz/ready` répond `200` contre cette base.

C'est aussi ici — et nulle part ailleurs — que l'on observe ce que `migrate.mjs`
dit d'un schéma réel. Tant que cette phase n'a pas réussi, le
`preDeployCommand` de `Flowpoint-Main` reste commenté : une porte qui refuse un
schéma invalide bloquerait **tous** les déploiements, y compris un correctif
urgent.

## Phase 3 — la production, et son retour arrière

Ordre imposé : phase 1 réussie, phase 2 réussie, puis seulement ceci.

1. Reprendre une sauvegarde fraîche (phase 1) immédiatement avant.
2. Appliquer la migration hors d'un déploiement, en gardant la sortie complète.
3. Vérifier, dans cet ordre : `GET /api/healthz/ready` → `200` ; connexion par
   lien magique ; isolation entre deux organisations ; création d'une session
   Checkout ; réception d'un webhook Stripe signé.

### Retour arrière

Le retour arrière du **code** est indépendant et immédiat : Render redéploie le
commit précédent de la branche `Flowpoint`.

Le retour arrière du **schéma** n'est pas symétrique : `migrate.mjs` n'a pas de
sens inverse. Les deux seules voies sont donc, par ordre de préférence :

1. **Corriger en avant** — la migration est idempotente et ses étapes sont
   additives (création de policies, activation de RLS). Un second passage est
   sans danger et c'est la voie normale.
2. **Restaurer la sauvegarde de l'étape 1** — à n'employer que si le schéma est
   inutilisable. Coût : toutes les écritures faites depuis la capture sont
   perdues. C'est pourquoi la capture doit être immédiatement antérieure, et
   pourquoi l'opération se fait hors trafic.

Il n'existe pas de troisième voie. En particulier, ne pas désactiver RLS pour
« débloquer » une table : cela transforme un refus en fuite entre organisations.

## Ce que ce runbook n'autorise pas

- Aucune exécution sur la production sans validation explicite.
- `GRANT app_user TO postgres WITH SET TRUE` reste interdit sans validation.
- Aucune suppression de données de production.
- Le Blueprint Render ne doit pas être appliqué en l'état : il créerait des
  services en double (voir `docs/render-config-target.md`).
