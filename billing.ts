import { Router, type Request, type Response } from "express";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";

const router = Router();

router.post("/billing/portal", async (_req: Request, res: Response) => {
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  const returnUrl = process.env["STRIPE_RETURN_URL"] || `${process.env["PUBLIC_URL"] || "http://localhost:3000"}/dashboard`;

  if (!stripeKey) {
    logger.warn("[Billing] STRIPE_SECRET_KEY not set — returning mock portal URL");
    res.json({ url: `https://billing.stripe.com/p/session/test_mock_${Date.now()}` });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    let customerId = store.me.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: "mael@flowpoint.pro",
        name: store.me.firstName,
        metadata: { plan: store.me.plan },
      });
      customerId = customer.id;
      store.me.stripeCustomerId = customerId;
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create Stripe portal session");
    res.status(500).json({ error: "Failed to create billing portal session" });
  }
});

router.post("/billing/checkout", async (req: Request, res: Response) => {
  const { plan } = req.body as { plan?: string };
  if (!plan) { res.status(400).json({ error: "plan required" }); return; }

  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";

  const PLAN_PRICES: Record<string, string> = {
    pro: process.env["STRIPE_PRICE_PRO"] || "price_pro_placeholder",
    ultra: process.env["STRIPE_PRICE_ULTRA"] || "price_ultra_placeholder",
    starter: process.env["STRIPE_PRICE_STARTER"] || "price_starter_placeholder",
  };

  if (!stripeKey) {
    logger.warn("[Billing] STRIPE_SECRET_KEY not set — returning mock checkout URL");
    const mockUrl = `https://checkout.stripe.com/c/pay/test_mock_${plan}_${Date.now()}`;
    res.json({ url: mockUrl, plan, mock: true });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    const priceId = PLAN_PRICES[plan.toLowerCase()];
    if (!priceId || priceId.includes("placeholder")) {
      res.status(400).json({ error: `No Stripe price configured for plan: ${plan}. Set STRIPE_PRICE_${plan.toUpperCase()} env var.` });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${publicUrl}/api/dashboard/dashboard.html?plan=${plan}&checkout=success`,
      cancel_url: `${publicUrl}/api/dashboard/dashboard.html?checkout=cancelled`,
      metadata: { plan },
    });

    res.json({ url: session.url, plan });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create Stripe checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

router.get("/billing/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`data: ${JSON.stringify({ type: "connected", plan: store.me.plan })}\n\n`);

  const send = (data: string) => res.write(data);
  store.sseClients.add(send);

  const keepAlive = setInterval(() => {
    res.write(": ping\n\n");
  }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    store.sseClients.delete(send);
  });
});

export default router;
