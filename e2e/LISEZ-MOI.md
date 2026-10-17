# Tests E2E navigateur — parcours critiques

Huit parcours, trente-deux tests, joues dans un vrai Chromium contre une
instance reelle de FlowPoint.

## Lancer

```bash
E2E_BASE_URL=http://127.0.0.1:4321 \
E2E_ADMIN_KEY=<ADMIN_KEY de l'instance ciblee> \
npx playwright test
```

`E2E_ADMIN_KEY` sert uniquement a provisionner l'organisation de recette via
`POST /api/admin/provision-qa-account`. Elle doit venir de l'environnement,
jamais du depot.

## Ce que la cible doit offrir

| Variable sur le serveur cible | Pourquoi |
|---|---|
| `ENABLE_QA_FIXTURES=true` | provisionner l'organisation de recette |
| `ADMIN_KEY` (≥ 32 caracteres) | proteger ce provisionnement |
| `NODE_ENV` ≠ `production` | la route de connexion ne rend le lien magique qu'ici |
| `ENABLE_DEV_AUTH=true` | ouvrir une session pour un rôle donné (`07-roles`) |
| `BETTERSTACK_API_TOKEN` (valeur factice) | sans jeton, les routes BetterStack répondent 503 **avant** la garde de rôle, qui devient alors inobservable |

En production, `POST /api/auth/login-request` ne renvoie **jamais** le lien :
ces tests ne peuvent donc pas viser la production, et le socle le **refuse**
explicitement (`e2e/socle/garde-cible.ts`, liste blanche d'hotes).

## Deux contraintes mesurees, a connaitre avant de s'etonner

**Une seule session active par utilisateur.** Une connexion reussie revoque
toutes les autres sessions du meme compte (`invalidateAllSessions` dans
`login-verify`). C'est pourquoi les parcours qui se connectent ou se
deconnectent — `90-connexion`, `91-deconnexion` — passent en DERNIER : joues
en premier, ils invalidaient la session partagee et les vingt-cinq tests
suivants echouaient sans que rien n'indique pourquoi.

**Dix authentifications par quart d'heure et par adresse IP.** La suite en
consomme environ huit. Un passage complet par quart d'heure, donc. Le socle
reutilise la session du passage precedent si elle est encore valide, et les
tests qui touchent a la limite renoncent proprement (`test.skip`) plutot que
d'echouer. Cette limite est une protection : elle n'est pas contournee.

## Organisation des fichiers

| Fichier | Parcours |
|---|---|
| `01-tableau-de-bord` | ouverture, absence d'erreur de script, les 25 vues |
| `02-audit` | creation d'audit, saisie invalide, panne de fournisseur |
| `03-monitoring` | vue, onglets, etat en barre haute, panne de l'API |
| `04-organisation-parametres` | parametres, onglets, identite, facturation |
| `05-permissions` | actions d'administration, endpoints prives, cle admin, cloisonnement |
| `06-inscription-onboarding` | pre-inscription, route directe fermee, visite guidee |
| `90-connexion` | lien magique de bout en bout, jeton a usage unique |
| `91-deconnexion` | revocation cote navigateur ET cote serveur |

La visite guidee d'onboarding recouvre la navigation sur un compte neuf : le
socle la referme (`fermerVisite`). C'est voulu et refermable — un test le
verifie.

## Les rôles

`07-roles` ouvre trois sessions — propriétaire, administrateur, membre — par la
porte `POST /api/auth/dev-session`, et compare les réponses du **serveur** à la
même opération. Masquer un bouton n'est pas une protection.

Un code 4xx autre que 403 n'est pas un refus d'autorisation : c'est la garde
franchie, puis un refus en aval (donnée invalide, ressource absente, service
tiers non configuré). Les tests distinguent les deux, sinon ils confondraient
« interdit » et « cassé ». Et chaque test qui vérifie un refus vérifie aussi
qu'un rôle supérieur **passe** : sinon une garde qui bloque tout le monde
paraîtrait correcte.

Ce parcours exige les gardes de rôle BetterStack apportées par la PR #161 : sur
une branche qui ne les contient pas, le test du membre échoue en le disant.
