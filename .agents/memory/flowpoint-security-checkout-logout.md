---
name: Security tab / Checkout / Logout patterns
description: Patterns used for the security checklist CTAs, logout revocation, and Stripe PaymentElement fallback
---

## Security checklist CTA pattern
Non-done items use `item.label` matching to provide contextual action buttons instead of a generic "Bientôt disponible" span.
The 2FA CONFIG card has `id="fp-sec-2fa"` for scroll targeting.

**Why:** Audit found "3 vulnérabilités détectées" with zero actionable links — bad UX.

**How to apply:** When adding new security checklist items in `renderSettings(security)`, add a corresponding branch in the ternary at line ~8870 or add an `action`/`actionLabel` field to the item object.

## Logout with server-side revocation
`#fp-logout-btn` handler calls `await window.apiFetch('/api/auth/logout', { method: 'POST' })` before redirecting. Wrapped in try/catch so network errors don't block the redirect.

**Why:** Without this, the session cookie remains valid after "logout" — security vulnerability M11.

## Stripe PaymentElement — button enable fallback
`paymentElement.on('ready', _enablePayBtn)` + `setTimeout(_enablePayBtn, 8000)` + flag `_payBtnReady` to prevent double-enable.
Also `paymentElement.on('loaderror', ...)` for ad-blocker error message.

**Why:** If `ready` never fires (partial ad-blocker), button stays permanently disabled. 8s fallback ensures form is usable.
