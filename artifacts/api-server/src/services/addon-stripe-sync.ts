/**
 * Addon ↔ Stripe subscription sync.
 *
 * ── Architecture (P0-B) ───────────────────────────────────────────────────────
 * Paid add-ons live on a SEPARATE Stripe subscription per org, tagged with
 * metadata { addonSub: "true", orgId }.  This gives each add-on its own
 * independent monthly billing cycle starting from the purchase date, decoupled
 * from the plan subscription's renewal date.
 *
 * Backward-compatibility rule:
 *   If an add-on's price is already present on the PLAN subscription (legacy
 *   placement), it stays there and its quantity is updated in place.  New
 *   items always go onto the add-on subscription.  This prevents double-billing
 *   for existing customers without requiring a manual migration.
 *
 * Add-on subscription creation:
 *   - billing_cycle_anchor: "now"  → fresh 30-day cycle from activation date
 *   - payment_behavior: "default_incomplete" → requires payment before active
 *   - metadata: { addonSub: "true", orgId: "<uuid>" }
 *   - proration_behavior: "none" on item changes (cycle already anchored fresh)
 *
 * Migration procedure for existing items on plan subscription:
 *   To move monitorsPack10 (or any add-on) from the plan sub to the add-on sub:
 *   1. Deactivate via POST /api/addons/monitorsPack10/deactivate  → removes from plan sub
 *   2. Re-activate  via POST /api/addons/monitorsPack10/activate { quantity: 2 }
 *      → creates an add-on subscription with a fresh monthly cycle
 *   Do NOT perform this automatically without the user's consent as it creates a
 *   new billing cycle and prorations.
 */

import { ADDON_PRICE_IDS, PLAN_INCLUDED_ADDONS, getPlanForPriceId } from "../lib/plans.js";
import { loadBillingContext } from "./billing-context.js";
import { createStripeClient, getStripeKey } from "./stripe-factory.js";
import { logger } from "../lib/logger.js";

/* PLAN_INCLUDED_ADDONS imported from plans.ts — single source of truth */

const ONE_TIME_ADDONS = new Set(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);

export interface AddonSyncResult {
  synced: boolean;
  reason: string;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/** Return the stripe instance, or null when not configured. */
async function getStripe() {
  const key = getStripeKey();
  if (!key) return null;
  return createStripeClient(key);
}

type StripeSubItem = { id: string; price?: { id?: string }; quantity?: number };

/**
 * Find the first active/trialing plan subscription for this org (not an add-on sub).
 * Returns null when the org has no live plan sub.
 */
async function findPlanSubscription(
  stripe: Awaited<ReturnType<typeof createStripeClient>>,
  stripeCustomerId: string,
  orgId: string,
): Promise<{ id: string; items: { data: StripeSubItem[] } } | null> {
  const subs = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "active",
    limit: 10,
    expand: ["data.items.data.price"],
  });

  type StripeSub = { id: string; metadata?: Record<string, string>; status: string; items?: { data?: StripeSubItem[] } };

  const isFlowPointPlanSub = (s: StripeSub): boolean => {
    if (s.metadata?.["addonSub"]) return false; // exclude addon subs
    const items = s.items?.data ?? [];
    return items.length > 0 && items.some(it => getPlanForPriceId(it.price?.id ?? "") !== null);
  };

  const planSub: StripeSub | undefined =
    subs.data.find((s: StripeSub) => s.metadata?.["orgId"] === orgId && !s.metadata?.["addonSub"]) ??
    subs.data.find((s: StripeSub) => isFlowPointPlanSub(s)) ??
    subs.data.find((s: StripeSub) => !s.metadata?.["addonSub"] && (s.items?.data ?? []).length > 0);

  if (!planSub) return null;
  return planSub as { id: string; items: { data: StripeSubItem[] } };
}

/**
 * Find or create the org's dedicated add-on subscription.
 * The subscription is tagged with metadata.addonSub="true" and metadata.orgId=orgId.
 * It uses billing_cycle_anchor:"now" for an independent monthly cycle.
 */
