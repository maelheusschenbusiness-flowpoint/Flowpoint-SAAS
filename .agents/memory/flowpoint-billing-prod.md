---
name: FlowPoint billing production state
description: Stripe billing confirmed working in production — key facts about mock guards and price IDs
---

# FlowPoint billing production state

## The rule
`mock=true` NEVER appears in production. The guard is: if no Stripe key + NODE_ENV=production → 503 error. mock=true only returns in dev when key is missing.

## Key facts (confirmed 2026-06-28)
- `NODE_ENV=production` at runtime (confirmed via `printenv`)
- `STRIPE_LIVE_API_KEY` and `STRIPE_SECRET_KEY` both set in secrets
- GET /billing/subscription → `mock: false` confirmed
- POST /billing/checkout → real Stripe URL returned (no mock)
- All 3 plan price IDs hardcoded in `plans.ts` with `process.env["STRIPE_PRICE_ID_*"]` override
- Webhook: requires valid `stripe-signature` header in production (correct — rejects test calls)
- Embedded checkout: needs "Embedded Checkout" enabled in Stripe Dashboard (not activated yet)

## Correct AI credit pack names
`ai_credits_50k`, `ai_credits_200k`, `ai_credits_500k` (not `aiCreditsPack*`)

## Correct route paths
- Automation: `/api/automation/workflows` (not `/api/automations`)
- Calendar: `/api/calendar-events` (not `/api/calendar/events`)
- CRM: `/api/crm/status`, `/api/crm/providers` (not `/api/crm/contacts`)

**Why:** These are the runtime-confirmed paths. The route map in `flowpoint-api-routes.md` needs updating with these.
