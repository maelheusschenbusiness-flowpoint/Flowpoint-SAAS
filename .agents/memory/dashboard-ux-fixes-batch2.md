---
name: Dashboard UX batch 2 — 8 iOS issues
description: Patterns découverts en fixant les 8 bugs iOS du 2026-08-17
---

# Seat cap pattern (bug C)
**Rule:** `STATE.seatUsage.limit` retourné par `/api/team` peut être 1 si `organizations.plan` est en retard sur l'abonnement Stripe. Toujours utiliser `Math.max(seatUsage.limit, me.limits.teamMembers, LOCAL_PLAN_CAP[billing.plan])`.
**Why:** Le webhook Stripe peut échouer silencieusement à mettre à jour `organizations.plan` alors que `STATE.billing.plan` reflète le bon plan Stripe.
**How to apply:** `const _SC={standard:1,pro:5,ultra:10,agency:10}; const _ap=(STATE.billing?.plan||me?.plan||'standard').toLowerCase();` puis Math.max sur les 3 sources.

# AI textarea width
**Rule:** L'auto-resize oninput fait grossir la textarea horizontalement sur iOS Safari quand `overflow-y:hidden` + scroll-width > parent. Fix: hauteur fixe (`height:38px;max-height:38px;overflow-y:auto`) sans oninput.

# SSO Providers — always "Bientôt disponible"
**Rule:** Tous les providers SSO sont en roadmap. Le rendu doit toujours afficher `Bientôt disponible` sans jamais afficher "Configurer" ni "Plan requis". Passer par une liste statique fusionnée avec `catalog` via `.filter(dedup)`.

# Add-on redirect → checkout.html
**Rule:** `fpActivateAddon` doit rediriger vers `/checkout.html?from=dashboard&addon=...` (pas `pricing.html`). `pricing.html` a un gate "plan requis" qui bloque les users déjà abonnés.
**Note:** `fpBuyAICredits` reste sur `pricing.html` car son flow fonctionne correctement.

# Payment methods — subscription PM fallback
**Rule:** En Stripe Checkout, le PM est sur `subscription.default_payment_method`, pas nécessairement dans `paymentMethods.list({customer})`. Le endpoint `/billing/payment-methods` doit récupérer `subscriptions.list({customer, limit:1})` et merger le PM si absent du map.

# Google Maps mobile overflow
**Rule:** `gestureHandling:'greedy'` est nécessaire sur mobile pour que le pinch-to-zoom contrôle la carte et non la page. `'cooperative'` (défaut) cause un débordement fullscreen sur iOS Safari.

# fpT() scope en workspace presets
**Rule:** Les labels d'objets JS (arrays de préférences) doivent appeler `fpT()` au moment de la construction du tableau, pas lors du rendu. `{label:fpT('Niveau sécurité')}` dans l'array literal, et retirer `escHtml()` autour de `g.label` puisque fpT() retourne une string déjà safe.
