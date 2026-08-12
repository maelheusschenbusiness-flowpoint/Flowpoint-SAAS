---
name: Stripe dahlia current_period_end relocation
description: API version 2026-04-22.dahlia removed current_period_end from the subscription object; it lives on each subscription item. Also schedule phase-0 start_date rule and error-toast precedence.
---

# Stripe 2026-04-22.dahlia — current_period_end moved to items

**Rule:** Under apiVersion `2026-04-22.dahlia`, `subscription.current_period_end` is `undefined`. The value lives on each subscription item (`sub.items.data[i].current_period_end`). Resolve it as: top-level → max(item-level) → `trial_end` → null.

**Why:** Passing the undefined top-level field as a schedule phase `end_date` makes Stripe reject with "Phase 0 is invalid…", which surfaced to users as a generic plan-change failure.

**How to apply:** Any code reading a subscription's period end (downgrade schedules, next-billing dates, cancel dates) must use the shared resolution helper, never the raw top-level field.

# Subscription schedule phase-0 start_date

**Rule:** After `subscriptionSchedules.create({ from_subscription })`, never pass `start_date: "now"` when updating phases — Stripe rejects with "You can not modify the start date of the current phase." Reuse the created schedule's existing `phases[0].start_date`.

# Error body precedence in frontend fetch wrappers

**Rule:** When an API error body has both a machine token in `error` (e.g. `plan_already_active`) and French prose in `message`, the user-facing toast must prefer `message`; keep the token on `err.code` for programmatic branching. Never show a snake_case token to the user — substitute a localized fallback.

**Why:** Non-2xx responses throw before response-shape checks run, so a token-first `Error(detail.error)` leaked raw tokens into toasts.
