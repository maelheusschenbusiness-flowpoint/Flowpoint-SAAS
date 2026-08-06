---
name: Google OAuth scope allowlist
description: Single canonical scope list for Google integration OAuth, and how to keep the write scope from creeping back in
---

# Google OAuth scope allowlist

## Rule
There is exactly **one** canonical scope list for the Google *integration* flow, exported
from the Google service module as `GOOGLE_INTEGRATION_SCOPES` (plus a Set form for lookups).
`generateAuthUrl()` may only read from it. Analytics is **read-only** — the write scope
`.../auth/analytics.edit` must never appear.

The integration flow (Search Console / Business Profile / Analytics connect endpoints) is
distinct from the *login* flow, which requests only `openid email profile`. Do not merge them.

**Why:** the write scope triggers Google's sensitive/restricted-scope verification and was
requested even though the app only ever reads Analytics. It lived in an inline array inside
the URL builder, so it was invisible to anyone reviewing the connect routes.

## How to apply
- Two guards exist and must both stay wired: a unit test asserting the generated URL's
  `scope` param (readonly present, edit absent, no unknown/broader scopes), and a script
  that greps `src/`, `dist/`, and the frontend artifacts for the forbidden scope string.
  The script matters because a stale `dist/` can keep serving the old scope after a source fix.
- Verifying in production means reading the `scope` query param off the URL the live server
  returns from its connect endpoints — those return `{ok, url, state}` JSON, not a 302.
  They require an authenticated session (see `prod-test-session-uuid.md`).
- Confirm which commit production actually serves via the version endpoint before
  claiming a fix is live; Render can lag a push.
