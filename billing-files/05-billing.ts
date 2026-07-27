import { Router, type Request, type Response } from "express";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { ownerOnly } from "../middlewares/requireRole.js";
import { PLAN_PRICE_IDS, ADDON_PRICE_IDS, FLAG_ADDONS, QTY_ADDONS, PLAN_LIMITS } from "../lib/plans.js";
import { upsertOrgSettings, loadOrgSettings } from "../services/org-settings.js";
import { loadBillingContext } from "../services/billing-context.js";
import { createStripeClient } from "../services/stripe-factory.js";
import { ensureStripeCustomer } from "../services/ensure-stripe-customer.js";
import {
  getUsageSummary, getMRRData, getSubscriptionAnalytics,
  startTrial, validateCoupon, getInvoices, trackBillingEvent,
} from "../services/billing-service.js";
import { mailer } from "../services/mailer.js";
import { createRateLimit } from "../middlewares/rateLimiter.js";

/* Add-ons included in each plan — same source as public-billing.ts */
const PLAN_INCLUDED_ADDONS: Record<string, Set<string>> = {
  standard: new Set([]),
  pro:      new Set(["whiteLabel"]),
  ultra:    new Set(["whiteLabel", "agencyPacks"]),
};

/** Dedicated billing rate limiters — do NOT share quota with reports/exports. */
const billingPortalRateLimit   = createRateLimit("billingPortalPerMinute");
const billingCheckoutRateLimit = createRateLimit("billingCheckoutPerMinute");

// ── Stripe diagnostics gate ───────────────────────────────────────────────────
// Evaluated once at module load. Trim + lowercase so Render's " true" or "True"
// all resolve correctly. Never log the raw variable value.
const diagnosticsEnabled =
  String(process.env.BILLING_STRIPE_DIAGNOSTICS ?? "").trim().toLowerCase() === "true";

logger.info({
  event:           "billing_stripe_diagnostics_config",
  enabled:         diagnosticsEnabled,
  variablePresent: process.env.BILLING_STRIPE_DIAGNOSTICS != null,
}, "[Billing] diagnostics configuration");

const router = Router();

type AddonsMap = Record<string, boolean | number>;

function buildLineItems(plan: string, addons: AddonsMap): Array<{ price: string; quantity: number }> {
  const items: Array<{ price: string; quantity: number }> = [];
  const included = PLAN_INCLUDED_ADDONS[plan.toLowerCase()] ?? new Set<string>();

  const planPriceId = PLAN_PRICE_IDS[plan.toLowerCase()];
  if (planPriceId) items.push({ price: planPriceId, quantity: 1 });

  for (const key of FLAG_ADDONS) {
    if (!addons[key]) continue;
    if (included.has(key)) continue;
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

router.post("/billing/create-checkout-session", billingCheckoutRateLimit, async (req: Request, res: Response) => {
  res.redirect(307, "/api/billing/checkout");
});

// ── POST /billing/checkout ───────────────────────────────────────────────────
router.post("/billing/checkout", billingCheckoutRateLimit, async (req: Request, res: Response) => {
  const { plan = "", addons = {} } = req.body as { plan?: string; addons?: AddonsMap };
  const orgId = req.orgId ?? "default";

  // Load billing state from DB — never from the in-memory store singleton
  const billingCtx = await loadBillingContext(orgId);

  // Guard: reject if a subscription is already active — direct to upgrade instead
  const currentStatus = billingCtx.subscriptionStatus;
  if (currentStatus === "active" || currentStatus === "trialing") {
    logger.warn({ currentStatus, plan, orgId }, "[Billing] checkout blocked — subscription already active");
    res.status(409).json({
      error: "subscription_already_active",
      message: "Vous avez déjà un abonnement actif. Utilisez la mise à niveau pour changer de plan.",
      redirectTo: "/api/billing/upgrade",
    });
    return;
  }

  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("[Billing] STRIPE_SECRET_KEY not set in production — checkout unavailable");
      res.status(503).json({ error: "Payment service not configured. Contact support." });
      return;
    }
    logger.warn("[Billing] STRIPE_SECRET_KEY not set — returning mock checkout URL (dev only)");
    res.json({ url: `https://checkout.stripe.com/c/pay/test_mock_${plan}_${Date.now()}`, plan, mock: true });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);

    const lineItems = buildLineItems(plan, addons);

    if (lineItems.length === 0) {
      if (process.env["NODE_ENV"] !== "production") {
        logger.warn(`[Billing] No price IDs configured for plan="${plan}" — returning mock checkout (dev only)`);
        res.json({ url: `https://checkout.stripe.com/c/pay/test_mock_${plan}_${Date.now()}`, plan, mock: true });
        return;
      }
      const errMsg = plan
        ? `No Stripe price configured for plan "${plan}". Set STRIPE_PRICE_${plan.toUpperCase()} env var.`
        : "No Stripe price configured for the selected add-ons. Contact support.";
      res.status(400).json({ error: errMsg });
      return;
    }

    const customerId = await ensureStripeCustomer(orgId, billingCtx, stripeKey);

    // Belt-and-suspenders Stripe-side check for stale DB subscription_status
    if (customerId) {
      const existingSubs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 1 });
      if (existingSubs.data.length > 0) {
        logger.warn({ customerId, plan, orgId }, "[Billing] checkout blocked by Stripe — active subscription exists");
        res.status(409).json({
          error: "subscription_already_active",
          message: "Vous avez déjà un abonnement actif. Utilisez la mise à niveau pour changer de plan.",
          redirectTo: "/api/billing/upgrade",
        });
        return;
      }
      const trialingSubs = await stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 1 });
      if (trialingSubs.data.length > 0) {
        logger.warn({ customerId, plan, orgId }, "[Billing] checkout blocked by Stripe — trialing subscription exists");
        res.status(409).json({
          error: "subscription_already_active",
          message: "Vous êtes en période d'essai. Vous ne pouvez pas créer un second abonnement.",
          redirectTo: "/api/billing/upgrade",
        });
        return;
      }
    }

    // Only grant 14-day trial for confirmed first-time subscribers
    const hasHadTrial = !!billingCtx.trialEndsAt;
    let hasStripeSubHistory = false;
    if (customerId) {
      const allSubs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 });
      hasStripeSubHistory = allSubs.data.length > 0;
    }
    const grantTrial = !hasHadTrial && !hasStripeSubHistory;

    const subscriptionData: Record<string, unknown> = {};
    if (grantTrial) {
      subscriptionData["trial_period_days"] = 14;
      logger.info({ plan, orgId }, "[Billing] Granting 14-day trial — confirmed first-time subscriber");
    } else {
      logger.info({ plan, hasHadTrial, hasStripeSubHistory, orgId }, "[Billing] Skipping trial — prior subscription history");
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: lineItems,
      subscription_data: subscriptionData,
      success_url: `${publicUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicUrl}/cancel.html?next=${encodeURIComponent("/pricing.html")}`,
      metadata: { plan, addons: JSON.stringify(addons) },
    });

    res.json({ url: session.url, plan });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create Stripe checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ── POST /billing/checkout-embedded ─────────────────────────────────────────
