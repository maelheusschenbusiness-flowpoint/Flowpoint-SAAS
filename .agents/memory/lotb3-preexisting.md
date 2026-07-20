---
name: Lot B3 pre-existing failures
description: 12 failures in qa_lot_b3.mjs that are environment-dependent, not caused by RBAC/A2 changes
---

## Pre-existing failures (not caused by Wave 3 A2 changes)

### Uptime pipeline — 10 failures
Tests require a monitor with uptime < 50%. In the Replit test environment, all monitored URLs respond normally, so uptime is always 100%. The threshold of 50 never triggers. These tests are environment-dependent and cannot pass without a real failing endpoint.

**Pattern:** POST /monitors → POST /alert-rules (uptime, threshold=50) → POST /monitors/:id/check → expect uptime < 50 → expect alert_event created. Fails at "Real uptime < 50 (rule triggers)".

### monitor_down resolved status — 2 failures
After PATCH /alert-events/:id/resolve (which returns 200 OK ✅), the test checks:
- `monitor_down status=resolved`
- `monitor_down resolved_at set`

GET /alert-events filters out resolved events from the default list. The test queries the list and looks for the event by ID, but it's no longer there. The PATCH itself works correctly.

**Fix if needed:** GET /alert-events should accept `?includeResolved=true` param, or test should call GET /alert-events/:id directly.

## Confirmed not caused by A2 changes
- PATCH /alert-events/:id/resolve: requires canWrite (owner token) — PASS ✅
- POST /alert-events: now uses apiSvc() with service credential — both PASS ✅
- The latency pipeline (15 tests) all PASS in B3
