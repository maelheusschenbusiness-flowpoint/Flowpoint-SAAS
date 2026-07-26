/**
 * subscription-state.ts — FlowPoint subscription state machine.
 *
 * LIFECYCLE:
 *  signup                → "pending_billing"         (no trial yet)
 *  Stripe webhook trialing → "trialing"              (real trial, trialConsumedAt set)
 *  Stripe webhook active   → "active"
 *  Stripe webhook canceled → "canceled"
 *  resource_missing        → "pending_billing" / "none" (reconciled, IDs cleared)
 *
 * STATUS RULES:
 *  "pending_billing" — account created, checkout not completed; NO premium access
 *  "trialing"        — real Stripe trial active (stripeSubscriptionId non-null OR trialConsumedAt set + trialActive)
 *  "active"          — paid subscription (stripeSubscriptionId required)
 *  "past_due"        — payment failed, subscription still alive (stripeSubscriptionId required)
 *  "canceled"        — subscription ended (stripeSubscriptionId existed at some point)
 *  "incomplete"      — stripeCustomerId exists, no live subscription
 *  "unpaid"          — requires stripeSubscriptionId
 *  "paused"          — requires stripeSubscriptionId
 *  "none"            — no customer, no subscription, no trial
 *
 * PREMIUM ACCESS:
 *  Only "active" and "trialing" grant paid-feature access.
 *  "pending_billing" does NOT grant access — dashboard shows billing completion page.
 *
 * Dashboard access policy (single source of truth):
 *  - Dashboard shell:        all authenticated users (access gate is auth only)
 *  - Premium features/quota: requires statusGrantsAccess(status) === true
 *  - pending_billing:        dashboard shows only Billing / Pricing / Account pages
 *  - After trial expiry:     status normalises to "pending_billing" (DB not yet migrated)
 *                            or "incomplete" / "none" (DB up to date)
 */

export type SubscriptionStatus =
  | "pending_billing"
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid"
  | "paused";

export interface SubscriptionStateInput {
  /** Raw value from org_settings.subscription_status */
  rawStatus: string | null;
  /** From org_settings.stripe_subscription_id */
  stripeSubscriptionId: string | null;
  /** From org_settings.stripe_customer_id */
  stripeCustomerId: string | null;
  /** ISO string from org_settings.trial_ends_at */
  trialEndsAt: string | null;
  /**
   * ISO string from org_settings.trial_consumed_at.
   * Set by the Stripe webhook when the first trialing subscription is created.
   * NULL means no real Stripe trial was ever started (accounts before 2026-07-26
   * that were given a fake DB trial at signup).
   */
  trialConsumedAt?: string | null;
}

/**
 * Normalise raw DB state into a valid, consistent SubscriptionStatus.
 * This is the single source of truth — every endpoint that exposes a
 * subscription status MUST pass through this function.
 */
