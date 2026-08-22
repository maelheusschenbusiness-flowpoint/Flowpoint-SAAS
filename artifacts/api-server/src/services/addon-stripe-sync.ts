/**
 * Addon ↔ Stripe subscription sync.
 *
 * When a subscribed (active/trialing) org activates a paid add-on from the
 * dashboard, the add-on must be billed on the existing Stripe subscription —
 * no pricing/cart detour. Included-in-plan add-ons and one-time AI credit
 * packs are never added as subscription items.
 */
import { ADDON_PRICE_IDS, PLAN_INCLUDED_ADDONS } from "../lib/plans.js";
import { loadBillingContext } from "./billing-context.js";
import { createStripeClient, getStripeKey } from "./stripe-factory.js";
import { logger } from "../lib/logger.js";

/* PLAN_INCLUDED_ADDONS imported from plans.ts — single source of truth */

const ONE_TIME_ADDONS = new Set(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);

export interface AddonSyncResult {
  synced: boolean;
  reason: string;
}

/**
 * Adds or removes the addon's recurring price on the org's live subscription.
 * Never throws — a Stripe failure must not undo the DB activation, but it is
 * reported so the route can surface a warning.
 */
export async function syncAddonWithStripe(
  orgId: string,
  addonKey: string,
  action: "activate" | "deactivate",
  quantity = 1
): Promise<AddonSyncResult> {
  // Use getStripeKey() so STRIPE_TEST_MODE=true is honoured (test/live isolation).
  // Never bypass getStripeKey() with raw env-var access — the test safety gate is in stripe-factory.ts.
  const stripeKey = getStripeKey();
  if (!stripeKey) return { synced: false, reason: "no_stripe_key" };
  if (ONE_TIME_ADDONS.has(addonKey)) return { synced: false, reason: "one_time_addon" };

  const priceId = ADDON_PRICE_IDS[addonKey];
  if (!priceId) return { synced: false, reason: "no_price_id" };

  try {
    const ctx = await loadBillingContext(orgId);
    const status = ctx.subscriptionStatus;
    if (status !== "active" && status !== "trialing") {
      // DB status may be stale when a webhook was missed. If the org has a Stripe
      // customer, do a live look-up to find any active subscription before giving up.
      if (!ctx.stripeCustomerId) return { synced: false, reason: "no_live_subscription" };
      const stripe = await createStripeClient(stripeKey);
      const liveSubs = await stripe.subscriptions.list({ customer: ctx.stripeCustomerId, status: "active", limit: 5 });
      const planSub = liveSubs.data.find((s: { metadata?: Record<string, string>; items?: { data?: unknown[] } }) =>
        !s.metadata?.["addonOnly"] && (s.items?.data ?? []).length > 0
      );
      if (!planSub) return { synced: false, reason: "no_live_subscription" };
      // Back-fill the DB so future calls don't need to hit Stripe again
      const { persistOrgData } = await import("./org-data.js");
      persistOrgData(orgId, {
        stripeSubscriptionId: planSub.id,
        subscriptionStatus: "active",
      }).catch(() => {});
      ctx.stripeSubscriptionId = planSub.id;
      (ctx as { subscriptionStatus: string }).subscriptionStatus = "active";
    }
    if (!ctx.stripeSubscriptionId) return { synced: false, reason: "no_subscription_id" };

    const included = PLAN_INCLUDED_ADDONS[ctx.plan.toLowerCase()] ?? new Set<string>();
    if (included.has(addonKey)) return { synced: false, reason: "included_in_plan" };

    const stripe = await createStripeClient(stripeKey);
    const sub = await stripe.subscriptions.retrieve(ctx.stripeSubscriptionId, { expand: ["items.data.price"] });
    const existing = sub.items.data.find((it: { id: string; price?: { id?: string } }) => it.price?.id === priceId);

    const qty = Math.max(1, Math.floor(Number(quantity) || 1));
    if (action === "activate") {
      if (existing) {
        // Item already on the subscription — align its quantity if it differs
        // (e.g. user increases the pack count).
        const existingQty = (existing as { quantity?: number }).quantity ?? 1;
        if (existingQty !== qty) {
          await stripe.subscriptionItems.update(existing.id, {
            quantity: qty,
            proration_behavior: "create_prorations",
          });
          logger.info({ orgId, addonKey, priceId, qty }, "[AddonSync] addon quantity updated on Stripe subscription");
          return { synced: true, reason: "quantity_updated" };
        }
        return { synced: true, reason: "already_on_subscription" };
      }
      await stripe.subscriptionItems.create({
        subscription: ctx.stripeSubscriptionId,
        price: priceId,
        quantity: qty,
        proration_behavior: "create_prorations",
      });
      logger.info({ orgId, addonKey, priceId, qty }, "[AddonSync] addon added to Stripe subscription");
      return { synced: true, reason: "item_added" };
    }

    // deactivate
    if (!existing) return { synced: true, reason: "not_on_subscription" };
    await stripe.subscriptionItems.del(existing.id, { proration_behavior: "create_prorations" });
    logger.info({ orgId, addonKey, priceId }, "[AddonSync] addon removed from Stripe subscription");
    return { synced: true, reason: "item_removed" };
  } catch (err) {
    logger.error({ err, orgId, addonKey, action }, "[AddonSync] Stripe sync failed");
    return { synced: false, reason: "stripe_error" };
  }
}
