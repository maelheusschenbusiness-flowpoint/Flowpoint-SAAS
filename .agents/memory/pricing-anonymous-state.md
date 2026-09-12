---
name: Pricing anonymous billing state & visitor cart
description: How pricing.html must handle stale local billing caches for logged-out visitors and persist visitor carts
---

# Pricing anonymous billing state & visitor cart

**Rule 1 — cached billing render is gated AND reversible.** The `fp_dashboard_state` anti-flash render may only run when a session token exists, and a 401 from `/api/billing/subscription` must (a) remove `fp_dashboard_state`, (b) null `window._fpBillingState`, and (c) call `resetBillingUIToAnonymous()` if the cached render already mutated the DOM. Token *presence* is not authentication — a stale token renders the previous account's "✓ Votre plan actuel"/"✓ Actif" markers, and only the explicit DOM reset removes them.

**Rule 2 — visitor carts persist, dashboard carts don't leak.** Every `fp_cart` save stamps `_v:1` and `_updatedAt`. On pricing load without `?from=dashboard`, a cart is kept and its selections re-clicked (`restoreCartSelections()`) only if it has no `fromDashboard` flag, no `_orgId`, and is <1h old; otherwise it is wiped. Dashboard-scoped carts are restored only on the explicit `from=dashboard` path (which also adds the back button via `applyCart`).

**Why:** visitors previously saw plans/add-ons marked active from another session's localStorage, and their selections were wiped on every refresh before checkout.

**How to apply:** any new surface reading `fp_dashboard_state` or `fp_cart` must respect the same gates; cart visuals always win over billing-state resets (precedence rule 2 in `applyBillingState`).

Related: after checkout, dashboard cache-bust triggers on `plan_changed`, `checkout=success`, `plan_activated`, `addon_success` — every checkout-return redirect must carry one of these or the dashboard shows stale plan/quotas.
