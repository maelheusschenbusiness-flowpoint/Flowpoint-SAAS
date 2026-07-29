---
name: org_settings NOT NULL stripe columns
description: stripe_customer_id in org_settings has an implicit NOT NULL constraint; clearing requires '' not NULL
---

## Rule
When clearing `stripe_customer_id` in the `org_settings` table, write `''` (empty string) — never `NULL`.

The column was declared `TEXT` without `NOT NULL` in the ALTER TABLE migration, but the live DB has the constraint enforced (PostgreSQL error 23502 on `SET stripe_customer_id = NULL`).

## Why
The schema uses `NULLIF(stripe_customer_id, '')` at read-time (in the SELECT view / loadBillingContext) to normalize `''` → `NULL`. Writing `''` is therefore semantically correct — all readers treat it as "no customer".

## How to apply
- Any code that clears stripeCustomerId in `org_settings` must use `= ''`, not `= NULL`.
- `persistOrgData` / `upsertOrgSettings` use `val !== null` guard in their `textCols` loop and would skip a `null` value entirely (no update at all). Use raw SQL for explicit clears.
- The `organizations` table (UUID orgs) DOES allow NULL — `UPDATE organizations SET stripe_customer_id = NULL` is fine there.
- When checking "is customer ID set?", guard with `stripeCustomerId && stripeCustomerId !== ''`.