router.post("/billing/checkout-embedded", async (req: Request, res: Response) => {
  const body = req.body as { plan?: string; planId?: string; addons?: AddonsMap };
  const plan = body.plan || body.planId || "";
  const addons: AddonsMap = body.addons ?? {};
  const orgId = req.orgId ?? "default";

  const billingCtx = await loadBillingContext(orgId);

  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("[Billing] STRIPE_SECRET_KEY not set in production — embedded checkout unavailable");
      res.status(503).json({ error: "Payment service not configured. Contact support." });
      return;
    }
    logger.warn("[Billing] STRIPE_SECRET_KEY not set — returning mock embedded session (dev only)");
    res.json({ clientSecret: `cs_test_mock_${Date.now()}`, mock: true });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);

    const lineItems = buildLineItems(plan, addons);
    if (lineItems.length === 0) {
      res.status(400).json({ error: `No price configured for plan: ${plan}` });
      return;
    }

    const customerId = await ensureStripeCustomer(orgId, billingCtx, stripeKey);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      ui_mode: "embedded_page",
      line_items: lineItems,
      return_url: `${publicUrl}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
      metadata: { plan, addons: JSON.stringify(addons) },
    });

    res.json({ clientSecret: session.client_secret });
  } catch (err) {
    logger.error({ err }, "[Billing] Embedded checkout failed — falling back to redirect mode");
    try {
      const stripe = await createStripeClient(
        process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"] || ""
      );
      const lineItems = buildLineItems(plan, addons);
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: lineItems,
        success_url: `${publicUrl}/dashboard.html?checkout=success&plan=${plan}`,
        cancel_url: `${publicUrl}/pricing.html`,
        metadata: { plan, addons: JSON.stringify(addons) },
      });
      res.json({ url: session.url, plan, fallback: true });
    } catch (fallbackErr) {
      logger.error({ fallbackErr }, "[Billing] Fallback checkout also failed");
      res.status(500).json({ error: "Failed to create checkout session" });
    }
  }
});

// ── GET /billing/verify ──────────────────────────────────────────────────────
router.get("/billing/verify", async (req: Request, res: Response) => {
  const sessionId = String(req.query["session_id"] || "");
  if (!sessionId) { res.status(400).json({ error: "session_id required" }); return; }

  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("[Billing] STRIPE_SECRET_KEY not set in production — verify unavailable");
      res.status(503).json({ error: "Payment service not configured. Contact support." });
      return;
    }
    logger.warn("[Billing] STRIPE_SECRET_KEY not set — mock verify (dev only)");
    res.json({ ok: true, mock: true });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

    if (session.payment_status !== "paid" && session.status !== "complete") {
      res.status(402).json({ error: "Payment not completed", status: session.status });
      return;
    }

    const planMeta = (session.metadata?.["plan"] || "pro").toLowerCase();
    const orgIdVerify = req.orgId ?? "default";
    if (["standard","pro","ultra"].includes(planMeta)) {
      store.broadcastPlanUpdate(planMeta, orgIdVerify);
    }

    let addonsMeta: Record<string, boolean | number> = {};
    try { addonsMeta = JSON.parse(session.metadata?.["addons"] || "{}"); } catch {}

    const activatedAddons: Record<string, unknown> = {};
    for (const key of FLAG_ADDONS) {
      if (addonsMeta[key] !== undefined) activatedAddons[key] = !!addonsMeta[key];
    }
    for (const key of QTY_ADDONS) {
      if (addonsMeta[key] !== undefined) activatedAddons[key] = Number(addonsMeta[key] || 0);
    }

    const billingCtx = await loadBillingContext(orgIdVerify);

    // Persist all billing state to DB — this is the authoritative write path after checkout
    await upsertOrgSettings(orgIdVerify, {
      plan: planMeta,
      subscriptionStatus: "active",
      stripeCustomerId: session.customer ? String(session.customer) : (billingCtx.stripeCustomerId ?? undefined),
      addons: { ...billingCtx.addons, ...activatedAddons },
      trialEndsAt: billingCtx.trialEndsAt ?? undefined,
    }).catch(err => logger.error({ err }, "[Billing] Failed to persist state after checkout verify"));

    logger.info({ plan: planMeta, sessionId, orgId: orgIdVerify }, "[Billing] Checkout verified — plan activated");

    res.json({ ok: true, plan: planMeta });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to verify checkout session");
    res.status(500).json({ error: "Failed to verify checkout session" });
  }
});

// ── POST /billing/portal ─────────────────────────────────────────────────────
router.post("/billing/portal", billingPortalRateLimit, ownerOnly, async (req: Request, res: Response) => {
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";
  const returnUrl = process.env["STRIPE_RETURN_URL"] || `${publicUrl}/dashboard`;

  // ── Log 1/3 : request received (before any async work) ────────────────────
  if (diagnosticsEnabled) {
    logger.info({
      event:     "billing_portal_request_received",
      requestId: (req as Record<string, unknown>)["id"]
                   ?? (req.headers["x-request-id"] as string | undefined)
                   ?? `portal-${Date.now()}`,
      orgId:     req.orgId ?? "default",
    }, "[Billing] billing_portal_request_received");
  }

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("[Billing] STRIPE_SECRET_KEY not set in production — portal unavailable");
      res.status(503).json({ error: "Payment service not configured. Contact support." });
      return;
    }
    logger.warn("[Billing] STRIPE_SECRET_KEY not set — returning mock portal URL (dev only)");
    res.json({ url: `https://billing.stripe.com/p/session/test_mock_${Date.now()}` });
    return;
  }

  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);
  // Snapshot the DB value BEFORE ensureStripeCustomer so we can tell whether
  // a new Customer was created during this call (customerCreated = true).
  const dbStripeCustomerId: string | null = billingCtx.stripeCustomerId ?? null;

  let customerId: string;
  try {
    customerId = await ensureStripeCustomer(orgId, billingCtx, stripeKey);
  } catch (ensureErr) {
    logger.error({ ensureErr, orgId }, "[Billing] portal: ensureStripeCustomer failed");
    res.status(503).json({ error: "stripe_unavailable", message: "Impossible de créer le portail — réessayez dans quelques secondes." });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);
    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });

    if (diagnosticsEnabled) {
      // Never log: Stripe keys, full portal URL, session token, email, or secrets.
      logger.info({
        event:                    "billing_portal_customer_resolution",
        requestId:                (req.headers["x-request-id"] as string | undefined) ?? `portal-${Date.now()}`,
        userId:                   (req as Record<string, unknown>)["userId"] ?? orgId,
        orgId,
        dbStripeCustomerId,
        resolvedStripeCustomerId: customerId,
        customerCreated:          !dbStripeCustomerId || dbStripeCustomerId !== customerId,
        portalSessionId:          session.id,
        lockAcquired:             true,
        transactionCommitted:     true,
      }, "[Billing] billing_portal_customer_resolution");
    }

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create Stripe portal session");
    res.status(500).json({ error: "Failed to create billing portal session" });
  }
});

// ── GET /billing/usage ───────────────────────────────────────────────────────
router.get("/billing/usage", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const usage = await getUsageSummary(orgId);
    res.json(usage);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get usage");
    res.status(500).json({ error: "Failed to retrieve usage data" });
  }
});

