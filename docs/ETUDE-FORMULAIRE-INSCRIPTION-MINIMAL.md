# Étude : formulaire d'inscription minimal avant checkout

Date : 2026-11-17. Branche d'étude : `claude/etude-formulaire-minimal` (depuis `origin/Test-Replit`, commit `f0033049`).
Comparée à `origin/Flowpoint` (commit `a4d355e8`).

**Nature du document : étude seule.** Aucune donnée obligatoire, aucun backend, aucun code produit, aucun prix ni quota n'est modifié. Aucun appel réseau, aucun appel Stripe, aucun déploiement. Rien ici n'est une certification : tout ce qui n'a pas pu être vérifié dans le code est listé en section 9.

---

## 0. Résumé (à lire d'abord)

1. **La prémisse « huit champs » décrit la production, pas `Test-Replit`.** Sur `Flowpoint`, le formulaire et `POST /api/auth/pre-register` exigent huit éléments : e-mail, prénom, nom, entreprise, pays, adresse, ville, code postal. Sur `Test-Replit`, la réduction à **trois champs (prénom, nom, e-mail)** est **déjà faite**, côté formulaire (`signin.html`) et côté serveur (`auth.ts`), avec un test dédié (`signup-preregister-champs-minimaux.test.ts`, commits `8f155905` → `6ae4db3e`). Le formulaire de `Test-Replit` ne contient même plus le téléphone ni le n° de TVA (optionnels en production).
2. **Donc la vraie question de la phase 4 n'est pas « peut-on supprimer ? » mais « que perd-on, que faut-il rattraper, et peut-on aller plus loin ? »** Les dépendances aval de ces champs (organisation, Customer Stripe, facture, e-mails, rapports) sont lisibles dans le code et sont cartographiées ci-dessous.
3. **Trouvaille centrale : sur `Test-Replit`, plus aucun chemin ne collecte d'adresse de facturation.** Le Payment Element (`checkout-payment.html`) n'a pas d'Address Element ; il ne collecte, selon la méthode, que nom/e-mail et, pour une carte, pays + code postal. Or l'enrichissement du Customer à la finalisation (`public-billing.ts`, ~l. 2317) n'écrit une adresse que si `line1` **et** `country` sont présents dans `billing_details` du moyen de paiement : `line1` n'est jamais collecté. Résultat probable : **les nouveaux Customers n'ont pas d'adresse** (à confirmer en test Stripe, section 6). Le commentaire du code (« Stripe Address Element ») décrit une intention qui n'est plus câblée.
4. **Aucun calcul de taxe dans le dépôt** : pas de `automatic_tax`, `tax_id_collection`, `tax_behavior`, `billing_address_collection` ni `tax_rates` dans `artifacts/`. Le dépôt ne prouve donc ni Stripe Tax ni TVA calculée par l'application. Ce qui est configuré dans le Dashboard Stripe (Stripe Tax, mentions de facture) est **inconnu** de cette étude et doit être vérifié par le propriétaire.
5. **Précédent déjà en production** : le chemin « Continuer avec Google » (`auth.ts`, ~l. 2108-2128) crée déjà des comptes sans société, pays, adresse, ville ni code postal (NULL), sur les deux branches. Les « comptes sans pays » existent donc déjà ; le produit les supporte.
6. **Recommandation** : conserver les trois champs sur `Test-Replit`, ne pas descendre plus bas avant d'avoir (a) rattaché la collecte d'adresse de facturation à Stripe (Address Element en mode facturation, ou Checkout hébergé), (b) décidé du sort de la TVA/facture avec le comptable, (c) porté la mesure `signup_submitted`/`signup_failed` (présente seulement en production) pour pouvoir mesurer. Aucune promesse de gain chiffré : voir section 8.

---

## 1. Différences exactes `Flowpoint` (production) vs `Test-Replit`

