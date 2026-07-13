---
name: Multi-tenant org isolation pattern
description: How FlowPoint prevents org "default" data leakage; global middleware + per-route helper
---

## Rule
Two-layer defence: global middleware in routes/index.ts + requireOrgId() helper in individual route handlers.

**Layer 1 — global middleware** (routes/index.ts, immediately after `router.use(requireAuth)`):
- Checks `req.orgContext?.orgId` is non-null and non-"default"
- Returns 401 if invalid
- Dev bypass when `API_SECRET_KEY` is unset (matches existing requireAuth behaviour)

**Layer 2 — per-route helper** (lib/require-org-id.ts):
- `requireOrgId(req, res): string | null`
- Route handler: `const orgId = requireOrgId(req, res); if (!orgId) return;`
- Used explicitly in me.ts, audits.ts, monitors.ts

**Why:**
Service token (`API_SECRET_KEY`) passes requireAuth but gets `orgId: "default"` from orgContext.ts.
Without this guard, any internal script using the service key accessed org "default" data
(which includes seed/mock data visible to all unauthenticated sessions).

**How to apply:**
Any new authenticated route must use `requireOrgId()`. DB-row orgId (e.g. from monitor rows in cron)
should be guarded with a skip/500 rather than requireOrgId (it's a data-integrity issue, not auth).

~15 other route files still have `?? "default"` patterns but are covered by the global middleware.