// ── GET /billing/analytics ───────────────────────────────────────────────────
router.get("/billing/analytics", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const analytics = await getSubscriptionAnalytics(orgId);
    res.json(analytics);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get analytics");
    res.status(500).json({ error: "Failed to retrieve subscription analytics" });
  }
});

// ── GET /billing/mrr ─────────────────────────────────────────────────────────
router.get("/billing/mrr", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  try {
    const mrr = await getMRRData(orgId);
    res.json(mrr);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get MRR data");
    res.status(500).json({ error: "Failed to retrieve MRR data" });
  }
});

// ── GET /billing/invoices ────────────────────────────────────────────────────
router.get("/billing/invoices", async (req: Request, res: Response) => {
  const limit = Math.min(Number((req.query as Record<string, string>)["limit"] || 20), 100);
  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);
  const stripeCustomerId = billingCtx.stripeCustomerId ?? undefined;
  try {
    const result = await getInvoices(limit, stripeCustomerId);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get invoices");
    res.status(500).json({ error: "Failed to retrieve invoices" });
  }
});

// ── POST /billing/trial ──────────────────────────────────────────────────────
router.post("/billing/trial", async (req: Request, res: Response) => {
  const { plan = "pro", days = 14 } = req.body as { plan?: string; days?: number };
  const orgId = req.orgId ?? "default";

  const billingCtx = await loadBillingContext(orgId);
  if (billingCtx.subscriptionStatus === "active") {
    res.status(409).json({ error: "Vous avez déjà un abonnement actif" });
    return;
  }
  try {
    const result = await startTrial(plan, days, orgId);
    await trackBillingEvent("trial_started", { days, ...result }, orgId).catch(() => {});
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to start trial");
    res.status(500).json({ error: "Failed to start trial" });
  }
});

// ── POST /billing/coupon/validate ────────────────────────────────────────────
router.post("/billing/coupon/validate", async (req: Request, res: Response) => {
  const { code } = req.body as { code?: string };
  if (!code) { res.status(400).json({ error: "Coupon code requis" }); return; }
  try {
    const result = await validateCoupon(String(code).trim().toUpperCase());
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to validate coupon");
    res.status(500).json({ error: "Impossible de valider le coupon" });
  }
});

// ── POST /billing/cancel ─────────────────────────────────────────────────────
router.post("/billing/cancel", ownerOnly, async (req: Request, res: Response) => {
  const { atPeriodEnd = true } = req.body as { atPeriodEnd?: boolean };
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const orgId = req.orgId ?? "default";

  const billingCtx = await loadBillingContext(orgId);

  if (!stripeKey || !billingCtx.stripeCustomerId) {
    await upsertOrgSettings(orgId, { subscriptionStatus: "canceled" }).catch(() => {});
    logger.warn({ orgId }, "[Billing] cancel: no Stripe key or customerId — marking canceled in DB");
    res.json({ ok: true, cancelAtPeriodEnd: atPeriodEnd, mock: true });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);
    // Check both active AND trialing subscriptions (trial can also be cancelled at period end)
    const activeSubs  = await stripe.subscriptions.list({ customer: billingCtx.stripeCustomerId, status: "active",   limit: 1 });
    const trialSubs   = await stripe.subscriptions.list({ customer: billingCtx.stripeCustomerId, status: "trialing", limit: 1 });
    const sub = activeSubs.data[0] ?? trialSubs.data[0];
    if (!sub) { res.status(404).json({ error: "No active subscription found" }); return; }

    const email = billingCtx.email ?? req.orgContext?.email;

    if (atPeriodEnd) {
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      if (email) {
        mailer.sendSubscriptionCanceled({
          to: email, name: email.split("@")[0], plan: billingCtx.plan,
          cancelDate: new Date(sub.current_period_end * 1000).toLocaleDateString("fr-FR"),
        }).catch(() => {});
      }
      res.json({ ok: true, cancelAtPeriodEnd: true, cancelAt: sub.current_period_end });
    } else {
      await stripe.subscriptions.cancel(sub.id);
      await upsertOrgSettings(orgId, { subscriptionStatus: "canceled" }).catch(() => {});
      if (email) {
        mailer.sendSubscriptionCanceled({
          to: email, name: email.split("@")[0], plan: billingCtx.plan, cancelDate: null,
        }).catch(() => {});
      }
      res.json({ ok: true, cancelAtPeriodEnd: false });
    }
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to cancel subscription");
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

// ── POST /billing/reactivate ──────────────────────────────────────────────────
// Removes cancel_at_period_end flag — restores automatic renewal.
router.post("/billing/reactivate", ownerOnly, async (req: Request, res: Response) => {
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);

  if (!stripeKey || !billingCtx.stripeCustomerId) {
    await upsertOrgSettings(orgId, { subscriptionStatus: "active" }).catch(() => {});
    logger.warn({ orgId }, "[Billing] reactivate: no Stripe key — marking active in DB (mock)");
    res.json({ ok: true, reactivated: true, mock: true });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);
    // Look for active OR trialing subscription with cancel_at_period_end=true
    const [activeSubs, trialSubs] = await Promise.all([
      stripe.subscriptions.list({ customer: billingCtx.stripeCustomerId, status: "active",   limit: 5 }),
      stripe.subscriptions.list({ customer: billingCtx.stripeCustomerId, status: "trialing", limit: 5 }),
    ]);
    const allSubs = [...activeSubs.data, ...trialSubs.data];
    const sub = allSubs.find((s) => s.cancel_at_period_end);

    if (!sub) {
      res.status(404).json({ error: "Aucun abonnement en cours d'annulation trouvé." });
      return;
    }

    await stripe.subscriptions.update(sub.id, { cancel_at_period_end: false });
    const newStatus = sub.status === "trialing" ? "trialing" : "active";
    await upsertOrgSettings(orgId, { subscriptionStatus: newStatus }).catch(() => {});

    const email = billingCtx.email ?? req.orgContext?.email;
    if (email) {
      mailer.sendSubscriptionReactivated({
        to: email, name: email.split("@")[0], plan: billingCtx.plan,
      }).catch(() => {});
    }

    store.broadcastPlanUpdate(billingCtx.plan, orgId);
    logger.info({ orgId, subId: sub.id, newStatus }, "[Billing] Subscription reactivated");
    res.json({ ok: true, reactivated: true, status: newStatus });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to reactivate subscription");
    res.status(500).json({ error: "Failed to reactivate subscription" });
  }
});

