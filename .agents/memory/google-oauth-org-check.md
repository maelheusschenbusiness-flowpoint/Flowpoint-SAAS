---
name: Google OAuth — organizations table check before org_settings
description: Google callback must check organizations table first; org_settings alone misses magic-link users and creates duplicate Stripe customers.
---

## The rule

In the Google OAuth callback (`auth.ts`), always query `organizations WHERE owner_email=$1` BEFORE checking `org_settings`.

**Why:** Users who signed up via magic link only have records in `organizations`/`users` (new auth system). `org_settings` (legacy) has no entry for them. Without the organizations check, the callback treats them as brand-new → writes a `pending_billing` entry to `org_settings` → routes them to plan selection → Stripe creates a **second** customer.

**How to apply:**

```typescript
// Fast-path at the top of the try block:
const _orgQuery = await pool.query<{ id: string; subscription_status: string | null }>(
  `SELECT id, subscription_status FROM organizations
    WHERE owner_email = $1 AND status != 'deleted' LIMIT 1`,
  [resolvedEmail],
);
const _orgRow = _orgQuery.rows[0] ?? null;
const _isActivated = _orgRow !== null &&
  _orgRow.subscription_status !== null &&
  _orgRow.subscription_status !== "" &&
  _orgRow.subscription_status !== "pending_billing";

if (_isActivated) {
  // Existing activated org — skip org_settings entirely
  googleIdentity = await resolveOrCreateLegacyOrg({ email: resolvedEmail, ... });
} else {
  // Legacy / new-signup path (org_settings flow)
  ...
}
```

Also applies to GitHub and Apple OAuth callbacks if they have the same `_loadGithubOrg`/`_loadAppleOrg` pattern.
