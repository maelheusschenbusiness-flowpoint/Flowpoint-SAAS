/**
 * reactivate-subscription.ts
 *
 * Canonical service: re-activates a canceled FlowPoint subscription on login.
 *
 * Called from:
 *   - handleLoginVerify  (magic-link / email auth)
 *   - Google OAuth callback
 *
 * NOT called from: /api/me, session-restore, refresh, navigation, polling.
 *
 * Rules:
 *   - Only acts when organizations.subscription_status === 'canceled'
 *   - Uses organizations.stripe_customer_id only — no email lookup
 *   - Never creates a new Stripe customer
 *   - Never grants a new trial (canStartTrial stays false)
 *   - Never creates a subscription for an account that never had one
 *   - If Stripe create fails → DB stays 'canceled', login continues
 *   - If Stripe create returns incomplete/incomplete_expired/past_due/unpaid → DB NOT active
 *   - Stripe idempotency key: reactivate:<orgId>:<latestCanceledSubId>
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { createStripeClient, getStripeKey } from "./stripe-factory.js";
import { PLAN_PRICE_IDS, PLAN_PRICE_IDS_TEST } from "../lib/plans.js";

/** Stripe subscription statuses that mean "fully active" in FlowPoint terms. */
const ACTIVE_STRIPE_STATUSES = new Set(["active", "trialing"]);

/**
 * Maps a Stripe subscription status to a FlowPoint subscription_status string.
 * Only statuses that represent actual premium access are mapped.
 */
function stripeStatusToFP(stripeStatus: string): string | null {
  if (stripeStatus === "active")   return "active";
  if (stripeStatus === "trialing") return "trialing";
  return null; // incomplete / past_due / unpaid / canceled → no DB promotion
}

/**
 * reactivateSubscriptionAfterLogin
 *
 * Fire-and-forget helper. Never throws — all errors are logged and swallowed.
 * Safe to call without awaiting.
 *
 * @param orgId  - UUID of the authenticated organization (canonical, from session)
 * @param caller - Short string identifying the auth path ('magic-link' | 'google-oauth')
 */
