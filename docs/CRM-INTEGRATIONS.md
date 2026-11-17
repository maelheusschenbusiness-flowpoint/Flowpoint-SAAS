# CRM Integrations — HubSpot (architecture extensible)

**Statut : implémenté et vérifié en local contre une fausse API HubSpot. NON certifié** : aucune connexion à un vrai compte HubSpot n'a été exécutée (aucune application OAuth ni clé disponible dans l'environnement de développement). **Non disponible à l'achat** : l'add-on `crmIntegration` reste dans la liste « indisponible à l'achat » de `lib/plans.ts` jusqu'à la certification fournisseur ; la carte de l'add-on affiche « Bientôt disponible ».

Quatre niveaux à ne jamais confondre :

| Niveau | État |
|---|---|
| Implémentation | HubSpot seul : OAuth2, jetons chiffrés, synchronisation manuelle des contacts (lecture seule), webhooks v3 signés. Les 7 autres CRM répondent 501 explicite. |
| Tests simulés | 67 tests CRM contre une **fausse** API HubSpot HTTP locale et PostgreSQL réel, plus le rendu de l'interface exécuté en bac à sable. Preuve de la logique, pas du fournisseur. |
| Certification fournisseur | **Aucune** (0/1). Protocole : `docs/CERTIFICATION-HUBSPOT-PROTOCOLE.md`. |
| Disponibilité commerciale | **Non** (add-on non achetable). |

## Architecture

```
routes/crm.ts                 routes authentifiées (add-on crmIntegration) + routeur public (callback OAuth, webhook)
services/crm/adapter.ts       contrat CrmProviderAdapter (OAuth, refresh, contacts, webhook)
services/crm/hubspot.ts       adaptateur HubSpot
services/crm/registry.ts      fournisseurs réellement implémentés
services/crm/crm-core.ts      état OAuth, quotas, jetons, synchronisation, test de connexion, webhooks (indépendant du fournisseur)
services/crm/token-crypto.ts  AES-256-GCM
services/crm-service.ts       statut public, journaux, mappings, plafond par plan
```

**Ajouter un CRM** : écrire un adaptateur (`CrmProviderAdapter`), l'enregistrer dans `registry.ts`. Le cœur (état OAuth, chiffrement, quotas, idempotence, journaux, webhooks) ne change pas. Tant qu'un fournisseur n'a pas d'adaptateur, ses routes répondent **501** (`CRM_OAUTH_UNAVAILABLE`, `CRM_SYNC_UNAVAILABLE`, `CRM_TEST_UNAVAILABLE`) et `GET /crm/providers` le marque `implemented:false`.

## États exposés (API → interface FR/EN/ES)

Chaque état a un code distinct ; l'interface ne présente jamais « connecté » sans preuve.

| État | Source API | Interface |
|---|---|---|
| Fournisseur non implémenté | `providers[].implemented:false` ; 501 sur connect/sync/test | « Bientôt disponible », bouton inactif |
| Non configuré sur ce serveur | `providers[].configured:false` ; 503 `CRM_PROVIDER_NOT_CONFIGURED` | « Non configuré sur ce serveur », bouton inactif |
| Non connecté | pas de ligne, ou `disconnected` ; 409 `CRM_NOT_CONNECTED` | « Non connecté » + Connecter (owner/admin) |
| Connecté | `status:'connected'` d'un fournisseur implémenté | « Connecté · N contacts » |
| Reconnexion requise | `status:'reauth_required'` ; 409 `CRM_REAUTH_REQUIRED` (sync **et** test, y compris aux appels suivants) | « Reconnexion requise » + Reconnecter |
| Ligne héritée d'un fournisseur sans adaptateur | `status:'unavailable'`, `implemented:false` | « Ancienne connexion non vérifiable » + Déconnecter |
| CRM injoignable | 503 `CRM_PROVIDER_UNREACHABLE` / 502 `CRM_*` | message « momentanément indisponible » |
| API CRM en panne | 503 `CRM_STATUS_UNAVAILABLE` / `CRM_LOGS_UNAVAILABLE` / `CRM_LEADS_UNAVAILABLE` | bannière « indisponible » + Réessayer (jamais « aucun CRM ») |
| Add-on absent | 402 `ADDON_REQUIRED` | bannière dédiée, aucune action |
| Rôle lecture seule | writeRoleGuard (403) | actions masquées |

