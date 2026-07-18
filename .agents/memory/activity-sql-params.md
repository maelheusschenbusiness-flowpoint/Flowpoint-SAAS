---
name: activity.ts parameterized SQL
description: GET /api/activity now supports limit/page/type via SQL; id in SELECT; backward compatible array response
---

# /api/activity — parameterized SQL (Wave 2 Lot A)

## Implemented params
| Param | Validation | Default | SQL mechanism |
|-------|-----------|---------|---------------|
| `limit` | 1–200 | 50 | `LIMIT $1` |
| `page` | ≥ 0 | 0 | `OFFSET $2` (= page × limit) |
| `type` | any string | — (all types) | `WHERE type = $3` |

## Backward compatibility
- Always returns a JSON **array** (never an object with pagination wrapper).
  Frontend bootstrap and 60s poll both check `Array.isArray(value)`.
- No params = same behaviour as before (50 items, all types).

## id field
- `id` is now included in the `SELECT` (`activity_logs.id`).
- The 60s activity poll uses `e.id || e.createdAt` for deduplication.
  Without `id`, two events at the same second were indistinguishable.

## Order
`ORDER BY created_at DESC, id DESC` — deterministic; no duplicates across pages.

## store.getRecentActivity
Kept as a deprecated wrapper around `getFilteredActivity({ limit, offset: 0 })`.
Only used internally; no external callers beyond activity.ts.
