# FlowPoint — Description du parcours client complet

> Document rédigé le 14 août 2026 pour validation externe (ChatGPT / équipe).  
> Ce parcours couvre l'intégralité du cycle d'un nouveau client, de la découverte jusqu'à l'utilisation quotidienne, en incluant les cas de bord.

---

## Vue d'ensemble

Le parcours client FlowPoint comporte **4 grandes phases** :

| Phase | Nom | Pages impliquées |
|-------|-----|-----------------|
| A | Découverte & sélection du plan | `pricing.html` → `signin.html` |
| B | Paiement & activation du compte | `checkout-payment.html` → `checkout-return.html` |
| C | Connexion & accès au tableau de bord | `login.html` → `login-verify.html` → `dashboard.html` |
| D | Gestion d'équipe (optionnel) | `accept-invitation.html` |

---

## Phase A — Découverte et sélection du plan

### Étape A1 — Consultation de la grille tarifaire (`pricing.html`)

L'utilisateur arrive sur la page de pricing (publicité, SEO, bouton d'appel à l'action).  
La page charge les plans disponibles depuis **`GET /api/billing/plans`** (endpoint public, aucun token requis).  
Trois plans sont proposés : **Standard**, **Pro**, **Ultra** (jamais "Pro+", jamais "Enterprise" dans ce flux).  
L'utilisateur peut filtrer par cycle de facturation (mensuel / annuel). Les prix affichés viennent du serveur.  
L'utilisateur clique sur « Choisir ce plan ».

**Effet produit par le clic :**
- Le plan sélectionné est écrit dans `localStorage.fp_cart` (JSON : `{ plan, addons, _v, _updatedAt }`).
- L'utilisateur est redirigé vers `signin.html`.

---

### Étape A2 — Formulaire de pré-inscription (`signin.html`)

L'utilisateur remplit le formulaire avec ses coordonnées :
- Prénom, nom, email professionnel
- Nom de l'entreprise
- Pays, adresse postale, ville, code postal
- Téléphone, numéro TVA (optionnels)

Au clic sur « Créer mon compte » :