// ── POST /billing/cancel-trial ────────────────────────────────────────────────
// Cancels an active trial immediately or at period end.
router.post("/billing/cancel-trial", ownerOnly, async (req: Request, res: Response) => {
  const { atPeriodEnd = false } = req.body as { atPeriodEnd?: boolean };
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);

  if (!stripeKey || !billingCtx.stripeCustomerId) {
    await upsertOrgSettings(orgId, { subscriptionStatus: "canceled" }).catch(() => {});
    logger.warn({ orgId }, "[Billing] cancel-trial: no Stripe key — marking canceled in DB (mock)");
    res.json({ ok: true, mock: true });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);
    const subs = await stripe.subscriptions.list({
      customer: billingCtx.stripeCustomerId, status: "trialing", limit: 5,
    });
    const sub = subs.data[0];
    if (!sub) {
      res.status(404).json({ error: "Aucun essai actif trouvé." });
      return;
    }

    const email = billingCtx.email ?? req.orgContext?.email;

    if (atPeriodEnd) {
      await stripe.subscriptions.update(sub.id, { cancel_at_period_end: true });
      if (email) {
        mailer.sendTrialCanceled({
          to: email, name: email.split("@")[0], plan: billingCtx.plan,
          cancelDate: new Date(sub.trial_end! * 1000).toLocaleDateString("fr-FR"),
        }).catch(() => {});
      }
      res.json({ ok: true, cancelAtPeriodEnd: true, cancelAt: sub.trial_end });
    } else {
      await stripe.subscriptions.cancel(sub.id);
      await upsertOrgSettings(orgId, { subscriptionStatus: "canceled" }).catch(() => {});
      if (email) {
        mailer.sendTrialCanceled({
          to: email, name: email.split("@")[0], plan: billingCtx.plan, cancelDate: null,
        }).catch(() => {});
      }
      logger.info({ orgId, subId: sub.id }, "[Billing] Trial cancelled immediately");
      res.json({ ok: true, cancelAtPeriodEnd: false });
    }
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to cancel trial");
    res.status(500).json({ error: "Failed to cancel trial" });
  }
});

// ── POST /billing/upgrade ─────────────────────────────────────────────────────
// Handles: trial (any direction, immediate), upgrade (immediate + prorations),
//          downgrade (scheduled to period end via subscription schedule).
// Also reconciles add-ons that become included in the new plan.
router.post("/billing/upgrade", billingCheckoutRateLimit, ownerOnly, async (req: Request, res: Response) => {
  const { plan = "" } = req.body as { plan?: string; interval?: string };
  if (!plan) { res.status(400).json({ error: "plan required" }); return; }

  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);

  // Guard: reject if target plan is already the active plan
  const currentPlan   = billingCtx.plan.toLowerCase();
  const targetPlan    = plan.toLowerCase();
  const upgradeStatus = billingCtx.subscriptionStatus;
  if (targetPlan && targetPlan === currentPlan && (upgradeStatus === "active" || upgradeStatus === "trialing")) {
    logger.warn({ currentPlan, targetPlan, orgId }, "[Billing] upgrade blocked — plan already active");
    res.status(409).json({
      error: "plan_already_active",
      message: `Le plan ${plan} est déjà votre plan actuel.`,
    });
    return;
  }

  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";

  if (!stripeKey) {
    logger.warn("[Billing] upgrade: no Stripe key — returning mock checkout");
    res.json({ url: `https://checkout.stripe.com/c/pay/test_mock_upgrade_${plan}_${Date.now()}`, plan, mock: true });
    return;
  }

  // ── Plan hierarchy: standard < pro < ultra ───────────────────────────────────
  const PLAN_LEVELS: Record<string, number> = { standard: 0, pro: 1, ultra: 2 };
  const currentLevel = PLAN_LEVELS[currentPlan] ?? 0;
  const targetLevel  = PLAN_LEVELS[targetPlan]  ?? 0;
  const isUpgrade    = targetLevel > currentLevel;
  const isDowngrade  = targetLevel < currentLevel;

  // ── Reverse map: Stripe price ID → addon key (for reconciliation) ────────────
  const addonPriceToKey: Record<string, string> = {};
  for (const [key, pid] of Object.entries(ADDON_PRICE_IDS)) {
    if (pid) addonPriceToKey[pid] = key;
  }
  const targetIncluded = PLAN_INCLUDED_ADDONS[targetPlan] ?? new Set<string>();
  const planPriceIdSet  = new Set(Object.values(PLAN_PRICE_IDS).filter(Boolean));

  type SubItem = { id: string; price: { id: string }; quantity?: number };

  try {
    const stripe = await createStripeClient(stripeKey);

    // ── Try to update existing subscription first (active OR trialing) ──────────
    if (billingCtx.stripeCustomerId) {
      const [activeSubs, trialingSubs] = await Promise.all([
        stripe.subscriptions.list({ customer: billingCtx.stripeCustomerId, status: "active",   limit: 1 }),
        stripe.subscriptions.list({ customer: billingCtx.stripeCustomerId, status: "trialing", limit: 1 }),
      ]);
      const sub = activeSubs.data[0] ?? trialingSubs.data[0];

      if (sub) {
        const isTrialing = sub.status === "trialing";
        const priceId    = PLAN_PRICE_IDS[targetPlan];
        if (!priceId) { res.status(400).json({ error: `Unknown plan: ${plan}` }); return; }

        const planItem = sub.items.data.find((item: SubItem) => planPriceIdSet.has(item.price.id));

        // Add-on items now included in the new plan (to be removed from billing)
        const removedIncludedItems = sub.items.data
          .filter((item: SubItem) => !planPriceIdSet.has(item.price.id))
          .filter((item: SubItem) => {
            const addonKey = addonPriceToKey[item.price.id];
            return addonKey && targetIncluded.has(addonKey);
          });
        const removedAddonKeys = removedIncludedItems
          .map((i: SubItem) => addonPriceToKey[i.price.id])
          .filter(Boolean);

        // Add-on items to keep (not a plan item, not included in new plan)
        const keptAddonItems = sub.items.data
          .filter((item: SubItem) => !planPriceIdSet.has(item.price.id))
          .filter((item: SubItem) => {
            const addonKey = addonPriceToKey[item.price.id];
            return !addonKey || !targetIncluded.has(addonKey);
          });

        if (isDowngrade && !isTrialing) {
          // ── Active downgrade → schedule change at period end ─────────────────
          // Phase 1: keep current plan until period end (no change)
          // Phase 2: switch to new lower plan at period end
          const currentPriceId = planItem?.price?.id ?? PLAN_PRICE_IDS[currentPlan];

          const currentAddonPrices = sub.items.data
            .filter((item: SubItem) => !planPriceIdSet.has(item.price.id))
            .map((item: SubItem) => ({ price: item.price.id, quantity: item.quantity ?? 1 }));

          const nextAddonPrices = currentAddonPrices.filter((it: { price: string }) => {
            const addonKey = addonPriceToKey[it.price];
            return !addonKey || !targetIncluded.has(addonKey);
          });

          // Compute effective date early — needed by both the idempotency path and the normal path
          const effectiveDate = new Date(sub.current_period_end * 1000).toLocaleDateString("fr-FR", {
            day: "2-digit", month: "long", year: "numeric",
          });

          // ── Idempotency: if subscription already has an active schedule, skip ──
          if (sub.schedule) {
            const existingScheduleId = typeof sub.schedule === "string" ? sub.schedule : (sub.schedule as { id: string }).id;
            logger.info({ scheduleId: existingScheduleId, orgId }, "[Billing] downgrade schedule already exists — idempotent return");
            res.json({
              ok:                   true,
              plan,
              downgrade:            true,
              effective:            "period_end",
              effectiveDate,
              removedIncludedAddons: [],
              idempotent:           true,
            });
            return;
          }

          let scheduleId: string;
          try {
            const schedule = await stripe.subscriptionSchedules.create({ from_subscription: sub.id });
            scheduleId = schedule.id;
            await stripe.subscriptionSchedules.update(scheduleId, {
              end_behavior: "release",
              phases: [
                {
                  start_date:         "now" as unknown as number,
                  end_date:           sub.current_period_end,
                  items:              [
                    { price: currentPriceId ?? undefined, quantity: 1 },
                    ...currentAddonPrices,
                  ],
                  proration_behavior: "none",
                },
                {
                  items: [
                    { price: priceId, quantity: 1 },
                    ...nextAddonPrices,
                  ],
                  proration_behavior: "none",
                },
              ],
            });
          } catch (schedErr: unknown) {
            // Stripe can reject the create() when a schedule is already attached
            // to this subscription (race condition or duplicate request).
            // Detect that specific case and return the idempotent success response
            // instead of propagating a misleading 500.
            const isAlreadyAttached = ((): boolean => {
              if (!schedErr || typeof schedErr !== "object") return false;
              const e = schedErr as Record<string, unknown>;
              const code    = String(e["code"]    ?? "");
              const message = String(e["message"] ?? "").toLowerCase();
              return (
                code === "resource_already_exists" ||
                message.includes("schedule") ||
                message.includes("already attached") ||
                message.includes("already has a schedule")
              );
            })();

            if (!isAlreadyAttached) throw schedErr; // genuine Stripe error → bubble up to outer catch → 500

            // Re-read the subscription to confirm the schedule is now present
            const freshSub = await stripe.subscriptions.retrieve(sub.id, { expand: ["schedule"] });
            if (!freshSub.schedule) throw schedErr; // schedule still absent → treat as genuine error

            const attachedId = typeof freshSub.schedule === "string"
              ? freshSub.schedule
              : (freshSub.schedule as { id: string }).id;
            logger.warn(
              { scheduleId: attachedId, subId: sub.id, orgId },
              "[Billing] schedule already attached (race) — idempotent downgrade return",
            );
            res.json({
              ok:                   true,
              plan,
              downgrade:            true,
              effective:            "period_end",
              effectiveDate,
              removedIncludedAddons: removedAddonKeys,
              idempotent:           true,
            });
            return;
          }

          // Do NOT change org_settings.plan now — the subscription is still on
          // the current (higher) plan until the period end. Only store the
          // pending change so the dashboard can show the scheduled downgrade.
          await upsertOrgSettings(orgId, { pendingPlan: plan, pendingPlanDate: effectiveDate }).catch(() => {});
          logger.info(
            { plan, subId: sub.id, orgId, effectiveDate, removedAddonKeys },
            "[Billing] downgrade scheduled for period end",
          );
          res.json({
            ok:                   true,
            plan,
            downgrade:            true,
            effective:            "period_end",
            effectiveDate,
            removedIncludedAddons: removedAddonKeys,
          });
          return;
        }

        // ── Upgrade or trialing → immediate update ───────────────────────────
        const prorationBehavior = (isUpgrade && !isTrialing) ? "create_prorations" : "none";
        await stripe.subscriptions.update(sub.id, {
          items: [
            { id: planItem?.id, price: priceId },
            ...keptAddonItems.map((item: SubItem) => ({ id: item.id })),
          ],
          proration_behavior: prorationBehavior,
          metadata: { plan },
        });
        await upsertOrgSettings(orgId, { plan }).catch(() => {});
        logger.info(
          { plan, subId: sub.id, subStatus: sub.status, isTrialing, isUpgrade, prorationBehavior, removedAddonKeys, orgId },
          "[Billing] upgrade/trial plan change applied immediately",
        );
        res.json({
          ok:                   true,
          plan,
          upgraded:             true,
          effective:            "now",
          removedIncludedAddons: removedAddonKeys,
        });
        return;
      }
    }

    // No existing sub — tell the frontend to use our embedded checkout pages
    // (checkout.html → checkout-payment.html → checkout-return.html).
    // Never redirect to Stripe-hosted checkout from this endpoint.
    logger.info({ plan, orgId }, "[Billing] upgrade: no active subscription — redirecting to embedded checkout");
    res.json({ noSubscription: true, redirectTo: "/checkout.html", plan });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to upgrade");
    res.status(500).json({ error: "Failed to process upgrade" });
  }
});

