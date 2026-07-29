---
name: Billing/activity P1 fixes
description: Three security commits applied 2026-07-29 — store.me eliminated from billing, session revocation awaited, activity_logs org-scoped.
---

# Three P1 Commits Applied 2026-07-29

## Commit 1 — store.me elimination in billing

**Rule:** Billing functions must NEVER read from `store.me.*` — it is a process-wide singleton that contaminates cross-tenant requests.

**Files changed:**
- `services/billing-service.ts` — `getSubscriptionAnalytics`, `getMRRData`, `getUsageSummary`, `startTrial`, `hasFeature`, `trackBillingEvent` all now use `loadOrgData(orgId)` from DB
- `services/store.ts` — `broadcastPlanUpdate` no longer mutates `this.me.plan`; SSE broadcast preserved
- `routes/me.ts` — `PUT /api/me/addons` reads current addons via `loadOrgData(orgId)` not `store.me.addons`; `store` import removed

**Why:** `store.me.plan` is set by the last webhook/billing event. In a multi-tenant server, org A's plan update overwrites the singleton, then org B reads stale data.

## Commit 2 — Session revocation awaited

**Rule:** `invalidateAllSessions` in the DELETE /team/:id handler must be `await`-ed inside `try/catch`, never fire-and-forget.

**File:** `routes/team.ts`

**Why:** If revocation fails silently, the removed member retains a valid session token until it naturally expires. This is a security hole.

**Pattern:**
```typescript
try {
  await invalidateAllSessions(memberEmail);
} catch (err) {
  logger.error({ err, ... }, "[team/delete] SECURITY: session revocation failed ...");
}
```

## Commit 3 — activity_logs org_id isolation

**Rule:** All `logActivity()` calls must pass `orgId`. `getFilteredActivity()` must always WHERE-filter on `org_id`.

**Files changed:**
- `services/store.ts` — `ActivityLog.orgId` field added; `logActivity` INSERT now includes `org_id`; `getFilteredActivity` filters by `org_id` (always, not optional)
- `routes/activity.ts` — GET/POST extract orgId from req and pass it
- 9 caller files (audits, addons, reports, keywords, seo, automation, connectors, missions, monitors) — `orgId` added to each `logActivity({...})` call

**Why:** Without org_id in the WHERE clause, all orgs see each other's activity feed — a P1 cross-tenant leak.

## Certification tests
- `.local/qa_billing_store_me_cert.cjs` — 5/5 green
- `src/tests/session_revocation.test.ts` — 4/4 green (tsx)
- `.local/qa_activity_isolation_cert.cjs` — 6/6 green
