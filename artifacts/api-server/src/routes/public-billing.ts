import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { PLAN_PRICE_IDS, ADDON_PRICE_IDS, FLAG_ADDONS, QTY_ADDONS } from "../lib/plans.js";
import { createRateLimit } from "../middlewares/rateLimiter.js";

const publicCheckoutRateLimit = createRateLimit("reportsPerHour");

const router = Router();

type AddonsMap = Record<string, boolean | number>;

/* Add-ons that are one-time purchases (not subscription items) */
const AI_CREDIT_PACKS = new Set(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);

/* Add-ons included in each plan (excluded from billing) */
const PLAN_INCLUDED_ADDONS: Record<string, Set<string>> = {
  standard: new Set([]),
  pro:      new Set(["whiteLabel"]),
  ultra:    new Set(["whiteLabel", "agencyPacks"]),
};

function buildLineItems(
  plan: string,
  addons: AddonsMap,
): {
  subscriptionItems: Array<{ price: string; quantity: number }>;
  oneTimeItems: Array<{ price: string; quantity: number }>;
  checkoutType: string;
} {
  const included = PLAN_INCLUDED_ADDONS[plan.toLowerCase()] ?? new Set();
  const subscriptionItems: Array<{ price: string; quantity: number }> = [];
  const oneTimeItems: Array<{ price: string; quantity: number }> = [];

  /* Plan */
  const planPriceId = PLAN_PRICE_IDS[plan.toLowerCase()];
  if (planPriceId) subscriptionItems.push({ price: planPriceId, quantity: 1 });

  /* Monthly flag add-ons */
  for (const key of FLAG_ADDONS) {
    if (!addons[key]) continue;
    if (included.has(key)) continue; /* skip included */
    if (AI_CREDIT_PACKS.has(key)) continue;
    const priceId = ADDON_PRICE_IDS[key];
    if (priceId) subscriptionItems.push({ price: priceId, quantity: 1 });
  }

  /* Qty add-ons */
  for (const key of QTY_ADDONS) {
    const qty = Number(addons[key] || 0);
    if (qty <= 0) continue;
    if (AI_CREDIT_PACKS.has(key)) {
      /* One-time */
      const priceId = ADDON_PRICE_IDS[key];
      if (priceId) oneTimeItems.push({ price: priceId, quantity: qty });
    } else {
      const priceId = ADDON_PRICE_IDS[key];
      if (priceId) subscriptionItems.push({ price: priceId, quantity: qty });
    }
  }

  const hasPlan  = !!planPriceId;
  const hasOneTime = oneTimeItems.length > 0;
  const hasMonthly = subscriptionItems.filter(i => i.price !== planPriceId).length > 0;

  let checkoutType: string;
  if (hasPlan) checkoutType = "subscription";
  else if (hasOneTime && !hasMonthly) checkoutType = "ai_credits_only";
  else checkoutType = "addon_only";

  return { subscriptionItems, oneTimeItems, checkoutType };
}

