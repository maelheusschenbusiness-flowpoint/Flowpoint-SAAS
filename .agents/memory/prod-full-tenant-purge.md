---
name: Full tenant purge — two account layers
description: Why deleting every FlowPoint customer needs two passes (UUID orgs + legacy email-keyed rows) plus an independent Stripe sweep
---

# Full tenant purge

## Rule
"Delete all customers" is **not** satisfied by running the account-deletion pipeline over
`organizations`. Production carries two parallel account layers, and Stripe carries a third
independent set. All three must be swept and verified separately.

**Why:** the deletion pipeline resolves its target from an `organizations` row. Legacy
accounts predate that table — they live only as `org_settings` rows keyed by the raw email
string (and their sessions/tokens are keyed the same way). After the pipeline reported
success on every organization, a login with an old email still worked, because the
credential path only needs `org_settings` + `magic_link_tokens`, never `organizations`.

## The three layers
1. **UUID orgs** — `organizations` + `organization_members` + `users`. Handled by the
   account-deletion pipeline (Stripe first, then one DB transaction).
2. **Legacy email-keyed rows** — `org_settings.org_id` holds an email or an ad-hoc test
   string. Carries its own `stripe_customer_id` / `stripe_subscription_id`. Invisible to the
   pipeline. Sessions, `magic_link_tokens`, `pending_signups`, and `google_tokens` for these
   accounts are keyed by the same email string.
3. **Stripe** — customers can outlive both DB layers. Expect orphans whose metadata points
   at an org id that no longer exists anywhere. Sweep `customers.list()` directly at the end;
   do not assume the DB knew about every customer.

## Gotchas
- The primary organization record is owner-keyed, not necessarily `org_id`-keyed.
  Any dynamic DB purge that discovers only `org_id`/`user_id` columns can leave
  an orphan organization behind; include owner identity fields and assert zero
  organizations in the final survivor check.
- **PostgREST refuses `DELETE` with no filter** (`21000: DELETE requires a WHERE clause`).
  Use an always-true predicate on a NOT NULL column, e.g. `?token=not.is.null`.
- The pipeline can report `usersDeleted: 0` and still be correct — legacy orgs often have no
  `users` row at all, which is exactly why the email layer survives.
- `subscriptionsCanceled: 0` alongside `customerDeleted: true` is normal when the
  subscription was already cancelled; deleting the customer is what stops future billing.

## Verification (the part that actually proves it)
Counting DB tables to zero is necessary but not sufficient — verify the *behaviour*:
- `POST /api/auth/login-request` with each former customer email must return **404**
  ("Aucun compte trouvé"). Do not test against an authenticated endpoint; a `401 missing
  credentials` means you picked the wrong route and proves nothing.
- Stripe: `customers.list()` empty, and `subscriptions.list()` empty for every billable
  status (`active`, `trialing`, `past_due`, `unpaid`, `incomplete`) — not just `active`.