| Élément | `Flowpoint` | `Test-Replit` |
|---|---|---|
| Champs obligatoires du formulaire `signin.html` (attribut `required`) | prénom, nom, e-mail, entreprise, pays (`<select>`), adresse, ville, code postal = **8** | prénom, nom, e-mail = **3** |
| Champs optionnels du formulaire | téléphone, n° TVA (« optionnel ») | **absents** du formulaire |
| Validation client (`signin.html`, handler `submit`) | 8 contrôles `fpF('signup_failed', 'missing_*')` + e-mail valide + jetable | prénom, nom, e-mail valide, jetable (l. ~918-924). Plus d'émission `signup_failed` |
| Corps envoyé à `/api/auth/pre-register` | `firstName, lastName, email, companyName, country, address, city, postalCode, phone?, vat?, seller_code, fp_lid, visiteurId, source` | `firstName, lastName, email, language, seller_code, fp_lid, visiteurId, source` |
| Validation serveur `auth.ts` | 400 si prénom, nom, entreprise, pays, adresse, ville ou code postal vide (7 refus + e-mail) ; messages en français | 400 seulement pour e-mail invalide, prénom ou nom vide, e-mail jetable ; messages en anglais. Les champs historiques restent **acceptés** s'ils sont fournis (compatibilité) |
| Langue d'interface stockée (`pending_signups.language`) | non | oui (`language`, liste blanche `fp-locale.js`, défaut `en`) |
| Écriture `pending_signups` | `INSERT … (… company_name, country, address, city, postal_code, phone, vat …)` | idem, avec UPDATE de la ligne non consommée du même jeton (retries) ; les champs absents sont écrits `''` (`company_name`, `country`, `address`, `city`, `postal_code`) ou `NULL` (`phone`, `vat`) |
| Schéma `pending_signups` | `company_name TEXT NOT NULL` ; `country`, `address`, `city`, `postal_code`, `phone`, `vat` nullables | identique (`company_name` reste `NOT NULL`, satisfait par `''`) |
| Création du Customer Stripe pendant `POST /public/payment-intent` | Oui : Customer créé **avant paiement** avec adresse venant de `pending_signups`, `description` = société, `preferred_locales: ["fr"]` | **Non** : invariant « un Customer n'est créé qu'après paiement/setup confirmé » (`ONE_CUSTOMER_INVARIANT`, `public-billing.ts` ~l. 688, 1352-1400). Le paramètre `billingAddress` est lu (l. 1246) mais **n'est plus utilisé** ; le front envoie `billingAddress: null` |
| Pré-remplissage Payment Element | `defaultValues.billingDetails` = nom + e-mail | identique ; `defaultValues.country` (« FR » par défaut) est calculé côté serveur mais **non consommé** par le front |
| Support de mesure du tunnel | `signup_submitted`, `signup_failed` + 15 catégories d'échec (dont `missing_company`, `missing_country`, `missing_address`, `missing_city`, `missing_postal_code`) | **absents** de `ETAPES_TUNNEL` ; `signup_started`, `signup_form_engaged`, `signup_form_completed` présents des deux côtés |
| Chemin Google | NULL pour pays/adresse/ville/code postal, `company_name ''` | idem + `language` |

Fichiers lus : `artifacts/api-server/src/routes/auth.ts` (pre-register ~l. 899-1150 ; Google ~l. 2100-2130), `artifacts/flowpoint-export/signin.html`, `checkout-payment.html`, `routes/public-billing.ts`, `routes/stripe-webhook.ts`, `services/pending-signup-stripe-customer.ts`, `services/init-data-tables.ts`, `services/funnel-events.ts`.

---

## 2. Tableau champ par champ

Légende : **L** = lu par, **É** = écrit par, **X** = exigé par. « Si absent » = ce qui se passe réellement sur `Test-Replit` d'après le code.