// ── GET /billing/subscription ────────────────────────────────────────────────
router.get("/billing/subscription", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);

  const plan                  = billingCtx.plan;
  const trialEndsAt           = billingCtx.trialEndsAt ?? null;
  const stripeCustomerId      = billingCtx.stripeCustomerId ?? null;
  const stripeSubscriptionId  = billingCtx.stripeSubscriptionId ?? null;
  const stripeKey             = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];

  // billingCtx.subscriptionStatus is already normalised by the state machine:
  // it NEVER returns "active" when stripeSubscriptionId is null.
  const normalisedStatus = billingCtx.subscriptionStatus ?? "none";

  // ── No Stripe key or no customer → return DB state (already normalised) ───
  if (!stripeKey || !stripeCustomerId) {
    res.json({
      plan,
      status:            normalisedStatus,
      subscriptionStatus: normalisedStatus,
      trialEndsAt,
      canStartTrial:     billingCtx.canStartTrial,
      hasPremiumAccess:  billingCtx.hasPremiumAccess,
      mustCompleteBilling: billingCtx.mustCompleteBilling,
      addons:            billingCtx.addons,
      subscriptionId:    stripeSubscriptionId,
      stripeCustomerId,
      pendingPlan:       billingCtx.pendingPlan     ?? null,
      pendingPlanDate:   billingCtx.pendingPlanDate ?? null,
      mock:              !stripeKey,
    });
    return;
  }

  // ── Reconcile with Stripe (live subscription data) ─────────────────────────
  try {
    const stripe = await createStripeClient(stripeKey);

    // Prefer the tracked subscription ID for a precise lookup; fall back to
    // listing all active subscriptions for this customer.
    let sub: Awaited<ReturnType<typeof stripe.subscriptions.list>>["data"][0] | undefined;

    if (stripeSubscriptionId) {
      try {
        const fetched = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        if (fetched && fetched.id) sub = fetched;
      } catch (fetchErr: unknown) {
        const code = (fetchErr as { code?: string })?.code;
        if (code !== "resource_missing") throw fetchErr;
        // Subscription no longer exists in Stripe — reconcile DB
        logger.warn({ orgId, stripeSubscriptionId }, "[Billing] resource_missing: Stripe subscription gone — clearing stale reference");
        try {
          const { pool: pgPool } = await import("@workspace/db");
          const _client = await pgPool.connect();
          try {
            const newStatus = stripeCustomerId ? "incomplete" : "pending_billing";
            await _client.query(
              `UPDATE org_settings
               SET    stripe_subscription_id = NULL,
                      subscription_status    = $1,
                      updated_at             = NOW()
               WHERE  org_id = $2`,
              [newStatus, orgId]
            );
            logger.info({ orgId, newStatus }, "[Billing] resource_missing: DB reconciled — subscription ID cleared");
          } finally { _client.release(); }
        } catch (cleanupErr) {
          logger.warn({ cleanupErr, orgId }, "[Billing] resource_missing: DB cleanup failed (non-fatal)");
        }
        // sub remains undefined — reconciled will reflect cleared state
      }
    } else {
      const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 1 });
      sub = subs.data[0];
    }

    // The Stripe status is authoritative when a subscription is found.
    // Re-apply the state machine to avoid impossible combos from Stripe.
    const stripeStatus = sub?.status ?? null;
    const effectiveSubId = sub?.id ?? stripeSubscriptionId;
    const { normalizeSubscriptionStatus } = await import("../lib/subscription-state.js");
    const reconciledTrialEndsAt = sub?.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : trialEndsAt;
    const reconciled = normalizeSubscriptionStatus({
      rawStatus:            stripeStatus ?? normalisedStatus,
      stripeSubscriptionId: effectiveSubId ?? null,
      stripeCustomerId,
      trialEndsAt:          reconciledTrialEndsAt,
      trialConsumedAt:      billingCtx.trialConsumedAt,
    });

    res.json({
      plan,
      status:              reconciled,
      subscriptionStatus:  reconciled,
      trialEndsAt:         reconciledTrialEndsAt,
      currentPeriodEnd:    sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      cancelAtPeriodEnd:   sub?.cancel_at_period_end ?? false,
      subscriptionId:      effectiveSubId ?? null,
      addons:              billingCtx.addons,
      stripeCustomerId,
      pendingPlan:         billingCtx.pendingPlan     ?? null,
      pendingPlanDate:     billingCtx.pendingPlanDate ?? null,
      canStartTrial:       billingCtx.canStartTrial,
      hasPremiumAccess:    billingCtx.hasPremiumAccess,
      mustCompleteBilling: billingCtx.mustCompleteBilling,
    });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get subscription from Stripe — returning normalised DB state");
    // Fallback: DB state is already normalised — safe to return
    res.json({
      plan,
      status:              normalisedStatus,
      subscriptionStatus:  normalisedStatus,
      trialEndsAt,
      addons:              billingCtx.addons,
      subscriptionId:      stripeSubscriptionId,
      stripeCustomerId,
      canStartTrial:       billingCtx.canStartTrial,
      hasPremiumAccess:    billingCtx.hasPremiumAccess,
      mustCompleteBilling: billingCtx.mustCompleteBilling,
    });
  }
});

