---
name: Lot 398 fix patterns
description: Durable rules from the activités/usage/spinner/plans/add-ons fix batch
---

- Activity feed avatars: `getInitials()` returns `'?'` when no userName — never render it raw; fall back to a type-relevant `svgIcon` (map audit→check, monitor→wifi, alert→alert, report→file, team→users, settings→settings, mission→target, export→download) with `clock` as final fallback.
- Sidebar usage bars and Facturation > Usage must share one canonical source: `/api/billing/usage-details` (`STATE.usageDetails`), falling back to `/api/me` counters only before it loads.
- AI chat 503s must be differentiated by `err.code` (`PROVIDER_UNAVAILABLE` vs `QUOTA_STATE_UNAVAILABLE`) — never a blanket "service non configuré" message; all three providers (openai/anthropic/gemini) are configured and work when called with strictProvider.
- `fpGoToPricing()` must keep subscribed users (subscriptionStatus active/trialing/past_due) inside the dashboard via `fpGoToBillingPlans()`; only non-subscribers go to pricing.html.
- Initial page spinner lives in dashboard.html before any JS (`#fp-initial-spinner` with inline keyframes + 12s inline safety timeout) and is removed at the end of `_doRender()`.
- `/api/addons` GET: `org_addons` is source of truth; legacy `org_settings.addons` JSON only fills gaps (`{...legacy, ...orgAddons}`). Frontend activate/deactivate must reload `/api/addons` after success and toast on `{ok:false}`.
- `workflow_runs` inserts must set the real `org_id` (drizzle default is 'default'); run-route failures after the enabled-check are 500 execution errors, not 409 "indisponible".
- QA sessions: `user_sessions.role='owner'` is required for ownerOnly routes; workflow create requires `triggerType`.
