/**
 * subscription-state.ts — FlowPoint subscription state machine.
 *
 * RULES:
 *  - "active"     requires stripe_subscription_id (non-null, non-empty)
 *  - "past_due"   requires stripe_subscription_id
 *  - "canceled"   stripe_subscription_id existed at some point (preserved for history)
 *  - "unpaid"     requires stripe_subscription_id
 *  - "paused"     requires stripe_subscription_id
 *  - "trialing"   requires trial_ends_at > NOW()
 *  - "incomplete" stripe_customer_id exists, no active subscription
 *  - "none"       no customer, no subscription, no trial
 *
 * NEVER return "active" when stripe_subscription_id is null.
 *
 * Dashboard access policy (documented here as single source of truth):
 *  - Dashboard shell:         all authenticated users (access gate is auth only)
 *  - Paid features / quota:   plan gate reads plan from DB per-request
 *  - Trial access:            status="trialing" grants same quota as the trial plan
 *  - After trial expiry:      status normalises to "none" / "incomplete"
 *  - Without subscription:    status="none" or "incomplete" → standard-plan limits only
 *  - Cancelled:               planGate reverts to "standard" limits immediately
 */

export type SubscriptionStatus =
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
}

/**
 * Normalise raw DB state into a valid, consistent SubscriptionStatus.
 * This is the single source of truth — every endpoint that exposes a
 * subscription status MUST pass through this function.
 */
export function normalizeSubscriptionStatus(input: SubscriptionStateInput): SubscriptionStatus {
  const { rawStatus, stripeSubscriptionId, stripeCustomerId, trialEndsAt } = input;

  const hasSubscription = !!(stripeSubscriptionId && stripeSubscriptionId.trim());
  const hasCustomer     = !!(stripeCustomerId     && stripeCustomerId.trim());
  const trialActive     = !!(trialEndsAt && new Date(trialEndsAt) > new Date());

  // Statuses that require a real Stripe subscription
  const requiresSubscription = new Set(["active", "past_due", "unpaid", "paused"]);

  if (rawStatus && requiresSubscription.has(rawStatus)) {
    if (!hasSubscription) {
      // Impossible state: has billing status but no subscription ID.
      // Normalise based on what actually exists.
      if (trialActive)    return "trialing";
      if (hasCustomer)    return "incomplete";
      return "none";
    }
    return rawStatus as SubscriptionStatus;
  }

  if (rawStatus === "canceled") {
    // Canceled is valid even without a live subscription (it ended).
    return "canceled";
  }

  if (rawStatus === "trialing") {
    if (trialActive)       return "trialing";
    // Trial expired — if a subscription was created during the trial, trust it
    if (hasSubscription)   return "active";
    if (hasCustomer)       return "incomplete";
    return "none";
  }

  if (rawStatus === "incomplete") {
    return hasCustomer ? "incomplete" : "none";
  }

  // null / "none" / unknown raw status
  if (trialActive)     return "trialing";
  if (hasCustomer)     return "incomplete";
  return "none";
}

/**
 * Returns true when the status grants access to paid-tier features.
 * "active" and "trialing" grant paid access.
 */
export function statusGrantsAccess(status: SubscriptionStatus): boolean {
  return status === "active" || status === "trialing";
}

/**
 * SQL to normalise existing rows that have status='active' without a
 * stripe_subscription_id (impossible state from the old DEFAULT 'active' bug).
 *
 * Safe to run repeatedly — only touches rows that are genuinely invalid.
 * Does NOT delete any Stripe data.
 */
export const NORMALIZE_ACTIVE_WITHOUT_SUBSCRIPTION_SQL = `
UPDATE org_settings
SET    subscription_status =
         CASE
           WHEN trial_ends_at IS NOT NULL
                AND trial_ends_at > NOW()           THEN 'trialing'
           WHEN stripe_customer_id IS NOT NULL
                AND stripe_customer_id <> ''        THEN 'incomplete'
           ELSE                                          'none'
         END,
       updated_at = NOW()
WHERE  subscription_status = 'active'
  AND  (stripe_subscription_id IS NULL OR stripe_subscription_id = '');
`;

/**
 * Returns an object suitable for a structured log entry summarising the
 * normalisation of an impossible state.
 */
export function impossibleStateReport(input: SubscriptionStateInput, resolved: SubscriptionStatus) {
  return {
    rawStatus:           input.rawStatus,
    stripeSubscriptionId: input.stripeSubscriptionId,
    stripeCustomerId:    input.stripeCustomerId,
    trialEndsAt:         input.trialEndsAt,
    normalizedTo:        resolved,
    wasImpossible:       resolved !== input.rawStatus,
  };
}
