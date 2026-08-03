/**
 * Addon ↔ Stripe subscription sync.
 *
 * When a subscribed (active/trialing) org activates a paid add-on from the
 * dashboard, the add-on must be billed on the existing Stripe subscription —
 * no pricing/cart detour. Included-in-plan add-ons and one-time AI credit
 * packs are never added as subscription items.
 */
import { ADDON_PRICE_IDS } from "../lib/plans.js";
import { loadBillingContext } from "./billing-context.js";
import { createStripeClient } from "./stripe-factory.js";
import { logger } from "../lib/logger.js";

const PLAN_INCLUDED_ADDONS: Record<string, Set<string>> = {
  // Mirrors billing.ts / public-billing.ts canonical inclusion matrix
  standard: new Set(["whiteLabel"]),
  pro:      new Set(["whiteLabel", "customDomain", "advancedWebhooks", "retention90d", "advancedSeoLab", "backlinkIntelligence"]),
  ultra:    new Set(["whiteLabel", "customDomain", "advancedWebhooks", "retention90d", "advancedSeoLab", "backlinkIntelligence",
                     "retention365d", "keywordDomination", "behavioralAI", "aiForecasting"]),
};

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
  action: "activate" | "deactivate"
): Promise<AddonSyncResult> {
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  if (!stripeKey) return { synced: false, reason: "no_stripe_key" };
  if (ONE_TIME_ADDONS.has(addonKey)) return { synced: false, reason: "one_time_addon" };

  const priceId = ADDON_PRICE_IDS[addonKey];
  if (!priceId) return { synced: false, reason: "no_price_id" };

  try {
    const ctx = await loadBillingContext(orgId);
    const status = ctx.subscriptionStatus;
    if (status !== "active" && status !== "trialing") return { synced: false, reason: "no_live_subscription" };
    if (!ctx.stripeSubscriptionId) return { synced: false, reason: "no_subscription_id" };

    const included = PLAN_INCLUDED_ADDONS[ctx.plan.toLowerCase()] ?? new Set<string>();
    if (included.has(addonKey)) return { synced: false, reason: "included_in_plan" };

    const stripe = await createStripeClient(stripeKey);
    const sub = await stripe.subscriptions.retrieve(ctx.stripeSubscriptionId, { expand: ["items.data.price"] });
    const existing = sub.items.data.find((it: { id: string; price?: { id?: string } }) => it.price?.id === priceId);

    if (action === "activate") {
      if (existing) return { synced: true, reason: "already_on_subscription" };
      await stripe.subscriptionItems.create({
        subscription: ctx.stripeSubscriptionId,
        price: priceId,
        quantity: 1,
        proration_behavior: "create_prorations",
      });
      logger.info({ orgId, addonKey, priceId }, "[AddonSync] addon added to Stripe subscription");
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
