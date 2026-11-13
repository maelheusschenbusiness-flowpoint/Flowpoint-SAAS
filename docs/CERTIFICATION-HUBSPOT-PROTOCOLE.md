# Protocole de certification HubSpot (CRM Integrations)

**État actuel : implémenté et testé localement contre une fausse API (35 tests), NON certifié.** Ce protocole décrit comment obtenir la certification réelle. Rien n'est exécuté tant que les accès ci-dessous n'existent pas. Jamais de compte HubSpot client : **compte développeur / sandbox de test uniquement**.

## A. Ce qui est déjà vérifié SANS identifiants (ne pas refaire)
`services/crm/crm-hubspot.test.ts` et `routes/crm-readiness.test.ts` (PostgreSQL réel + fausse API HTTP locale) : chiffrement AES-256-GCM et échec fermé ; `state` haché, usage unique, expiration, cookie anti-CSRF ; jetons jamais exposés ni journalisés ; refresh, révocation (400/401/403) vs panne (429/5xx) ; synchronisation paginée idempotente, verrou sans course ; isolation entre organisations ; quotas par plan, transaction verrouillée ; signature de webhook v3 (secret erroné, corps altéré, horodatage périmé), déduplication, re-livraison sur 503 ; déconnexion avec révocation ; rôles owner/admin.
Pré-contrôle des prérequis : `node scripts/certify-preflight.mjs hubspot`.

## B. Ce qui exige une application HubSpot de test (non vérifiable sans elle)
| Besoin | Détail |
|---|---|
| Compte développeur HubSpot + **application** de test | client id / secret ; portée **`oauth crm.objects.contacts.read`** (lecture seule) ; URL de redirection `https://<hôte de test>/api/crm/oauth/hubspot/callback` |
| Compte de test (sandbox) avec ≥ 150 contacts fictifs | pour franchir la pagination (page de 100) ; **aucun contact réel** |
| Abonnement webhook (contact.creation / propertyChange) | cible `https://<hôte de test>/api/crm/webhook/hubspot` |
| Environnement bêta HTTPS joignable par HubSpot | `flowpoint-test.onrender.com` ou équivalent ; base jetable ; jamais `app.flowpoint.pro` |
| Variables à poser **par l'exploitant** | `HUBSPOT_CLIENT_ID`, `HUBSPOT_CLIENT_SECRET`, `CRM_TOKEN_ENCRYPTION_KEY` (64 hex, générée pour ce test), `PUBLIC_URL`/`CRM_OAUTH_REDIRECT_BASE` ; **pas** de `HUBSPOT_*_BASE` (réservés à la fausse API) |
| Organisation de test | une organisation Pro (3 CRM) avec l'add-on `crmIntegration`, et une seconde organisation (isolation) |

## C. Scénario réel (à exécuter dans l'ordre, preuves archivées)
1. **OAuth2** — organisation A, `POST /api/crm/connect/hubspot` → ouvrir l'URL dans un navigateur connecté au compte de test → autoriser. *Attendu* : redirection vers `/dashboard?crm_connected=hubspot` ; ligne `crm_integrations` `status='connected'`, `portal_id` = identifiant du portail HubSpot, jetons au format `v1:…` (jamais en clair) ; cookie `fp_crm_oauth` effacé. *Négatifs* : rejouer l'URL de callback → 400 ; callback sans cookie → 400 ; refuser l'autorisation → `crm_error=consent_denied`.
2. **Test de connexion** — `POST /api/crm/test {provider:"hubspot"}` → `ok:true`.
3. **Synchronisation** — `POST /api/crm/sync` → `created` = nombre de contacts du sandbox, `truncated:false` ; relancer → `created:0`, `updated:N`, aucun doublon (`SELECT external_id, count(*) … HAVING count(*)>1` vide) ; `crm_sync_logs` : 2 lignes `success`. Comparer 5 contacts au hasard avec HubSpot (nom, e-mail, étape).
4. **Renouvellement des jetons** — forcer l'expiration (`UPDATE crm_integrations SET token_expires_at = now() - interval '1 hour'` sur la base **de test**) puis resynchroniser → nouveau jeton chiffré, `last_sync_status='success'`. Constater la durée de vie réelle (`expires_in`) donnée par HubSpot et la consigner.
5. **Webhooks signés** — créer un contact dans le sandbox → HubSpot livre l'événement → ligne `crm_webhook_events`, contact présent dans `crm_contacts`. Rejouer la même livraison (bouton de re-livraison HubSpot) → `duplicates:1`, aucun second traitement. Envoyer à la main un corps non signé → 401. Vérifier que l'URL signée correspond exactement (sinon `CRM_WEBHOOK_PUBLIC_URL`).
6. **Isolation** — organisation B : `GET /api/crm/leads`, `/status`, `/logs` ne montrent rien de A ; `POST /api/crm/sync` → 409 `CRM_NOT_CONNECTED`. Connecter le **même** portail à B : un webhook de ce portail doit être **ignoré** (portail partagé ⇒ ambigu) ; consigner le comportement.
7. **Quota** — organisation Standard (1 CRM) avec un autre CRM déjà connecté : `connect` → 403 `CRM_LIMIT_REACHED`.
8. **Révocation côté HubSpot** — retirer l'application depuis le compte HubSpot, puis `POST /api/crm/sync` → 409 `CRM_REAUTH_REQUIRED`, jetons effacés ; reconnecter → `connected`.
9. **Déconnexion** — `POST /api/crm/disconnect/hubspot` → jeton révoqué chez HubSpot (l'application disparaît des applications connectées), jetons `NULL`, statut `disconnected` ; un webhook ultérieur est ignoré.
10. **Hygiène** — aucune valeur de jeton/secret/code dans les journaux de l'application (`grep` sur les journaux du scénario) ; supprimer `crm_contacts` de l'organisation de test ; révoquer l'application de test.

## D. Critères de réussite
Les 10 étapes passent avec preuves (sorties API, SQL, captures HubSpot, extraits de journaux **sans secret**). Une seule étape manquante = non certifié. À consigner explicitement : durée de vie réelle des jetons, limites de débit rencontrées, format réel des webhooks (écarts éventuels avec `parseWebhook`).

## E. Hors périmètre
Autres CRM (501), synchronisation planifiée, écriture vers HubSpot, objets autres que les contacts, comptes clients réels.
