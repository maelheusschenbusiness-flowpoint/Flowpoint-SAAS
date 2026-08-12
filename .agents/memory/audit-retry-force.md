---
name: Audit retry force parameter
description: POST /api/audits accepts force:true to bypass the 409 DUPLICATE_AUDIT same-day guard when explicitly retrying
---

# Audit retry force parameter

**Rule:** Retry buttons (single audit panel + bulk relaunch) must pass `{ url, force: true }` to bypass the same-day duplicate guard.

**Why:** POST /api/audits has a guard `SELECT ... WHERE created_at >= date_trunc('day', now())` that returns 409 DUPLICATE_AUDIT. Without `force:true`, clicking "Relancer" on an audit that already ran today always fails silently. The UI catches the error and increments `fail++` with no helpful message.

**How to apply:**
- Server: `audits.ts` destructures `force?: boolean` from body; duplicate guard is wrapped in `if (!force) { ... }`
- Client single retry: `apiAction('POST', '/api/audits', { url: audit.url, force: true })` at `bindAuditPanelBtns`
- Client bulk retry: same pattern inside the `Promise.allSettled` map in the bulk-rerun handler
