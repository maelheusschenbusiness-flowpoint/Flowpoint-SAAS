---
name: Lot B QA isolation pattern
description: Seat saturation and org_id mismatch bugs in multi-group QA suites
---

## Rule
Each QA group that accumulates members/invitations across the session must use its own
isolated org (G14_ORG, G15_ORG, etc.) to avoid hitting the ultra plan seat limit (10).

## Why
After ~8 groups, the main ORG accumulates: 1 owner + active members from accepts (G5) +
PATCH targets (G8) + owner-role test (G9) + E2E accept (G13) + GROUP 15 live member = 
hits the 10-seat ultra limit. Any invite attempt then fails with 402 SEAT_LIMIT_REACHED.

## Bug pattern — org_id mismatch
When copy-pasting an INSERT for a "duplicate constraint" test, the params array may still
reference `ORG` instead of the isolated `G15_ORG`:
  `[dupId, ORG, liveEmail]`   ← BAD: different org, no conflict
  `[dupId, G15_ORG, liveEmail]` ← CORRECT: same org, constraint fires

## Accept-invitation.html redirect
`acceptInvitation()` calls `setState('success')` then `setTimeout(redirect, 2000)`.
DOM state check after 3s will always see no state (page navigated away).
Fix: intercept the `/api/team/invitations/accept` network response instead of checking DOM.
