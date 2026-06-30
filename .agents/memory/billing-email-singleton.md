---
name: Billing store.me singleton email bug
description: stripe.customers.create() must read email from req.orgContext, not the store singleton
---

**Rule:** In billing.ts (and any route that calls stripe.customers.create), always use `req.orgContext?.email` as the primary email source, not `store.me.email`.

**Why:** `store` (services/store.ts) is a process-wide singleton. Its `me.email` field comes from `org_settings.email` in the DB, which is never populated during the Google OAuth / registration flow. Every single Stripe customer in history (June 21 – June 30, 2026) shows `email=None` as proof. The per-request session context (`req.orgContext`) is populated correctly by `orgContext.ts` from the verified session object, which does carry the user's email.

**How to apply:**
- `email: req.orgContext?.email || store.me.email || undefined`
- `name: store.me.firstName || req.orgContext?.email || store.me.email || store.me.org?.name || "FlowPoint User"`
- `metadata.orgId: req.orgId ?? store.me.org?.id ?? "default"`
- `metadata.userId: req.userId ?? store.me.id ?? "unknown"`

**Files affected:** `artifacts/api-server/src/routes/billing.ts` — 5 occurrences of `stripe.customers.create()` at lines 80, 137, 276, 539, 658 (post-fix).
