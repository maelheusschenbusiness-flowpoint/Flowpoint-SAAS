---
name: Missions fast-path schema gap
description: initMissionsTables was absent from the Render fast-path startup; columns added after the initial Pre-Deploy were missing in production, causing 500s on GET /missions/:id and write routes.
---

## Rule
`initMissionsTables` must run on **every boot** (fast-path AND full-init path) in `index.ts`.

Every `init-*.ts` service that self-heals with `ALTER TABLE … ADD COLUMN IF NOT EXISTS` should follow the same pattern.

## Why
On Render, the fast-path (`[startup] Schema already migrated — skipping full init`) skips all `runCriticalStartupStep` calls that are only in the `else` branch. `initMissionsTables` was only in the full-init `else` branch. Any column added to the CREATE TABLE after the initial Pre-Deploy was never applied to the existing production table.

The resulting `column does not exist` errors were:
- Caught → 200 `[]` on GET /missions (safe catch)
- **Returned as 500** on GET /missions/:id (catch block does `res.status(500)`)
- Returned as 500 on POST /missions (catch block does `res.status(500)`)

## How to apply
When adding a new init service or new columns to an existing one:
1. Add the function to the **fast-path block** in `index.ts` with `.catch(warn)` (non-fatal).
2. Add every new column as `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in the init function — even columns that are in CREATE TABLE. This handles instances where the table predates the column.