## Sécurité

| Sujet | Mesure |
|---|---|
| `state` OAuth | 256 bits aléatoires, stocké **haché** (`crm_oauth_states`), usage unique (DELETE…RETURNING), expire en 10 min, lié à l'organisation **et** au fournisseur ; consommé même si l'utilisateur refuse |
| Callback public | n'accepte que `code`+`state` ; l'organisation vient **uniquement** du `state`, jamais d'un paramètre ; **protection CSRF** : le `state` doit aussi égaler le cookie `fp_crm_oauth` (HttpOnly, SameSite=Lax, 10 min) posé au démarrage dans le même navigateur — un lien fabriqué par un tiers est refusé sans consommer l'état. Le retour navigateur redirige vers `FRONTEND_URL/dashboard` (**défaut : `app.flowpoint.pro`, la production** : à poser en bêta). |
| Jetons | chiffrés AES-256-GCM avant écriture (`v1:iv:tag:corps`) ; clé `CRM_TOKEN_ENCRYPTION_KEY` (32 octets hex), **échec fermé** si absente ; jamais renvoyés par l'API ni journalisés |
| Refresh | jeton rafraîchi s'il expire sous 1 min ; refus 400/401/403 du fournisseur (ou jeton rejeté en cours de synchronisation **ou de test de connexion**) → jetons effacés, statut `reauth_required` (409), reconnexion exigée ; 429/5xx/panne réseau = panne transitoire, jetons conservés |
| Isolation | toutes les requêtes filtrent `org_id` ; RLS sur les tables CRM (la base de production se connecte avec un rôle qui contourne la RLS : seul le filtre `org_id` écrit à la main isole les organisations, comme pour le reste de l'application) ; webhook rattaché à l'organisation via `portal_id` — portail inconnu ou partagé par plusieurs organisations ⇒ ignoré ; mappings : intégration d'une autre organisation ⇒ 404 sans écriture |
| Webhook | signature HubSpot v3 (HMAC-SHA256 de `METHOD+URL+corps+horodatage`), comparaison en temps constant, tolérance 5 min, corps brut ; échec ⇒ 401 ; déduplication par `eventId` (`crm_webhook_events`) ; contact injoignable ⇒ 503 (journalisé) et événement non marqué, donc re-livré par HubSpot |
| Quotas | `getCrmLimit(plan)` (Standard 1 / Pro 3 / Ultra 10, source unique `CORE_QUOTAS`) vérifié au démarrage **et** au callback, dans une transaction verrouillée par organisation ; reconnecter le même CRM ne consomme pas de place. L'interface affiche la limite renvoyée par l'API. |
| Rôles | connexion et déconnexion réservées aux **owner/admin** (`canAdmin`) ; synchronisation, test et mappings ouverts aux membres ; **lecteur : écritures refusées** (`writeRoleGuard` global, `/crm/*`) mais lecture du statut, des journaux et des contacts autorisée |
| Déconnexion | jeton révoqué chez HubSpot (au mieux), jetons effacés localement dans tous les cas, webhooks ensuite ignorés. **Les contacts déjà importés restent en base** (non exposés par `/crm/leads` tant que le CRM n'est pas reconnecté). |
| URL fournisseur | surchargeables (`HUBSPOT_AUTH_BASE`, `HUBSPOT_API_BASE`) **hors production uniquement** : en production, domaines officiels figés |

## Synchronisation

Contacts uniquement (HubSpot `crm/v3/objects/contacts`), pages de 100, **20 pages maximum par exécution** (2 000 contacts ; `truncated:true` sinon, et chaque relance repart du début : les contacts au-delà ne sont pas importés). Idempotente : clé unique `(org_id, provider, external_id)`, rejouer ne crée aucun doublon. Verrou : index unique partiel (une seule synchronisation `running` par intégration, sans course) ⇒ 409 ; un verrou orphelin de plus de 15 min est libéré automatiquement. Chaque exécution écrit une ligne `crm_sync_logs` (créés / mis à jour / échecs / durée / code d'erreur). **Aucun planificateur** : la synchronisation n'est déclenchée que par `POST /crm/sync` ou un webhook signé. Pas de synchronisation bidirectionnelle, pas de leads/deals/entreprises. Les mappings de champs (`/crm/field-mappings`) sont enregistrés (validation stricte, remplacement réel, isolation par organisation) mais **la synchronisation ne les applique pas** : les réponses portent `applied:false` et l'interface l'indique.

## Variables d'environnement (à poser par l'exploitant — rien n'est posé automatiquement)

| Variable | Rôle |
|---|---|
| `CRM_TOKEN_ENCRYPTION_KEY` | clé AES-256 (64 caractères hex), obligatoire pour connecter |
| `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | application OAuth HubSpot (le secret signe aussi les webhooks) |
| `FRONTEND_URL` | hôte vers lequel le callback redirige le navigateur (défaut = production : **obligatoire en bêta**) |
| `CRM_OAUTH_REDIRECT_BASE` (optionnel) | base publique ; sinon `RENDER_EXTERNAL_URL` / `PUBLIC_URL` / `FRONTEND_URL` |
| `CRM_WEBHOOK_PUBLIC_URL` (optionnel) | base publique exacte signée par HubSpot, si différente |

URL de redirection à déclarer chez HubSpot : `<base>/api/crm/oauth/hubspot/callback`. URL de webhook : `<base>/api/crm/webhook/hubspot`. Portée demandée : `oauth crm.objects.contacts.read` (lecture seule).

## Ce qui est vérifié (automatiquement, fausse API — aucun appel réseau réel)

- `services/crm/crm-hubspot.test.ts` (33 tests, PostgreSQL réel + fausse API HubSpot HTTP locale) : chiffrement et échec fermé ; signature (valide, secret erroné, corps altéré, horodatage périmé, en-têtes absents) ; `state` (haché, usage unique, expiré, mauvais fournisseur, refus utilisateur) ; jetons chiffrés non exposés ; 250 contacts sur 3 pages puis rejeu sans doublon ; isolation entre deux organisations ; verrou ; refresh puis révocation ; webhooks (signature, déduplication, portail inconnu, après déconnexion, journalisation de l'échec) ; quota ; test de connexion (OK, 409, révocation ⇒ `reauth_required`, CRM injoignable ⇒ 503) ; `reauth_required` conservé aux appels suivants ; mappings (404 inter-organisations, entrées invalides 400, remplacement réel) ; `/crm/leads` (CRM connectés seulement, total réel) ; ligne héritée jamais « connectée ».
- `routes/crm-readiness.test.ts` (8) : fournisseurs sans adaptateur ⇒ 501, pannes base ⇒ 503 explicite, webhook non signé ⇒ 401. `services/crm-service.test.ts` (2). `tests/crm-hub-ui.test.ts` (17) : rendu réel de la section CRM Hub (états, rôles, quota, pannes, « bientôt », actions branchées, catalogues EN/ES complets). `tests/certify-preflight.test.ts` (7).

## Ce qui n'est PAS vérifié

Comportement réel de HubSpot (formats, limites de débit, expiration des jetons, livraison réelle des webhooks), parcours d'autorisation navigateur chez HubSpot, interface dans un vrai navigateur (le rendu est testé en bac à sable, pas capturé). **À faire pour certifier** : `docs/CERTIFICATION-HUBSPOT-PROTOCOLE.md`.

## Limites connues (non corrigées, décisions produit requises)

- **Add-on résilié** : les webhooks et les jetons d'une intégration déjà connectée ne revérifient pas l'add-on ; les routes authentifiées, elles, exigent l'add-on (402). À trancher : déconnexion automatique à la résiliation.
- **Conservation des contacts** après déconnexion (voir ci-dessus) : aucune purge automatique.
- **Pas de synchronisation planifiée**, mappings non appliqués, sync limitée à 2 000 contacts.
- Les modèles d'automatisation « CRM » du catalogue (Lead → HubSpot deal, Salesforce, etc.) sont des gabarits de workflow indépendants de ce module : ils ne prouvent aucune connexion CRM.

## Corrections de la revue du 17 novembre

| Défaut | Correction | Test |
|---|---|---|
| Bouton « Connecter » sans effet : les actions étaient définies dans un `<script>` inséré par `innerHTML` (jamais exécuté) | actions déplacées dans `window.FP_CRM_UI` | `crm-hub-ui.test.ts` |
| Les 8 fournisseurs affichaient « + Connecter » ; les 7 non implémentés renvoyaient 501 puis un message générique | « Bientôt disponible », bouton inactif ; « Non configuré » distinct | `crm-hub-ui.test.ts` |
| Réglages factices (« Sync automatique toutes les 60 min » actif, bidirectionnelle, conflits, webhook) et boutons leads/deals/companies (400) | remplacés par une liste de capacités en lecture seule, une seule action « contacts » | `crm-hub-ui.test.ts` |
| Panne API / add-on absent affichés comme « Non connecté » | états distincts avec bannière et Réessayer | `crm-hub-ui.test.ts` |
| `reauth_required` non affiché (carte « Non connecté ») | état « Reconnexion requise » + Reconnecter | `crm-hub-ui.test.ts` |
| Après une révocation, les appels suivants répondaient `CRM_NOT_CONNECTED` | `CRM_REAUTH_REQUIRED` conservé | `crm-hubspot.test.ts` |
| Test de connexion : jeton rejeté ⇒ 502 trompeur, statut resté « connecté » | `reauth_required` + 409 (`testCrmConnection`) | `crm-hubspot.test.ts` |
| Panne réseau vers HubSpot ⇒ 500 `CRM_INTERNAL_ERROR` | 503 `CRM_PROVIDER_UNREACHABLE` | `crm-hubspot.test.ts` |
| Mappings : écriture sur l'intégration d'une autre organisation répondait `ok:true` sans rien écrire ; « upsert » qui ignorait les mises à jour ; entrées libres | 404, validation, remplacement réel, `applied:false` | `crm-hubspot.test.ts` |
| `/crm/leads` : contacts d'un CRM déconnecté exposés, total plafonné à 100 | CRM connectés seulement, total réel, `truncated` | `crm-hubspot.test.ts` |
| Ligne héritée « connected » d'un fournisseur sans adaptateur affichée connectée | statut `unavailable`, exclue du compteur | `crm-service.test.ts`, `crm-hubspot.test.ts` |
| Disconnect / mappings : 500 sans code, fournisseur inconnu accepté | 503 codés, 400 `CRM_PROVIDER_INVALID` | `crm-hubspot.test.ts` |
| Journal d'échec de lecture d'un contact (webhook) jamais écrit (code mort après `continue`) | journalisé avant la re-livraison | `crm-hubspot.test.ts` |
| Carte de l'add-on : promettait deals, bidirectionnel temps réel, Salesforce/Pipedrive | « Bientôt disponible », liste honnête | `dashboard-i18n-static-audit.test.ts` |
| Commentaire périmé de `plans.ts` (« non implémenté ») | corrigé | — |
| Pré-contrôle de certification : `FRONTEND_URL` non vérifié (repli sur la production) | contrôle ajouté | `certify-preflight.test.ts` |

## Observation antérieure corrigée

`GET /crm/status` interrogeait une colonne inexistante (`created_at` au lieu de `connected_at`) : l'endpoint répondait toujours 503. Corrigé.
