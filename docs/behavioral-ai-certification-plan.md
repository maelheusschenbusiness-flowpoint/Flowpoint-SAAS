# Behavioral AI — plan de certification connectée (site de test contrôlé)

Objectif : prouver le flux réel snippet → ingestion → insights sur un site **que nous contrôlons**, avec des visiteurs **synthétiques**. Niveau visé : C (certification technique TEST) puis D (réelle) ; ce plan ne revendique ni l'un ni l'autre tant qu'il n'est pas exécuté et daté.

## Règles
- Site de test : une page statique dont nous sommes propriétaires, servie sur un domaine/une URL dédiée aux tests (jamais flowpoint.pro, jamais le site d'un client).
- Visiteurs : uniquement nos navigateurs de test pilotés (Playwright). Aucun trafic réel, aucune donnée personnelle saisie.
- Organisation et abonnement : organisation de test, add-on activé via Stripe TEST. Aucun paiement réel, aucun LIVE.
- Base : environnement jetable ; purge des événements de test en fin d'exécution.

## Étapes et preuves attendues
1. **Provisionnement** — `GET /api/behavioral/snippet?siteUrl=<site de test>` avec l'add-on. Preuve : snippet reçu, jeton enregistré (haché), origine ajoutée à la liste CORS.
2. **Consentement (nouveau)** — page de test avec un bandeau simulé. Avant clic « Accepter » : **aucune requête** vers `/api/behavioral/*` (capture réseau). Avec Global Privacy Control : aucune requête, même après accord. Après accord (`fp:behavioral-consent`) : démarrage une seule fois.
3. **Ingestion** — parcours scripté (vues, clics, scroll, formulaire, sortie) puis `GET /api/behavioral/status?siteUrl=...` : `status: active`, `totalEvents` cohérent avec les actions jouées (nombre exact attendu, rejeu refusé par le nonce).
4. **Attestation** — requêtes forgées refusées : sans `Origin` (403), mauvaise origine (403), jeton expiré (403), horodatage hors fenêtre (403), nonce rejoué (403).
5. **Isolation** — une seconde organisation de test : ne peut pas enregistrer la même URL (403), ne lit ni `status` ni `insights` du site de la première (404).
6. **Analyse** — `GET /api/behavioral/insights` (7/30/90 j), `POST /api/behavioral/funnels/analyze`, `POST /api/behavioral/generate-insights` : quota IA appliqué ; avec trop peu de données, état « données insuffisantes » et aucun chiffre inventé.
7. **Nettoyage** — suppression des événements de test, preuve de purge.

## Critères de réussite
Toutes les preuves 1 à 7 archivées (captures réseau, sorties API, journal CI), aucune requête avant consentement, aucun événement d'une autre organisation, aucune métrique sans donnée.

## Ce que ce plan ne couvre pas
Mesures sur un site de production d'un client, conformité juridique du texte de consentement du client (sa responsabilité), certification du fournisseur IA.
