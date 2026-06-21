import { Router, type Request, type Response } from "express";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { PLAN_PRICE_IDS, ADDON_PRICE_IDS, FLAG_ADDONS, QTY_ADDONS } from "../lib/plans.js";
import { PLAN_CONFIG, ADDON_CATALOG, getUsageSummary, getMRRData, getSubscriptionAnalytics, startTrial, validateCoupon, getInvoices, trackBillingEvent } from "../services/billing-service.js";
import { createRateLimit } from "../middlewares/rateLimiter.js";

const billingCheckoutRateLimit = createRateLimit("reportsPerHour");

const router = Router();

type AddonsMap = Record<string, boolean | number>;

function buildLineItems(plan: string, addons: AddonsMap): Array<{ price: string; quantity: number }> {
  const items: Array<{ price: string; quantity: number }> = [];

  const planPriceId = PLAN_PRICE_IDS[plan.toLowerCase()];
  if (planPriceId) items.push({ price: planPriceId, quantity: 1 });

  for (const key of FLAG_ADDONS) {
    if (!addons[key]) continue;
    if (key === "whiteLabel") continue;
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

router.post("/billing/checkout", billingCheckoutRateLimit, async (req: Request, res: Response) => {
  const { plan = "pro", addons = {} } = req.body as { plan?: string; addons?: AddonsMap };

  const stripeKey = process.env["STRIPE_SECRET_KEY"];
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
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    const lineItems = buildLineItems(plan, addons);

    if (lineItems.length === 0) {
      res.status(400).json({ error: `No Stripe price configured for plan: ${plan}. Set STRIPE_PRICE_${plan.toUpperCase()} env var.` });
      return;
    }

    let customerId = store.me.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ name: store.me.firstName, metadata: { plan } });
      customerId = customer.id;
      store.me.stripeCustomerId = customerId;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: lineItems,
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

router.post("/billing/checkout-embedded", async (req: Request, res: Response) => {
  const { plan = "pro", addons = {} } = req.body as { plan?: string; addons?: AddonsMap };

  const stripeKey = process.env["STRIPE_SECRET_KEY"];
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
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    const lineItems = buildLineItems(plan, addons);
    if (lineItems.length === 0) {
      res.status(400).json({ error: `No price configured for plan: ${plan}` });
      return;
    }

    let customerId = store.me.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ name: store.me.firstName, metadata: { plan } });
      customerId = customer.id;
      store.me.stripeCustomerId = customerId;
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      ui_mode: "embedded",
      line_items: lineItems,
      return_url: `${publicUrl}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
      metadata: { plan, addons: JSON.stringify(addons) },
    });

    res.json({ clientSecret: session.client_secret });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create embedded checkout session");
    res.status(500).json({ error: "Failed to create embedded checkout session" });
  }
});

router.get("/billing/verify", async (req: Request, res: Response) => {
  const sessionId = String(req.query["session_id"] || "");
  if (!sessionId) { res.status(400).json({ error: "session_id required" }); return; }

  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  const apiSecretKey = process.env["API_SECRET_KEY"];

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
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription"] });

    if (session.payment_status !== "paid" && session.status !== "complete") {
      res.status(402).json({ error: "Payment not completed", status: session.status });
      return;
    }

    const planMeta = (session.metadata?.["plan"] || "pro").toLowerCase();
    if (["standard","pro","ultra"].includes(planMeta)) {
      store.broadcastPlanUpdate(planMeta);
    }

    if (session.customer) {
      store.me.stripeCustomerId = String(session.customer);
    }
    store.me.subscriptionStatus = "active";

    let addonsMeta: Record<string, boolean | number> = {};
    try { addonsMeta = JSON.parse(session.metadata?.["addons"] || "{}"); } catch {}

    if (addonsMeta["whiteLabel"] !== undefined) {
      store.me.addons.whiteLabel = !!addonsMeta["whiteLabel"];
    }
    if (addonsMeta["customDomain"] !== undefined) {
      store.me.addons.customDomain = !!addonsMeta["customDomain"];
    }
    if (addonsMeta["prioritySupport"] !== undefined) {
      store.me.addons.prioritySupport = !!addonsMeta["prioritySupport"];
    }
    if (addonsMeta["extraSeats"] !== undefined) {
      store.me.addons.extraSeats = Number(addonsMeta["extraSeats"] || 0);
    }
    if (addonsMeta["monitorsPack50"] !== undefined) {
      store.me.addons.monitorsPack50 = Number(addonsMeta["monitorsPack50"] || 0);
    }

    logger.info({ plan: planMeta, sessionId }, "[Billing] Checkout verified — plan activated");

    res.json({ ok: true, plan: planMeta });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to verify checkout session");
    res.status(500).json({ error: "Failed to verify checkout session" });
  }
});

router.post("/billing/portal", billingCheckoutRateLimit, async (_req: Request, res: Response) => {
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";
  const returnUrl = process.env["STRIPE_RETURN_URL"] || `${publicUrl}/dashboard`;

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

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    let customerId = store.me.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ name: store.me.firstName, metadata: { plan: store.me.plan } });
      customerId = customer.id;
      store.me.stripeCustomerId = customerId;
    }

    const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create Stripe portal session");
    res.status(500).json({ error: "Failed to create billing portal session" });
  }
});

// ── NEW: GET /billing/plans ──────────────────────────────────────────────────
router.get("/billing/plans", (_req: Request, res: Response) => {
  const plans = Object.values(PLAN_CONFIG);
  res.json({
    plans,
    addons: ADDON_CATALOG,
    current: (store.me.plan || "standard").toLowerCase(),
    subscriptionStatus: store.me.subscriptionStatus,
    trialEndsAt: store.me.trialEndsAt,
  });
});

// ── NEW: GET /billing/usage ──────────────────────────────────────────────────
router.get("/billing/usage", async (_req: Request, res: Response) => {
  try {
    const usage = await getUsageSummary();
    res.json(usage);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get usage");
    res.status(500).json({ error: "Failed to retrieve usage data" });
  }
});

// ── NEW: GET /billing/analytics ──────────────────────────────────────────────
router.get("/billing/analytics", async (_req: Request, res: Response) => {
  try {
    const analytics = await getSubscriptionAnalytics();
    res.json(analytics);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get analytics");
    res.status(500).json({ error: "Failed to retrieve subscription analytics" });
  }
});

// ── NEW: GET /billing/mrr ────────────────────────────────────────────────────
router.get("/billing/mrr", async (_req: Request, res: Response) => {
  try {
    const mrr = await getMRRData();
    res.json(mrr);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get MRR data");
    res.status(500).json({ error: "Failed to retrieve MRR data" });
  }
});

// ── NEW: GET /billing/invoices ───────────────────────────────────────────────
router.get("/billing/invoices", async (_req: Request, res: Response) => {
  const limit = Math.min(Number((_req.query as Record<string, string>)["limit"] || 20), 100);
  try {
    const result = await getInvoices(limit);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get invoices");
    res.status(500).json({ error: "Failed to retrieve invoices" });
  }
});

// ── NEW: POST /billing/trial ─────────────────────────────────────────────────
router.post("/billing/trial", async (req: Request, res: Response) => {
  const { plan = "pro", days = 14 } = req.body as { plan?: string; days?: number };
  if (store.me.subscriptionStatus === "active") {
    res.status(409).json({ error: "Vous avez déjà un abonnement actif" });
    return;
  }
  try {
    const result = await startTrial(plan, days);
    await trackBillingEvent("trial_started", { plan, days, ...result }).catch(() => {});
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to start trial");
    res.status(500).json({ error: "Failed to start trial" });
  }
});

// ── NEW: POST /billing/coupon/validate ───────────────────────────────────────
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

// ── NEW: GET /billing/subscription ──────────────────────────────────────────
router.get("/billing/subscription", async (_req: Request, res: Response) => {
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
  const me = store.me;

  if (!stripeKey || !me.stripeCustomerId) {
    res.json({
      plan: me.plan,
      status: me.subscriptionStatus,
      trialEndsAt: me.trialEndsAt,
      addons: me.addons,
      mock: !stripeKey,
    });
    return;
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
    const subs = await stripe.subscriptions.list({ customer: me.stripeCustomerId, limit: 1 });
    const sub = subs.data[0];

    res.json({
      plan: me.plan,
      status: sub?.status || me.subscriptionStatus,
      trialEndsAt: sub?.trial_end ? new Date(sub.trial_end * 1000).toISOString() : me.trialEndsAt,
      currentPeriodEnd: sub?.current_period_end ? new Date(sub.current_period_end * 1000).toISOString() : null,
      cancelAtPeriodEnd: sub?.cancel_at_period_end || false,
      addons: me.addons,
      stripeCustomerId: me.stripeCustomerId,
    });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get subscription");
    res.json({ plan: me.plan, status: me.subscriptionStatus, addons: me.addons });
  }
});

// ── NEW: POST /billing/checkout with coupon + annual support ─────────────────
// (Also supports ?annual=true and ?coupon=CODE query params in the enhanced version)
// The existing /billing/checkout handler handles basic checkout.
// We add /billing/checkout/annual as a convenience.
router.post("/billing/checkout/annual", async (req: Request, res: Response) => {
  const { plan = "pro", addons = {}, coupon } = req.body as { plan?: string; addons?: AddonsMap; coupon?: string };
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
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
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    const annualPriceEnvKey = `STRIPE_PRICE_${plan.toUpperCase()}_ANNUAL`;
    const annualPriceId = process.env[annualPriceEnvKey] || PLAN_PRICE_IDS[plan.toLowerCase()];

    if (!annualPriceId) {
      res.status(400).json({ error: `No annual price configured for plan: ${plan}` });
      return;
    }

    let customerId = store.me.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ name: store.me.firstName, metadata: { plan } });
      customerId = customer.id;
      store.me.stripeCustomerId = customerId;
    }

    const sessionParams: Parameters<typeof stripe.checkout.sessions.create>[0] = {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: annualPriceId, quantity: 1 }],
      success_url: `${publicUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&annual=1`,
      cancel_url: `${publicUrl}/cancel.html`,
      metadata: { plan, addons: JSON.stringify(addons), billing: "annual" },
      subscription_data: { metadata: { plan, billing: "annual" } },
    };

    if (coupon) {
      (sessionParams as Record<string, unknown>)["discounts"] = [{ coupon }];
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url, plan, annual: true });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create annual checkout");
    res.status(500).json({ error: "Failed to create annual checkout session" });
  }
});

// ── GET /billing/usage-details ───────────────────────────────────────────────
// Returns real counters for billing page (reports, team).
// Infrastructure metrics (storage, bandwidth, API calls, emails) are not yet
// instrumented server-side — those fields return null so the UI shows "—".
router.get("/billing/usage-details", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgContext?.orgId ?? "default";
  const me    = store.me;
  const limits = PLAN_LIMITS[me.plan.toLowerCase()] ?? PLAN_LIMITS["standard"];

  let reportsUsed: number | null = null;
  let teamMembersUsed: number | null = null;

  try {
    const r = await pool.query(
      `SELECT COUNT(*) FROM reports WHERE org_id = $1 AND created_at > date_trunc('month', now())`,
      [orgId]
    );
    reportsUsed = Number(r.rows[0]?.count ?? 0);
  } catch { /* reports table may not exist yet */ }

  try {
    const r = await pool.query(
      `SELECT COUNT(*) FROM team_members WHERE org_id = $1`,
      [orgId]
    );
    teamMembersUsed = Math.max(1, Number(r.rows[0]?.count ?? 1));
  } catch { /* team_members table may not exist yet */ }

  res.json({
    reportsUsed,
    reportsLimit:       limits.reports,
    teamMembersUsed,
    teamMembersLimit:   limits.teamMembers,
    // Not yet instrumented on server side — return null so UI shows "—"
    emailsSent:    null,
    apiCalls:      null,
    storageUsed:   null,
    bandwidthUsed: null,
  });
});

router.get("/billing/config", (_req: Request, res: Response) => {
  const publishableKey = process.env["STRIPE_PUBLISHABLE_KEY"] ?? process.env["PUBLIC_STRIPE_API_KEY"] ?? "";
  res.json({ publishableKey });
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

  const keepAlive = setInterval(() => { res.write(": ping\n\n"); }, 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    store.sseClients.delete(send);
  });
});

// ── Stripe Webhook ────────────────────────────────────────────────────────────
// Raw body is already applied in app.ts for /api/billing/webhook
router.post("/billing/webhook", async (req: Request & { rawBody?: Buffer }, res: Response) => {
  const stripeKey = process.env["STRIPE_SECRET_KEY"];
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
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
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
    const { upsertOrgSettings } = await import("../services/org-settings.js");
    const { pool } = await import("@workspace/db");
    const orgId = "default";

    switch (event.type) {
      // ── Trial started ──────────────────────────────────────────────────────
      case "customer.subscription.created": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        const plan = (sub.metadata?.["plan"] || "standard").toLowerCase();
        const status = sub.status; // "trialing" | "active" | ...
        const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

        store.me.subscriptionStatus = status;
        store.me.trialEndsAt = trialEnd ?? store.me.trialEndsAt;
        if (plan) { store.me.plan = plan; store.broadcastPlanUpdate(plan); }
        if (sub.customer) store.me.stripeCustomerId = String(sub.customer);

        await upsertOrgSettings(orgId, {
          subscriptionStatus: status,
          plan: plan || undefined,
          trialEndsAt: trialEnd ?? undefined,
          stripeCustomerId: String(sub.customer),
        });
        await trackBillingEvent("subscription_created", { plan, amount: 0, currency: "eur", subscriptionId: sub.id });
        break;
      }

      // ── Subscription changed (upgrade/downgrade/cancel scheduled) ──────────
      case "customer.subscription.updated": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        const plan = (sub.metadata?.["plan"] || store.me.plan || "standard").toLowerCase();
        const status = sub.status;
        const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;

        store.me.subscriptionStatus = status;
        if (trialEnd) store.me.trialEndsAt = trialEnd;
        if (plan) { store.me.plan = plan; store.broadcastPlanUpdate(plan); }

        await upsertOrgSettings(orgId, {
          subscriptionStatus: status,
          plan: plan || undefined,
          trialEndsAt: trialEnd ?? undefined,
        });
        break;
      }

      // ── Subscription ended (canceled / trial expired without payment) ───────
      case "customer.subscription.deleted": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        store.me.subscriptionStatus = "canceled";

        await upsertOrgSettings(orgId, { subscriptionStatus: "canceled" });
        await trackBillingEvent("subscription_canceled", { plan: store.me.plan, amount: 0, currency: "eur", subscriptionId: sub.id });
        logger.warn({ subId: sub.id }, "[Webhook] Subscription canceled");
        break;
      }

      // ── Trial ending soon (3 days before) ─────────────────────────────────
      case "customer.subscription.trial_will_end": {
        const sub = event.data.object as import("stripe").Stripe.Subscription;
        const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null;
        logger.info({ trialEnd, subId: sub.id }, "[Webhook] Trial will end soon — send reminder email here");
        // TODO: trigger reminder email via Resend
        break;
      }

      // ── Payment succeeded → mark active ────────────────────────────────────
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as import("stripe").Stripe.Invoice;
        const subId = (invoice as { subscription?: string }).subscription;
        const amount = (invoice.amount_paid || 0) / 100;

        store.me.subscriptionStatus = "active";
        await upsertOrgSettings(orgId, { subscriptionStatus: "active" });
        await trackBillingEvent("subscription_renewed", {
          plan: store.me.plan, amount, currency: invoice.currency ?? "eur",
          invoiceId: invoice.id, subscriptionId: subId,
        });
        logger.info({ invoiceId: invoice.id, amount }, "[Webhook] Payment succeeded — subscription active");
        break;
      }

      // ── Payment failed → mark past_due ─────────────────────────────────────
      case "invoice.payment_failed": {
        const invoice = event.data.object as import("stripe").Stripe.Invoice;
        store.me.subscriptionStatus = "past_due";
        await upsertOrgSettings(orgId, { subscriptionStatus: "past_due" });
        logger.warn({ invoiceId: invoice.id }, "[Webhook] Payment failed — subscription past_due");
        break;
      }

      // ── Checkout session completed (alternative activation path) ───────────
      case "checkout.session.completed": {
        const session = event.data.object as import("stripe").Stripe.Checkout.Session;
        const plan = (session.metadata?.["plan"] || "pro").toLowerCase();
        if (session.customer) store.me.stripeCustomerId = String(session.customer);
        store.me.subscriptionStatus = "active";
        store.me.plan = plan;
        store.broadcastPlanUpdate(plan);
        await upsertOrgSettings(orgId, {
          subscriptionStatus: "active",
          plan,
          stripeCustomerId: session.customer ? String(session.customer) : undefined,
        });
        await trackBillingEvent("subscription_created", { plan, amount: 0, currency: "eur", sessionId: session.id });
        break;
      }

      default:
        logger.debug({ type: event.type }, "[Webhook] Unhandled Stripe event type");
    }

    // Log raw event to DB for audit trail
    try {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO billing_events (org_id, type, amount, currency, plan, metadata, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,now())
           ON CONFLICT DO NOTHING`,
          [orgId, event.type, 0, "eur", store.me.plan, JSON.stringify({ eventId: event.id })]
        );
      } finally { client.release(); }
    } catch { /* non-fatal */ }

  } catch (err) {
    logger.error({ err, type: event.type }, "[Webhook] Event processing failed");
  }

  res.json({ received: true });
});

export default router;
