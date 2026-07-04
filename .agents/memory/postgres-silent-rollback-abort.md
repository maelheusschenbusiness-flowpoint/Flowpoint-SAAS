---
name: Postgres transaction abort silently discards prior writes
description: A failing statement mid-transaction (e.g. wrong column type) aborts the whole transaction; a later COMMIT is silently converted to ROLLBACK with no JS exception — looks like "the DB write vanished" with zero errors.
---

## The trap
Inside a single Postgres transaction, if any statement errors (e.g. `invalid input syntax for type uuid` from inserting a text value into a UUID column), the transaction enters an "aborted" state. All later statements on that transaction — including `COMMIT` — are accepted by the client library without throwing, but Postgres treats `COMMIT` on an aborted transaction as an implicit `ROLLBACK`. Every write that transaction made, even ones that succeeded and reported correct `rowCount`, is discarded with **no error surfaced anywhere** in application logs.

**Why:** In FlowPoint's monitor-check flow, `saveCheckResult` ran INSERT (monitor_checks) + UPDATE (monitors) + a conditional INSERT (monitor_incidents) in one `withOrgDb` transaction. The incident INSERT failed with 22P02 only on "up→down" transitions (schema drift: `monitor_incidents.org_id` was UUID while every other org_id column app-wide is TEXT). The try/catch around that block caught the JS error and logged it, but never rolled back — so the poisoned transaction silently ate the earlier, otherwise-successful INSERT/UPDATE on COMMIT. Symptom: HTTP 200, `rowCount: 1` on every step, but the row was provably unchanged on re-select — a strong signal for this exact bug, not a caching/replica/RLS issue.

**How to apply:**
- If a DB write reports success (200 response, correct rowCount) but a fresh re-select shows no change, suspect a poisoned multi-statement transaction, not the write logic itself.
- Diagnostic: add `rowCount` from each intermediate query to a temporary debug response field to prove each step's own view of the transaction is correct while the end state is not — isolates it to "something after this point aborts the whole txn."
- Fix pattern: wrap any secondary/best-effort logic inside a bigger transaction in `SAVEPOINT x` / `RELEASE SAVEPOINT x` on success / `ROLLBACK TO SAVEPOINT x` on catch, so a failure there can never poison the rest of the transaction.
- Root-cause fix: also find and correct the actual failing statement (here: retype the drifted column to match its sibling tables) — the savepoint only contains the blast radius, it doesn't fix the underlying schema drift.
