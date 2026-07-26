/**
 * billing-context.ts — Per-request billing state loaded from DB.
 *
 * All billing decisions (subscription guards, trial checks, plan gates) must
 * read from this context rather than from the in-memory store singleton.
 *
 * The store singleton (store.me) is only authoritative for SSE pub/sub;
 * it MUST NOT be used as the source of truth for any per-tenant billing decision.
 */

import { pool } from "@workspace/db";
import { loadOrgSettings } from "./org-settings.js";
import { normalizeSubscriptionStatus, statusGrantsAccess } from "../lib/subscription-state.js";
import { logger } from "../lib/logger.js";

export interface BillingContext {
  /** Normalised subscription status (never "active" without a subscriptionId) */
  subscriptionStatus: string | null;
  /** Raw status from org_settings.subscription_status (for debugging / migration) */
  rawSubscriptionStatus: string | null;
  /** Current plan from org_settings.plan */
  plan: string;
  /** Stripe customer ID from org_settings.stripe_customer_id */
  stripeCustomerId: string | null;
  /** Stripe subscription ID from org_settings.stripe_subscription_id */
  stripeSubscriptionId: string | null;
  /** Trial end ISO string from org_settings.trial_ends_at */
  trialEndsAt: string | null;
  /**
   * Set by webhook when first real Stripe trialing subscription is created.
   * NULL = no real Stripe trial was ever started.
   */
  trialConsumedAt: string | null;
  /** Contact email from org_settings.email */
  email: string | null;
  /** First name from org_settings.first_name */
  firstName: string | null;
  /** Organisation name from org_settings.org_name */
  orgName: string | null;
  /** Active add-ons from org_addons table (keyed by addon_key) */
  addons: Record<string, boolean | number>;
  /** Pending plan (scheduled downgrade, not yet in effect) */
  pendingPlan: string | null;
  /** Human-readable date when pendingPlan becomes effective */
  pendingPlanDate: string | null;

  // ── Derived access flags ─────────────────────────────────────────────────
  /** true when status is "active" or "trialing" (real Stripe trial) */
  hasPremiumAccess: boolean;
  /**
   * true when account has never consumed a real trial AND has no Stripe subscription history.
   * Computed from trialConsumedAt IS NULL AND stripeSubscriptionId IS NULL.
   */
  canStartTrial: boolean;
  /**
   * true when account must complete billing before accessing premium features.
   * Equivalent to !hasPremiumAccess AND status is pending_billing / none / incomplete.
   */
  mustCompleteBilling: boolean;
}

/**
 * Load all billing-relevant fields for the given org from the database.
 * Always reads from DB — never from the in-memory store singleton.
 * Safe for concurrent requests from different organisations.
 *
 * The returned `subscriptionStatus` is ALWAYS normalised through the state
 * machine (normalizeSubscriptionStatus) so callers never see "active" without
 * a stripe_subscription_id.
 */
export async function loadBillingContext(orgId: string): Promise<BillingContext> {
  const [settings, addonsResult] = await Promise.all([
    loadOrgSettings(orgId).catch(err => {
      logger.warn({ err, orgId }, "[BillingContext] loadOrgSettings failed");
      return null;
    }),
    (async () => {
      const client = await pool.connect();
      try {
        return await client.query<{ addon_key: string; active: boolean }>(
          `SELECT addon_key, active
           FROM org_addons
           WHERE org_id = $1`,
          [orgId]
        );
      } finally {
        client.release();
      }
    })().catch(err => {
      logger.warn({ err, orgId }, "[BillingContext] org_addons query failed");
      return { rows: [] as { addon_key: string; active: boolean }[] };
    }),
  ]);

  // Build addons map from org_addons table (the canonical source of truth)
  const addons: Record<string, boolean | number> = {};
  for (const row of addonsResult.rows) {
    addons[row.addon_key] = row.active;
  }

  // Merge addons from org_settings.addons JSONB as legacy supplemental
  // (org_addons table takes precedence when both exist for the same key)
  if (settings?.addons && typeof settings.addons === "object") {
    for (const [key, val] of Object.entries(settings.addons)) {
      if (!(key in addons)) {
        addons[key] = val as boolean | number;
      }
    }
  }

  const rawSubscriptionStatus = settings?.subscriptionStatus ?? null;
  const stripeSubscriptionId  = settings?.stripeSubscriptionId ?? null;
  const stripeCustomerId      = settings?.stripeCustomerId ?? null;
  const trialEndsAt           = settings?.trialEndsAt ?? null;
  const trialConsumedAt       = settings?.trialConsumedAt ?? null;

  // Normalise status — never returns "active" without a stripeSubscriptionId
  const normalised = normalizeSubscriptionStatus({
    rawStatus:           rawSubscriptionStatus,
    stripeSubscriptionId,
    stripeCustomerId,
    trialEndsAt,
    trialConsumedAt,
  });

  // Log impossible states for audit trail (does not mutate DB here)
  if (normalised !== rawSubscriptionStatus && rawSubscriptionStatus !== null) {
    logger.warn(
      { orgId, rawSubscriptionStatus, normalizedTo: normalised, stripeSubscriptionId, trialConsumedAt },
      "[BillingContext] Subscription state normalised at read-time",
    );
  }

  const hasPremiumAccess    = statusGrantsAccess(normalised);
  const canStartTrial       = !trialConsumedAt && !stripeSubscriptionId;
  const mustCompleteBilling = !hasPremiumAccess;

  return {
    subscriptionStatus:    normalised,
    rawSubscriptionStatus,
    plan:                  settings?.plan ?? "standard",
    stripeCustomerId,
    stripeSubscriptionId,
    trialEndsAt,
    trialConsumedAt,
    email:                 settings?.email ?? null,
    firstName:             settings?.firstName ?? null,
    orgName:               settings?.orgName ?? null,
    addons,
    pendingPlan:           settings?.pendingPlan     ?? null,
    pendingPlanDate:       settings?.pendingPlanDate ?? null,
    hasPremiumAccess,
    canStartTrial,
    mustCompleteBilling,
  };
}

/**
 * Lightweight billing access resolver — returns a summary of billing state.
 * Use this on any route that needs to gate premium access without loading
 * the full billing context.
 */
export async function resolveBillingAccess(orgId: string): Promise<{
  status: string;
  hasDashboardAccess: boolean;
  hasPremiumAccess: boolean;
  mustCompleteBilling: boolean;
  canStartTrial: boolean;
  currentPlan: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}> {
  const ctx = await loadBillingContext(orgId);
  return {
    status:             ctx.subscriptionStatus ?? "pending_billing",
    hasDashboardAccess: true,  // all authenticated users can access the dashboard shell
    hasPremiumAccess:   ctx.hasPremiumAccess,
    mustCompleteBilling: ctx.mustCompleteBilling,
    canStartTrial:      ctx.canStartTrial,
    currentPlan:        ctx.plan,
    trialEndsAt:        ctx.trialEndsAt,
    currentPeriodEnd:   null,   // populated by billing.ts after Stripe reconciliation
  };
}