// ── POST /billing/checkout/annual ────────────────────────────────────────────
router.post("/billing/checkout/annual", async (req: Request, res: Response) => {
  const { plan = "pro", addons = {}, coupon } = req.body as { plan?: string; addons?: AddonsMap; coupon?: string };
  const orgId = req.orgId ?? "default";

  const billingCtx = await loadBillingContext(orgId);

  // Guard: reject if a subscription is already active
  const currentStatusAnnual = billingCtx.subscriptionStatus;
  if (currentStatusAnnual === "active" || currentStatusAnnual === "trialing") {
    logger.warn({ currentStatus: currentStatusAnnual, plan, orgId }, "[Billing] annual-checkout blocked — subscription already active");
    res.status(409).json({
      error: "subscription_already_active",
      message: "Vous avez déjà un abonnement actif. Utilisez la mise à niveau pour changer de plan.",
      redirectTo: "/api/billing/upgrade",
    });
    return;
  }

  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("[Billing] STRIPE_SECRET_KEY not set in production — annual checkout unavailable");
      res.status(503).json({ error: "Payment service not configured. Contact support." });
      return;
    }
    res.json({ url: `https://checkout.stripe.com/c/pay/test_annual_${plan}_${Date.now()}`, plan, annual: true, mock: true });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);

    const annualPriceEnvKey = `STRIPE_PRICE_${plan.toUpperCase()}_ANNUAL`;
    const annualPriceId = process.env[annualPriceEnvKey] || PLAN_PRICE_IDS[plan.toLowerCase()];

    if (!annualPriceId) {
      res.status(400).json({ error: `No annual price configured for plan: ${plan}` });
      return;
    }

    const customerId = await ensureStripeCustomer(orgId, billingCtx, stripeKey);

    // Stripe-side guard
    if (customerId) {
      const existingActiveSubs = await stripe.subscriptions.list({ customer: customerId, status: "active", limit: 1 });
      if (existingActiveSubs.data.length > 0) {
        logger.warn({ customerId, plan, orgId }, "[Billing] annual-checkout blocked by Stripe — active subscription exists");
        res.status(409).json({
          error: "subscription_already_active",
          message: "Vous avez déjà un abonnement actif. Utilisez la mise à niveau pour changer de plan.",
          redirectTo: "/api/billing/upgrade",
        });
        return;
      }
      const existingTrialSubs = await stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 1 });
      if (existingTrialSubs.data.length > 0) {
        logger.warn({ customerId, plan, orgId }, "[Billing] annual-checkout blocked by Stripe — trialing subscription exists");
        res.status(409).json({
          error: "subscription_already_active",
          message: "Vous êtes en période d'essai. Vous ne pouvez pas créer un second abonnement.",
          redirectTo: "/api/billing/upgrade",
        });
        return;
      }
    }

    const sessionParams: Record<string, unknown> = {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: annualPriceId, quantity: 1 }],
      success_url: `${publicUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&annual=1`,
      cancel_url: `${publicUrl}/cancel.html`,
      metadata: { plan, addons: JSON.stringify(addons), billing: "annual" },
      subscription_data: { metadata: { plan, billing: "annual" } },
    };
    if (coupon) sessionParams["discounts"] = [{ coupon }];

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url, plan, annual: true });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create annual checkout");
    res.status(500).json({ error: "Failed to create annual checkout session" });
  }
});

// ── GET /billing/usage-details ───────────────────────────────────────────────
router.get("/billing/usage-details", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgContext?.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);
  const limits = PLAN_LIMITS[billingCtx.plan.toLowerCase()] ?? PLAN_LIMITS["standard"];

  let reportsUsed: number | null = null;
  let teamMembersUsed: number | null = null;

  try {
    const r = await req.orgDb(
      `SELECT COUNT(*) FROM reports WHERE org_id = $1 AND created_at > date_trunc('month', now())`,
      [orgId]
    );
    reportsUsed = Number(r.rows[0]?.count ?? 0);
  } catch { /* reports table may not exist yet */ }

  try {
    // Count active members only (mirrors /team getSeatUsage: 1 owner + active members)
    const r = await req.orgDb(
      `SELECT COUNT(*) FROM team_members WHERE org_id = $1 AND status = 'active'`,
      [orgId]
    );
    teamMembersUsed = 1 + Number(r.rows[0]?.count ?? 0); // 1 = owner always counts
  } catch { /* team_members table may not exist yet */ }

  res.json({
    reportsUsed,
    reportsLimit:     limits.reports,
    teamMembersUsed,
    teamMembersLimit: limits.teamMembers,
    emailsSent:    null,
    apiCalls:      null,
    storageUsed:   null,
    bandwidthUsed: null,
  });
});