| Champ | Exigé (prod) | Exigé (Test-Replit) | Écrit | Lu | Si absent |
|---|---|---|---|---|---|
| **e-mail** | oui | oui | `pending_signups.email` ; ensuite `users.email`, `organizations.owner_email`, `org_settings.org_id` (clé historique = e-mail) | tout le tunnel : garde de doublon (`users`, `organization_members`, `organizations`), éligibilité à l'essai (`stripe-trial-history.ts`), Customer Stripe (`email`, métadonnées `orgId`), e-mail d'activation (lien magique), jetons de checkout | **Impossible** : identité, essai, activation et Customer en dépendent. Reste obligatoire |
| **prénom** | oui | oui | `pending_signups.first_name` → `users.first_name`, `org_settings.first_name` | nom du Customer Stripe (`prénom nom`), nom du payeur pré-rempli, salutation de l'e-mail d'activation (`name: first_name \|\| partie locale de l'e-mail`) | Dégradation légère (repli sur la partie locale de l'e-mail). Pas de blocage technique. `pending_signups.first_name` est `NOT NULL` (accepte `''`) |
| **nom** | oui | oui | `pending_signups.last_name` → `users.last_name`, `org_settings.last_name` | nom du Customer Stripe, nom du payeur pré-rempli | Idem prénom. Le nom du Customer Stripe sert de « Facturé à » sur la facture : un nom vide dégrade la facture |
| **entreprise** (`companyName`) | oui | non | `pending_signups.company_name` → `organizations.name` (`company_name \|\| e-mail`), `organizations.slug`, `org_settings.org_name` ; Customer Stripe `description` | invitations d'équipe (`team.ts` : « invited you to {orgName} »), en-tête/pied des rapports en marque blanche (`dashboard.js` : `me.orgName`, défaut « Mon Agence »), `/me` | L'organisation s'appelle **l'adresse e-mail du propriétaire** (`organizations.name`), le slug aussi. Invitations d'équipe et rapports en marque blanche affichent alors l'e-mail ou un défaut. **Aucune** facture n'indique la société. Aucun blocage backend. Pas de règle de quota ni de plan sur ce champ |
| **pays** | oui | non | `pending_signups.country` → `org_settings.country` ; Customer Stripe `address.country` (webhook, `pending-signup-stripe-customer.ts`) | `email-localization.ts` (repli de langue d'e-mail, **après** préférence explicite et langue d'inscription) ; `/me` ; `dashboard.js` (géocodage de localisation) | Plus de pays sur le Customer sauf via Payment Element (carte : pays + code postal dans `billing_details`, **non recopiés** sur le Customer car `line1` absent). Langue d'e-mail : déjà couverte par `language`. **Aucune règle de quota/plan/éligibilité à l'essai ne lit le pays** (recherche exhaustive dans `services/`, `routes/`, `middlewares/`, `lib/`). Voir section 3 pour la TVA |
| **adresse** | oui | non | `pending_signups.address` → `org_settings.address` ; Customer Stripe `address.line1` | `local-maps-service.ts` (géocodage de l'adresse de l'organisation pour la veille locale), `dashboard.js` (~l. 5515), page Localisation | Pas de ligne 1 sur le Customer ni sur la facture. `locationConfigured` reste `false` (calculé `city \|\| address`) : la veille locale demande alors à l'utilisateur de saisir sa localisation dans l'app (fonction existante : `location.ts`) |
| **ville** | oui | non | `pending_signups.city` → `org_settings.city` ; Customer Stripe `address.city` | idem adresse + `locationConfigured` | idem |
| **code postal** | oui | non | `pending_signups.postal_code` → `org_settings.postal_code` ; Customer `address.postal_code` | idem | idem. Pour une carte, Stripe redemande un code postal dans le Payment Element selon le pays de la carte : **doublon de saisie en production** |
| téléphone (optionnel prod) | non | n/a | `pending_signups.phone` → `org_settings.phone` | `/me` | aucun effet bloquant |
| n° TVA (optionnel prod) | non | n/a | `pending_signups.vat` → `org_settings.vat` | **jamais envoyé à Stripe** (pas de `tax_ids`) ; lu seulement par l'app (`/me`) | Aucun effet sur la facturation actuelle : le n° de TVA saisi à l'inscription **n'arrive pas** sur le Customer Stripe, donc pas sur la facture |
| `seller_code` / `fp_ref` | non | non | `pending_signups.seller_id` (validé côté serveur) → `organizations.seller_id`, métadonnées Stripe `seller_id`/`seller_attribution` | webhook et finalisation (ledger vendeur) | **Indépendant** des huit champs : aucune de ces colonnes ne conditionne l'attribution |
| `fp_lid`, `visiteurId`, `source` | non | non | `pending_signups.fp_lid` → `organizations.fp_lid` ; `funnel_events` | AI Lab (`signup`, `checkout`, `trial`, `paid`) | Indépendant. `signup_form_completed` est émis **après** le COMMIT de la ligne `pending_signups`, quel que soit le contenu des champs facultatifs |
| `_hp` (honeypot) | non | non | – | rejet silencieux | indépendant |
| consentement CGU | **aucune case à cocher**, ni en production ni sur `Test-Replit` : seulement une phrase avec liens (« Terms and Conditions », « Privacy Policy » → `flowpoint.pro/informations-legales`) | idem | – | – | voir section 5 (point juridique) |

Notes :
- `webhook` (`stripe-webhook.ts` ~l. 723-945, `activateNewSignup`) relit `company_name, country, address, city, postal_code, phone, vat, language` pour créer `organizations`/`org_settings`. Tous les champs absents donnent `''`/NULL sans erreur. Le test existant `signup-preregister-champs-minimaux.test.ts` ne couvre que `pre-register` : **aucun test ne couvre l'activation d'une organisation sans société/adresse** (voir section 6).
- `finalize-checkout` (`public-billing.ts` ~l. 2520-2840) : même lecture, plus l'étape 4f qui ne crée `org_settings.address` que si une adresse est présente (sinon rien).

---

## 3. Dépendances Stripe, taxes, facturation

### 3.1 Customer Stripe
- Création **après** paiement/setup confirmé, via `ensurePendingSignupStripeCustomer` (`pending-signup-stripe-customer.ts`) depuis le webhook `setup_intent.succeeded` / `payment_intent.succeeded` **ou** depuis `finalize-checkout` (course entre les deux, verrou transactionnel).
- Données posées : `email`, `name` (`prénom nom`, repli société puis e-mail), `description` (société si présente), `preferred_locales: ["fr"]` (**codé en dur**, y compris pour un parcours en anglais : à noter, voir risques), `address` seulement si `address|city|country` du signup existe (jamais plus sur `Test-Replit`), métadonnées `orgId`, `pre_register_token`, `source`, `seller_id`.
- Enrichissement de `finalize-checkout` : lit `paymentMethods.retrieve().billing_details` ; n'écrit l'adresse que si `line1 && country`. **Pas d'Address Element** dans `checkout-payment.html` → condition jamais remplie par le formulaire actuel.
- Le webhook ne lit pas l'adresse depuis Stripe pour la recopier dans `org_settings` (`customer.updated` ne fait que persister l'identifiant du Customer).

