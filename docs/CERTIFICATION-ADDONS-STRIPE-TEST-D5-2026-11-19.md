# Certification D5 add-ons Stripe TEST apres PR #514 (19-20 novembre 2026)

Cible : `https://flowpoint-test.onrender.com`, deploiement `dep-dbvm18t9el5s73esens0` (commit `88aba252`, PR #514), live 2026-11-19T20:53:42Z. Stripe : `acct_1StVIr9eqtbj6iPB`, `livemode:false` partout. Base de test Supabase `rrjllaiodpvtsphrtdqd` en lecture seule. Production, LIVE et Flowpoint non touches. Aucun secret affiche.

Methode (identique au rejeu #511) : 4 organisations jetables fraiches creees par le vrai parcours d'inscription navigateur (carte 4242, essai 14 j, `20-addons-a-comptes.stripe.ts`, CERT_A_COMPTES=oct:pro,tsf:standard,sci:pro,coe:pro) ; session par jeton magic-link lu en base puis `POST /api/auth/login-verify` (en-tete Origin de la beta) ; achat par `POST /api/addons/:key/activate` ; Stripe via connecteur MCP.

## Verdict
| Scenario | Add-on | Verdict |
|---|---|---|
| 1 (D5) | organicCampaignTracker / Pro | **REUSSI** |
| 1 (D5) | technicalSeoFixVerification / Standard | **REUSSI** |
| 1 (D5) | seoChangeImpact / Pro | **REUSSI** |
| 1 (D5) | conversionOpportunityEngine / Pro | **REUSSI** |
| 2 | technicalSeoFixVerification : succes fonctionnel complet | **REUSSI** (200, GET, 402 sans add-on) |

D5 est corrige : `subscription_status` reste `trialing` apres l'invoice payee de l'add-on ; `trial_ends_at`, `current_period_end`, `stripe_subscription_id` et `updated_at` de l'organisation sont inchanges.

## Scenario 1 - organisations et etat AVANT achat (21:00-21:01Z, 19 nov)
| Etiquette | Org | Client | Abonnement plan | subscription_status | trial_ends_at = current_period_end | Stripe plan |
|---|---|---|---|---|---|---|
| oct (Pro) | `bef5c1e6-27ef-4545-a20d-e5004ee5baa5` | `cus_VewKbLXTqJ2huk` | `sub_1UdcRO9eqtbj6iPBZWg60XXi` | trialing | 2026-12-03 21:00:14+00 | trialing, trial_end 1796331614 (2026-12-03T21:00:14Z) |
| tsf (Standard) | `a17cf057-3bd4-4ad0-a857-0fa8aa0d01fc` | `cus_VewKXUSy81Dago` | `sub_1UdcRi9eqtbj6iPBPXievzV2` | trialing | 2026-12-03 21:00:34+00 | trialing, trial_end 1796331634 |
| sci (Pro) | `bf79650c-79ee-4978-864a-f4e46218df49` | `cus_VewKYqPbPUjuG2` | `sub_1UdcS49eqtbj6iPBTGGWhUwP` | trialing | 2026-12-03 21:00:56+00 | trialing, trial_end 1796331656 |
| coe (Pro) | `17d6051f-5a88-4495-9114-c5849af555fd` | `cus_VewLsxVyhBbsmJ` | `sub_1UdcSR9eqtbj6iPBNweuzT09` | trialing | 2026-12-03 21:01:19+00 | trialing, trial_end 1796331679 |

Avant achat : GET de la fonction -> 402 `ADDON_REQUIRED` sur les 4 add-ons (21:27:43Z).

## Scenario 1 - achat, webhooks, droits (3 `POST /activate` simultanes par add-on, 21:27:46-21:28:10Z)
| | oct | tsf | sci | coe |
|---|---|---|---|---|
| Reponses des 3 appels | 200 x3 : 1 `item_added` + 2 `already_on_subscription` | idem | idem | idem |
| Abonnement add-on (un seul, Stripe) | `sub_1Udcry9eqtbj6iPB4u9BGiFg` active 1200 EUR, `metadata.addonSub=true` | `sub_1Udcs69eqtbj6iPBeWsNDh34` active 1900 | `sub_1UdcsE9eqtbj6iPBvCpX2b23` active 1500 | `sub_1UdcsM9eqtbj6iPBgiovWzDD` active 1200 |
| Facture (billing_reason subscription_create) | `in_1Udcry9eqtbj6iPB68QIkeES` (25GAA0PF-0427) paid 1200 | `in_1Udcs69eqtbj6iPBT8w2BrW6` paid | `in_1UdcsE9eqtbj6iPBHzhs4Z18` paid | `in_1UdcsN9eqtbj6iPBenYOK4rG` paid |
| billing_events (21:27-21:28Z) | subscription.created, payment_intent.succeeded, invoice.payment_succeeded 21:27:53 | 21:28:01 | 21:28:09-10 | 21:28:17 |
| subscription_status apres | **trialing** (inchange) | **trialing** | **trialing** | **trialing** |
| trial_ends_at / current_period_end / stripe_subscription_id / updated_at | inchanges (updated_at 2026-11-19 21:00:27) | inchanges (21:00:48) | inchanges (21:01:11) | inchanges (21:01:33) |
| Stripe plan apres | trialing, trial_end inchange | idem | idem | idem |
| org_addons.active | true (activated 21:27:54) | true (21:28:02) | true (21:28:11) | true (21:28:19) |
| GET fonction | 200 `{ok:true,campaigns:[]}` | 200 | 200 | 200 |

Journaux Render (21:27:53-21:28:02Z) : `[Webhook] Received Stripe event`, `orgId resolved`, `[Webhook][plan-sync] customer.subscription event received`, `[Webhook] abonnement d'add-on : etat de l'abonnement principal inchange`, `invoice.payment_succeeded: subscription_create - activation email already sent, skipping duplicate`, `Add-on/AI credit payment excluded from seller ledger`, `Event status persisted`.

## Scenario 1 - annulation cote Stripe de l'abonnement d'add-on (2026-11-20 22:22:31-22:22:40Z)
| | oct | tsf | sci | coe |
|---|---|---|---|---|
| Annulation Stripe | `sub_1Udcry...` canceled 22:22:31 | `sub_1Udcs6...` 22:22:34 | `sub_1UdcsE...` 22:22:37 | `sub_1UdcsM...` 22:22:40 |
| `customer.subscription.deleted` traite (billing_events) | 22:22:33 | 22:22:35 | 22:22:38 | 22:22:41 |
| org_addons.active | false (22:22:34) | false (22:22:36) | false (22:22:38) | false (22:22:41) |
| GET fonction | 402 | 402 | 402 | 402 |
| Abonnement principal | trialing, inchange (verifie en base apres annulation) | idem | idem | idem |

## Scenario 2 - Technical SEO Fix Verification, succes complet (org tsf, Standard, add-on actif)
Les audits sont crees par l'API du produit, sans aucune insertion en base, aucun quota ni fonctionnalite bloquants sur Standard :
1. `POST /api/audits {url:"https://flowpoint-test.onrender.com"}` -> 201 `a17952132538536cu` ; termine `ok` score 86, 14 problemes (created_at 2026-11-20T22:20:51.850Z).
2. `POST /api/audits {…, force:true}` -> 201 `a1795213281087rqy` ; `ok` score 86, 14 problemes (22:21:19.987Z). Note : sans `force:true`, le 2e audit de la meme URL le meme jour est refuse (409 `DUPLICATE_AUDIT`, garde de `routes/audits.ts`).
3. `POST /api/technical-seo-fix-verification/verify {beforeAuditId:a17952132538536cu, afterAuditId:a1795213281087rqy}` -> **200** `{ok:true,metric:"aggregate_audit_issue_count",result:{status:"still_present",beforeIssueCount:14,afterIssueCount:14,evidence:"two_distinct_audits"}}` (22:21:43Z).
4. `GET /api/technical-seo-fix-verification` -> 200, `verifications:[{id:"59124f60-7e0a-4062-9df3-e505c293b445",url,before_audit_id,after_audit_id,before_issue_count:14,after_issue_count:14,status:"still_present"}]`.
5. Sans add-on (apres annulation Stripe) : GET et POST verify -> 402 `ADDON_REQUIRED`.

## Observations (non bloquantes, aucun correctif applique)
- Le journal `[Webhook] invoice.payment_succeeded: €0 invoice - subscription status left to customer.subscription.* events` est emis pour une facture d'add-on payee 1200 EUR : libelle trompeur (la branche add-on de #514 reutilise ce message) ; le comportement (statut inchange) est correct.
- `billing_events.amount` vaut 0 pour `invoice.payment_succeeded` d'add-on (1200-1900 centimes payes), inchange depuis le rejeu #511.
- Le meme jour, les `POST /activate` repetes restent idempotents (`already_on_subscription`).

## Nettoyage (Stripe TEST, livemode false)
Abonnements annules (`canceled`, 8) : add-ons `sub_1Udcry9eqtbj6iPB4u9BGiFg`, `sub_1Udcs69eqtbj6iPBeWsNDh34`, `sub_1UdcsE9eqtbj6iPBvCpX2b23`, `sub_1UdcsM9eqtbj6iPBgiovWzDD` ; plans `sub_1UdcRO9eqtbj6iPBZWg60XXi`, `sub_1UdcRi9eqtbj6iPBPXievzV2`, `sub_1UdcS49eqtbj6iPBTGGWhUwP`, `sub_1UdcSR9eqtbj6iPBNweuzT09` (22:24-22:26Z). Clients TEST non supprimables par le connecteur : `cus_VewKbLXTqJ2huk`, `cus_VewKXUSy81Dago`, `cus_VewKYqPbPUjuG2`, `cus_VewLsxVyhBbsmJ`. Factures payees TEST non remboursees : 12 + 19 + 15 + 12 EUR (add-ons). Base de test : organisations, 2 audits et 1 verification jetables conserves.
