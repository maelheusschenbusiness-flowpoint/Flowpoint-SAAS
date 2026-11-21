# Convention des métadonnées Stripe — FlowPoint (21 novembre 2026)

Lecture du code (Test-Replit `88aba252`, Flowpoint `e25a0075`) et du catalogue Stripe TEST. Stripe LIVE n'est pas accessible depuis l'outil : la section « À poser manuellement en LIVE » donne les valeurs exactes.

## 1. Ce que le code lit réellement

| Où | Clé | Rôle | Obligatoire ? |
|---|---|---|---|
| Abonnement | `plan` (`standard`/`pro`/`ultra`) | plan de l'abonnement (`stripe-webhook.ts` `parsePlanFromSubscription`) | oui, posé par le serveur |
| Abonnement | `orgId` / `org_id` | organisation propriétaire | oui, posé par le serveur |
| Abonnement | `addonSub="true"` | abonnement dédié d'add-on (jamais le plan) | oui, posé par le serveur |
| Abonnement | `source` (`checkout_payment_addons`…) | origine du second abonnement du parcours public | oui, posé par le serveur |
| Abonnement / PaymentIntent | `addons` (JSON), `billing`, `type` (`ai_credits`), `pack`, `credits`, `amountEurCents` | panier et crédits IA ; `credits` n'est JAMAIS cru (le catalogue fait foi) | posé par le serveur |
| Abonnement / PaymentIntent | `seller_id`, `seller_attribution`, `reactivation` | attribution vendeur, réactivation | posé par le serveur |
| Ligne d'abonnement (item) | `addonKey` | repli d'identification d'un add-on si le `price_id` n'est pas connu (validé contre les add-ons connus) | repli |
| **Prix** | `plan` | repli d'identification du plan si le `price_id` est inconnu | repli |
| Produit / Prix d'add-on | aucune clé lue | l'add-on est identifié par son **identifiant de prix** (variables `STRIPE_PRICE_ID_*` LIVE, `STRIPE_TEST_PRICE_ID_ADDON_*` TEST) | non |

Aucune métadonnée liée à OpenAI n'est lue dans les flux Stripe : les crédits IA reposent sur `credits`/`pack`/`type` (informatifs) et sur le catalogue `AI_CREDIT_CATALOG` du code.

**Conclusion** : l'attribution des droits ne dépend d'AUCUNE métadonnée de produit ou de prix ; elle dépend de l'identifiant de prix posé dans l'environnement Render. Les métadonnées ci-dessous servent à l'audit, au rapprochement et au repli.

## 2. Convention retenue (produit ET prix)

| Clé | Valeur | Remarque |
|---|---|---|
| `addonKey` | clé exacte du catalogue (`organicCampaignTracker`…) | convention du code (item) et des produits `[CERT]` |
| `flowpoint_addon_key` | identique à `addonKey` | conservé (produits existants) |
| `flowpoint_kind` | `addon` / `plan` / `credit_pack` | |
| `flowpoint_catalog_version` | `1` (= `catalogVersion` de `/api/plans/catalog`) | |
| `flowpoint_environment` | `live` ou `test` | TEST existant : `render-test`/`test` conservés |
| `plan` (prix de plan) | `standard`/`pro`/`ultra` | seule clé lue par le code côté prix |
| `credits` (packs IA) | nombre | informatif uniquement |

Ne jamais mettre de secret, d'e-mail client ni d'identifiant d'organisation dans les métadonnées de produit/prix.

## 3. État Stripe TEST (appliqué le 21/11, sans changer aucun identifiant de prix)
Produits et prix mis à jour (fusion, aucune clé existante supprimée) : Organic Campaign Tracker, Technical SEO Fix Verification, Agency Portfolio Priorities, SEO Change Impact, Conversion Opportunity Engine, Local Landing Opportunities, Local Presence Optimizer, GBP Performance & Leads, Agency Reporting Packs (fixture `[TEST]`). Prix de plan : Standard, Pro, Ultra (`plan` + `flowpoint_kind=plan`).
Non modifiés : les 15 produits `[CERT]` (déjà `addonKey`, `cert=cert2026`, `credits` pour les packs IA).

## 4. À poser manuellement en LIVE (4 produits créés sans métadonnées)
Sur CHAQUE produit **et** son prix (Dashboard Stripe → Produit → Métadonnées ; Prix → Métadonnées), mode LIVE :

| Produit LIVE | `addonKey` | `flowpoint_addon_key` | `flowpoint_kind` | `flowpoint_catalog_version` | `flowpoint_environment` |
|---|---|---|---|---|---|
| Organic Campaign Tracker (12 €) | organicCampaignTracker | organicCampaignTracker | addon | 1 | live |
| Technical SEO Fix Verification (19 €) | technicalSeoFixVerification | technicalSeoFixVerification | addon | 1 | live |
| SEO Change Impact (15 €) | seoChangeImpact | seoChangeImpact | addon | 1 | live |
| Conversion Opportunity Engine (12 €) | conversionOpportunityEngine | conversionOpportunityEngine | addon | 1 | live |

Pour les anciens produits LIVE (plans, add-ons, crédits IA) : comparer leurs métadonnées existantes à ce tableau ; ne rien supprimer, ajouter seulement les clés manquantes. Rien n'est requis pour le fonctionnement : le code identifie les prix par leur identifiant.
