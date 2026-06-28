---
name: FlowPoint API audit results
description: Complete results of production-readiness 8-bloc validation (28/06/2026) + route map
---

## Final State (28/06/2026) — Bêta privée validée
- **18/18 dashboard endpoints** — 200 OK, zéro donnée fake
- **10/10 CRUD entities** — audit, monitor, mission, keyword, competitor, report, calendar, alert-rule, team, notifications
- **155/155 tables RLS** — couverture complète
- **0 erreurs 500 / 0 stack traces / 0 secrets leakés**

## Bugs corrigés (28/06/2026)
1. `GET /api/audits/:id` → route manquante → ajoutée dans `audits.ts`
2. `POST /api/auth/magic-link` → 401 → alias 307 → `/api/auth/login-request`
3. `POST /api/billing/checkout-embedded` → `planId` ignoré → accepte `plan` OU `planId`; fallback redirect si embedded Stripe échoue
4. `POST /api/billing/cancel` → 404 → route ajoutée dans `billing.ts`
5. `POST /api/billing/upgrade` → 404 → route ajoutée dans `billing.ts`
6. `GET /api/health` → 401 → alias public ajouté dans `health.ts`

## Routes clés (paths confirmés)
- Magic link: `POST /api/auth/login-request` (alias: `/api/auth/magic-link` → 307)
- Health: `GET /api/health` ou `/api/healthz` (public, avant requireAuth)
- Google OAuth URL: `GET /api/google/connect`
- Google status: `GET /api/google/status`
- Stripe checkout: `POST /api/billing/checkout` (param: `plan`, pas `planId`)
- Stripe embedded: `POST /api/billing/checkout-embedded` (accepte `plan` ou `planId`, fallback redirect)
- Stripe AI credits: `POST /api/billing/checkout-ai-credits` (packs: `ai_credits_50k/200k/500k`)
- Stripe webhook: `POST /api/billing/webhook` (vérifie sig Stripe → 400 si invalide ✅)
- Stripe cancel: `POST /api/billing/cancel` (ajouté 28/06)
- Stripe upgrade: `POST /api/billing/upgrade` (ajouté 28/06)
- Audit by ID: `GET /api/audits/:id` (ajouté 28/06)

## Endpoint path corrections (toujours valides)
- `/api/team` (pas `/api/team/members`)
- `/api/calendar-events` (pas `/api/calendar/events`)
- `/api/automation/workflows` (pas `/api/automations`)
- `/api/seo/llm-visibility` (pas `/api/llm-visibility`)
- `/api/billing/checkout-ai-credits` (pas `/api/ai-credits/checkout`)
- Settings → localStorage only, aucun endpoint API

## Résultats par bloc (bêta privée)
- AUTH ✅ — signup, login-request, magic-link alias, logout, session expiry, 401 sans token
- DASHBOARD ✅ — 18/18 → 200 OK, zéro donnée fake
- CRUD ✅ — 10 entités create/update/delete toutes OK
- STRIPE ✅ — plans, config, checkout, embedded+fallback, annual, AI credits, portal, cancel, upgrade, webhook
- GOOGLE ✅ — OAuth URL valide (accounts.google.com avec scope+state), not-connected propre, zéro fake
- RESEND ✅ — API up (HTTP 200 confirmé via /healthz/deep), 11 types câblés dans mailer.ts
- SECURITY ✅ — 401 sans token, org isolation parfaite, admin key protégé, SQL injection géré, headers HSTS/X-Frame/nosniff
- LOGS ✅ — 0 erreur 500, 0 stack trace, 0 secret leaké

## Risques résiduels (mineurs, non bloquants)
- checkout-embedded tombe en fallback redirect (UI mode embedded non activé sur compte Stripe live)
- Rate limiting auth 10 req/15min — acceptable bêta privée
- cancel retourne `mock:true` si pas de sub Stripe active en dev (comportement attendu)

**Why:** Production readiness validation cycle completed 28/06/2026.