router.post("/public/checkout-session", publicCheckoutRateLimit, async (req: Request, res: Response) => {
  const { plan = "", addons = {}, source = "checkout_html", embedded = false } = req.body as {
    plan?: string;
    addons?: AddonsMap;
    source?: string;
    embedded?: boolean;
  };

  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "https://app.flowpoint.pro";

  const publishableKey = process.env["PUBLIC_STRIPE_API_KEY"] || "";

  /* No key in dev → mock */
  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      res.status(503).json({ error: "Payment service not configured." });
      return;
    }
    res.json({ url: `https://checkout.stripe.com/c/pay/test_mock_${plan}_${Date.now()}`, mock: true });
    return;
  }

  /* Require plan unless it's a pure addon/credits purchase */
  const planKey      = plan.toLowerCase();
  const hasPlan      = !!PLAN_PRICE_IDS[planKey];
  const addonKeys    = Object.keys(addons).filter(k => addons[k]);
  const hasOnlyAICr  = addonKeys.length > 0 && addonKeys.every(k => AI_CREDIT_PACKS.has(k));

  if (!hasPlan && !hasOnlyAICr && addonKeys.length === 0) {
    res.status(400).json({ error: "Sélectionnez un plan avant de continuer." });
    return;
  }

  /* Diagnostic log */
  const keyMode = stripeKey.startsWith("sk_live_") ? "live" : stripeKey.startsWith("sk_test_") ? "test" : "unknown";
  logger.info({
    plan, addonCount: addonKeys.length, source, keyMode,
  }, "[PublicBilling] checkout-session requested");

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    const { subscriptionItems, oneTimeItems, checkoutType } = buildLineItems(planKey, addons);

    const selectedAddonNames = addonKeys.join(",");
    /* Classify add-ons for webhook processing */
    const included       = PLAN_INCLUDED_ADDONS[planKey] ?? new Set();
    const immediateAddons = addonKeys.filter(k => !AI_CREDIT_PACKS.has(k) && !included.has(k));
    const includedAddons  = addonKeys.filter(k => included.has(k));
    const aiCredits       = addonKeys.filter(k => AI_CREDIT_PACKS.has(k));

    const finalCheckoutType = (checkoutType === "subscription" && immediateAddons.length > 0)
      ? "subscription_with_immediate_addons"
      : checkoutType;

    const metadata: Record<string, string> = {
      flowpoint_checkout_type: finalCheckoutType,
      selected_plan:           planKey || "",
      selected_addons:         selectedAddonNames,
      immediate_addons:        immediateAddons.join(","),
      included_addons:         includedAddons.join(","),
      ai_credits:              aiCredits.join(","),
      trial_plan:              hasPlan ? "true" : "false",
      addons_billed_now:       immediateAddons.length > 0 ? "true" : "false",
      source,
      flowpoint_cart:          "true",
    };

    /* ── Helper: build common embedded vs redirect params ── */
    const returnUrl = `${publicUrl}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`;
    const successUrl = `${publicUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = `${publicUrl}/cancel.html`;

    function urlOrEmbedded(params: Record<string, unknown>) {
      if (embedded) {
        return { ...params, ui_mode: "embedded", return_url: returnUrl };
      }
      return { ...params, success_url: successUrl, cancel_url: cancelUrl };
    }

    function respond(session: { id: string; url: string | null; client_secret: string | null }) {
      logger.info({ checkoutType, sessionId: session.id, embedded }, "[PublicBilling] Session created");
      if (embedded) {
        res.json({ clientSecret: session.client_secret, publishableKey });
      } else {
        res.json({ url: session.url });
      }
    }

    /* ── Case 1: subscription (with optional one-time add_invoice_items) ── */
    if (checkoutType === "subscription") {
      if (subscriptionItems.length === 0) {
        res.status(400).json({ error: "Plan invalide ou introuvable." });
        return;
      }

      const sessionParams = urlOrEmbedded({
        mode: "subscription",
        line_items: subscriptionItems,
        subscription_data: {
          trial_period_days: 14,
          metadata,
          ...(oneTimeItems.length > 0 ? {
            add_invoice_items: oneTimeItems.map(i => ({ price: i.price, quantity: i.quantity })),
          } : {}),
        },
        metadata,
      }) as Parameters<typeof stripe.checkout.sessions.create>[0];

      const session = await stripe.checkout.sessions.create(sessionParams);
      respond(session as { id: string; url: string | null; client_secret: string | null });
      return;
    }

    /* ── Case 2: AI credits only → one-time payment ── */
    if (checkoutType === "ai_credits_only") {
      if (oneTimeItems.length === 0) {
        res.status(400).json({ error: "Aucun pack IA sélectionné." });
        return;
      }
      const sessionParams = urlOrEmbedded({
        mode: "payment",
        line_items: oneTimeItems,
        metadata,
      }) as Parameters<typeof stripe.checkout.sessions.create>[0];

      const session = await stripe.checkout.sessions.create(sessionParams);
      respond(session as { id: string; url: string | null; client_secret: string | null });
      return;
    }

    /* ── Case 3: addon_only (client with active plan) ── */
    if (checkoutType === "addon_only") {
      const allItems = [...subscriptionItems, ...oneTimeItems];
      if (allItems.length === 0) {
        res.status(400).json({ error: "Aucun add-on valide sélectionné." });
        return;
      }
      const sessionParams = urlOrEmbedded({
        mode: "subscription",
        line_items: allItems,
        metadata,
      }) as Parameters<typeof stripe.checkout.sessions.create>[0];

      const session = await stripe.checkout.sessions.create(sessionParams);
      respond(session as { id: string; url: string | null; client_secret: string | null });
      return;
    }

    res.status(400).json({ error: "Sélection invalide." });
  } catch (err) {
    logger.error({ err }, "[PublicBilling] Failed to create checkout session");
    res.status(500).json({ error: "Erreur lors de la création de la session. Réessayez." });
  }
});

export default router;
