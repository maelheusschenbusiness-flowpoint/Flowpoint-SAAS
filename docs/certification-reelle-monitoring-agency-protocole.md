# Protocole de certification réelle — Global Monitoring, SLA Monitoring Avancé, Agency Reporting Packs

Document de préparation, rédigé le 17 novembre 2026. **Rien de ce qui suit n’a été exécuté** : aucun accès fournisseur réel, aucun e-mail réel, aucun appel Stripe ni Better Stack n’a eu lieu lors de la préparation. Ce protocole complète `docs/global-monitoring-qa-monitor-procedure.md` et `docs/CERTIFICATION-STRIPE-REEL.md`.

Règles communes, non négociables : environnement **Test-Replit** (jamais `Flowpoint`, jamais la production, jamais la PR #438), base de test dédiée, aucune clé Stripe LIVE, aucun prix, quota ni abonnement modifié, aucun achat, `coming_soon` conservé en LIVE. Les preuves sont expurgées (aucun secret, aucune adresse personnelle dans le dépôt).

## A. Lecture d’un moniteur Better Stack QA préexistant (modules #10 et #11)

**Objectif** : prouver que Global Monitoring et SLA Monitoring Avancé restituent exactement ce que Better Stack renvoie pour **un moniteur QA qui existe déjà**. Aucun moniteur n’est créé, modifié, mis en pause, repris ni supprimé.

### Variables et autorisations indispensables

| Élément | Détail |
|---|---|
| `BETTERSTACK_API_TOKEN` | Jeton de l’API Uptime Better Stack, **sur l’environnement de test uniquement**. Idéalement un jeton **lecture seule** d’une équipe QA isolée. Lu au chargement du module : redémarrer le serveur après l’avoir posé. |
| Sortie réseau | HTTPS vers `uptime.betterstack.com` autorisée depuis l’environnement de test. |
| Moniteur QA | Identifiant (`bs_id`), URL et régions d’un moniteur **déjà existant**, désigné par écrit comme lisible pour la certification. Si aucun n’existe, arrêter ici : ne pas en créer. |
| Organisation QA | Une organisation de test (UUID) avec les add-ons `globalMonitoring` et `slaMonitoring` actifs (`org_addons.active = true`) obtenus en environnement TEST (prix `STRIPE_TEST_PRICE_ID_ADDON_GLOBAL_MONITORING` / `STRIPE_TEST_PRICE_ID_ADDON_SLA_MONITORING` ou activation par l’opérateur QA sur la seule base de test). Le catalogue, les prix et `coming_soon` ne changent pas. |
| Appartenance | Une ligne dans `bs_monitor_ownership` reliant `bs_id` à l’organisation QA. **Aucun chemin applicatif ne revendique un moniteur préexistant** (`proposerAttributions` n’a aucun appelant) : l’opérateur DB de test vérifie que l’URL du moniteur correspond bien à l’organisation QA, puis exécute `INSERT INTO bs_monitor_ownership (bs_id, org_id, claimed_via) VALUES ('<bs_id>', '<org QA>', 'backfill_url') ON CONFLICT (bs_id) DO NOTHING;`. C’est une écriture dans **notre** base, pas chez Better Stack. |
| Comptes | Un `owner` ou `admin` QA, un `member`, un `viewer`, et un second utilisateur d’une **autre** organisation de test. |

### Parcours et résultats attendus

1. `GET /api/betterstack/config` → `configured: true`, `ownershipRegistry: true`.
2. `GET /api/betterstack/monitors` (organisation QA) → uniquement le moniteur QA ; aucun autre moniteur du compte partagé.
3. `GET /api/betterstack/global-overview` → les régions sont **exactement** celles que Better Stack déclare pour ce moniteur ; `measurementScope = better_stack_monitor_aggregate` et `regionalChecksPerformed = false` (un agrégat n’est pas une mesure par région).
4. `GET /api/betterstack/monitors/:id/sla?from=AAAA-MM-JJ&to=AAAA-MM-JJ` → `availability`, `total_downtime`, `number_of_incidents` identiques au tableau de bord Better Stack pour la même fenêtre. Définir une cible (`PUT …/sla-target`, admin, écriture dans notre base) puis vérifier `met` / `breached`, et l’export CSV.
5. `GET …/response-times?period=24h` et `GET /api/betterstack/incidents` → uniquement des données du moniteur QA.
6. Négatifs : autre organisation → 404 sur le même identifiant ; organisation sans add-on → 402 `ADDON_REQUIRED` ; `viewer`/`member` → écritures de cible refusées ; jeton retiré → 503 `configured: false` ; fenêtre sans mesure → `insufficient_data`, jamais 100 %.
7. Contrôle fournisseur : le journal d’audit Better Stack ne montre **que des lectures** (aucun POST/PATCH/DELETE, pause ou reprise). Ne jamais appeler `POST/PATCH/DELETE /api/betterstack/monitors*` pendant la certification.

**Revendiquable à l’issue** : lecture réelle d’un moniteur, cohérence des valeurs avec le fournisseur, isolation. **Non revendiquable** : mesures indépendantes par région, création/gestion de moniteurs, disponibilité commerciale.

## B. Envoi e-mail réel d’un rapport Agency vers une seule boîte de test (module #16)

### Variables et autorisations indispensables

| Élément | Détail |
|---|---|
| Fournisseur d’envoi | `RESEND_API_KEY` **ou** SMTP : `SMTP_HOST` + `SMTP_PASS` (+ `SMTP_USER`, `SMTP_PORT`, `SMTP_SECURE`). Clé limitée à l’envoi, compte Resend/SMTP de test. |
| Expéditeur | `RESEND_FROM` (ou `SMTP_FROM`) sur un **domaine vérifié** (SPF/DKIM) ; accès au tableau de bord du fournisseur pour lire l’identifiant d’envoi. |
| Planificateur | `AGENCY_REPORT_SCHEDULER_ENABLED=true` et `PUBLIC_URL` (ou `PUBLIC_BASE_URL`) : base HTTPS valide et joignable depuis la boîte de réception. |
| Mailer réel | `TEST_MAIL_DIR` et `ENABLE_TEST_MAILER` **non définis**, `NODE_ENV` différent de `test` (sinon l’envoi est capturé ou refusé avec `TEST_MAILER_NOT_ENABLED`). |
| Boîte de test | **Une seule** adresse, contrôlée par l’équipe QA, consentante. Aucun client. |
| Données | Organisation QA avec l’add-on `agencyPacks` actif (cycle TEST déjà validé) et au moins deux audits `completed` lui appartenant. |

### Parcours et résultats attendus

1. Créer la planification (`POST /api/reports/agency-packs/schedules`, rôle ≥ member) avec 2 audits terminés, la boîte de test, un cron proche (ex. `*/5 * * * *`) puis la **suspendre** (`PATCH … {"enabled": false}`) dès la première livraison.
2. Attendre la prise en compte (rafraîchissement du planificateur toutes les 60 s) puis le déclenchement.
3. Attendu : une ligne `agency_report_schedule_runs.status = 'delivered'`, `agency_report_schedules.last_status = 'delivered'`, un rapport `REPORT` multi-sites, un portail, un e-mail reçu dans la boîte de test avec un lien `…/api/agency-portal/<jeton>` qui s’ouvre, l’identifiant d’envoi visible chez le fournisseur.
4. Révoquer le portail ensuite (`DELETE …/portals/:id`).
5. Négatifs : fournisseur absent → `last_status = 'failed'` avec l’erreur (jamais « livré ») ; add-on désactivé après création de la planification → échec consigné `AGENCY_ADDON_INACTIVE`, aucun rapport ni e-mail (contrôle ajouté dans ce lot) ; quota de rapports atteint → échec consigné, aucune insertion partielle.

**Non revendiquable** : délivrabilité à grande échelle, envoi à des clients, achat LIVE.

## C. Webhook Stripe TEST public (module #16)

### Variables et autorisations indispensables

| Élément | Détail |
|---|---|
| Clé | Clé Stripe **TEST** (`STRIPE_TEST_SECRET_KEY` ou `STRIPE_SECRET_KEY` en `sk_test_`), `STRIPE_TEST_MODE=true`. Aucune clé LIVE. |
| Secret de signature | `STRIPE_TEST_WEBHOOK_SECRET` (`whsec_…` du point de terminaison **TEST**). |
| Prix | `STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PACKS` : prix TEST **existant**, non modifié ni créé. |
| URL publique | Déploiement de test joignable en HTTPS (pas la production) exposant `POST /api/webhooks/stripe` (chemin hérité : `/api/billing/webhook`) ; `PUBLIC_URL` aligné. |
| Autorisation Stripe | Accès au tableau de bord Stripe **en mode test** pour déclarer un point de terminaison de test (une ressource de configuration TEST, à supprimer ensuite avec accord) — ou, à défaut, Stripe CLI `stripe listen` (preuve de signature seulement, pas de livraison publique). |
| Organisation | Organisation QA liée à un client Stripe TEST créé par la campagne. |

### Parcours et résultats attendus

1. Déclarer le point de terminaison de test sur l’URL publique avec les événements traités : `checkout.session.completed`, `customer.subscription.created|updated|deleted`, `invoice.payment_succeeded|payment_failed`, `setup_intent.succeeded`, `payment_intent.succeeded`.
2. Rejouer un cycle d’achat **TEST** de `agencyPacks` : réponse 200 côté Stripe, ligne `billing_events`, add-on actif pour l’organisation QA uniquement.
3. Renvoyer le même événement : traitement idempotent (pas de double activation). Signature invalide : 400.
4. Annuler les abonnements de l’exécution ; Stripe conserve les événements et PaymentIntents réussis (non supprimables).

**Non revendiquable** : achat LIVE, ouverture commerciale (reste `coming_soon`).

## Ce qui est déjà couvert en local (sans fournisseur)

Voir `docs/beta2-addon-matrix.md` (lignes 10, 11, 16) : tests unitaires/service/PostgreSQL sur données synthétiques, fail-closed sans Better Stack, e-mail capturé dans `TEST_MAIL_DIR`, webhook Stripe TEST signé rejoué localement. Ces preuves ne remplacent aucune des trois certifications ci-dessus.