### 3.2 TVA, taxes, mentions légales
- **Rien dans le code** : pas de Stripe Tax, pas de `tax_id_collection`, pas de `tax_exempt`, pas de `tax_behavior` sur les prix, pas de `billing_address_collection`. Le Customer Checkout hébergé (réactivation, add-on) a `customer_update: {address: "auto", name: "auto"}` mais sans collecte d'adresse forcée.
- Conséquence : l'adresse du formulaire n'est **pas utilisée** pour calculer une taxe (le code ne calcule rien). Si une taxe est calculée dans Stripe (Dashboard), la localisation du client pour Stripe Tax vient du Customer/moyen de paiement, donc la disparition de l'adresse du formulaire la prive de signal. **À vérifier côté Dashboard** (inconnu ici).
- Factures : `billing-service.ts` expose `invoice_pdf` et `hosted_invoice_url` de Stripe ; le dépôt ne génère **aucune** facture/PDF propre. Le contenu légal (société, adresse, TVA du client) est donc exclusivement celui du Customer Stripe.
- Mentions légales BE/FR (nom/adresse du client B2B, n° TVA du client pour l'autoliquidation, taux, adresse du vendeur) : **question juridique/comptable**, voir section 7. Le code n'établit pas ce qui est requis.
- Précision : le n° TVA collecté en production (optionnel) n'a **jamais** été transmis à Stripe ; supprimer le champ ne retire donc aucune fonction de facturation existante.

### 3.3 Fraude et éligibilité à l'essai
- `isTrialEligibleForIdentity` / `hasStripeSubscriptionHistory` (`stripe-trial-history.ts`) : décision **par e-mail uniquement** (organisations, `org_settings`, Customers Stripe de cet e-mail, abonnements `status: all`). **Aucun usage** de pays, adresse, société ni empreinte de carte (`fingerprint` : absent du code applicatif). Retirer les champs ne dégrade donc pas l'éligibilité à l'essai.
- Faiblesse existante, indépendante de l'étude : un même prospect peut réutiliser un nouvel e-mail pour un nouvel essai ; la seule garde supplémentaire est l'e-mail jetable (liste interne) et le rate limit. Ni l'adresse ni la société ne l'empêchaient en production (champs libres, non vérifiés).
- Réconciliation `trial-subscription-reconcile.ts` : lit `organizations` (e-mail, plan, client Stripe, dates d'essai) ; **aucun** des huit champs.

### 3.4 Fichiers de la liste de mission : verdict
| Fichier | Lit un des huit champs ? |
|---|---|
| `routes/public-billing.ts` | oui : `pending_signups` (société, pays, adresse…) pour Customer/organisation ; `billingAddress` lu mais inutilisé |
| `routes/stripe-webhook.ts` | oui : `activateNewSignup` (organisation, `org_settings`) ; pas de lecture d'adresse Stripe |
| `services/stripe-factory.ts` | non (fabrique de client, garde `sk_test_`/test) |
| `services/trial-subscription-reconcile.ts` | non |
| `services/init-checkout-post-tokens.ts`, `checkout-post-tokens` | non (jetons de connexion post-paiement, clés e-mail/organisation) |
| `services/stripe-trial-history.ts` | non (e-mail seulement) |
| `services/seller-attribution.ts` | non |
| `services/signup-subscription.ts` | non (création d'abonnement depuis l'intent) |

### 3.5 Exports/PDF et rapports dans l'app
- Rapports en marque blanche : `me.orgName` (société ou, à défaut, e-mail du propriétaire dans `organizations.name`). Défaut d'interface « Mon Agence » seulement si `orgName` est vide.
- `report-view.html` : n'affiche que le nom d'agence de la marque blanche (`branding.agencyName`), ni adresse ni TVA ; les autres exports/PDF n'ont pas été audités exhaustivement ; la page Localisation (`location.ts`) permet déjà de saisir ville/adresse/pays après coup.
- Quotas et règles dépendant du pays : **aucune** trouvée.

---

## 4. Formulaire minimal proposé

Principe : **une seule collecte de l'adresse de facturation, chez Stripe, au moment du paiement**, à condition de câbler cette collecte (aujourd'hui absente, voir 0.3). Tant que ce câblage n'est pas fait et certifié, ne pas descendre sous l'état actuel.

### 4.1 Avant checkout (`signin.html`, obligatoires)
| Champ | Obligatoire ? | Raison |
|---|---|---|
| e-mail professionnel | oui | identité, essai, activation, doublon, Customer |
| prénom | oui (conserver) | nom de facturation, personnalisation de l'e-mail d'activation ; un prénom coûte peu |
| nom | oui (conserver) | nom de facturation ; idem |
| consentement CGU/Confidentialité | **à décider** (section 7) : aujourd'hui simple mention avec liens, sans case |
| honeypot `_hp`, `seller_code`, `fp_lid`, `language`, `visiteurId`, `source` | invisibles | attribution, langue, mesure |

Option « deux champs » (e-mail seul, nom récupéré au paiement) : **non recommandée à ce stade**. Gain de saisie faible (deux champs courts avec `autocomplete`), perte du nom avant paiement (affiche « — » dans l'e-mail d'activation, nom du Customer vide tant que le Payment Element n'a pas rendu `billing_details.name`, et `NOT NULL` à gérer). À reconsidérer seulement après mesure, voir section 8.

### 4.2 Collectés plus tard
| Donnée | Où | Pourquoi |
|---|---|---|
| Adresse de facturation complète (pays, ligne 1, ville, code postal) | **Stripe**, à ajouter : Address Element (`mode: 'billing'`) dans `checkout-payment.html`, ou `billingAddress` « complet » si Checkout hébergé (`billing_address_collection: 'required'` + `customer_update.address: 'auto'`, déjà présent) | une seule saisie ; la donnée légale de la facture vit sur le Customer Stripe ; permet au besoin Stripe Tax |
| N° de TVA intracommunautaire | Stripe (`tax_id_collection: { enabled: true }` en Checkout, ou Address Element/portail client) ou page Paramètres de l'app | aujourd'hui non transmis à Stripe, donc sans effet sur la facture |
| Nom de société | Paramètres > Profil / première visite de l'app (champ **non bloquant**), repli automatique sur le nom de domaine du site audité ou l'e-mail | alimente invitations d'équipe et rapports en marque blanche, pas la facture |
| Ville/adresse « locale » pour veille locale | page Localisation existante (`location.ts`) | usage produit, distinct de l'adresse de facturation |
| Téléphone | Paramètres | facultatif |

### 4.3 À conserver tel quel
Garde de doublon e-mail (409 → `/login.html`), e-mail jetable, honeypot, rate limit, mesure `signup_form_completed`, `seller_code`/`fp_lid`.

### 4.4 Ce que le code actuel permet sans changer de contrat
Les champs historiques restent **acceptés** par `pre-register` (test C du fichier de test existant) : rien n'oblige à retirer le support côté serveur ; une collecte ultérieure (Paramètres) peut les remplir sans migration de schéma.

---

## 5. Risques

| Risque | Gravité | Détail et mitigation proposée |
|---|---|---|
| Factures sans adresse (ou sans société) | élevée si facturation B2B BE/FR | probable aujourd'hui sur `Test-Replit` (section 0.3). Mitigation : Address Element/Checkout hébergé + test Stripe TEST affichant la facture ; décision comptable avant production |
| TVA / conformité | à qualifier par le comptable | pas de taxe calculée par le code ; n° TVA client jamais transmis. Mitigation : collecte via Stripe, ou politique explicite écrite |
| Comptes sans pays | faible | déjà le cas pour Google ; aucune règle dépendante du pays ; langue d'e-mail portée par `language` |
| Fraude/abus d'essai | moyenne, **inchangée** | les huit champs étaient non vérifiés (texte libre) et inutilisés par la garde d'essai (e-mail seulement). Une adresse/société plausibles n'ajoutaient pas de contrôle. Piste hors périmètre : empreinte de carte avant essai |
| Qualité des données de prospection | moyenne | la société et le pays n'étaient pas des données de qualité contrôlée ; perte pour segmentation (ex. segments `CLIENTS_FR_BE_SMB` / `SELLERS_FR_BE` d'AI Lab, qui dépendent du pays/segment : **à vérifier avec le propriétaire**, non lisible ici). Mitigation : enrichir à l'onboarding ou depuis Stripe, ou inférer le pays de la carte (`billing_details.address.country`) |
| Nom d'organisation = e-mail | moyenne | visible dans les invitations d'équipe (« invited you to jane@… ») et rapports en marque blanche. Mitigation : champ « Nom de l'agence/société » non bloquant à la première visite, avant tout rapport |
| Impact sur la mesure `signup_form_completed` | moyenne | l'événement se déclenche après un COMMIT réussi ; avec moins de champs, **le numérateur monte mécaniquement** et la comparaison avant/après est biaisée si l'on ne suit que cette étape. Il faut mesurer la **conversion de bout en bout** (visiteur → `checkout_completed` → `trial_activated`), pas l'étape isolée |
| Perte de la mesure par champ | moyenne | `signup_failed` par catégorie existe **en production seulement** (PR #464). Sur `Test-Replit`, plus aucune mesure d'échec par champ. À porter avant l'expérience |
| `preferred_locales: ["fr"]` codé en dur | faible, indépendant | e-mails/factures Stripe potentiellement en français pour un parcours anglais. Hors périmètre ; à signaler |
| `defaultValues.country` ignoré | faible | code mort (serveur calcule, front n'utilise pas) |
| Écart de branche | élevée (process) | production exige encore huit champs : tout ce qui est écrit ici ne vaut que pour `Test-Replit` tant que la fusion n'est pas décidée |

---

## 6. Plan de migration en étapes certifiables

Aucune étape ci-dessous n'est exécutée par cette étude. Chaque étape a un critère de sortie vérifiable et un retour arrière.

**Étape 0 : état de référence `Test-Replit` (sans rien changer).**
- Rejouer le test existant `signup-preregister-champs-minimaux.test.ts` (vitest ; non exécuté ici car les dépendances `pnpm` ne sont pas installées dans cet environnement isolé).
- Parcours navigateur Stripe TEST : inscription 3 champs → plan → paiement carte test → retour → connexion. Relever sur le Customer créé : `address`, `name`, `email`, `description`, `preferred_locales` ; sur la facture : « Facturé à ». **Critère** : tableau attendu/observé des champs du Customer et de la facture (confirme ou infirme la trouvaille 0.3).
- Même parcours avec SEPA test ; relever si Stripe exige une adresse.
- Retour arrière : sans objet (lecture).

**Étape 1 : tests à écrire (aucun changement produit).**
1. `activateNewSignup` (webhook) et `finalize-checkout` avec `pending_signups` sans société/pays/adresse : organisation créée, `name = e-mail`, `org_settings` créé sans adresse, `locationConfigured = false`, pas d'erreur.
2. `ensurePendingSignupStripeCustomer` sans adresse : pas de clé `address` envoyée ; nom/e-mail présents.
3. Enrichissement `finalize-checkout` : `billing_details` carte (pays + code postal seulement) → pas d'adresse écrite (verrouille le comportement actuel, rend la régression de 0.3 visible).
4. Pas de lecture de pays dans l'éligibilité à l'essai (test de non-régression : même décision avec et sans pays).
5. Base de test éventuelle : `flowpoint_ci_etude` (jamais `flowpoint_ci`) pour les tests `*-db.test.ts`.
- Retour arrière : supprimer les tests.

**Étape 2 : portage de la mesure (autorisation requise).**
- Porter `signup_submitted`/`signup_failed` (production, PR #464) vers `Test-Replit`, catégories de champs obsolètes retirées. **Critère** : les deux branches émettent les mêmes étapes pour comparer.

**Étape 3 : collecte d'adresse chez Stripe sur `Test-Replit` (changement produit : autorisation requise).**
- Ajouter l'Address Element (billing) ; garder la condition `line1 && country` ; ajouter le test (étape 1.3) au vert. Option : `tax_id_collection`.
- **Critère** : Stripe TEST, Customer et facture avec adresse ; carte et SEPA ; mobile 390 px ; thème clair/sombre ; échec de carte (3DS, refus) ; double clic ; reprise d'un jeton expiré.
- Retour arrière : retirer l'Address Element (le Payment Element seul reste fonctionnel).

**Étape 4 : champ « Nom de la société » non bloquant** à la première visite ou dans Paramètres. **Critère** : un compte sans société ne produit plus d'invitation d'équipe au nom de l'e-mail. Retour arrière : masquer le champ.

**Étape 5 : certification navigateur complète** (protocole `docs/CERTIFICATION-NAVIGATEUR.md` et `CERTIFICATION-STRIPE-TEST-E2E`) : inscription e-mail et Google, essai, paiement immédiat si historique, réactivation, add-on, retour Stripe, e-mails (langues FR/EN), tableau de bord, invitation d'équipe.

**Étape 6 : métriques avant/après (section 8) puis décision de fusion vers `Flowpoint`** (propriétaire, hors périmètre de ce document).

**Retour arrière global** : les champs historiques sont toujours acceptés par `pre-register` ; restaurer le formulaire de production suffit à retrouver le comportement précédent sans migration de schéma (aucune colonne n'est supprimée dans ce plan).

---

## 7. Ce qui exige l'autorisation du propriétaire ou un avis juridique/comptable

**Autorisation du propriétaire (décisions produit) :**
1. Garder trois champs ou descendre à deux (e-mail seul).
2. Autoriser l'ajout de l'Address Element / `tax_id_collection` sur `Test-Replit` (touche le parcours de paiement).
3. Autoriser le portage de `signup_submitted`/`signup_failed` vers `Test-Replit`.
4. Décider si la fusion vers `Flowpoint` (production) est visée ; elle seule retire les cinq champs en production. **Jamais faite par cette étude.**
5. Dépendance AI Lab : les segments de prospection (`CLIENTS_FR_BE_SMB`, `SELLERS_FR_BE`) reposent-ils sur le pays/la société saisis ? À confirmer avant tout changement.
6. Politique du nom d'organisation par défaut (e-mail, domaine, invite à renseigner).

**Avis juridique / comptable (non tranchable par le code) :**
1. Mentions obligatoires d'une facture B2B/B2C en Belgique et en France (identité et adresse du client, n° de TVA du client) et à partir de quand elles doivent figurer.
2. Régime de TVA : taux, lieu de taxation, autoliquidation intracommunautaire, guichet unique OSS ; existence ou non d'une taxe aujourd'hui calculée par Stripe (Dashboard).
3. Preuve de consentement aux CGU : une mention avec liens suffit-elle, ou une case à cocher/horodatage est-elle nécessaire (présence d'une case : **absente** actuellement, en production comme sur `Test-Replit`) ? Même question pour le RGPD (information, base légale).
4. Conservation/minimisation des données (`pending_signups` conserve les anciens champs jusqu'à purge).

**Hors périmètre absolu** : branche `Flowpoint`, production, Stripe LIVE, prix, quotas, déploiement.

---

## 8. Effet attendu sur la conversion : estimation honnête

- **Direction attendue** : retirer des champs obligatoires réduit en général l'abandon du formulaire. **Aucun chiffre n'est avancé ici** : le dépôt ne contient aucune donnée de conversion réelle. Les seuls chiffres disponibles (`CERTIFICATION-CONVERSION-AI-LAB-2026-11-14.md` §12 : 42 visiteurs, taux consentants 0,605) viennent de certifications Stripe TEST, pas de prospects ; ils ne servent ni de base ni de cible.
- **Effet probablement concentré à un endroit précis** : `signup_started` → `signup_form_completed`. Mais cette étape est celle dont le numérateur monte mécaniquement quand on retire des champs ; elle ne prouve pas un gain commercial. Il faut suivre : `signup_started` → `checkout_completed` → `trial_activated` (puis `subscription_activated` en paiement).
- **Effet possiblement négatif aval** : un prospect moins engagé peut abandonner plus tard au paiement ; et si l'adresse est collectée au paiement (étape 3), la page de paiement s'allonge. Le bilan net n'est pas connu d'avance.
- **Méthode de mesure** :
  1. Avant/après sur la même source d'acquisition (`source` : smartlead, google, direct…), mêmes jours de la semaine ; mesure de bout en bout.
  2. Idéalement test A/B par `visiteurId` (50/50) : formulaire de production (8 champs) vs minimal. Exige que la production reste l'un des bras, donc décision propriétaire et déploiement hors périmètre.
  3. Mesure de l'échec par champ via `signup_failed` (production) pour savoir quels champs bloquent réellement.
  4. Restreindre aux visiteurs consentants analytiques (`mixed_coverage` : ne jamais diviser des populations de couverture différente).
- **Taille d'échantillon** (test bilatéral à deux proportions, α = 0,05, puissance 80 %, formule `n = (1,96 + 0,84)² [p1(1−p1) + p2(1−p2)] / (p1−p2)²`, **par bras**). Les taux ci-dessous sont des **hypothèses d'illustration, pas des mesures** :

| Taux de base → taux visé (hypothèse) | Visiteurs par bras |
|---|---|
| 50 % → 60 % | environ 385 |
| 50 % → 55 % | environ 1 560 |
| 30 % → 36 % | environ 960 |
| 30 % → 33 % | environ 3 760 |
| 10 % → 12 % | environ 3 840 |

  Avec un volume du niveau de la certification actuelle (quelques dizaines de visiteurs), **aucune** de ces différences n'est détectable : une conclusion statistique n'est pas possible tant que le trafic réel n'est pas de l'ordre de plusieurs centaines à quelques milliers de visiteurs par bras. En dessous, ne présenter que des tendances et des intervalles de confiance larges, jamais un « gain de X % ».

---

## 9. Limites de cette étude (non vérifié)

- **Aucune exécution** : dépendances `pnpm` non installées dans l'environnement isolé, donc aucun test lancé ; aucune base créée ; aucun appel réseau.
- **Comportement réel de Stripe** (adresse demandée ou non par le Payment Element pour SEPA/carte ; contenu exact d'une facture ; Stripe Tax activé ou non ; mentions de facture dans le Dashboard) : **non observé**. Les affirmations s'appuient sur le code du dépôt (0.3, 3.1, 3.2) et doivent être confirmées à l'étape 0 en Stripe TEST.
- **Prospection** : dépendance d'AI Lab au pays/à la société non lisible dans ce dépôt.
- **Données de conversion réelles** : aucune disponible.
- Numéros de ligne approximatifs, relevés sur `origin/Test-Replit` au commit `f0033049`.
