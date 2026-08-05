---
name: Account deletion pipeline
description: How FlowPoint's permanent account deletion is designed and why — dynamic table discovery, per-table parameter binding, refuse-to-commit survivor check, Stripe ordering.
---

# Account deletion pipeline

The deletion service discovers what to delete at runtime instead of carrying a
hand-maintained table list.

## Rules

**Discover ownership dynamically, never with a static table list.**
Query `information_schema` for every base table carrying an org column
(`org_id`, `organization_id`) or a user-reference column (`user_id`,
`user_id_v2`, `owner_id`, `created_by`, `member_id`, `invited_by`, `sender_id`,
`author_id`, `assigned_to`, …).
**Why:** the previous implementation hardcoded ~54 tables and silently missed
every table added afterwards. The live schema currently resolves to ~165 owned
tables — a static list will always drift behind.

**Build the parameter array per table, not once for the whole run.**
Placeholders must be numbered contiguously from `$1` *for each statement*. A
table with only an org column must not be handed a second, unreferenced
parameter.
**Why:** passing `[orgId, userIds]` to every table produced
`bind message supplies 2 parameters, but prepared statement "" requires 1` and
aborted the whole deletion.

**Compare org columns with `::text`.**
Most `org_id` columns are `text`, several are `uuid`. Casting both sides to text
gives one code path.

**Refuse to commit if anything survived.**
After the deletes, re-count every touched table inside the transaction and throw
if any `rowsAfter > 0`. The throw triggers `ROLLBACK`.
**Why:** a partial deletion is worse than no deletion — it leaves an account
half-alive with no way to retry cleanly. All-or-nothing is the only safe state.

**Stripe runs BEFORE the transaction; storage runs AFTER the commit.**
Neither can participate in a Postgres transaction. Stripe first, because an
un-cancelled subscription keeps billing a deleted customer — that is the
expensive failure. Storage after, because deleting objects for an account that
then fails to delete is unrecoverable.

**Stripe: cancel subscriptions, delete the customer, keep the invoices.**
`customers.del()` removes the customer but Stripe retains invoices and payments,
which is the legally required behaviour. Treat `resource_missing` as already
clean (idempotency).

## Certification

Three suites, all must pass:
- `tools/deletion-cert.mjs` — seeds a real row into every discovered table using
  values generated from the live column types, deletes, asserts zero survivors
  plus a full-schema orphan audit.
- `tools/deletion-cert-stripe.mjs` — Stripe **test mode** only; asserts the
  subscription is cancelled, the customer deleted, and the invoice still
  retrievable.
- `.local/qa_482_account_deletion_browser.cjs` — real browser flow.

**How to apply:** any new table with an org or user column is picked up
automatically — but re-run `deletion-cert.mjs` after schema changes, because a
table whose NOT NULL constraints block the seeder is reported as "not seedable"
and is therefore *not* proven covered.
