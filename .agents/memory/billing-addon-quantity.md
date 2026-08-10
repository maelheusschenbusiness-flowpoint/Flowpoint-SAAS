---
name: Quantity add-on entitlements
description: pack counts are durable (org_addons.quantity) and expand quotas only via the canonical grants map in plans.ts
---

Rule: recurring quantity add-ons (monitor/audit/PDF/export/seat/GBP packs) store their pack count durably — one active row per (org, addon key), quantity updated in place, never duplicate rows. Quota expansion is derived exclusively from the canonical per-pack grants map in `lib/plans.ts` (`QTY_ADDON_GRANTS` + `computeQtyAddonExtras`); no billing surface may hardcode its own per-addon branch.

**Why:** entitlement was previously boolean-only and per-surface hardcoded: a customer paying Stripe quantity N was granted 1 pack, and monitor packs got quota expansion while audit/PDF/export packs silently got none — display, enforcement, and billing disagreed.

**How to apply:**
- The selected pack count must travel the whole chain: UI selector → activation/checkout request body → server-side clamp (only for quantity add-ons) → Stripe line-item/subscription-item quantity → durable persistence → every quota reader.
- Adding a new quantity pack = one entry in the grants map; all surfaces (limits, enforcement, usage display) pick it up automatically.
- Deactivation compensation must capture the prior quantity BEFORE revoking and restore that exact count on failure — never a default of 1.
