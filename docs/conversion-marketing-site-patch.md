# Site vitrine flowpoint.pro — correctifs à appliquer (pour Replit)

Le code du site vitrine n'est pas dans ce dépôt (il est servi séparément). Chaque constat ci-dessous a été vérifié **en ligne le 12 novembre 2026**. Chaque comportement attendu côté application a été vérifié **dans le code et par simulation** (`scripts/certify-conversion-local.mjs`, 390 px). Rien n'a été modifié sur le site vitrine par nous : tant que Replit n'a pas appliqué ce document **et que le site publié a été re-vérifié**, les points 1 à 4 ne sont pas validés.

Hors périmètre : prix, quotas, durée de l'essai (14 jours), règles Stripe. Ne rien y toucher.

Le détail de la langue est dans `docs/conversion-marketing-site-patch-langue.md` (à appliquer avec ce document).

## 1. FAQ de /pricing — formulation trompeuse (P0)
Texte actuellement publié, dans le HTML visible **et** dans le JSON-LD `FAQPage` :
> After your 14-day trial, choose the plan that fits your needs. Your data is retained so you can pick up where you left off.

Il laisse croire que le plan se choisit après l'essai. Remplacer **mot pour mot** (c'est le texte de l'application) :
> All plans include a free 14-day trial with full access. You choose your plan before you start, and a credit card is required at sign-up. Nothing is charged during the trial. When the 14 days end, your subscription to the chosen plan starts and your card is charged automatically, unless you cancel before that date. You can cancel at any time before the trial ends, at no cost.

À faire aussi : chaque mention « free trial » / « Try for free » / « Start free » proche d'un prix doit être accompagnée de « card required » et de « billed automatically after 14 days unless cancelled ». Version française (pages françaises) : « Tous les plans incluent 14 jours d'essai gratuit avec accès complet. Vous choisissez votre plan avant de commencer, et une carte bancaire est requise à l'inscription. Rien n'est débité pendant l'essai. À la fin des 14 jours, l'abonnement au plan choisi démarre et la carte est débitée automatiquement, sauf si vous annulez avant cette date. Vous pouvez annuler à tout moment avant la fin de l'essai, sans frais. »

**Vérification après publication :** `curl -s https://flowpoint.pro/pricing | grep -c "charged automatically"` doit renvoyer ≥ 1 et `grep -c "choose the plan that fits"` doit renvoyer 0.

## 2. Boutons de plan sans plan (P0)
Les 5 liens de /pricing pointent vers `https://app.flowpoint.pro/signin.html` sans plan. Les boutons doivent transmettre le plan :

| Bouton | Lien |
|---|---|
| Standard | `https://app.flowpoint.pro/signin.html?plan=standard` |
| Pro | `https://app.flowpoint.pro/signin.html?plan=pro` |
| Ultra | `https://app.flowpoint.pro/signin.html?plan=ultra` |
| CTA génériques (« Start free », « Create my free account ») | inchangés, **sans** `plan` |

Comportement de l'application (vérifié) : seul `standard`, `pro` ou `ultra` est accepté (liste blanche) ; toute autre valeur est ignorée sans erreur. Le plan est mis dans le panier, retiré de l'URL, conservé jusqu'au checkout, et **modifiable** par le visiteur. Le prix et les quotas sont toujours recalculés côté serveur : le paramètre ne peut rien modifier d'autre que la présélection.

## 3. Paramètres à conserver sur tous les liens vers l'application
Ajouter (si connus) à **tous** les liens vers `app.flowpoint.pro` :

| Paramètre | Valeur | Remarque |
|---|---|---|
| `plan` | `standard` \| `pro` \| `ultra` | boutons de plan uniquement |
| `lang` | `fr` `en` `es` `de` `it` `pt` `pt-br` `nl` `pl` `sv` `ro` `cs` | voir le document langue |
| `fp_lid` | 22 caractères `[A-Za-z0-9_-]` | identifiant opaque d'un e-mail Smartlead ; le recopier tel quel, ne jamais le fabriquer |
| `utm_source`, `utm_medium`, `utm_campaign` | minuscules `[a-z0-9._-]`, 1 à 64 caractères | une valeur hors motif est ignorée |
| `fp_source` | `smartlead` \| `google` \| `direct` \| `social` \| `other_campaign` | source de première touche |
| `fp_vid` | UUID v4 | **uniquement si le visiteur a consenti** (voir 5) |
| `fp_ref` | code vendeur | inchangé |

## 4. Libellé « Dashboard IA » sur les pages anglophones (P2)
Présent sur https://flowpoint.pro/pricing. Remplacer par « AI dashboard ».

## 5. Mesure : consentement et identifiant visiteur
L'application ne mesure **que** si le cookie `fp_analytics_consent=accepted` est présent. Le site vitrine doit le poser **après consentement explicite seulement**, de façon lisible par l'application :

```
fp_analytics_consent=accepted; Domain=.flowpoint.pro; Path=/; Max-Age=15552000; SameSite=Lax; Secure
```

Si le visiteur refuse ou n'a pas répondu : ne pas poser ce cookie, **ne pas** ajouter `fp_vid`, ne rien envoyer. Après consentement, générer un UUID v4, le conserver côté vitrine et l'ajouter en `fp_vid` aux liens vers l'application : l'application le reprend (un seul identifiant par visiteur, aucun double comptage).

Événements que le site vitrine peut envoyer (facultatif, après consentement) : `POST https://app.flowpoint.pro/api/public/funnel-event` (CORS : `https://flowpoint.pro` et `https://www.flowpoint.pro` sont autorisées avec `credentials: "include"`), corps JSON :

```json
{ "etape": "landing_vue", "visiteurId": "<uuid v4 consenti>", "source": "smartlead", "fp_lid": "<22 car. ou absent>", "utm_source": "…", "utm_medium": "…", "utm_campaign": "…" }
```
`etape` accepté : `landing_vue`, `tarifs_vus`, `cta_clique`, `signup_started`, `signup_form_engaged` (les autres sont refusées). Doublons impossibles : un même visiteur n'est compté qu'une fois par étape et par jour. Ne **pas** envoyer `tarifs_vus` depuis le vitrine **et** compter deux fois : l'application en émet un pour sa propre page tarifs, et le serveur dédoublonne par visiteur, étape et jour.

## 6. HEAD renvoie 404 (P2)
`HEAD https://flowpoint.pro/` et `/pricing` renvoient 404 (`content-type: application/json`, 23 octets) alors que `GET` renvoie 200. Le serveur doit répondre à HEAD comme à GET (corps omis). Impact : moniteurs d'uptime, crawlers, aperçus de liens. **Vérification :** `curl -sI https://flowpoint.pro/ | head -1` doit afficher `200`.

## Checklist de vérification en ligne (à exécuter après publication)
1. `curl -s https://flowpoint.pro/pricing | grep -c "charged automatically"` ≥ 1 ; `grep -c "choose the plan that fits"` = 0.
2. `curl -s https://flowpoint.pro/pricing | grep -o 'signin.html?plan=[a-z]*' | sort -u` liste `plan=standard`, `plan=pro`, `plan=ultra`.
3. `curl -s https://flowpoint.pro/pricing | grep -c "Dashboard IA"` = 0.
4. `curl -sI https://flowpoint.pro/ | head -1` → 200.
5. Depuis un navigateur : accepter le consentement, cliquer « Pro » → arrivée sur l'application avec le plan Pro présélectionné.