// ── POST /billing/checkout-ai-credits ─────────────────────────────────────────
router.post("/billing/checkout-ai-credits", billingCheckoutRateLimit, async (req: Request, res: Response) => {
  const { pack = "" } = req.body as { pack?: string };

  const AI_PACK_MAP: Record<string, { addonKey: string; credits: number; envVar: string; amountEurCents: number }> = {
    "ai_credits_50k":  { addonKey: "aiCreditsPack50k",  credits: 50000,  envVar: "STRIPE_PRICE_AI_50K",  amountEurCents: 400  },
    "ai_credits_200k": { addonKey: "aiCreditsPack200k", credits: 200000, envVar: "STRIPE_PRICE_AI_200K", amountEurCents: 900  },
    "ai_credits_500k": { addonKey: "aiCreditsPack500k", credits: 500000, envVar: "STRIPE_PRICE_AI_500K", amountEurCents: 1900 },
  };

  const packInfo = AI_PACK_MAP[pack.toLowerCase()];
  if (!packInfo) {
    res.status(400).json({ error: `Pack IA inconnu : ${pack}. Valeurs valides : ai_credits_50k, ai_credits_200k, ai_credits_500k` });
    return;
  }

  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);

  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("[Billing] STRIPE_SECRET_KEY not set in production — AI credits checkout unavailable");
      res.status(503).json({ error: "Payment service not configured. Contact support." });
      return;
    }
    logger.warn("[Billing] STRIPE_SECRET_KEY not set — returning mock AI credits checkout (dev only)");
    res.json({ url: `https://checkout.stripe.com/c/pay/test_ai_${pack}_${Date.now()}`, pack, credits: packInfo.credits, mock: true });
    return;
  }

  const priceId = process.env[packInfo.envVar] || ADDON_PRICE_IDS[packInfo.addonKey];
  if (!priceId) {
    if (process.env["NODE_ENV"] !== "production") {
      logger.warn(`[Billing] No Stripe price for ${pack} — mock checkout (dev only)`);
      res.json({ url: `https://checkout.stripe.com/c/pay/test_ai_${pack}_${Date.now()}`, pack, credits: packInfo.credits, mock: true });
      return;
    }
    res.status(400).json({ error: `Prix Stripe non configuré pour ${pack}. Définissez ${packInfo.envVar}.` });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);

    const customerId = await ensureStripeCustomer(orgId, billingCtx, stripeKey);

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${publicUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&type=ai_credits&pack=${encodeURIComponent(pack)}&credits=${packInfo.credits}`,
      cancel_url:  `${publicUrl}/dashboard.html#billing`,
      metadata: {
        type:           "ai_credits",
        pack,
        credits:        String(packInfo.credits),
        amountEurCents: String(packInfo.amountEurCents),
      },
    });

    logger.info({ pack, credits: packInfo.credits, orgId }, "[Billing] AI credits checkout session created");
    res.json({ url: session.url, pack, credits: packInfo.credits });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create AI credits checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ── GET /billing/config ──────────────────────────────────────────────────────
router.get("/billing/config", (_req: Request, res: Response) => {
  const publishableKey = process.env["STRIPE_PUBLISHABLE_KEY"] ?? process.env["PUBLIC_STRIPE_API_KEY"] ?? "";
  res.json({ publishableKey });
});

// ── GET /billing/events (SSE) ─────────────────────────────────────────────────
router.get("/billing/events", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Load current plan from DB for the initial "connected" event
  const billingCtx = await loadBillingContext(orgId);
  res.write(`data: ${JSON.stringify({ type: "connected", plan: billingCtx.plan })}\n\n`);

  const send = (data: string) => res.write(data);
  store.addSseClient(orgId, send);

  const keepAlive = setInterval(() => { res.write(": ping\n\n"); }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    store.removeSseClient(orgId, send);
  });
});

// ── Stripe Webhook ────────────────────────────────────────────────────────────
router.post("/billing/webhook", async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"] || process.env["STRIPE_WEBHOOK_SECRET_RENDER"];

  if (!stripeKey) {
    res.status(503).json({ error: "Stripe not configured" });
    return;
  }

  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  let event: import("stripe").Stripe.Event;
  try {
    const stripe = await createStripeClient(stripeKey);
    const rawBody = req.rawBody ?? req.body;

    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } else {
      logger.warn("[Webhook] STRIPE_WEBHOOK_SECRET not set — skipping signature verification (dev only)");
      if (process.env["NODE_ENV"] === "production") {
        res.status(400).json({ error: "Webhook secret not configured" });
        return;
      }
      event = JSON.parse(rawBody.toString()) as import("stripe").Stripe.Event;
    }
  } catch (err) {
    logger.error({ err }, "[Webhook] Signature verification failed");
    res.status(400).json({ error: "Webhook signature invalid" });
    return;
  }

  logger.info({ type: event.type }, "[Webhook] Stripe event received");

  try {
    const { upsertOrgSettings: upsert } = await import("../services/org-settings.js");

    // Derive orgId from Stripe customer ID stored in org_settings
    let orgId = "default";
    try {
      const stripeCustomerId =
        ((event.data.object as unknown) as Record<string, unknown>)["customer"] as string | undefined;
      if (stripeCustomerId) {
        const { pool: rawPool } = await import("@workspace/db");
        const orgLookup = await rawPool.query<{ org_id: string }>(
          `SELECT org_id FROM org_settings WHERE stripe_customer_id = $1 LIMIT 1`,
          [stripeCustomerId]
        );
        if (orgLookup.rows[0]) orgId = orgLookup.rows[0].org_id;
      }
    } catch (lookupErr) {
      logger.warn({ lookupErr }, "[Webhook] org lookup by stripe_customer_id failed — falling back to default");
    }

    // Load current DB plan for plan-fallback and event logging
    const orgSettings = await loadOrgSettings(orgId).catch(() => null);

    switch (event.type) {
      case "customer.subscription.created": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        const plan = (sub.metadata?.["plan"] || "standard").toLowerCase();
        const status = sub.status;
        const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

        if (plan) store.broadcastPlanUpdate(plan, orgId);
        await upsert(orgId, {
          subscriptionStatus: status,
          plan: plan || undefined,
          trialEndsAt: trialEnd ?? undefined,
          stripeCustomerId: String(sub.customer),
        });
        await trackBillingEvent("subscription_created", { plan, amount: 0, currency: "eur", subscriptionId: sub.id }, orgId);
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        const plan = (sub.metadata?.["plan"] || orgSettings?.plan || "standard").toLowerCase();
        const status = sub.status;
        const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
        const cancelAtPeriodEnd = sub.cancel_at_period_end;

        if (plan) store.broadcastPlanUpdate(plan, orgId);
        await upsert(orgId, {
          subscriptionStatus: status,
          plan:               plan || undefined,
          trialEndsAt:        trialEnd ?? undefined,
          // Clear any pending downgrade now that the plan has been applied by Stripe
          pendingPlan:        null,
          pendingPlanDate:    null,
        });

        if (cancelAtPeriodEnd) {
          // Subscription scheduled for cancellation — broadcast so SSE clients update UI
          store.broadcast({ type: "billing:cancel_scheduled", cancelAt: sub.cancel_at }, orgId);
          logger.info({ subId: sub.id, orgId, cancelAt: sub.cancel_at }, "[Webhook] Subscription scheduled for cancellation");
        }
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        store.broadcast({ type: "billing:subscription_canceled" }, orgId);
        await upsert(orgId, { subscriptionStatus: "canceled" });
        await trackBillingEvent("subscription_canceled", {
          plan: orgSettings?.plan ?? "standard",
          amount: 0, currency: "eur", subscriptionId: sub.id,
        }, orgId);
        // Send cancellation email (fire-and-forget)
        try {
          const orgEmail = (orgSettings as unknown as { email?: string } | null)?.email;
          if (orgEmail) {
            mailer.sendSubscriptionCanceled({
              to: orgEmail, name: orgEmail.split("@")[0],
              plan: orgSettings?.plan ?? "standard", cancelDate: null,
            }).catch(() => {});
          }
        } catch { /* non-fatal */ }
        logger.warn({ subId: sub.id, orgId }, "[Webhook] Subscription canceled");
        break;
      }

      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
        logger.info({ trialEnd, subId: sub.id, orgId }, "[Webhook] Trial will end soon");
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object as import("stripe").Stripe.Invoice;
        const subId = (invoice as { subscription?: string }).subscription;
        const amount = (invoice.amount_paid || 0) / 100;

        store.broadcast({ type: "billing:payment_succeeded" }, orgId);
        await upsert(orgId, { subscriptionStatus: "active" });
        await trackBillingEvent("subscription_renewed", {
          plan: orgSettings?.plan ?? "standard", amount, currency: invoice.currency ?? "eur",
          invoiceId: invoice.id, subscriptionId: subId,
        }, orgId);
        logger.info({ invoiceId: invoice.id, amount, orgId }, "[Webhook] Payment succeeded — subscription active");
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as import("stripe").Stripe.Invoice;
        store.broadcast({ type: "billing:payment_failed" }, orgId);
        await upsert(orgId, { subscriptionStatus: "past_due" });
        logger.warn({ invoiceId: invoice.id, orgId }, "[Webhook] Payment failed — subscription past_due");
        break;
      }

      case "checkout.session.completed": {
        const session = event.data.object as import("stripe").Stripe.Checkout.Session;
        const plan = (session.metadata?.["plan"] || "pro").toLowerCase();
        store.broadcastPlanUpdate(plan, orgId);
        await upsert(orgId, {
          subscriptionStatus: "active",
          plan,
          stripeCustomerId: session.customer ? String(session.customer) : undefined,
        });
        await trackBillingEvent("subscription_created", { plan, amount: 0, currency: "eur", sessionId: session.id }, orgId);
        break;
      }

      default:
        logger.debug({ type: event.type }, "[Webhook] Unhandled Stripe event type");
    }

    // Log raw event to DB for audit trail
    try {
      const { pool: rawPool } = await import("@workspace/db");
      await rawPool.query(
        `INSERT INTO billing_events (org_id, type, amount, currency, plan, metadata, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,now())
         ON CONFLICT DO NOTHING`,
        [orgId, event.type, 0, "eur", orgSettings?.plan ?? "standard", JSON.stringify({ eventId: event.id })]
      );
    } catch { /* non-fatal */ }

  } catch (err) {
    logger.error({ err, type: event.type }, "[Webhook] Event processing failed");
  }

  res.json({ received: true });
});