export async function reactivateSubscriptionAfterLogin(
  orgId: string,
  caller: string
): Promise<void> {
  if (!orgId) return;

  try {
    // ── 1. Read canonical org row ─────────────────────────────────────────────
    const orgRow = await pool.query<{
      subscription_status: string;
      stripe_customer_id: string | null;
      plan: string | null;
    }>(
      `SELECT subscription_status, stripe_customer_id, plan
         FROM organizations WHERE id = $1`,
      [orgId]
    );
    const org = orgRow.rows[0];

    if (!org) {
      logger.warn({ orgId, caller }, "[Reactivate] org not found — skip");
      return;
    }
    if (org.subscription_status !== "canceled") {
      // Already active / trialing / pending_billing → nothing to do
      return;
    }

    const customerId = org.stripe_customer_id;
    if (!customerId) {
      // No Stripe customer → never had a subscription billed through Stripe.
      // We do NOT create a customer or subscription silently.
      logger.info(
        { orgId, caller },
        "[Reactivate] no stripe_customer_id — leaving canceled"
      );
      return;
    }

    // ── 2. Build Stripe client ────────────────────────────────────────────────
    const stripeKey = getStripeKey();
    if (!stripeKey) {
      logger.warn({ orgId, caller }, "[Reactivate] no Stripe key configured — skip");
      return;
    }

    const stripe = await createStripeClient(stripeKey);
    const isTestMode = stripeKey.startsWith("sk_test_");

    // ── 3. Check for already-active subscription ──────────────────────────────
    const [activeSubs, trialSubs] = await Promise.all([
      stripe.subscriptions.list({ customer: customerId, status: "active",   limit: 1 }),
      stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 1 }),
    ]);

    if (activeSubs.data.length > 0) {
      await pool.query(
        `UPDATE organizations SET subscription_status = 'active' WHERE id = $1`,
        [orgId]
      );
      logger.info({ orgId, caller, subId: activeSubs.data[0].id },
        "[Reactivate] Active sub found in Stripe — synced DB to active");
      return;
    }
    if (trialSubs.data.length > 0) {
      await pool.query(
        `UPDATE organizations SET subscription_status = 'trialing' WHERE id = $1`,
        [orgId]
      );
      logger.info({ orgId, caller, subId: trialSubs.data[0].id },
        "[Reactivate] Trialing sub found in Stripe — synced DB to trialing");
      return;
    }

    // ── 4. Check for cancel_at_period_end subscription to reverse ────────────
    const allSubs = await stripe.subscriptions.list({
      customer: customerId,
      limit: 10,
      expand: ["data.items"],
    });

    const cancelPendingSub = allSubs.data.find(
      (s: { cancel_at_period_end: boolean; status: string }) =>
        s.cancel_at_period_end &&
        (s.status === "active" || s.status === "trialing")
    );
    if (cancelPendingSub) {
      await stripe.subscriptions.update(cancelPendingSub.id, {
        cancel_at_period_end: false,
      });
      const fpStatus = cancelPendingSub.status === "trialing" ? "trialing" : "active";
      await pool.query(
        `UPDATE organizations SET subscription_status = $1 WHERE id = $2`,
        [fpStatus, orgId]
      );
      logger.info(
        { orgId, caller, subId: cancelPendingSub.id, fpStatus },
        "[Reactivate] Reversed cancel_at_period_end — synced DB"
      );
      return;
    }

    // ── 5. All previous subscriptions are truly canceled — create a new one ──
    // Find the most recently canceled subscription (for idempotency key).
    const canceledSubs = allSubs.data
      .filter((s: { status: string }) => s.status === "canceled")
      .sort((a: { canceled_at: number | null }, b: { canceled_at: number | null }) =>
        (b.canceled_at ?? 0) - (a.canceled_at ?? 0)
      );

    const latestCanceledSub = canceledSubs[0];

    if (!latestCanceledSub) {
      // No Stripe subscription history at all for this customer.
      // This account never had a subscription → do NOT create one silently.
      logger.info(
        { orgId, caller, customerId },
        "[Reactivate] No Stripe subscription history — leaving canceled"
      );
      return;
    }

    // Idempotency key tied to the specific canceled subscription.
    // Two concurrent logins will use the same key → Stripe deduplicates.
    const idempotencyKey = `reactivate:${orgId}:${latestCanceledSub.id}`;

    // Resolve plan price ID (never hardcode).
    const planName = (org.plan || "standard").toLowerCase();
    const priceIds = isTestMode ? PLAN_PRICE_IDS_TEST : PLAN_PRICE_IDS;
    const priceId = priceIds[planName] || priceIds["standard"];

    if (!priceId) {
      logger.warn(
        { orgId, caller, planName, isTestMode },
        "[Reactivate] No price ID found for plan — leaving canceled"
      );
      return;
    }

    logger.info(
      { orgId, caller, customerId, planName, priceId, idempotencyKey },
      "[Reactivate] Creating new Stripe subscription for formerly-canceled account"
    );

    const newSub = await stripe.subscriptions.create(
      {
        customer: customerId,
        items: [{ price: priceId }],
        metadata: { org_id: orgId, plan: planName, reactivated_by: caller },
        // payment_behavior: 'default_incomplete' would allow no-payment-method.
        // We intentionally omit it so Stripe uses the customer's default method.
        // If no method is available, Stripe returns status=incomplete — handled below.
      },
      { idempotencyKey }
    );

    // ── 6. DB sync — only on success; never promote on incomplete/past_due ───
    const fpStatus = stripeStatusToFP(newSub.status);
    if (fpStatus) {
      await pool.query(
        `UPDATE organizations SET subscription_status = $1 WHERE id = $2`,
        [fpStatus, orgId]
      );
      logger.info(
        { orgId, caller, subId: newSub.id, stripeStatus: newSub.status, fpStatus },
        "[Reactivate] New subscription created — DB synced"
      );
    } else {
      logger.warn(
        { orgId, caller, subId: newSub.id, stripeStatus: newSub.status },
        "[Reactivate] New sub created but status not promotable — DB stays canceled"
      );
    }
  } catch (err) {
    // Never break login on reactivation failure.
    logger.warn(
      { orgId, caller, err: err instanceof Error ? err.message : String(err) },
      "[Reactivate] reactivateSubscriptionAfterLogin failed (non-fatal)"
    );
  }
}
