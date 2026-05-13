import { Router, type Request, type Response } from "express";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";

const router = Router();

const PLAN_MAP: Record<string, string> = {
  "price_starter": "Starter",
  "price_pro": "Pro",
  "price_agency": "Agency",
  "price_ultra": "Ultra",
};

function parsePlanFromSubscription(subscription: Record<string, unknown>): string | null {
  const items = subscription.items as { data?: Array<{ price?: { id?: string; nickname?: string; metadata?: Record<string, string> } }> } | undefined;
  if (!items?.data?.length) return null;
  const price = items.data[0]?.price;
  if (!price) return null;
  if (price.metadata?.["plan"]) return price.metadata["plan"];
  if (price.nickname) return price.nickname;
  if (price.id && PLAN_MAP[price.id]) return PLAN_MAP[price.id];
  return null;
}

router.post("/webhooks/stripe", async (req: Request, res: Response) => {
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];

  let event: { type: string; data: { object: Record<string, unknown> } };

  if (stripeKey && webhookSecret) {
    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
      const sig = req.headers["stripe-signature"] as string;
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!rawBody) {
        res.status(400).json({ error: "Raw body required for webhook verification" });
        return;
      }
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret) as unknown as typeof event;
    } catch (err) {
      logger.error({ err }, "[Webhook] Stripe signature verification failed");
      res.status(400).json({ error: "Webhook signature verification failed" });
      return;
    }
  } else {
    const isProduction = process.env["NODE_ENV"] === "production";
    if (isProduction) {
      logger.error("[Webhook] STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET missing in production — rejecting unsigned webhook");
      res.status(503).json({ error: "Webhook verification unavailable: Stripe credentials not configured" });
      return;
    }
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    try {
      const parsed = rawBody ? JSON.parse(rawBody.toString("utf-8")) : req.body;
      event = parsed as typeof event;
    } catch {
      event = req.body as typeof event;
    }
    logger.warn("[Webhook] Development mode: processing webhook without signature verification (set STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET for production)");
  }

  logger.info({ type: event.type }, "[Webhook] Received Stripe event");

  switch (event.type) {
    case "customer.subscription.updated": {
      const subscription = event.data.object;
      const newPlan = parsePlanFromSubscription(subscription);
      const status = String(subscription["status"] || "active");

      if (newPlan) {
        logger.info({ newPlan }, "[Webhook] Subscription updated — broadcasting plan change");
        store.me.subscriptionStatus = status;
        store.broadcastPlanUpdate(newPlan);
      }

      if (status === "past_due" || status === "unpaid") {
        store.me.subscriptionStatus = status;
        store.sseClients.forEach((send) => {
          send(`data: ${JSON.stringify({ type: "subscription_status", status })}\n\n`);
        });
      }
      break;
    }

    case "customer.subscription.deleted": {
      logger.info("[Webhook] Subscription deleted — downgrading to Starter");
      store.me.subscriptionStatus = "canceled";
      store.broadcastPlanUpdate("Starter");
      break;
    }

    case "invoice.payment_succeeded": {
      logger.info("[Webhook] Payment succeeded");
      store.me.subscriptionStatus = "active";
      store.sseClients.forEach((send) => {
        send(`data: ${JSON.stringify({ type: "payment_succeeded" })}\n\n`);
      });
      break;
    }

    default:
      logger.info({ type: event.type }, "[Webhook] Unhandled Stripe event type");
  }

  res.json({ received: true });
});

export default router;