1. Le frontend envoie **`POST /api/auth/pre-register`** avec tous les champs.
2. Le backend :
   - Valide les champs obligatoires (retourne 400 si incomplet).
   - Vérifie que l'email n'est pas temporaire/jetable (retourne 400).
   - Vérifie qu'aucun compte actif n'existe pour cet email (retourne 409 si oui → redirige vers `/login.html`).
   - Si une inscription en cours abandonnée existe (ancienne session Stripe non complétée), elle est invalidée et l'utilisateur peut réessayer.
   - Crée une ligne dans la table `pending_signups` (TTL 2h) avec un token unique.  
     Un index UNIQUE partiel (`WHERE consumed_at IS NULL`) empêche les doublons concurrents.
   - Crée une ligne dans la table `users` avec `status = 'pending'` (protection de l'email).
   - Renvoie `{ ok: true, preRegisterToken: "<token 64 hex>" }`.

3. Le frontend stocke le `preRegisterToken` :
   - Dans `sessionStorage.fp_pre_reg_token` (accès rapide)
   - **ET** dans `localStorage.fp_pre_reg_token` (JSON `{ token, exp }` avec TTL 2h) — survit à la fermeture d'onglet.

4. Le plan (déjà dans `localStorage.fp_cart`) et le `preRegisterToken` permettent de continuer vers le paiement.
5. L'utilisateur est redirigé vers `checkout-payment.html`.

---

## Phase B — Paiement et activation

### Étape B1 — Initialisation du paiement (`checkout-payment.html`)

La page lit depuis le stockage local :
- Le plan et les add-ons sélectionnés (`localStorage.fp_cart`)
- Le `preRegisterToken` (`sessionStorage.fp_pre_reg_token` ou `localStorage.fp_pre_reg_token` comme fallback si l'onglet a été fermé entre temps)

La page envoie **`POST /api/public/payment-intent`** avec `{ plan, addons, preRegisterToken }`.

Le backend :
- Vérifie que le `preRegisterToken` est valide et non consommé dans `pending_signups`.
- Crée (ou retrouve) le client Stripe via `ensureStripeCustomer` (DB-first, anti-doublon, gère les clients Stripe supprimés).
- Crée un `PaymentIntent` ou `SetupIntent` Stripe selon le plan.
- Met à jour `pending_signups.stripe_customer_id`.
- Renvoie `{ clientSecret, publishableKey, quote }`.

La page instancie les éléments Stripe (`PaymentElement`) et affiche le récapitulatif de commande (plan, add-ons, total).

L'utilisateur saisit ses coordonnées bancaires directement sur la page (hébergé par Stripe, PCI compliant).

---

### Étape B2 — Confirmation de paiement et retour Stripe (`checkout-return.html`)

Après confirmation du paiement par Stripe, le navigateur est redirigé vers `checkout-return.html`.

**Deux chemins selon le type de retour :**

#### Chemin 1 — `payment_intent` ou `setup_intent` (Stripe Elements)
Le frontend lit le `preRegisterToken` depuis sessionStorage ou localStorage (fallback), puis envoie :
**`POST /api/public/finalize-checkout`** avec `{ intentId, intentType, plan, addons, preRegisterToken }`.

Le backend :
- Vérifie le paiement côté Stripe (appel API Stripe direct).
- Crée l'organisation dans `organizations`.
- Crée la souscription Stripe.
- Consomme le token `pending_signups` (marked `consumed_at = NOW()`).
- Envoie un email de magic link au nouvel utilisateur.
- Renvoie `{ success: true }`.

Le frontend :
- Efface `localStorage.fp_cart` et `sessionStorage.fp_pre_reg_token` **seulement après confirmation du succès**.
- Affiche l'écran de succès "Compte activé ! Vérifiez votre boîte mail."

#### Chemin 2 — `session_id` Stripe Checkout
Le frontend appelle **`GET /api/auth/checkout-complete?session_id=…`**.  
Le backend vérifie la session Stripe et, si paiement confirmé, crée l'org et envoie le magic link.  
Si la session n'est pas encore confirmée (webhook en cours), renvoie 402 → le frontend réessaie jusqu'à 4 fois.

**Cas utilisateur déjà connecté (reactivation/upgrade) :**  
Le frontend appelle **`GET /api/billing/verify?session_id=…`** à la place.  
Le panier est effacé uniquement dans les chemins succès (plus prématurément).

---

## Phase C — Connexion via magic link

### Étape C1 — Réception de l'email et clic sur le lien

L'utilisateur reçoit un email contenant un lien de type :
```
https://app.flowpoint.pro/login-verify.html?token=<64-hex>
```
Le token est stocké dans `magic_link_tokens` (table auto-créée au démarrage du serveur, TTL 15 minutes, usage unique).

---

### Étape C2 — Vérification du magic link (`login-verify.html`)

La page JS envoie **`POST /api/auth/login-verify`** avec `{ token }`.

Le backend exécute 6 vérifications (S1→S6) :
1. **S1** — `peekToken` : le token existe dans `magic_link_tokens` et n'est pas expiré.
2. **S2** — vérification de l'expiration (15 min).
3. **S3** — le token n'a pas encore été consommé (`used = false`).
4. **S4** — l'email du token correspond à un utilisateur `active` dans `users`.
5. **S5** — l'utilisateur appartient à au moins une organisation active.
6. **S6** — l'organisation a un abonnement actif (Stripe ou DB).

Si toutes les vérifications passent :
- Le token est consommé atomiquement (`UPDATE … RETURNING email`).
- Une session est créée dans `user_sessions` avec UUID utilisateur, rôle, IP, user-agent.
- Un cookie `fp_token` HttpOnly/Secure est posé.
- Le token de session est aussi renvoyé dans le corps JSON pour que le frontend le stocke en Bearer.

La page redirige vers `dashboard.html`.

---

### Étape C3 — Accès au tableau de bord (`dashboard.html`)

Le dashboard charge via **`GET /api/me`** (requiert auth Bearer ou cookie HttpOnly).  
Le backend renvoie : orgId, email, plan, rôle, nom, prénom, crédits IA, addons actifs.

Le dashboard affiche les données en temps réel :
- Audits SEO, monitors de disponibilité, analytics GA4/GSC, chat IA, calendrier éditorial, etc.

---

## Phase C bis — Connexion récurrente (`login.html`)

Pour les connexions suivantes, l'utilisateur va sur `login.html`.

Le frontend envoie **`POST /api/auth/login-request`** avec `{ email }`.

Le backend vérifie :
- Email valide, non temporaire.
- Compte existant dans `users` (statut `active`) **ou** dans `org_settings` (legacy).
- Compte non suspendu.
- Compte pas en attente de paiement (`status = 'pending'` → 402).

Si OK : génère un magic link, stocke dans `magic_link_tokens`, envoie l'email.  
L'email dans le message de succès est **échappé HTML** (protection XSS).  
L'utilisateur vérifie sa boîte mail et clique sur le lien → Étape C2.

---

## Phase D — Gestion d'équipe : invitation et acceptation

### Étape D1 — Invitation envoyée par l'admin

L'administrateur de l'organisation va dans Paramètres → Équipe → Inviter un membre.  
Il entre l'email et le rôle (viewer / member / admin).  
Le backend (**`POST /api/team/invitations`**) :
- Vérifie les seats disponibles selon le plan.
- Crée une entrée dans `team_invitations` (token UUID, TTL 7 jours).
- Envoie un email d'invitation avec un lien vers `accept-invitation.html?token=…&email=…`.

### Étape D2 — Acceptation de l'invitation (`accept-invitation.html`)

La page valide d'abord l'invitation : **`GET /api/team/invitations/validate?token=…`**.
- Renvoie les détails de l'invitation (orgName, rôle, expiration).
- Retourne 410 si expirée ou révoquée.

L'utilisateur clique sur « Rejoindre l'équipe » → **`POST /api/team/invitations/accept`** avec `{ token, email }`.

Le backend, dans une seule transaction :
1. Vérifie que l'invitation est valide, non expirée, non révoquée.
2. Vérifie que l'email correspond à celui de l'invitation.
3. Upsert dans `users` (crée ou récupère l'utilisateur).
4. Crée une ligne dans `organization_members` avec le rôle de l'invitation.
5. Marque l'invitation comme acceptée.
6. **COMMIT** puis récupère l'UUID de l'utilisateur depuis `users`.
7. Crée une session dans `user_sessions` avec l'**UUID** (pas l'email) comme identifiant.
8. Pose le cookie `fp_token` HttpOnly.
9. Renvoie `{ ok: true, sessionToken, orgId, email, role }`.

Le frontend stocke `sessionToken` en `fp_session_token` (sessionStorage) et redirige vers `dashboard.html`.

---

## Cas de bord couverts

| Scénario | Comportement |
|----------|-------------|
| Pre-register doublon concurrent | Index UNIQUE partiel `pending_signups(email) WHERE consumed_at IS NULL` bloque le 2e INSERT |
| Fermeture d'onglet entre signin et checkout | `localStorage.fp_pre_reg_token` (TTL 2h) survit, checkout-payment relit le token |
| Webhook Stripe lent | checkout-return réessaie `/auth/checkout-complete` jusqu'à 4× (toutes les 2 s) |
| Session déjà expirée après magic link | login-verify renvoie 410, la page affiche "Lien expiré, demandez-en un nouveau" |
| Token magic link rejoué (replay attack) | `used = true` atomique côté DB → 410 au 2e usage |
| Compte suspendu | login-request renvoie 403 avec message explicite |
| Email dans le message de succès | Échappé HTML (`&amp;`, `&lt;`, `&gt;`, `&quot;`) — protection XSS |
| sessionToken dans la réponse d'accept | Présent dans le JSON body (nécessaire pour le Bearer auth du frontend) et dans le cookie HttpOnly (navigation) |
| Reactivation d'un abonnement annulé | Redirection vers un nouveau Checkout Stripe (reactivation checkout), idempotent |

---

## Matrice des tokens de session

| Token | Écrit par | Stockage | Utilisé par |
|-------|-----------|---------|-------------|
| `preRegisterToken` | `POST /api/auth/pre-register` | `sessionStorage.fp_pre_reg_token` + `localStorage.fp_pre_reg_token` (TTL 2h) | `checkout-payment.html`, `checkout-return.html` (finalize-checkout) |
| `fp_token` (cookie) | `POST /api/auth/login-verify`, `/team/invitations/accept` | Cookie HttpOnly/Secure | Toutes les requêtes authentifiées (navigateur) |
| `sessionToken` (bearer) | Idem | `sessionStorage.fp_session_token` | Dashboard, API calls JS |
| `fp_cart` | `pricing.html` / `signin.html` | `localStorage.fp_cart` | `checkout-payment.html`, `checkout-return.html` |

---

## Endpoints clés résumés

| Méthode | Chemin | Auth | Rôle |
|---------|--------|------|------|
| GET | `/api/billing/plans` | Aucune | Grille tarifaire publique |
| POST | `/api/auth/pre-register` | Aucune | Pré-inscription + token |
| POST | `/api/public/payment-intent` | preRegToken | Création de l'intent Stripe |
| POST | `/api/public/finalize-checkout` | preRegToken | Activation post-paiement |
| GET | `/api/auth/checkout-complete` | Aucune (session Stripe) | Activation alternative |
| POST | `/api/auth/login-request` | Aucune | Envoi du magic link |
| GET/POST | `/api/auth/login-verify` | Token magic link | Échange token → session |
| GET | `/api/me` | Bearer / Cookie | Données utilisateur courant |
| GET | `/api/billing/verify` | Bearer / Cookie | Vérification paiement |
| POST | `/api/team/invitations` | Bearer / Cookie (admin) | Créer une invitation |
| GET | `/api/team/invitations/validate` | Aucune | Vérifier un lien d'invitation |
| POST | `/api/team/invitations/accept` | Aucune | Accepter une invitation |
