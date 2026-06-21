import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { PLAN_PRICE_IDS, ADDON_PRICE_IDS, FLAG_ADDONS, QTY_ADDONS } from "../lib/plans.js";
import { createRateLimit } from "../middlewares/rateLimiter.js";

const publicCheckoutRateLimit = createRateLimit("reportsPerHour");

const router = Router();

type AddonsMap = Record<string, boolean | number>;

function buildPublicLineItems(plan: string, addons: AddonsMap): Array<{ price: string; quantity: number }> {
  const items: Array<{ price: string; quantity: number }> = [];
  const planPriceId = PLAN_PRICE_IDS[plan.toLowerCase()];
  if (planPriceId) items.push({ price: planPriceId, quantity: 1 });
  for (const key of FLAG_ADDONS) {
    if (!addons[key]) continue;
    const priceId = ADDON_PRICE_IDS[key];
    if (priceId) items.push({ price: priceId, quantity: 1 });
  }
  for (const key of QTY_ADDONS) {
    const qty = Number(addons[key] || 0);
    if (qty <= 0) continue;
    const priceId = ADDON_PRICE_IDS[key];
    if (priceId) items.push({ price: priceId, quantity: qty });
  }
  return items;
}

router.post("/public/checkout-session", publicCheckoutRateLimit, async (req: Request, res: Response) => {
  const { plan = "", addons = {} } = req.body as { plan?: string; addons?: AddonsMap };

  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      res.status(503).json({ error: "Payment service not configured." });
      return;
    }
    res.json({ url: `https://checkout.stripe.com/c/pay/test_mock_${plan}_${Date.now()}`, mock: true });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    const lineItems = buildPublicLineItems(plan, addons);

    if (lineItems.length === 0) {
      if (process.env["NODE_ENV"] !== "production") {
        res.json({ url: `https://checkout.stripe.com/c/pay/test_mock_${plan}_${Date.now()}`, mock: true });
        return;
      }
      res.status(400).json({ error: "No valid plan or add-ons selected." });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: lineItems,
      subscription_data: { trial_period_days: 14 },
      success_url: `${publicUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicUrl}/pricing.html`,
      metadata: {
        plan,
        addons: JSON.stringify(addons),
        source: "public_pricing",
        flowpoint_cart: "true",
      },
    });

    logger.info({ plan, sessionId: session.id }, "[PublicBilling] Checkout session created");
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "[PublicBilling] Failed to create checkout session");
    res.status(500).json({ error: "Failed to create checkout session. Please try again." });
  }
});

export default router;
