# CRM Integrations — HubSpot (architecture extensible)

**Statut : implémenté et vérifié en local contre une fausse API HubSpot. NON certifié** : aucune connexion à un vrai compte HubSpot n'a été exécutée (aucune application OAuth ni clé disponible dans l'environnement de développement).

## Architecture

```
routes/crm.ts                 routes authentifiées (add-on crmIntegration) + routeur public (callback OAuth, webhook)
services/crm/adapter.ts       contrat CrmProviderAdapter (OAuth, refresh, contacts, webhook)
services/crm/hubspot.ts       adaptateur HubSpot
services/crm/registry.ts      fournisseurs réellement implémentés
services/crm/crm-core.ts      état OAuth, quotas, jetons, synchronisation, webhooks (indépendant du fournisseur)
services/crm/token-crypto.ts  AES-256-GCM
```

**Ajouter un CRM** : écrire un adaptateur (`CrmProviderAdapter`), l'enregistrer dans `registry.ts`. Le cœur (état OAuth, chiffrement, quotas, idempotence, journaux, webhooks) ne change pas. Tant qu'un fournisseur n'a pas d'adaptateur, ses routes répondent **501** (`CRM_OAUTH_UNAVAILABLE`, `CRM_SYNC_UNAVAILABLE`, `CRM_TEST_UNAVAILABLE`) et `GET /crm/providers` le marque `implemented:false`.

## Sécurité

| Sujet | Mesure |
|---|---|
| `state` OAuth | 256 bits aléatoires, stocké **haché** (`crm_oauth_states`), usage unique (DELETE…RETURNING), expire en 10 min, lié à l'organisation **et** au fournisseur ; consommé même si l'utilisateur refuse |
| Callback public | n'accepte que `code`+`state` ; l'organisation vient **uniquement** du `state`, jamais d'un paramètre ; **protection CSRF** : le `state` doit aussi égaler le cookie `fp_crm_oauth` (HttpOnly, SameSite=Lax, 10 min) posé au démarrage dans le même navigateur — un lien fabriqué par un tiers est refusé sans consommer l'état |
| Jetons | chiffrés AES-256-GCM avant écriture (`v1:iv:tag:corps`) ; clé `CRM_TOKEN_ENCRYPTION_KEY` (32 octets hex), **échec fermé** si absente ; jamais renvoyés par l'API ni journalisés |
| Refresh | jeton rafraîchi s'il expire sous 1 min ; refus 400/401/403 du fournisseur (ou jeton rejeté en cours de synchronisation) → jetons effacés, statut `reauth_required` (409), reconnexion exigée ; 429/5xx = panne transitoire, jetons conservés |
| Isolation | toutes les requêtes filtrent `org_id` ; RLS sur les 3 nouvelles tables ; webhook rattaché à l'organisation via `portal_id` — portail inconnu ou partagé par plusieurs organisations ⇒ ignoré |
| Webhook | signature HubSpot v3 (HMAC-SHA256 de `METHOD+URL+corps+horodatage`), comparaison en temps constant, tolérance 5 min, corps brut ; échec ⇒ 401 ; déduplication par `eventId` (`crm_webhook_events`) ; contact injoignable ⇒ 503 et événement non marqué, donc re-livré par HubSpot |
| Quotas | `getCrmLimit(plan)` (1 / 3 / 10) vérifié au démarrage **et** au callback, dans une transaction verrouillée par organisation (pas de dépassement par callbacks simultanés) ; reconnecter le même CRM ne consomme pas de place |
| Rôles | connexion et déconnexion réservées aux **owner/admin** (`canAdmin`) ; synchronisation ouverte aux membres ; lecteur refusé (`writeRoleGuard` global) |
| Déconnexion | jeton révoqué chez HubSpot (au mieux), jetons effacés localement dans tous les cas, webhooks ensuite ignorés |
| URL fournisseur | surchargeables (`HUBSPOT_AUTH_BASE`, `HUBSPOT_API_BASE`) **hors production uniquement** : en production, domaines officiels figés |

## Synchronisation

Contacts uniquement (HubSpot `crm/v3/objects/contacts`), pages de 100, **20 pages maximum par exécution** (`truncated:true` sinon). Idempotente : clé unique `(org_id, provider, external_id)`, rejouer ne crée aucun doublon. Verrou : index unique partiel (une seule synchronisation `running` par intégration, sans course) ⇒ 409 ; un verrou orphelin de plus de 15 min est libéré automatiquement. Chaque exécution écrit une ligne `crm_sync_logs` (créés / mis à jour / échecs / durée / code d'erreur). Aucun planificateur : la synchronisation n'est déclenchée que par `POST /crm/sync` ou un webhook signé.

## Variables d'environnement (à poser par l'exploitant — rien n'est posé automatiquement)

| Variable | Rôle |
|---|---|
| `CRM_TOKEN_ENCRYPTION_KEY` | clé AES-256 (64 caractères hex), obligatoire pour connecter |
| `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET` | application OAuth HubSpot (le secret signe aussi les webhooks) |
| `CRM_OAUTH_REDIRECT_BASE` (optionnel) | base publique ; sinon `RENDER_EXTERNAL_URL` / `PUBLIC_URL` / `FRONTEND_URL` |
| `CRM_WEBHOOK_PUBLIC_URL` (optionnel) | base publique exacte signée par HubSpot, si différente |

URL de redirection à déclarer chez HubSpot : `<base>/api/crm/oauth/hubspot/callback`. URL de webhook : `<base>/api/crm/webhook/hubspot`. Portée demandée : `oauth crm.objects.contacts.read` (lecture seule).

## Ce qui est vérifié (automatiquement)

`services/crm/crm-hubspot.test.ts` (base PostgreSQL réelle + fausse API HubSpot HTTP locale) : chiffrement et échec fermé ; signature (valide, secret erroné, corps altéré, horodatage périmé, en-têtes absents) ; `state` (haché, usage unique, expiré, mauvais fournisseur, refus utilisateur) ; jetons chiffrés non exposés ; 250 contacts sur 3 pages puis rejeu sans doublon ; isolation entre deux organisations ; verrou ; refresh puis révocation ; webhooks (signature, déduplication, portail inconnu, après déconnexion) ; quota Standard ; test de connexion. `routes/crm-readiness.test.ts` : fournisseurs sans adaptateur ⇒ 501, webhook non signé ⇒ 401.

## Ce qui n'est PAS vérifié

Comportement réel de HubSpot (formats, limites de débit, expiration des jetons, livraison réelle des webhooks), parcours d'autorisation navigateur chez HubSpot, interface utilisateur de connexion. **À faire pour certifier** : créer une application HubSpot de test, poser les variables ci-dessus en bêta, connecter un compte developer HubSpot, synchroniser, déclencher un webhook réel, révoquer l'accès et vérifier `reauth_required`.

## Observation corrigée en passant

`GET /crm/status` interrogeait une colonne inexistante (`created_at` au lieu de `connected_at`) : l'endpoint répondait toujours 503. Corrigé.
