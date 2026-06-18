import { Router, type Request, type Response } from "express";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { getPlanForPriceId, getAddonForPriceId, FLAG_ADDONS, QTY_ADDONS } from "../lib/plans.js";

const router = Router();

function parsePlanFromSubscription(subscription: Record<string, unknown>): string | null {
  const items = subscription.items as { data?: Array<{ price?: { id?: string; nickname?: string; metadata?: Record<string, string> } }> } | undefined;
  if (!items?.data?.length) return null;

  for (const item of items.data) {
    const price = item?.price;
    if (!price) continue;
    if (price.metadata?.["plan"]) return price.metadata["plan"];
    if (price.id) {
      const found = getPlanForPriceId(price.id);
      if (found) return found;
    }
    if (price.nickname && ["standard","pro","ultra"].includes(price.nickname.toLowerCase())) {
      return price.nickname.toLowerCase();
    }
  }
  return null;
}

function syncAddonsFromSubscription(subscription: Record<string, unknown>) {
  const items = subscription.items as { data?: Array<{ price?: { id?: string }; quantity?: number }> } | undefined;
  if (!items?.data?.length) return;

  for (const item of items.data) {
    if (!item.price?.id) continue;
    const addonKey = getAddonForPriceId(item.price.id);
    if (!addonKey) continue;

    if (FLAG_ADDONS.has(addonKey) && addonKey !== "whiteLabel") {
      (store.me.addons as Record<string, boolean | number>)[addonKey] = true;
    } else if (QTY_ADDONS.has(addonKey)) {
      (store.me.addons as Record<string, boolean | number>)[addonKey] = Number(item.quantity ?? 1);
    }
  }
}

async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"];

  let event: { type: string; data: { object: Record<string, unknown> } };

  if (stripeKey && webhookSecret) {
    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
      const sig = req.headers["stripe-signature"] as string;
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
      if (!rawBody) { res.status(400).json({ error: "Raw body required" }); return; }
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret) as unknown as typeof event;
    } catch (err) {
      logger.error({ err }, "[Webhook] Signature verification failed");
      res.status(400).json({ error: "Webhook signature verification failed" });
      return;
    }
  } else {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("[Webhook] Missing Stripe credentials in production — rejecting");
      res.status(503).json({ error: "Webhook verification unavailable" });
      return;
    }
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    try {
      event = rawBody ? JSON.parse(rawBody.toString("utf-8")) : req.body;
    } catch {
      event = req.body as typeof event;
    }
    logger.warn("[Webhook] Dev mode: processing without signature verification");
  }

  // ── Idempotency guard — skip events already processed ────────────────────
  const eventId = (event as unknown as { id?: string }).id;
  if (eventId) {
    try {
      const { pool: pgPool } = await import("@workspace/db");
      const idClient = await pgPool.connect();
      try {
        const { rowCount } = await idClient.query(
          `INSERT INTO billing_events (org_id, type, stripe_event_id, amount, currency, metadata)
           VALUES ('default', $1, $2, 0, 'eur', '{}')
           ON CONFLICT (stripe_event_id) DO NOTHING`,
          [event.type, eventId]
        );
        if ((rowCount ?? 0) === 0) {
          logger.info({ eventId, type: event.type }, "[Webhook] Duplicate event — already processed, skipping");
          res.json({ received: true, duplicate: true });
          return;
        }
      } finally {
        idClient.release();
      }
    } catch (e) {
      // Non-fatal — if dedup fails, still process the event (prefer double-process over drop)
      logger.warn({ e, eventId }, "[Webhook] Idempotency check failed — processing anyway");
    }
  }

  logger.info({ type: event.type }, "[Webhook] Received Stripe event");
  const obj = event.data.object;

  switch (event.type) {

    case "checkout.session.completed": {
      const plan = String(obj["metadata"] && (obj["metadata"] as Record<string,string>)["plan"] || "");
      const planNorm = plan.toLowerCase();
      if (["standard","pro","ultra"].includes(planNorm)) {
        store.broadcastPlanUpdate(planNorm);
      }
      if (obj["customer"]) store.me.stripeCustomerId = String(obj["customer"]);
      store.me.subscriptionStatus = "active";
      logger.info({ plan: planNorm }, "[Webhook] Checkout session completed");
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const newPlan = parsePlanFromSubscription(obj);
      const status = String(obj["status"] || "active");

      store.me.subscriptionStatus = status;

      if (newPlan) {
        logger.info({ newPlan, status }, "[Webhook] Subscription updated — broadcasting plan change");
        store.broadcastPlanUpdate(newPlan);
      }

      syncAddonsFromSubscription(obj);

      // Persist activated add-ons to DB
      try {
        const { activateAddon } = await import("../services/addons-service.js");
        const addons = store.me.addons as Record<string, boolean | number>;
        for (const [key, val] of Object.entries(addons)) {
          if (val === true || (typeof val === "number" && val > 0)) {
            await activateAddon(key).catch(() => {});
          }
        }
      } catch { /* non-critical */ }

      if (status === "past_due" || status === "unpaid" || status === "canceled") {
        store.broadcast({ type: "subscription_status", status });
      }
      break;
    }

    case "customer.subscription.deleted": {
      logger.info("[Webhook] Subscription deleted — downgrading to standard");
      store.me.subscriptionStatus = "canceled";
      store.me.addons.customDomain = false;
      store.me.addons.prioritySupport = false;
      store.me.addons.extraSeats = 0;
      store.me.addons.monitorsPack50 = 0;
      store.me.addons.whiteLabel = false;
      store.me.addons.retention90d = false;
      store.me.addons.retention365d = false;
      const client2 = await (await import("@workspace/db")).pool.connect();
      try {
        await client2.query(`UPDATE org_addons SET active = false, updated_at = NOW() WHERE org_id = 'default'`);
      } finally { client2.release(); }
      store.broadcastPlanUpdate("standard");
      break;
    }

    case "invoice.payment_succeeded": {
      logger.info("[Webhook] Payment succeeded");
      store.me.subscriptionStatus = "active";
      store.broadcast({ type: "payment_succeeded" });
      // Persist active add-ons to DB on successful payment
      try {
        const { activateAddon } = await import("../services/addons-service.js");
        const addons = store.me.addons as Record<string, boolean | number>;
        for (const [key, val] of Object.entries(addons)) {
          if (val === true || (typeof val === "number" && val > 0)) {
            await activateAddon(key).catch(() => {});
          }
        }
      } catch { /* non-critical */ }
      break;
    }

    case "invoice.payment_failed": {
      const attemptCount = Number(obj["attempt_count"] || 1);
      logger.warn({ attemptCount }, "[Webhook] Payment failed");
      store.me.subscriptionStatus = "past_due";
      store.broadcast({ type: "payment_failed", attemptCount });
      break;
    }

    case "customer.updated": {
      if (obj["id"]) store.me.stripeCustomerId = String(obj["id"]);
      break;
    }

    default:
      logger.info({ type: event.type }, "[Webhook] Unhandled Stripe event type");
  }

  res.json({ received: true });
}

// Canonical path + legacy path active in Stripe Dashboard
router.post("/webhooks/stripe", handleStripeWebhook);
router.post("/billing/webhook", handleStripeWebhook);

export default router;