export function normalizeSubscriptionStatus(input: SubscriptionStateInput): SubscriptionStatus {
  const { rawStatus, stripeSubscriptionId, stripeCustomerId, trialEndsAt, trialConsumedAt } = input;

  const hasSubscription = !!(stripeSubscriptionId && stripeSubscriptionId.trim());
  const hasCustomer     = !!(stripeCustomerId     && stripeCustomerId.trim());
  const trialActive     = !!(trialEndsAt && new Date(trialEndsAt) > new Date());
  const wasConsumed     = !!(trialConsumedAt);

  // ── pending_billing: explicit new-account state ──────────────────────────
  // Signup no longer grants a trial — accounts start here.
  // Only upgraded via Stripe webhook (subscription created/updated).
  if (rawStatus === "pending_billing") {
    if (hasSubscription) {
      // Webhook fired and set a subscriptionId — normalise based on real state
      if (trialActive)  return "trialing";
      return "active";
    }
    return "pending_billing";
  }

  // ── Statuses that require a real Stripe subscription ────────────────────
  const requiresSubscription = new Set(["active", "past_due", "unpaid", "paused"]);
  if (rawStatus && requiresSubscription.has(rawStatus)) {
    if (!hasSubscription) {
      // Impossible state: billing status but no subscription ID.
      if (trialActive && wasConsumed) return "trialing";
      if (trialActive)               return "pending_billing";
      if (hasCustomer)               return "incomplete";
      return "none";
    }
    return rawStatus as SubscriptionStatus;
  }

  // ── canceled: valid even without a live subscription ────────────────────
  if (rawStatus === "canceled") {
    return "canceled";
  }

  // ── trialing ─────────────────────────────────────────────────────────────
  if (rawStatus === "trialing") {
    if (hasSubscription) {
      // Stripe-backed trial
      if (trialActive)   return "trialing";
      return "active";   // trial period over but subscription continues
    }
    // No Stripe subscription:
    if (!wasConsumed) {
      // No trial_consumed_at → this was the OLD fake DB trial set at signup.
      // Treat as pending_billing (no real trial ever started).
      return "pending_billing";
    }
    // trial_consumed_at IS set → trial was real, but subscription is gone
    if (trialActive)   return "trialing"; // still within trial window
    if (hasCustomer)   return "incomplete";
    return "none";
  }

  // ── incomplete ───────────────────────────────────────────────────────────
  if (rawStatus === "incomplete") {
    return hasCustomer ? "incomplete" : "none";
  }

  // ── null / "none" / unknown raw status ──────────────────────────────────
  // DO NOT fall back to "trialing" based on trialEndsAt alone —
  // trialEndsAt is set by the old signup code and is not a reliable signal.
  if (hasCustomer)     return "incomplete";
  return "none";
}

/**
 * Returns true when the status grants access to paid-tier features.
 * Only "active" and "trialing" (real Stripe-backed) grant premium access.
 * "pending_billing" does NOT grant premium access.
 */
export function statusGrantsAccess(status: SubscriptionStatus): boolean {
  return status === "active" || status === "trialing";
}

/**
 * SQL to normalise:
 * 1. Active without subscription (impossible state from old DEFAULT 'active' bug)
 * 2. Trialing without subscription AND without trial_consumed_at (old fake DB trial)
 *
 * Safe to run repeatedly (only touches invalid rows). Does NOT delete Stripe data.
 */
export const NORMALIZE_IMPOSSIBLE_STATES_SQL = `
-- Fix 1: active without subscription
UPDATE org_settings
SET    subscription_status =
         CASE
           WHEN trial_ends_at IS NOT NULL
                AND trial_ends_at > NOW()
                AND trial_consumed_at IS NOT NULL  THEN 'trialing'
           WHEN stripe_customer_id IS NOT NULL
                AND stripe_customer_id <> ''        THEN 'incomplete'
           ELSE                                          'none'
         END,
       updated_at = NOW()
WHERE  subscription_status = 'active'
  AND  (stripe_subscription_id IS NULL OR stripe_subscription_id = '');

-- Fix 2: trialing without subscription AND without trial_consumed_at = fake DB trial
UPDATE org_settings
SET    subscription_status = 'pending_billing',
       updated_at = NOW()
WHERE  subscription_status = 'trialing'
  AND  (stripe_subscription_id IS NULL OR stripe_subscription_id = '')
  AND  trial_consumed_at IS NULL;
`;

/** Keep for backward compat — callers can switch to NORMALIZE_IMPOSSIBLE_STATES_SQL */
export const NORMALIZE_ACTIVE_WITHOUT_SUBSCRIPTION_SQL = NORMALIZE_IMPOSSIBLE_STATES_SQL;

/**
 * Returns an object suitable for a structured log entry summarising the
 * normalisation of an impossible state.
 */
export function impossibleStateReport(input: SubscriptionStateInput, resolved: SubscriptionStatus) {
  return {
    rawStatus:            input.rawStatus,
    stripeSubscriptionId: input.stripeSubscriptionId,
    stripeCustomerId:     input.stripeCustomerId,
    trialEndsAt:          input.trialEndsAt,
    trialConsumedAt:      input.trialConsumedAt,
    normalizedTo:         resolved,
    wasImpossible:        resolved !== input.rawStatus,
  };
}
