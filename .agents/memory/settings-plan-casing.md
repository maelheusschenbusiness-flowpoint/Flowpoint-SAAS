---
name: Settings page plan casing and real data fixes
description: Plan variable casing bug (DB stores lowercase, UI compared capitalized), security fake vuln fix, team member id fix — all in Settings sub-tabs
---

## The Plan Casing Bug

Billing stores plan as lowercase ('pro', 'standard', 'ultra') via `.toLowerCase()` in Stripe webhook.
`me.ts` was returning `dbData.plan` raw → STATE.me.plan = 'pro', breaking all `plan === 'Pro'` comparisons.

**Fix applied**: `me.ts` GET + PATCH responses now normalize plan to Title Case:
```ts
plan: dbData.plan ? dbData.plan.charAt(0).toUpperCase() + dbData.plan.slice(1).toLowerCase() : 'Standard'
```
This is done in 3 places: dbData response, store.me fallback response, PATCH response.

**Why**: Every renderer (renderSettings, renderBilling, renderReports, renderLocalSEO, etc.) uses `plan === 'Standard'` etc. Fixing at the API layer fixes everything at once.

## renderSettings planLc pattern

`renderSettings` was additionally changed to use `planLc = plan.toLowerCase()` for all boolean flags, as a defense-in-depth approach that works regardless of casing.

## Security section — no fake CSP/CORS

The non-PREVIEW_MODE fallback for `secItems` previously showed fabricated CSP/CORS vulnerabilities.
**Fix**: non-preview fallback now uses only facts: password (always true), 2FA from `STATE.me?.twoFactorEnabled`, HTTPS session (always true), API keys (always true).

## Team member id field

The `.map(t => ({...}))` in the 'team' sub-route was missing `id: String(t.id || t._id || '')`.
Without it, `m.id` in PATCH `/api/team/${m.id}` rendered as `undefined` → 404.

## Role normalization

- `PATCH /api/team/:id` now sends `role: el.value.toLowerCase()`  
- `POST /api/team/invite` in team.ts now stores `(role || "viewer").toLowerCase()`  
- Invite button in dashboard.js sends `.toLowerCase()` role

## displayStat fabricated values gated

`displayStat(null, 'hardcoded')` was showing fallback values even in production.
Pattern fix: `displayStat(null, PREVIEW_MODE ? 'hardcoded' : '—')`
Applied to: AI precision (87%), data backup date (01/05/2026), automations time saved (~6h/mois).

**How to apply**: Any `displayStat(null, literal)` where the literal is fabricated must gate the fallback behind PREVIEW_MODE.
