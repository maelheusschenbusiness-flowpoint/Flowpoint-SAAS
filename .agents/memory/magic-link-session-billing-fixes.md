---
name: Magic link, session TTL, and billing refresh fixes
description: Root causes and fixes for three production bugs — magic link failures, plan limits staying stale, Safari session expiry
---

## Magic Link "lien invalide ou expiré" (Bug 1)

**Root causes (multiple)**:
1. `storeMagicToken` (login-request manual flows) had TTL of **15 minutes** — users taking longer to check email got "Ce lien a expiré". Fixed to **1 hour**.
2. `checkout-complete` returned `emailSent: true` without actually sending the email when `hasToken=true` — it ASSUMED the webhook had emailed the user. If the webhook's Resend call failed silently, the user never received any link but the UI said "check your email". Fixed: now re-sends the email using the existing webhook token.
3. `peekToken` failures (not_found) were silent — no log, no diagnostic. Fixed: now logs `tokenPrefix + reason` to BetterStack at WARN level.

**Why:** `storeMagicToken` is used by login-request and magic-link endpoints. Webhook-generated tokens use inline INSERT with 24h TTL. checkout-complete checked for token existence but didn't verify email delivery.

**How to apply:** Any new magic link generation path should use 1h minimum TTL. checkout-complete should always attempt to send the email, not just check for token existence.

## Plan Limits Not Refreshing After Plan Change (Bug 2)

**Root cause:** `fp:billing:updated` event handler (fp-backend.js) only patched `STATE.me.plan` and `STATE.me.subscriptionStatus`. All other limits (`limits.teamMembers`, `limits.exports`, `limits.monitors`, `addons`, AI credits) remained stale.

**Fix:** After optimistic patch, handler now:
1. Busts both `_fpCache` and `_apiFetchCache` for `/api/me`
2. Calls `apiFetch('/api/me')` and overwrites `STATE.me` with fresh data
3. Calls `render()` again after the full refresh

**Why:** SSE only carries the new plan name/status, not the full limits matrix. Full `/api/me` is the only source of truth.

## Safari Browser Refresh → Sign-in (Bug 3)

**Root cause:** `SESSION_TTL_MS = 24 * 60 * 60 * 1000` (24 hours). Safari's tab freeze/restore (iOS) and overnight laptop closure both clear sessionStorage. If the 24h server-side session (and cookie maxAge) had elapsed, session-restore returns 401 and the user is redirected to login.

**Fix:** `SESSION_TTL_MS` changed to `7 * 24 * 60 * 60 * 1000` (7 days). Cookie `maxAge` follows `SESSION_TTL_MS` so both browser cookie and server DB session are consistent.

**Why:** B2B SaaS users expect sessions to survive at least a week of normal laptop/browser usage. 24h was too aggressive for the sessionStorage → cookie fallback to save users.

**Confirmed tests (dev server):**
- session TTL = 168h via DB SELECT ✅
- Cookie `fp_token` set in response ✅
- login-verify works for valid 24h token ✅
- canRetry=true for expired/not_found tokens ✅
