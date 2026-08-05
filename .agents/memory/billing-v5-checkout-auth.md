---
name: Billing V5 checkout-session auth fix
description: Fixes applied in Task #466 — the four root causes in the payment flow and their fixes
---

## Fixes applied

### 1. `public-billing.ts` — Auth user orgId + customer resolution in checkout-session
**Problem:** `POST /public/checkout-session` only resolved `stripeCustomerId` and set `orgId` in metadata when a `preRegisterToken` was present. Authenticated users (upgrade/plan-change/addon) got checkout sessions with no customer attached and no `orgId` in metadata → webhook fired but couldn't map the session back to an org.

**Fix:** After the preRegisterToken block, added auth-user lookup:
```typescript
if (!preRegisterToken) {
  const _authOrgId = (req as Request & { orgId?: string }).orgId;
  if (_authOrgId && _authOrgId !== "default") {
    signupOrgId = _authOrgId;
    const _authCtx = await loadBillingContext(_authOrgId);
    if (_authCtx.stripeCustomerId) stripeCustomerId = _authCtx.stripeCustomerId;
  }
}
```
Same pattern as `payment-intent` handler (lines 656–671).

**Why:** Webhook resolves orgId from `metadata.orgId` first. Without it, webhook must fall back to customer metadata lookup (fragile) or fail entirely.

### 2. `stripe-webhook.ts` — AI credits purchase ID determinism
**Problem:** `ai_credit_purchases` insert used `acp_${Date.now()}_${Math.random()...}` as primary key. `ON CONFLICT (id) DO NOTHING` only works if the same ID is used on retry — random IDs defeat idempotency.

**Fix:** Changed to `const purchaseId = \`acp_${sessionId}\`` where `sessionId = obj["id"]` (the Stripe session ID, already on line 719).

### 3. `stripe-webhook.ts` — Webhook handles `ai_credits_only` checkout type from public route
**Problem:** `checkout.session.completed` only checked `meta["type"] === "ai_credits"`. Sessions from `POST /public/checkout-session` (ai_credits_only type) set `flowpoint_checkout_type: "ai_credits_only"` instead, so the webhook would fall through to the subscription handler.

**Fix:** Condition changed to:
```typescript
if (meta["type"] === "ai_credits" || meta["flowpoint_checkout_type"] === "ai_credits_only") {
```
Also parses `pack`/`credits` from `meta["ai_credits"]` field (comma-separated pack keys) for the public route case.

### 4. `billing.ts` — `/billing/checkout-ai-credits` missing orgId in session metadata
**Problem:** The redirect-to-Stripe AI credits checkout (`POST /billing/checkout-ai-credits`) created Stripe sessions without `orgId` in metadata — relying solely on customer metadata lookup in webhook.

**Fix:** Added `orgId` explicitly to session `metadata` object.

### 5. `pricing.html` — Addon mode: hide plan cards for subscribed users
When `?from=dashboard&addon=X` is in URL: polls `window._fpBillingState` and if `status === 'active'/'trialing'`, hides `.fp-plans-section` and updates hero text to addon-purchase context.

## Test results
QA suite `.local/qa_466_billing.cjs` — 34/34 tests passing.