// ── POST /billing/addon-checkout ───────────────────────────────────────────────
router.post("/billing/addon-checkout", billingCheckoutRateLimit, async (req: Request, res: Response): Promise<void> => {
  const { addonKey = "", addonName = "" } = req.body as { addonKey?: string; addonName?: string; price?: string };
  if (!addonKey) { res.status(400).json({ error: "addonKey required" }); return; }

  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);

  const addonPriceId = ADDON_PRICE_IDS[addonKey];
  const stripeKeyForAddonCheck = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];

  if (stripeKeyForAddonCheck && billingCtx.stripeCustomerId) {
    try {
      const stripeForAddonCheck = await createStripeClient(stripeKeyForAddonCheck);
      const activeSubs = await stripeForAddonCheck.subscriptions.list({
        customer: billingCtx.stripeCustomerId,
        status: "active",
        limit: 10,
      });
      const trialSubs = await stripeForAddonCheck.subscriptions.list({
        customer: billingCtx.stripeCustomerId,
        status: "trialing",
        limit: 10,
      });
      const allSubs = [...activeSubs.data, ...trialSubs.data];
      if (addonPriceId && allSubs.some((sub: { items: { data: { price: { id: string } }[] } }) =>
        sub.items.data.some((item: { price: { id: string } }) => item.price.id === addonPriceId)
      )) {
        logger.warn({ addonKey, orgId }, "[Billing] addon-checkout blocked — addon already active in Stripe");
        res.status(409).json({ error: "addon_already_active", message: `L'add-on "${addonName || addonKey}" est déjà actif sur votre abonnement.` });
        return;
      }
    } catch (stripeCheckErr) {
      logger.warn({ stripeCheckErr, addonKey, orgId }, "[Billing] Stripe addon active-check failed — falling back to DB state");
      const existingVal = billingCtx.addons[addonKey];
      if (existingVal === true || (typeof existingVal === "number" && existingVal > 0)) {
        logger.warn({ addonKey, orgId }, "[Billing] addon-checkout blocked by DB state fallback");
        res.status(409).json({ error: "addon_already_active", message: `L'add-on "${addonName || addonKey}" est déjà actif sur votre abonnement.` });
        return;
      }
    }
  } else {
    // No Stripe credentials or no customer — check DB state
    const existingVal = billingCtx.addons[addonKey];
    if (existingVal === true || (typeof existingVal === "number" && existingVal > 0)) {
      logger.warn({ addonKey, orgId }, "[Billing] addon-checkout blocked — addon already active (DB state, no Stripe key)");
      res.status(409).json({ error: "addon_already_active", message: `L'add-on "${addonName || addonKey}" est déjà actif sur votre abonnement.` });
      return;
    }
  }

  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";

  const priceId = ADDON_PRICE_IDS[addonKey];
  if (!priceId) {
    res.status(422).json({ error: `Aucun prix Stripe configuré pour l'add-on "${addonName || addonKey}". Contactez le support.` });
    return;
  }

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("[Billing] STRIPE_SECRET_KEY not set — addon checkout unavailable");
      res.status(503).json({ error: "Payment service not configured. Contact support." });
      return;
    }
    logger.warn("[Billing] STRIPE_SECRET_KEY not set — returning mock addon checkout (dev only)");
    res.json({ url: `https://checkout.stripe.com/c/pay/test_addon_${addonKey}_${Date.now()}`, mock: true });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${publicUrl}/billing?addon_success=${encodeURIComponent(addonKey)}`,
      cancel_url:  `${publicUrl}/billing?addon_cancel=1`,
      metadata: { addonKey, addonName, orgId },
    });

    const sessionId: string = typeof session.id === "string" ? session.id : String(session.id ?? "");
    store.logActivity({
      type: "billing",
      label: `Add-on checkout initié : ${addonName || addonKey}`,
      targetId: sessionId,
      targetType: "billing",
      metadata: { addonKey },
    }).catch(() => {});

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, addonKey, orgId }, "[Billing] addon-checkout failed");
    res.status(500).json({ error: "Erreur lors de la création du paiement" });
  }
});

export default router;