async function findOrCreateAddonSubscription(
  stripe: Awaited<ReturnType<typeof createStripeClient>>,
  stripeCustomerId: string,
  orgId: string,
  firstPriceId: string,
  firstQty: number,
): Promise<{ id: string; items: { data: StripeSubItem[] } }> {
  // Search for an existing add-on sub for this org
  const existing = await stripe.subscriptions.list({
    customer: stripeCustomerId,
    status: "active",
    limit: 10,
    expand: ["data.items.data.price"],
  });

  type StripeSub = { id: string; metadata?: Record<string, string>; items?: { data?: StripeSubItem[] } };
  const addonSub = (existing.data as StripeSub[]).find(
    s => s.metadata?.["addonSub"] === "true" && s.metadata?.["orgId"] === orgId,
  );
  if (addonSub) return addonSub as { id: string; items: { data: StripeSubItem[] } };

  // Create a fresh add-on subscription with a billing cycle starting today
  const created = await stripe.subscriptions.create({
    customer: stripeCustomerId,
    items: [{ price: firstPriceId, quantity: firstQty }],
    metadata: { addonSub: "true", orgId },
    payment_behavior: "default_incomplete",
    expand: ["items.data.price"],
  } as Parameters<typeof stripe.subscriptions.create>[0]);
  logger.info(
    { orgId, subId: created.id, stripeCustomerId, firstPriceId, firstQty },
    "[AddonSync] Created dedicated add-on subscription",
  );
  return created as unknown as { id: string; items: { data: StripeSubItem[] } };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Adds or removes the addon's recurring price on the appropriate Stripe subscription.
 *
 * Activation strategy:
 *   1. Check the plan subscription — if the price is already there (legacy), update qty in place.
 *   2. Check the add-on subscription — if the price is already there, update qty.
 *   3. If the price is on neither: add it to the add-on subscription (creating it if needed).
 *
 * Deactivation strategy:
 *   Remove the item from whichever subscription holds it (plan sub or add-on sub).
 *   If the add-on subscription becomes empty after removal, cancel it immediately.
 *
 * Never throws — a Stripe failure must not undo the DB activation, but it is
 * reported so the route can surface a warning.
 */
export async function syncAddonWithStripe(
  orgId: string,
  addonKey: string,
  action: "activate" | "deactivate",
  quantity = 1,
): Promise<AddonSyncResult> {
  const stripeKey = getStripeKey();
  if (!stripeKey) return { synced: false, reason: "no_stripe_key" };
  if (ONE_TIME_ADDONS.has(addonKey)) return { synced: false, reason: "one_time_addon" };

  const priceId = ADDON_PRICE_IDS[addonKey];
  if (!priceId) return { synced: false, reason: "no_price_id" };

  try {
    const ctx = await loadBillingContext(orgId);

    // Ensure we have an active subscription context
    if (ctx.subscriptionStatus !== "active" && ctx.subscriptionStatus !== "trialing") {
      if (!ctx.stripeCustomerId) return { synced: false, reason: "no_live_subscription" };
      const stripe = await createStripeClient(stripeKey);
      const liveSubs = await stripe.subscriptions.list({
        customer: ctx.stripeCustomerId,
        status: "active",
        limit: 10,
        expand: ["data.items.data.price"],
      });
      type StripeSub = { id: string; metadata?: Record<string, string>; items?: { data?: StripeSubItem[] } };
      const isFlowPointPlanSub = (s: StripeSub) => {
        if (s.metadata?.["addonSub"]) return false;
        const items = s.items?.data ?? [];
        return items.length > 0 && items.some(it => getPlanForPriceId(it.price?.id ?? "") !== null);
      };
      const planSub: StripeSub | undefined =
        liveSubs.data.find((s: StripeSub) => s.metadata?.["orgId"] === orgId && !s.metadata?.["addonSub"]) ??
        liveSubs.data.find((s: StripeSub) => isFlowPointPlanSub(s)) ??
        liveSubs.data.find((s: StripeSub) => !s.metadata?.["addonSub"] && (s.items?.data ?? []).length > 0);
      if (!planSub) return { synced: false, reason: "no_live_subscription" };
      const { persistOrgData } = await import("./org-data.js");
      persistOrgData(orgId, { stripeSubscriptionId: planSub.id, subscriptionStatus: "active" }).catch(() => {});
      ctx.stripeSubscriptionId = planSub.id;
      (ctx as { subscriptionStatus: string }).subscriptionStatus = "active";
    }

    if (!ctx.stripeCustomerId) return { synced: false, reason: "no_subscription_id" };

    const included = PLAN_INCLUDED_ADDONS[ctx.plan.toLowerCase()] ?? new Set<string>();
    if (included.has(addonKey)) return { synced: false, reason: "included_in_plan" };

    const stripe = await createStripeClient(stripeKey);
    const qty = Math.max(1, Math.floor(Number(quantity) || 1));

    // ── Locate the item: check PLAN sub first (backward compat), then ADDON sub ──
    let itemOnPlanSub: StripeSubItem | undefined;
    let planSubId: string | null = null;

    if (ctx.stripeSubscriptionId) {
      try {
        const planSub = await stripe.subscriptions.retrieve(ctx.stripeSubscriptionId, {
          expand: ["items.data.price"],
        });
        itemOnPlanSub = (planSub.items.data as StripeSubItem[]).find(it => it.price?.id === priceId);
        planSubId = planSub.id;
      } catch (_e) {
        // Subscription may not exist in current Stripe mode — continue
      }
    }

    // Check the dedicated add-on subscription
    let itemOnAddonSub: StripeSubItem | undefined;
    let addonSubId: string | null = null;
    {
      const existingAddonSubs = await stripe.subscriptions.list({
        customer: ctx.stripeCustomerId,
        status: "active",
        limit: 10,
        expand: ["data.items.data.price"],
      });
      type StripeSub = { id: string; metadata?: Record<string, string>; items?: { data?: StripeSubItem[] } };
      const addonSub = (existingAddonSubs.data as StripeSub[]).find(
        s => s.metadata?.["addonSub"] === "true" && s.metadata?.["orgId"] === orgId,
      );
      if (addonSub) {
        addonSubId = addonSub.id;
        itemOnAddonSub = (addonSub.items?.data ?? []).find(it => it.price?.id === priceId);
      }
    }

    // ── ACTIVATE ──────────────────────────────────────────────────────────────
    if (action === "activate") {
      // Case 1: item is on the plan sub (legacy) — update quantity in place
      if (itemOnPlanSub && planSubId) {
        const existingQty = (itemOnPlanSub as { quantity?: number }).quantity ?? 1;
        if (existingQty !== qty) {
          await stripe.subscriptionItems.update(itemOnPlanSub.id, {
            quantity: qty,
            proration_behavior: "create_prorations",
          });
          logger.info({ orgId, addonKey, priceId, qty, subId: planSubId },
            "[AddonSync] Qty updated on PLAN subscription (legacy placement — kept in place)");
          return { synced: true, reason: "quantity_updated" };
        }
        return { synced: true, reason: "already_on_subscription" };
      }

      // Case 2: item is already on the add-on sub — update quantity
      if (itemOnAddonSub && addonSubId) {
        const existingQty = (itemOnAddonSub as { quantity?: number }).quantity ?? 1;
        if (existingQty !== qty) {
          await stripe.subscriptionItems.update(itemOnAddonSub.id, {
            quantity: qty,
            proration_behavior: "none",
          });
          logger.info({ orgId, addonKey, priceId, qty, subId: addonSubId },
            "[AddonSync] Qty updated on ADD-ON subscription");
          return { synced: true, reason: "quantity_updated" };
        }
        return { synced: true, reason: "already_on_subscription" };
      }

      // Case 3: new item — add to (or create) the dedicated add-on subscription
      // This gives it an independent billing cycle starting today.
      if (!ctx.stripeCustomerId) return { synced: false, reason: "no_subscription_id" };

      const addonSub = await findOrCreateAddonSubscription(
        stripe, ctx.stripeCustomerId, orgId, priceId, qty,
      );

      // If the subscription was freshly created, the first item is already there
      const itemAlreadyAdded = (addonSub.items.data ?? []).some(it => it.price?.id === priceId);
      if (!itemAlreadyAdded) {
        await stripe.subscriptionItems.create({
          subscription: addonSub.id,
          price: priceId,
          quantity: qty,
          proration_behavior: "none",
        });
      }
      logger.info({ orgId, addonKey, priceId, qty, subId: addonSub.id },
        "[AddonSync] Addon added to dedicated ADD-ON subscription (independent billing cycle)");
      return { synced: true, reason: "item_added" };
    }

    // ── DEACTIVATE ────────────────────────────────────────────────────────────

    // Remove from whichever subscription holds the item
    const targetItem = itemOnPlanSub ?? itemOnAddonSub;
    const targetSubId = itemOnPlanSub ? planSubId : addonSubId;

    if (!targetItem || !targetSubId) {
      return { synced: true, reason: "not_on_subscription" };
    }

    await stripe.subscriptionItems.del(targetItem.id, { proration_behavior: "create_prorations" });
    logger.info({ orgId, addonKey, priceId, subId: targetSubId },
      "[AddonSync] Addon item removed from subscription");

    // If this was the add-on subscription and it's now empty, cancel it immediately
    if (itemOnAddonSub && addonSubId) {
      try {
        const refreshed = await stripe.subscriptions.retrieve(addonSubId, {
          expand: ["items.data.price"],
        });
        if (refreshed.items.data.length === 0) {
          await stripe.subscriptions.cancel(addonSubId);
          logger.info({ orgId, subId: addonSubId },
            "[AddonSync] Add-on subscription cancelled (no remaining items)");
        }
      } catch (e) {
        // Non-critical: log and continue (subscription may already be gone)
        logger.warn({ err: e, orgId, addonSubId },
          "[AddonSync] Could not check/cancel empty add-on subscription");
      }
    }

    return { synced: true, reason: "item_removed" };
  } catch (err) {
    const errMsg = String((err as { message?: string })?.message ?? err ?? "");
    const isNoSuch = /No such subscription|resource_missing|does not exist/i.test(errMsg);
    if (isNoSuch) {
      logger.warn({ orgId, addonKey, action, errMsg },
        "[AddonSync] Subscription not found in current Stripe mode — treating as no_live_subscription");
      return { synced: false, reason: "no_live_subscription" };
    }
    logger.error({ err, orgId, addonKey, action }, "[AddonSync] Stripe sync failed");
    return { synced: false, reason: "stripe_error" };
  }
}
