# AUDIT GLOBAL FLOWPOINT — 8 novembre 2026

Audit indépendant, **en lecture seule**. Aucune modification de code ou de configuration, aucun déploiement, aucune fusion, aucune écriture en production, aucune action Stripe, aucun email ni publication envoyés, aucune mission AI Lab lancée. La branche `Flowpoint` n'a pas été touchée. Aucun secret ni donnée personnelle n'est reproduit.

## Comment lire ce rapport

- **[D] Démontré** : lu dans le code, un log ou une métrique. **[H] Hypothèse** : plausible, à confirmer. **[C] Choix commercial.**
- **Vérifié par moi** : A-01, B-01 et C-01 ont été revérifiés personnellement dans le code. Tous les autres constats viennent des sept sous-agents (un par domaine) et reposent sur leur lecture. Un constat « démontré par le code » n'est pas un bug observé en production.
- **Code audité** : branche locale à `f864a86` (29 oct.) + API GitHub, Render, Supabase, Resend en lecture. `Test-Replit` a avancé depuis (PR #358 fusionnée le 8 nov.) : certains constats peuvent déjà être corrigés.
- **Aucun test d'exécution** n'a été lancé : ni suite de tests, ni parcours navigateur, ni requête en base de production.

---

## 1. Synthèse exécutive

FlowPoint est un produit **large et sérieusement construit côté serveur** (webhooks Stripe idempotents, verrous sur les quotas d'audits et de rapports, séparation test/production, CI vert sur 20 runs, AI Lab bien verrouillé contre le merge automatique). **Mais il n'est pas prêt à convertir des clients payants à grande échelle**, pour quatre raisons :

1. **Le tunnel est rompu dès l'étape 2** : cliquer sur « Démarrer Pro » ne fait rien d'autre que sélectionner le plan (A-01, vérifié). La navigation exige de repérer ensuite le bouton « Panier ». C'est une explication plausible du « beaucoup de visites, zéro essai », sans que son ampleur soit mesurable : l'étape `cta_clique` n'est jamais émise (A-02) et tout le suivi exige le consentement cookies.
2. **Le tunnel est quasi aveugle** : impossible de localiser les abandons, et le haut comme le bas de l'entonnoir (Smartlead, essais, clients) ne sont pas mesurables depuis le produit.
3. **Des fonctions vendues ne font pas ce qu'elles annoncent** : publication de posts Google, recommandations CRO, heatmaps Local, automatisations, partage de rapports, quota d'exports.
4. **La résilience de la donnée n'est pas démontrée** : la base de production est sur une organisation Supabase au plan gratuit, sans sauvegarde restaurable prouvée (E-01, hypothèse P0).

La plateforme tient aujourd'hui un trafic quasi nul (≈ 0,03 requête/s, aucun 5xx sur 7 jours). **Aucune capacité à l'échelle n'est démontrée** ; tout le reste est projection.

**Constat transversal important** : les logs de production sur 7 jours montrent très peu de trafic sur le tunnel (≈ 6 visites de `login.html`, ≈ 7 de `pricing.html`, 0 appel de pré-inscription ou de paiement). Soit le trafic est très faible, soit il arrive ailleurs (`flowpoint.pro`, hors dépôt). Le diagnostic précédent « beaucoup de visites sur login » n'est donc **pas confirmé** côté serveur.

---

## 2. État réel des systèmes

| Système | État | Niveau de preuve |
|---|---|---|
| SaaS (API + dashboard) | Fonctionne, trafic quasi nul, 0 erreur 5xx en 7 jours | Métriques/logs Render |
| Tunnel d'inscription | Rompu à l'étape 2 ; fragile sur Google ; mesure partielle | Code (A-01 vérifié) |
| Facturation / webhooks Stripe | Bien conçus ; trous sur les gates de statut et l'activation d'essai | Code |
| Quotas | Audits/rapports : verrou transactionnel. Exports : jamais appliqués. Autres : non prouvés | Code (B-01 vérifié) |
| Sécurité applicative | Bases saines ; plusieurs P1 d'autorisation et de réseau | Revue statique |
| Sauvegardes / restauration | **Non prouvées** | Hypothèse (E-01) |
| AI Lab V2 | Utilisable sur petits correctifs, avec relecture humaine | Dépôt `flowpoint-ai-lab` + 5 PR |
| Social Studio | Code robuste en apparence ; état réel invérifiable (VPS) | Lecture de code |
| Acquisition (Smartlead) | Non mesurable depuis le produit | Aucun accès |
| Site marketing `flowpoint.pro` | **Non audité** (domaine non joignable depuis la session) | — |

**Vérification des chiffres de départ**
- Tarifs 29/79/149 € et essai 14 jours avec carte : **cohérents** entre le site (`pricing.html`) et le code (`plans.ts`, `TRIAL_DAYS = 14`).
- « 5 PR AI Lab non fusionnées » : **confirmé** (#353 à #357, CI verte).
- « 5 missions sur 5 sans intervention humaine » et « 4,26 $ » : **non vérifiables** (aucun journal ni rapport du pilote commité ; le code mesure un coût « équivalent API », pas une dépense réelle sous abonnement Max).

---

## 3. Anomalies priorisées

### P0 — critique

| ID | Constat | Statut | Preuve | Correction | Effort / risque |
|---|---|---|---|---|---|
| **A-01** | Les boutons « Démarrer Pro/Standard/Ultra » ne naviguent pas : `selectPlan` stocke le plan et change le libellé ; seul « Panier » mène au checkout | **[D] vérifié** | `pricing.html:1522-1548`, boutons l.376/410/444, `goToCheckout` l.1623 | Appeler `goToCheckout()` depuis `selectPlan` ; émettre `cta_clique` | S / faible |
| **E-01** | Base de production dans une organisation Supabase au plan `free` : sauvegardes restaurables et PITR non prouvés | **[H]** à confirmer dans le tableau de bord | `get_organization` : `plan: free` | Passer en Pro, vérifier les sauvegardes, `pg_dump` externe planifié, restauration testée sur le projet « Flowpoint test » | 0,5 j / faible |

### P1 — important

| ID | Constat | Statut | Preuve | Correction | Effort |
|---|---|---|---|---|---|
| A-06 | Doublons d'organisation possibles (course `finalize-checkout` / webhook), aucun index unique sur `organizations(owner_email)` | Mécanisme [D], occurrence [H] | `public-billing.ts` (~2642-2655), `stripe-webhook.ts` (~576-600) | Vérifier d'abord par requête de comptage de doublons ; verrou advisory + réutilisation de l'org + index unique partiel | M / moyen |
| A-09 | Un onglet fermé après la confirmation SetupIntent peut laisser une org « trialing » sans souscription Stripe, donc sans prélèvement à J+14 | [D] code, ampleur [H] | `stripe-webhook.ts` (~1830-1850), `public-billing.ts` (~2500) | Créer la souscription côté webhook ou cron de réconciliation | M-L / moyen |
| A-02 | `cta_clique` n'est jamais émis (pricing utilise des `<button onclick>`) | [D] | `funnel-tracking.js:168-177` | Émettre l'événement dans le code de sélection | S / nul |
| A-03 | 8 champs obligatoires avant toute valeur, puis carte | [D] code, effet [H] | `signin.html` (~650-665), `auth.ts:1022-1028` | Ne demander qu'email/prénom/entreprise | M / moyen |
| A-04 | Plan choisi 2 fois, 5 écrans avant la carte ; plan non transmis à Google | [D] | `signin.html:561`, callback Google | Propager `fp_cart`, sauter le 2e choix | S / faible |
| A-05 | Pas de session après paiement ; email vérifié seulement après paiement (faute de frappe = client payé sans accès) | [D] | `public-billing.ts:2930-3000` | Poser la session à la fin de `finalize` ou vérifier l'email avant | M / sécurité moyen |
| A-07 | Un membre invité qui se connecte via Google peut être traité comme nouveau compte | [H] | `auth.ts` (~2073) | Même garde que la pré-inscription par formulaire | S |
| A-10 | Google : adresse factice (`FR`, `—`, `00000`) écrite comme vraie | [D] | `auth.ts` (~2131) | Stocker NULL | S |
| A-12 | Tout le suivi dépend du cookie de consentement ; `checkout_completed` dépend du navigateur pour l'essai | [D] | `funnel-tracking.js:40-45`, `stripe-webhook.ts:1648` | Dénominateur serveur sans identifiant ; émettre aussi sur `setup_intent.succeeded` | S |
| B-01 | **Quota d'exports jamais appliqué** : la requête filtre sur `event_type`, la table a `kind` ; l'erreur est avalée (fail-open) | **[D] vérifié** (colonne en prod à confirmer) | `billing-service.ts:361` vs `usage-events.ts:30` | Remplacer par `kind` ; échouer fermé ; test sur base réelle | XS / faible |
| B-02 | Les exports sont déclarés par le navigateur : quota non contraignant par nature | [D] / [C] | `billing.ts:2349-2362` | Exports côté serveur, ou assumer un quota indicatif | M |
| B-03 | Aucune gate serveur ne lit `subscription_status` (`past_due`, `unpaid`, `pending_billing`…) | [D] ; absence de middleware global à confirmer | `planGate.ts:33-92` | Appliquer `statusGrantsAccess` avec durée de grâce | M / moyen |
| B-04 | Après annulation, le client garde les quotas Standard | [D] / [C] | `stripe-webhook.ts:2133`, `planGate.ts:36,83` | Politique explicite « annulé = lecture seule » | M |
| B-07 | `requireQuota` utilisé une seule fois ; quotas mots-clés, heatmaps, missions, GBP, CRM non prouvés appliqués | [H] | `competitors.ts:264`, `planGate.ts:129-152` | Cartographier route par route | M |
| B-11 | **22 fichiers de test sur 134 ne tournent jamais** (liste blanche manuelle), dont `stripe.test.ts`, `auth.test.ts`, `api-security.test.ts` | [D] | `vitest.config.ts` | Glob + exclusions documentées | S |
| C-01 | CORS avec cookies ouvert à tout `*.replit.dev/app` + cookie `SameSite=None` en prod + aucun CSRF | [D] code ; exploitation [H] | `app.ts:84-85,129`, `auth.ts:1907` | Liste blanche exacte, `SameSite=Lax`, contrôle Origin/CSRF | S-M |
| C-02 / C-03 | SSRF : webhooks d'intégration et analyse de concurrents appellent des URLs utilisateur sans garde d'adresse interne | [D] | `integrations-service.ts:192,324`, `competitor-analysis-service.ts:106-115` | Réutiliser `url-fetcher.ts` | S |
| C-04 | Majorité des routes d'écriture sans contrôle de rôle (un viewer pourrait écrire) | [D] comptage ; effet à tester | `ai.ts`, `integrations.ts`, `google.ts`, `white-label.ts`… | Garde par défaut sur les méthodes non-GET | M |
| C-05 | IDOR inter-organisations sur les posts GBP (`WHERE id=$1`) + identifiants prévisibles | [D] | `gbp-posting-service.ts:122-139` | `AND org_id=$n`, `randomUUID` | S |
| C-06 | Limiteurs de débit contournables via `X-Forwarded-For` | [D] ; atténuation proxy à vérifier | `rateLimiter.ts:231,371` | Utiliser `req.ip` | S |
| C-07 | OAuth Google/GitHub/Apple sans `state` vérifié, `email_verified` ignoré | [D] ; exploitation Apple [H] | `auth.ts:1990, 2050-2078, 2247-2257` | State signé en cookie, nonce, `email_verified` | M |
| C-08 | RLS peut basculer en mode dégradé sans alerte ; ~537 requêtes contournent la RLS | [H] | `lib/db/src/index.ts:595-612` | Alerte, tests d'isolation en CI | M |
| D-01 | « Publier » un post GBP ne publie rien chez Google (statut mis à jour en base) ; pas de worker de planification | [D] | `gbp-posting-service.ts:122-131` | Appeler `publishGBPPost` ; worker | 1-2 j / moyen |
| D-02 | Recommandations CRO sans analyse de la page ; statistiques fixes et confiance 0,85 codées en dur | [D] | `cro-service.ts:60-170` | Analyse réelle ou étiqueter « générique » | 2-4 j |
| D-03 | Heatmaps Local jamais calculées (statut `pending` éternel) | [D] | `local-maps-service.ts:193-210` | Worker DataForSEO | 3-5 j / coût |
| D-05 | Rapport « fantôme » (201 sans ligne en base) et faux lien de partage (jeton `Math.random()`, 404 ensuite) | [D] | `reports.ts:84-135`, `dashboard.js:1433-1445` | Erreur 5xx, retirer le repli | 0,5 j |
| D-07 | 198 templates d'automatisation, 9 événements supportés, aucun déclencheur automatique | [D] code ; effet à tester | `integrations-service.ts:5-9`, `automation.ts:122` | N'afficher que les templates livrables | 2-10 j |
| D-08 | Boutons appelant des routes inexistantes (révocation de session, `/api/local-seo`) | [D] | `dashboard.js:12041, 53327` | Implémenter ou retirer | 0,5-1 j |
| D-09 | 11 langues proposées (pas d'ukrainien annoncé ; SV et CS non annoncés) ; ≈ 79 % de couverture | [D], chiffre approximatif | `dashboard.js:11637` | Ajouter UA ou corriger l'annonce ; test de couverture | 2-3 j |
| E-02 | Surveillance des monitors séquentielle, sans verrou ni réentrance | [D] code, impact non mesuré | `monitor-cron.ts:373`, `monitors.ts:907-950` | Claim atomique, concurrence bornée, worker dédié | 2-3 j |
| E-03 / E-04 | Limiteur, cache, SSE en mémoire ; API et crons dans un seul process ; 512 Mo, 1 instance | [D] | `rateLimiter.ts`, `cache.ts`, `store.ts:51` | Redis/Key Value, LRU, plan supérieur | 3-5 j |
| E-05 | Build non reproductible (`--no-frozen-lockfile`) ; DDL exécuté à chaque démarrage | [D] | commande de build, `index.ts:~160-330` | Lockfile figé, migrations en Pre-Deploy | 1-2 j |
| E-06 | Sonde de santé sans test de la base ; monitoring externe non vérifié | [D] | `routes/health.ts` | `/readyz` avec `SELECT 1` + alertes | 1 j |
| F-01 / F-02 | PR AI Lab en doublon et en conflit (#341/#355 ; allowlist `vitest.config.ts`) ; ≈ 45 PR `ai/*` ouvertes | [D] | PR #341, #353-#357 | Rebaser, trancher, fermer en lot | faible |
| F-03 | Authentification Claude Max : expiration sans renouvellement ni alerte (déjà survenue le 8 oct.) | [D] code | `claude-auth.ts` | Alerte externe, échéance calendrier | S |
| F-04 / F-05 | Quota Claude partagé avec Social Studio (déjà épuisé du 31/10 au 02/11) ; budgets « expérimentaux » | [D] | `quota-claude.ts`, `budget-mission.ts` | Une mission à la fois, hors fenêtre Social, recalibrer | S / M |
| G-01 / G-02 | Mesure aveugle hors consentement ; cookie de consentement posé par un code hors dépôt | Mécanisme [D], ampleur [H] | `funnel-tracking.js` | Vérifier en production ; alerte si `landing_vue` = 0 | S |
| G-03 | Aucun lien Smartlead ↔ produit hors `fp_lid` | [D] | `fp-lid.ts` | Export périodique des agrégats Smartlead | M |
| G-06 / G-07 | Séparation domaine d'outreach / transactionnel et conformité RGPD de l'outreach non prouvées | [H] | — | Vérifier domaines secondaires, DMARC, désinscription | S-M |
| G-08 | « ∞ crédits IA » affiché pour Ultra alors que le plafond est 10 000 000 ; SLA/support non prouvés ; essai « une fois par organisation » non précisé | [D] / [C] | `pricing.html:1068`, `plans.ts:101` | Aligner les libellés | S |

### P2 — amélioration (résumé)

- **Quotas** : audits/rapports comptés sur lignes vivantes (B-05) ; source de vérité dupliquée et plan `agency` absent de `PLAN_DEFINITIONS` (B-09) ; `charge.refunded` sans effet sur les droits (B-10).
- **CI** : ni lint, ni scan de secrets, ni audit de dépendances, ni test de concurrence (B-12).
- **Sécurité** : comparaison non constante de `ADMIN_KEY` (C-09) ; session admin sans plafond (C-10) ; options SSO enregistrées mais non appliquées (C-11) ; clés API et jetons de session en clair en base (C-12) ; jeton en query string (C-13) ; emails en clair dans les logs (C-14) ; mode développement sans authentification si une variable manque (C-15) ; CSP avec `unsafe-inline`/`unsafe-eval` (C-18) ; fichiers parasites et vidéos versionnées (C-17).
- **Infra** : latence Oregon ↔ Francfort [H] (E-07) ; pool Postgres sans `statement_timeout` (E-08) ; Atlas probablement inutilisé (E-09) ; routes publiques de téléchargement de vidéos « temporaires » (E-10) ; services Render suspendus (E-12).
- **Produit** : onboarding IA avec impacts inventés en repli (D-06) ; deux copies de `dashboard.js` divergentes (D-10) ; registres de cron factices (D-11) ; `FAKE_DATA_AUDIT.md` périmé (D-12).
- **AI Lab** : « 63 échecs préexistants » (F-06) ; relecture humaine requise sur #354/#355/#356 (F-07) ; reprise après arrêt brutal non éprouvée (F-09) ; pas de rapport de campagne (F-12).
- **Tunnel** : Google, jeton de paiement et email dans l'URL (A-11) ; pré-inscription supprimant des clients Stripe sans vérifier l'état de l'intent [H] (A-13) ; documentation du parcours périmée.

---

## 4. Tunnel de conversion — détail

| # | Étape | État réel | Mesurable |
|---|---|---|---|
| 1 | Visite `pricing.html` | OK (un 401 attendu sur `/api/billing/subscription`) | `tarifs_vus`, avec consentement |
| 2 | Clic « Démarrer Pro » | **CASSÉ** : sélection seulement (A-01) | `cta_clique` jamais émis (A-02) |
| 3 | « Panier » → `/api/me` → signin | 401 anonyme attendu, puis redirection | Non |
| 4 | signin : formulaire à 8 champs ou Google | Friction forte (A-03) | Avec consentement |
| 5 | Callback Google → `pending_signups` | Fragile (A-07, A-08, A-10, A-11) | Aucun côté Google |
| 6 | Re-choix du plan | Redondant (A-04) | Non |
| 7 | `checkout.html` → paiement (SetupIntent) | OK | `checkout_started`, avec consentement |
| 8 | Confirmation Stripe → `finalize-checkout` | Pas de session (A-05) ; course avec le webhook (A-06, A-09) | Dépend du navigateur (A-12) |
| 9 | Magic link (24 h) → dashboard | Sortie vers la boîte mail ; aucun événement « lien cliqué » | Non |
| 10 | Essai 14 j → `active` / `past_due` / `canceled` | Webhooks signés et idempotents ; B-03/B-04 sur les gates | Avec consentement |

**Diagnostics précédents**

| Diagnostic | Verdict |
|---|---|
| Beaucoup de visites login, 0 essai | **Non confirmé** côté serveur (très peu de trafic dans les logs). Le bouton cassé (A-01) est une cause plausible mais non chiffrable |
| Google → page tarifs non authentifiée + 401 | **Partiel** : les 401 existent par construction et sont bénins ; un vrai blocage existe si le jeton de pré-inscription est perdu (A-11). Redirection vers tarifs non démontrée |
| Attribution incomplète | **Confirmé en partie** (A-02, A-12). PR #306 (clic `/go`) non déployée |
| Événements dépendants du consentement | **Confirmé** |
| Clics Smartlead gonflés par des scanners | **Non vérifiable** ici (le chiffre vient de la description de la PR #306) |

**États d'abonnement** : la machine à états est documentée, mais les gates serveur ne les lisent pas (B-03). **Webhooks** : 0 erreur de signature, réponses 200 en 1,8 à 2,4 s sur 7 jours. **401/403/5xx** : aucun 5xx, aucun 403 sur les routes du tunnel ; seuls des scanners et des anonymes en 401.

**Abandons mesurables** : seulement chez les visiteurs ayant accepté les cookies. **Impossibles à mesurer** : refus de consentement, clic sur « Démarrer Pro » (A-02), clic sur le magic link, onglet fermé après confirmation (A-12).

**Test à réaliser sur un environnement isolé** (non exécuté) : parcours complet avec compte Google neuf ; parcours avec membre invité (A-07) ; confirmation SetupIntent suivie d'une fermeture d'onglet (A-09) ; double déclenchement `finalize` + webhook (A-06). **Requête de contrôle à lancer par un humain** : doublons de `lower(owner_email)` dans `organizations`.

---

## 5. Sécurité et infrastructure

**Solide (vérifié par lecture)** : webhook Stripe (corps brut, signature, refus sans secret en production) ; routes `/admin` toutes gardées par clé ; clés scopées en temps constant ; récupération d'URL par l'IA protégée (DNS épinglé) ; propositions IA confirmées par organisation + conversation ; aucun secret trouvé par motifs dans l'arbre actuel ; Supabase : aucune alerte ERROR/WARN, 11 tables en « RLS sans policy » (INFO).

**À traiter** : voir C-01 à C-08. L'isolation inter-organisations repose surtout sur des filtres `org_id` écrits à la main, dont au moins un défaillant (C-05).

**Infrastructure (Render, 9 oct. → 8 nov.)** : 1 instance `starter` 512 Mo, CPU ≈ 0,3 %, mémoire 200-370 Mo (pic 72 %), trafic ≈ 0,03 req/s, 0 redémarrage/OOM relevé. Un environnement de test séparé existe (`flowpoint-test` sur `Test-Replit`, base Supabase distincte). La production déploie automatiquement à chaque commit sur `Flowpoint`.

**Sauvegardes / restauration** : Supabase (plan gratuit, E-01), Atlas, Render Postgres : **non vérifiés**. Aucune restauration testée n'est documentée.

---

## 6. AI Lab V2 et Social Studio

**5 PR du pilote** (base `Test-Replit`, 7 nov., CI verte, aucune review)

| PR | Sujet | Taille | Risque | Prêt ? |
|---|---|---|---|---|
| #353 | `parseJsonBuffer` BOM UTF-8 | +89/-1 | Faible | Oui, après rebase |
| #354 | csv-parser nombres signés | +53/-2 | Faible-moyen (périmètre élargi à tab/CR, non demandé) | Oui, après relecture + rebase |
| #355 | cache `getOrSet` concurrent | +112/-3 | Moyen (cache global) ; doublon de #341 | Non, tant que #341 n'est pas tranchée |
| #356 | `extractExtension` sans extension | +36/-1 | Moyen (validation d'upload) | Oui, après vérification des appelants + rebase |
| #357 | `normalizeBusinessName` tous alphabets | +18/-1 | Faible | Oui |

**Garde-fous (positif)** : le code refuse tout merge (« action humaine »), tout push vers `Flowpoint`/`Test-Replit`, les missions sont limitées à `ai/<domaine>/<slug>`. Les deux branches sont `protected: true` côté GitHub. Droits réels de l'application GitHub et règles de revue : invérifiables.

**Limites** : SENTINEL/JUDGE valident les critères de la mission, pas le périmètre ni les appelants (F-07) ; budgets expérimentaux (F-05) ; authentification Max sans renouvellement (F-03) ; quota partagé avec Social (F-04) ; reprise après interruption non éprouvée (F-09).

**Social Studio** : registre append-only avec reprise, publication désactivée par défaut, statut « incertain » prévu. Risque de double publication limité aux reprises tardives (> 20 h, Zernio). Dépendance à un fournisseur tiers et à des jetons à expiration. **État réel (jetons, publications planifiées, VPS) invérifiable.**

**Utilisation quotidienne** : possible sur des correctifs ciblés (1 fonction + test, 2-3 fichiers, ≤ ≈ 150 lignes), une mission à la fois, hors fenêtre Social (04:45-10:15 UTC), avec relecture humaine de chaque PR. **Pas encore** sur les refontes multi-fichiers ni les zones facturation, Stripe, authentification, base de données, ni sur le front monolithique (≈ 72 000 lignes).

---

## 7. Acquisition et performance commerciale

| Niveau | Chiffre | Statut |
|---|---|---|
| Prospects découverts / qualifiés | n/d | Non mesurable (Smartlead, aucun accès) |
| Emails d'outreach envoyés | n/d | Non mesurable |
| Transactionnel Resend (10 oct.-8 nov.) | 41 envoyés, 38 délivrés, 3 rebonds transitoires (7,32 %), 0 plainte, 3 supprimés | **Prouvé** — ce n'est pas de l'outreach |
| Ouvertures / clics | 0 / 0 | Suivi désactivé sur le domaine Resend ; non significatif |
| Réponses humaines | n/d | Non mesurable |
| Visites attribuables, essais, clients payants | n/d | Non mesurable (base de production non interrogée ; consentement requis) |

**Où l'on perd des prospects (démontré ou plausible)** : clic de plan qui ne mène nulle part (A-01) ; 8 champs + carte (A-03) ; plan choisi deux fois (A-04) ; magic link obligatoire après paiement (A-05). **Blocages de pilotage** : mesure aveugle (A-02, A-12, G-01) ; aucun coût par essai calculable (G-03).

**Site marketing** : `flowpoint.pro` non joignable depuis la session → accueil, CTA, SEO, bandeau cookies, vitesse non audités. Seule `pricing.html` a été lue. Promesses : prix, quotas et essai cohérents avec le code ; écarts sur « ∞ crédits IA », SLA, support « < 1 h », « API illimitée » (G-08). Les trois documents légaux pointent vers une seule page.

**Demandes pour terminer l'audit** : autoriser `flowpoint.pro` dans le réseau, fournir l'export d'attribution (clé dédiée) et un export Smartlead, vérifier SPF/DKIM/DMARC.

---

## 8. Scalabilité et coûts

**Démontré** : trafic ≈ 0,03 req/s, CPU ≈ 0,3 %, aucune erreur 5xx. **Tout le reste est projection.**

Hypothèses (à valider) : 60 % Standard / 30 % Pro / 10 % Ultra ; ≈ 25 monitors par client toutes les 5 min ; 1 crédit IA ≈ 1 token (non démontré) ; 30 % d'utilisation des crédits ; prix d'hébergement approximatifs. Hors DataForSEO, PageSpeed, Google Maps, Stripe, Resend.

| Palier | Charge monitors | Infra (proj.) | IA à 30 % (à 100 %) | Risque principal |
|---|---|---|---|---|
| 10 clients | ≈ 250 | ≈ 20-25 $/mois (actuel) | ≈ 13 $ (45 $) | E-01 sauvegardes |
| 100 clients | ≈ 2 500 | ≈ 60-80 $ | ≈ 126 $ (420 $) | E-02 : boucle séquentielle saturée (≈ 120 contrôles/min) ; E-04 |
| 1 000 clients | ≈ 25 000 | ≈ 350-500 $ | ≈ 1 300 $ (4 200 $) | E-03, connexions Postgres, quotas DataForSEO/PageSpeed |
| 2 000 clients | ≈ 51 000 | ≈ 700-1 000 $ | ≈ 2 500 $ (8 400 $) | Marge Ultra, worker de monitors |

Le coût qui croît avec l'usage : **l'IA des clients Ultra** (à 100 % de 10 M de crédits en gpt-5, ≈ 40 $/client dans l'hypothèse centrale, fourchette 12-100 $ pour 149 €) ; les appels DataForSEO/PageSpeed/Google ; les monitors. Les chiffres dépendent de la définition réelle du « crédit ».

---

## 9. Plan d'action

**À 7 jours** (sécuriser et rendre le tunnel mesurable)
1. Confirmer le plan Supabase et les sauvegardes ; passer en Pro et faire un `pg_dump` externe (E-01).
2. Corriger le clic de plan et émettre `cta_clique` (A-01, A-02).
3. Corriger la colonne `kind` du quota d'exports et échouer fermé (B-01).
4. Lancer la requête de contrôle des doublons d'organisations ; vérifier les organisations « trialing » sans souscription (A-06, A-09).
5. Retirer `*.replit.*` du CORS de production et passer `SameSite=Lax` (C-01).
6. Alerte d'expiration de la session Claude Max (F-03). Vérifier en production que le cookie de consentement est bien posé (G-02).

**À 30 jours**
7. Simplifier l'inscription (champs, double choix de plan, plan transmis à Google) ; session après paiement (A-03 à A-05).
8. Verrou + index unique contre les doublons d'organisation ; réconciliation des essais (A-06, A-09).
9. Gates serveur sur le statut d'abonnement et politique d'annulation (B-03, B-04).
10. Corriger SSRF, rôles, IDOR GBP, rate limit, `state` OAuth (C-02 à C-07).
11. Réparer ou retirer : publication GBP, partage de rapport, automatisations, CRO, heatmaps Local (D-01, D-02, D-03, D-05, D-07).
12. Remplacer la liste blanche de tests par un glob ; réintégrer les tests de facturation/sécurité (B-11).
13. `/readyz`, alertes 5xx/mémoire, build à lockfile figé (E-05, E-06). Nettoyer les PR AI Lab, fusionner dans l'ordre (F-01, F-02).
14. Brancher les agrégats Smartlead sur l'attribution ; vérifier domaines d'envoi, DMARC et désinscription (G-03, G-06, G-07). Aligner les promesses du site (G-08).

**À 90 jours**
15. Claim atomique et worker dédié pour les monitors ; Redis/Key Value ; 2 instances ; API à Francfort si la latence p95 le justifie (E-02 à E-04, E-07).
16. Tests d'isolation inter-organisations en CI ; alerte si la RLS est dégradée (C-08) ; hash des clés et jetons (C-12).
17. Test de charge sur environnement isolé ; mesurer le coût réel d'un crédit IA et fixer les plafonds Ultra.
18. Rapport par campagne AI Lab, recalibrage des budgets, élargissement progressif des missions (F-05, F-12).
19. Essai sans carte (PR #307) seulement après mesure du tunnel corrigé et validation Stripe.

---

## 10. Verdict final

**FlowPoint n'est pas prêt à accueillir, convertir et fidéliser des clients payants à grande échelle.** Le moteur serveur est de bonne facture, mais :
- le **tunnel d'acquisition est cassé à l'étape de choix du plan et quasi aveugle**, donc on ne peut ni convertir ni diagnostiquer ;
- plusieurs **fonctions vendues ne tiennent pas leur promesse**, ce qui expose à des remboursements et litiges ;
- la **résilience des données n'est pas prouvée** ;
- **rien n'est démontré au-delà de quelques utilisateurs**.

Une ouverture à de premiers clients payants **sous surveillance** devient raisonnable une fois le plan à 7 jours exécuté. Une montée en charge (100 clients et plus) suppose le plan à 30 jours.

### Évaluations

| Axe | Note | Justification |
|---|---|---|
| **Maturité technique** | **58 / 100** | Webhooks idempotents, verrous sur quotas, CI vert, séparation test/production, garde-fous AI Lab : points forts. Pénalisée par des P1 de sécurité (CORS/CSRF, SSRF, rôles, IDOR), 22 fichiers de test jamais exécutés, fonctions simulées ou inachevées, état en mémoire, front monolithique de ≈ 72 000 lignes |
| **Préparation commerciale** | **30 / 100** | Tarifs cohérents et essai bien câblé, mais bouton de plan cassé, entonnoir quasi aveugle, 8 champs + carte, promesses excessives, acquisition non mesurable, site marketing non audité. Faible confiance dans cette note, car le bas de l'entonnoir est inconnu |
| **Fiabilité opérationnelle** | **42 / 100** | Aucune erreur 5xx et déploiements propres, mais sauvegardes non prouvées, instance unique à 512 Mo, aucun monitoring externe démontré, sonde de santé superficielle, authentification Claude Max à renouvellement manuel, aucune restauration testée |

Ces notes sont des jugements argumentés, pas des mesures. Elles seraient à réviser après les vérifications listées ci-dessous.

---

## Annexe — Ce qui n'a pas pu être vérifié

- Base de production : doublons d'organisations, statuts réels, colonne `kind` de `usage_events`, rôle de connexion et RLS effective, `funnel_events`, sauvegardes (Supabase, Atlas, Render).
- Stripe live : souscriptions orphelines, essais sans souscription, TVA, remboursements, webhooks actifs.
- Variables d'environnement Render (valeurs), protection de la branche `Flowpoint` et CI requis, Pre-Deploy, rollback.
- `flowpoint.pro` (accueil, CTA, SEO, bandeau cookies), DNS (SPF/DKIM/DMARC), Smartlead (envois, réponses, rebonds), taux de consentement.
- VPS AI Lab : état des services, expiration Claude Max, jetons Instagram/TikTok/Zernio, coût réel du pilote, « sans intervention humaine », reprise après arrêt brutal.
- Exécution des tests, rendu navigateur, audits Playwright existants (non lus), historique git complet et secret scanning.
- Non lus en profondeur : `BILLING_CERT_*.md`, `docs/audits/`, `billing-files/`, code de remboursement et de TVA, `ai-engine.ts` (atomicité des crédits IA), `billing.ts`, `me.ts`, `behavioral.ts`, chiffrement des refresh tokens Google, PR #110-#118, #215, #322-#323, #340-#345.
- Cette session n'a lancé aucune modification. Le présent fichier est le seul fichier créé (non commité).
