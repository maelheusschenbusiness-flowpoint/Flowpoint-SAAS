---
name: FlowPoint mailer service
description: Centralized Resend email service — 11 types, all triggers, error handling pattern
---

# FlowPoint mailer service

## The rule
All transactional emails go through `artifacts/api-server/src/services/mailer.ts`.
Never instantiate Resend directly in route handlers (except auth.ts magic link, which predates the mailer).

## Email types + triggers wired
| Type | Trigger location |
|---|---|
| sendWelcome | auth.ts POST /auth/signup (success, fire-and-forget) |
| sendTrialStarted | auth.ts POST /auth/signup (success, fire-and-forget) |
| sendTrialEnding | mailer.ts implemented — no cron yet (P2) |
| sendPaymentSucceeded | stripe-webhook.ts invoice.payment_succeeded |
| sendPaymentFailed | stripe-webhook.ts invoice.payment_failed |
| sendMonitorDown | monitors.ts saveCheckResult UP→DOWN transition |
| sendMonitorUp | monitors.ts saveCheckResult DOWN→UP transition |
| sendReportGenerated | reports.ts POST /reports (after res.json) |
| sendTeamInvitation | team.ts POST /team/invite (after res.json) |
| sendNewMissions | missions.ts POST /missions/generate (after res.json) |
| sendSeoAlert | monitor-cron.ts evaluateAlertRulesForAudit (triggered) |

## How to apply
- All sends are fire-and-forget after `res.json(...)` using `.catch(() => {})`.
- Return type is `{ ok: boolean; id?: string; error?: string }` — never throws.
- RESEND_API_KEY missing → returns `{ ok: false, error: "RESEND_API_KEY_MISSING" }` and logs warn.
- FROM_EMAIL env var → custom sender; fallback to `onboarding@resend.dev`.

**Why:** Centralizing avoids duplicate Resend client instantiation, ensures consistent HTML branding, and makes it easy to add retry logic or email queue later without touching route handlers.
