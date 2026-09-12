---
name: me.ts addons & limits fix — 2026-08-15
description: Three billing bugs fixed in me.ts and team.ts; patterns to maintain when editing addon or limits logic
---

## The bugs (all fixed 2026-08-15)

### Bug 1 — team.ts extraSeats UUID cast
`getOrgSeatLimit` subquery: `org_addons.org_id = $1` fails silently because `org_addons.org_id` is type **uuid** and `$1` is text.
Fix: `org_id = $1::uuid`.

### Bug 2 — me.ts PLAN_INCLUDED_ADDONS not merged
`/api/me.addons` only read from `org_addons` table. Plan-included addons (e.g. `whiteLabel` for Standard) were never injected.
Fix: after building `_mergedAddons` from `org_addons`, loop over `PLAN_INCLUDED_ADDONS[plan]` and set missing keys to `true`.

### Bug 3 — me.ts limits not expanded by qty packs
`const limits = PLAN_LIMITS[plan]` — a readonly object, never updated by `org_addons`.  
Fix: spread to a mutable copy `const limits: Record<string,number> = { ...PLAN_LIMITS[plan] }`, then for each active qty addon row apply `limits[grant.resource] += packs * grant.perPack`.

## Patterns to maintain

- `org_addons.org_id` is UUID — every subquery or JOIN must cast the text orgId parameter: `org_id = $1::uuid`.
- Qty addons (extraSeats, monitorsPack10, etc.) return their **pack count** (number) in `addons`, not `true`.
- `PLAN_INCLUDED_ADDONS` is the single source of truth for bundled addons — any consumer building an addons object MUST merge it.
- `QTY_ADDON_GRANTS` is the single source of truth for resource+perPack values — limits expansion must import from there, not hardcode.

**Why:** silent type mismatch in PostgreSQL text/uuid comparison returns 0 rows with no error; qty/flag duality means callers must check `v > 0 || v === true` not just `=== true`.
