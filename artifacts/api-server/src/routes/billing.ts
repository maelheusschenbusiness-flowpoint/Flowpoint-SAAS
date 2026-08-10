import { Router, type Request, type Response } from "express";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { ownerOnly } from "../middlewares/requireRole.js";
import { PLAN_PRICE_IDS, ADDON_PRICE_IDS, FLAG_ADDONS, QTY_ADDONS, PLAN_LIMITS, PLAN_INCLUDED_ADDONS } from "../lib/plans.js";
import { persistOrgData, loadOrgData, findOrgByStripeCustomer } from "../services/org-data.js";
import { loadBillingContext } from "../services/billing-context.js";
import { createStripeClient, getStripeCheckoutModeLog, getStripeKey } from "../services/stripe-factory.js";
import { ensureStripeCustomer } from "../services/ensure-stripe-customer.js";
import { createBillingQuote, quoteToStripeLineItems, type BillingQuote } from "../services/billing-quote.js";
import {
  getUsageSummary, getMRRData, getSubscriptionAnalytics,
  startTrial, validateCoupon, getInvoices, trackBillingEvent,
} from "../services/billing-service.js";
import { mailer } from "../services/mailer.js";
import { createRateLimit } from "../middlewares/rateLimiter.js";
import { provisionPlanAddons } from "../services/addons-service.js";

/* PLAN_INCLUDED_ADDONS imported from plans.ts — do NOT duplicate here */

/** Dedicated billing rate limiters — do NOT share quota with reports/exports. */
const billingPortalRateLimit   = createRateLimit("billingPortalPerMinute");
const billingCheckoutRateLimit = createRateLimit("billingCheckoutPerMinute");
const billingDeleteRateLimit   = createRateLimit("billingDeletePerMinute");

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

// ── Input validation helpers ───────────────────────────────────────────────────
const ALLOWED_PLANS    = new Set<string>(["standard", "pro", "ultra"]);
const KNOWN_ADDON_KEYS = new Set<string>([...FLAG_ADDONS, ...QTY_ADDONS]);
const MAX_ADDON_QTY    = 500;
const AI_CREDIT_PACK_KEYS = new Set<string>(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);

/** Validates and normalises a plan string. Sends 400 + returns null on failure. */
function parsePlan(raw: unknown, res: Response): string | null {
  if (raw === undefined || raw === null || raw === "") {
    res.status(400).json({ error: "plan requis — valeurs acceptées : standard, pro, ultra" });
    return null;
  }
  if (typeof raw !== "string") {
    const typ = Array.isArray(raw) ? "array" : typeof raw;
    res.status(400).json({ error: `plan doit être une chaîne de caractères (reçu : ${typ})` });
    return null;
  }
  const p = raw.trim().toLowerCase();
  if (!ALLOWED_PLANS.has(p)) {
    res.status(400).json({ error: `Plan inconnu : "${raw}". Plans autorisés : standard, pro, ultra` });
    return null;
  }
  return p;
}

/** Like parsePlan but returns defaultPlan when the field is absent (undefined only — null still fails). */
function parsePlanWithDefault(raw: unknown, defaultPlan: string, res: Response): string | null {
  if (raw === undefined) return defaultPlan;
  return parsePlan(raw, res);
}

/** Validates the addons object. Sends 400 + returns null on failure. */
function parseAddons(raw: unknown, res: Response): AddonsMap | null {
  if (raw === undefined || raw === null) return {};
  if (Array.isArray(raw) || typeof raw !== "object") {
    res.status(400).json({ error: 'addons doit être un objet (ex: { "whiteLabel": true })' });
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const result: AddonsMap = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!KNOWN_ADDON_KEYS.has(key)) {
      res.status(400).json({ error: `Add-on inconnu : "${key}"` });
      return null;
    }
    if (typeof val === "boolean") { result[key] = val; continue; }
    if (typeof val !== "number" || !Number.isFinite(val) || !Number.isInteger(val)) {
      const typ = Array.isArray(val) ? "array" : typeof val;
      res.status(400).json({ error: `Quantité invalide pour "${key}" : entier attendu (reçu : ${typ})` });
      return null;
    }
    if (val <= 0) { res.status(400).json({ error: `Quantité invalide pour "${key}" : doit être > 0` }); return null; }
    if (val > MAX_ADDON_QTY) { res.status(400).json({ error: `Quantité invalide pour "${key}" : maximum ${MAX_ADDON_QTY}` }); return null; }
    result[key] = val;
  }
  return result;
}


router.post("/billing/create-checkout-session", billingCheckoutRateLimit, async (req: Request, res: Response) => {
  res.redirect(307, "/api/billing/checkout");
});

// ── POST /billing/checkout ───────────────────────────────────────────────────
router.post("/billing/checkout", billingCheckoutRateLimit, async (req: Request, res: Response) => {
  const plan = parsePlan(req.body?.plan, res);
  if (plan === null) return;
  const addons = parseAddons(req.body?.addons, res);
  if (addons === null) return;
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

  const stripeKey = getStripeKey();
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

    /* Canonical quote — the single place line items, plan inclusions and trial
       length are derived. This route used to build its own Stripe items and
       hardcode a 14-day trial, which is exactly how the dashboard price and the
       charged price drifted apart. */
    let quote: BillingQuote;
    try {
      quote = createBillingQuote({
        plan,
        addons,
        trialEligible: grantTrial,
        mechanism: "checkout_session",
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "INVALID_SELECTION";
      res.status(400).json({ error: "Sélection non facturable.", code });
      return;
    }

    const lineItems = quoteToStripeLineItems(quote);

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

    const subscriptionData: Record<string, unknown> = {};
    if (quote.trialEligible) {
      subscriptionData["trial_period_days"] = quote.trialDays;
      logger.info({ plan, orgId, trialDays: quote.trialDays }, "[Billing] Granting trial — confirmed first-time subscriber");
    } else {
      logger.info({ plan, hasHadTrial, hasStripeSubHistory, orgId }, "[Billing] Skipping trial — prior subscription history");
    }

    logger.info(getStripeCheckoutModeLog(stripeKey), "[BillingCertification] Checkout Session mode");
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: lineItems,
      subscription_data: subscriptionData,
      success_url: `${publicUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${publicUrl}/cancel.html?next=${encodeURIComponent("/pricing.html")}`,
      metadata: { plan, addons: JSON.stringify(addons) },
    });

    res.json({ url: session.url, plan, quote });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create Stripe checkout session");
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// ── GET /billing/verify ──────────────────────────────────────────────────────
router.get("/billing/verify", async (req: Request, res: Response) => {
  const sessionId = String(req.query["session_id"] || "");
  if (!sessionId) { res.status(400).json({ error: "session_id required" }); return; }

  const stripeKey = getStripeKey();

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

    // ── Detect checkout type from metadata ─────────────────────────────────────
    // AI credits-only sessions must not be treated as plan subscriptions;
    // the caller (checkout-return.html) uses checkoutType to show the right UI.
    const sessionMeta = (session.metadata ?? {}) as Record<string, string>;
    const checkoutType: string = sessionMeta["flowpoint_checkout_type"] ?? sessionMeta["type"] ?? "subscription";
    const isAiCredits = checkoutType === "ai_credits_only" || checkoutType === "ai_credits";

    // Credits field: parse from ai_credits metadata or credits field
    let creditsGranted = 0;
    if (isAiCredits) {
      const rawCredits = sessionMeta["credits"] ?? "0";
      creditsGranted = parseInt(rawCredits, 10) || 0;
      if (!creditsGranted) {
        // Try resolving from ai_credits pack key list
        const AI_CREDITS_FROM_PACK: Record<string, number> = {
          aiCreditsPack50k: 50000, aiCreditsPack200k: 200000, aiCreditsPack500k: 500000,
        };
        const packKey = (sessionMeta["ai_credits"] ?? "").split(",").find(k => k.startsWith("aiCreditsPack"));
        if (packKey) creditsGranted = AI_CREDITS_FROM_PACK[packKey] ?? 0;
        if (!creditsGranted) {
          const packName = sessionMeta["pack"] ?? "";
          creditsGranted = AI_CREDITS_FROM_PACK[packName] ?? 0;
        }
      }
    }

    const orgIdVerify = req.orgId ?? "default";

    // For AI credits: no plan update needed; webhook already credited the org.
    // Return early with credits info so checkout-return.html can show proper confirmation.
    if (isAiCredits) {
      logger.info({ checkoutType, creditsGranted, sessionId, orgId: orgIdVerify }, "[Billing] AI credits session verified");
      res.json({ ok: true, checkoutType, credits: creditsGranted });
      return;
    }

    const planMeta = (sessionMeta["selected_plan"] || sessionMeta["plan"] || "pro").toLowerCase();
    if (["standard","pro","ultra"].includes(planMeta)) {
      store.broadcastPlanUpdate(planMeta, orgIdVerify);
    }

    let addonsMeta: Record<string, boolean | number> = {};
    try { addonsMeta = JSON.parse(sessionMeta["addons"] || "{}"); } catch {}

    const activatedAddons: Record<string, unknown> = {};
    for (const key of FLAG_ADDONS) {
      if (addonsMeta[key] !== undefined) activatedAddons[key] = !!addonsMeta[key];
    }
    for (const key of QTY_ADDONS) {
      if (addonsMeta[key] !== undefined) activatedAddons[key] = Number(addonsMeta[key] || 0);
    }

    const billingCtx = await loadBillingContext(orgIdVerify);

    // Persist billing state to organizations (new source of truth) + mirror to org_settings
    const subscription = typeof session.subscription === "object" && session.subscription
      ? session.subscription as { id?: string; status?: string; trial_end?: number | null }
      : null;
    const trialEndsAt = subscription?.trial_end
      ? new Date(subscription.trial_end * 1000).toISOString()
      : billingCtx.trialEndsAt ?? undefined;
    await persistOrgData(orgIdVerify, {
      plan: planMeta,
      subscriptionStatus: subscription?.status ?? (trialEndsAt ? "trialing" : "active"),
      stripeCustomerId: session.customer ? String(session.customer) : (billingCtx.stripeCustomerId ?? undefined),
      stripeSubscriptionId: subscription?.id ?? billingCtx.stripeSubscriptionId ?? undefined,
      trialEndsAt,
    }).catch(err => logger.error({ err }, "[Billing] Failed to persist billing state after checkout verify"));
    logger.info({ plan: planMeta, sessionId, orgId: orgIdVerify }, "[Billing] Checkout verified — plan activated");

    res.json({ ok: true, plan: planMeta, checkoutType });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to verify checkout session");
    res.status(500).json({ error: "Failed to verify checkout session" });
  }
});

// ── POST /billing/portal ─────────────────────────────────────────────────────
router.post("/billing/portal", billingPortalRateLimit, ownerOnly, async (req: Request, res: Response) => {
  const stripeKey = getStripeKey();
  const publicUrl = process.env["PUBLIC_URL"] || "http://localhost:3001";
  const returnUrl = process.env["STRIPE_RETURN_URL"] || `${publicUrl}/dashboard`;

  // ── Log 1/3 : request received (before any async work) ────────────────────
  if (diagnosticsEnabled) {
    logger.info({
      event:     "billing_portal_request_received",
      requestId: (req as unknown as Record<string, unknown>)["id"]
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
        userId:                   (req as unknown as Record<string, unknown>)["userId"] ?? orgId,
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

// ── GET /billing/payment-methods ─────────────────────────────────────────────
router.get("/billing/payment-methods", async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";
  const stripeKey = getStripeKey();
  const billingCtx = await loadBillingContext(orgId);
  const stripeCustomerId = billingCtx.stripeCustomerId ?? undefined;

  if (!stripeKey || !stripeCustomerId) {
    res.json({ paymentMethods: [] });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);
    const [pmList, customer] = await Promise.all([
      stripe.paymentMethods.list({ customer: stripeCustomerId, type: "card" }),
      stripe.customers.retrieve(stripeCustomerId),
    ]);

    const defaultPmId =
      !customer.deleted && customer.invoice_settings?.default_payment_method
        ? (typeof customer.invoice_settings.default_payment_method === "string"
            ? customer.invoice_settings.default_payment_method
            : (customer.invoice_settings.default_payment_method as { id: string }).id)
        : null;

    const paymentMethods = (pmList.data as Array<{ id: string; card?: { brand?: string; last4?: string; exp_month?: number; exp_year?: number } }>).map((pm) => ({
      id:       pm.id,
      brand:    pm.card?.brand ?? "card",
      last4:    pm.card?.last4 ?? "????",
      expMonth: pm.card?.exp_month ?? 0,
      expYear:  pm.card?.exp_year  ?? 0,
      isDefault: pm.id === defaultPmId,
    }));

    res.json({ paymentMethods });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to get payment methods");
    res.status(500).json({ error: "Failed to retrieve payment methods" });
  }
});

// ── POST /billing/trial ──────────────────────────────────────────────────────
router.post("/billing/trial", async (req: Request, res: Response) => {
  const plan = parsePlanWithDefault(req.body?.plan, "pro", res);
  if (plan === null) return;
  const rawDays = req.body?.days;
  const days = (rawDays === undefined)
    ? 14
    : (typeof rawDays === "number" && Number.isInteger(rawDays) && rawDays >= 1 && rawDays <= 30)
      ? rawDays
      : null;
  if (days === null) { res.status(400).json({ error: "days doit être un entier entre 1 et 30" }); return; }
  const orgId = req.orgId ?? "default";

  const billingCtx = await loadBillingContext(orgId);
  if (billingCtx.subscriptionStatus === "active" || billingCtx.subscriptionStatus === "trialing") {
    res.status(409).json({ error: "Vous avez déjà un abonnement actif ou en période d'essai" });
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
  const stripeKey = getStripeKey();
  const orgId = req.orgId ?? "default";

  const billingCtx = await loadBillingContext(orgId);

  if (!stripeKey || !billingCtx.stripeCustomerId) {
    await persistOrgData(orgId, { subscriptionStatus: "canceled" }).catch(() => {});
    logger.warn({ orgId }, "[Billing] cancel: no Stripe key or customerId — marking canceled in DB");
    res.json({ ok: true, cancelAtPeriodEnd: atPeriodEnd, mock: true });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);
    // List ALL subscriptions (active, trialing, past_due, unpaid, incomplete)
    // using auto-pagination so we never miss a live sub hidden behind page 2+.
    const TERMINAL = new Set(["canceled", "incomplete_expired"]);
    const allSubsArr = await stripe.subscriptions.list({ customer: billingCtx.stripeCustomerId, status: "all" }).autoPagingToArray({ limit: 200 });
    type StripeSub = { id: string; status: string; current_period_end: number; trial_end?: number | null };
    const liveSubs = (allSubsArr as StripeSub[]).filter((s: StripeSub) => !TERMINAL.has(s.status));
    // Prefer active > trialing > any other live status
    const sub = liveSubs.find((s: StripeSub) => s.status === "active")
      ?? liveSubs.find((s: StripeSub) => s.status === "trialing")
      ?? liveSubs[0];
    if (!sub) {
      // Self-heal: DB says active/trialing but Stripe has no non-canceled subscription.
      // Correct the DB rather than returning a confusing 404 to the user.
      await persistOrgData(orgId, { subscriptionStatus: "canceled" }).catch(() => {});
      logger.warn({ orgId }, "[Billing] cancel: no live Stripe subscription found — self-healing DB status to canceled");
      res.json({ ok: true, selfHealed: true, message: "Abonnement déjà résilié — statut mis à jour." });
      return;
    }

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
      await persistOrgData(orgId, { subscriptionStatus: "canceled" }).catch(() => {});
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
  const stripeKey = getStripeKey();
  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);

  if (!stripeKey || !billingCtx.stripeCustomerId) {
    await persistOrgData(orgId, { subscriptionStatus: "active" }).catch(() => {});
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
    await persistOrgData(orgId, { subscriptionStatus: newStatus }).catch(() => {});

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
  const stripeKey = getStripeKey();
  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);

  if (!stripeKey || !billingCtx.stripeCustomerId) {
    await persistOrgData(orgId, { subscriptionStatus: "canceled" }).catch(() => {});
    logger.warn({ orgId }, "[Billing] cancel-trial: no Stripe key — marking canceled in DB (mock)");
    res.json({ ok: true, mock: true });
    return;
  }

  try {
    const stripe = await createStripeClient(stripeKey);
    // List ALL subscriptions using auto-pagination to detect every possible transition
    const CANCEL_TERMINAL = new Set(["canceled", "incomplete_expired"]);
    const allCancelSubsArr = await stripe.subscriptions.list({ customer: billingCtx.stripeCustomerId, status: "all" }).autoPagingToArray({ limit: 200 });
    type CancelSub = { id: string; status: string; trial_end?: number | null; current_period_end: number };
    const liveCancelSubs = (allCancelSubsArr as CancelSub[]).filter((s: CancelSub) => !CANCEL_TERMINAL.has(s.status));
    const trialSub  = liveCancelSubs.find((s: CancelSub) => s.status === "trialing");
    const activeSub = liveCancelSubs.find((s: CancelSub) => s.status === "active" || s.status === "past_due");

    if (!trialSub) {
      if (activeSub) {
        // Trial already transitioned to paid subscription — correct the DB and
        // tell the frontend to use the regular cancel flow instead.
        // Return 200 (not 409) so apiFetch/apiAction can read the response body.
        await persistOrgData(orgId, { subscriptionStatus: "active" }).catch(() => {});
        logger.info({ orgId, subId: activeSub.id }, "[Billing] cancel-trial: trial transitioned to active — DB corrected");
        res.json({
          ok: false,
          transitioned: true,
          error: "Votre essai est déjà converti en abonnement actif. Utilisez « Annuler l'abonnement » à la place.",
        });
        return;
      }
      // No live subscription at all — self-heal
      await persistOrgData(orgId, { subscriptionStatus: "canceled" }).catch(() => {});
      logger.warn({ orgId }, "[Billing] cancel-trial: no trialing Stripe subscription found — self-healing DB status to canceled");
      res.json({ ok: true, selfHealed: true, message: "Essai déjà terminé — statut mis à jour." });
      return;
    }
    const sub = trialSub;

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
      await persistOrgData(orgId, { subscriptionStatus: "canceled" }).catch(() => {});
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
// Handles: upgrade (immediate + prorations), downgrade (scheduled to the end
// of the current trial or paid period via a Stripe subscription schedule).
// Also reconciles add-ons that become included in the new plan.
router.post("/billing/upgrade", billingCheckoutRateLimit, ownerOnly, async (req: Request, res: Response) => {
  const plan = parsePlan(req.body?.plan, res);
  if (plan === null) return;

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

  const stripeKey = getStripeKey();
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

    // ── Canceled-subscription routing: determine exact Stripe state ─────────────
    //
    // DB subscriptionStatus === "canceled" has four real sub-states that require
    // different actions:
    //
    //  A) cancel_at_period_end = true — Stripe status is still "active"; the sub
    //     is live until the period ends. Normal sub.items upgrade/downgrade applies.
    //
    //  B) Trialing subscription — same as A; Stripe shows "trialing".
    //
    //  C) Completely terminated — no active/trialing sub in Stripe. The billing
    //     cycle is over. Downgrade → DB-only; upgrade → reactivation checkout.
    //
    //  D) Orphaned customer — customer ID in DB no longer exists in Stripe. Clean
    //     it up and send user to fresh checkout.
    //
    // We always query Stripe when a customer ID is stored; the DB value alone is
    // not authoritative enough to decide between these states.
    //
    if (billingCtx.subscriptionStatus === "canceled" && billingCtx.stripeCustomerId) {
      type OpenSession = { id: string; metadata?: Record<string, string>; url?: string | null };

      // Query live Stripe state: subscriptions + open checkout sessions in parallel.
      let canceledBlockSub: { id: string; status: string } | undefined;
      let openSessions:     OpenSession[] = [];

      try {
        const [activeSubs, trialingSubs, openSess] = await Promise.all([
          stripe.subscriptions.list({ customer: billingCtx.stripeCustomerId, status: "active",   limit: 1 }),
          stripe.subscriptions.list({ customer: billingCtx.stripeCustomerId, status: "trialing", limit: 1 }),
          stripe.checkout.sessions.list({ customer: billingCtx.stripeCustomerId, status: "open", limit: 5 }),
        ]);
        canceledBlockSub = activeSubs.data[0] ?? trialingSubs.data[0];
        openSessions     = (openSess.data ?? []) as OpenSession[];
      } catch (listErr: unknown) {
        const stripeCode = (listErr as { code?: string })?.code;
        if (stripeCode !== "resource_missing") throw listErr;

        // State D: orphaned customer — clear it from DB and redirect to fresh checkout.
        logger.warn(
          { orgId, stripeCustomerId: billingCtx.stripeCustomerId },
          "[Billing] canceled-check: stripeCustomerId orphaned (resource_missing) — clearing",
        );
        try {
          const { pool: cleanPool } = await import("@workspace/db");
          await cleanPool.query(
            `UPDATE org_settings SET stripe_customer_id = '' WHERE org_id = $1`, [orgId],
          );
          await cleanPool.query(
            `UPDATE organizations SET stripe_customer_id = NULL WHERE id = $1`, [orgId],
          ).catch(() => {});
        } catch (cleanErr: unknown) {
          logger.error({ cleanErr, orgId }, "[Billing] failed to clear orphaned stripeCustomerId");
        }
        res.json({ noSubscription: true, redirectTo: "/checkout.html", plan });
        return;
      }

      if (canceledBlockSub) {
        // State A/B: live subscription exists (e.g. cancel_at_period_end = true).
        // Fall through to the stripeCustomerId block below — it will pick up this
        // sub from a fresh Stripe call and apply the correct upgrade/downgrade logic.
        // (One extra subscriptions.list call is an acceptable cost for correctness.)
        logger.info(
          { subId: canceledBlockSub.id, subStatus: canceledBlockSub.status, orgId },
          "[Billing] canceled-check: live sub found (cancel_at_period_end?) — routing through normal upgrade path",
        );
        // No return — fall through
      } else if (isDowngrade) {
        // State C + downgrade: no live billing cycle to honour → DB-only plan update.
        try {
          await persistOrgData(orgId, { plan });
        } catch (persistErr) {
          logger.error({ persistErr, orgId, plan, currentPlan }, "[Billing] canceled-sub downgrade: persistOrgData failed");
          res.status(500).json({ error: "Échec de la mise à jour du plan — veuillez réessayer." });
          return;
        }
        logger.info({ plan, orgId, currentPlan }, "[Billing] canceled-sub downgrade — plan updated in DB immediately");
        res.json({ ok: true, plan, downgrade: true, effective: "now", noSubDowngrade: true });
        return;
      } else {
        // State C + upgrade: reactivation checkout — reuse the existing Stripe customer.
        // The webhook (checkout.session.completed) is the sole source of truth; no DB
        // mutation happens here.
        const priceId = PLAN_PRICE_IDS[targetPlan];
        if (!priceId) {
          res.status(400).json({ error: `Unknown plan: ${plan}` });
          return;
        }

        const existingSession = openSessions.find(
          (s) =>
            s.metadata?.["reactivation"] === "true" &&
            s.metadata?.["targetPlan"]   === targetPlan &&
            s.url,
        );
        if (existingSession) {
          logger.info({ sessionId: existingSession.id, orgId, targetPlan }, "[Billing] reactivation: returning existing open session (idempotent)");
          res.json({ reactivation: true, checkoutUrl: existingSession.url, customerReused: true, targetPlan, idempotent: true });
          return;
        }

        const idempotencyBucket = Math.floor(Date.now() / (30 * 60 * 1000));
        const idempotencyKey    = `fp-reactivation-${orgId}-${targetPlan}-${idempotencyBucket}`;
        const session = await stripe.checkout.sessions.create(
          {
            customer:    billingCtx.stripeCustomerId,
            mode:        "subscription",
            line_items:  [{ price: priceId, quantity: 1 }],
            success_url: `${publicUrl}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url:  `${publicUrl}/pricing.html`,
            metadata: {
              plan:         targetPlan,
              targetPlan,
              orgId,
              reactivation: "true",
              userId:       String(req.userId ?? ""),
            },
            subscription_data: { metadata: { plan: targetPlan, orgId, reactivation: "true" } },
          },
          { idempotencyKey },
        );
        logger.info({ sessionId: session.id, orgId, targetPlan, customerId: billingCtx.stripeCustomerId }, "[Billing] reactivation checkout session created");
        res.json({ reactivation: true, checkoutUrl: session.url, customerReused: true, targetPlan });
        return;
      }
    }

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

        if (isDowngrade) {
          // ── Downgrade → schedule change at trial/period end ──────────────────
          // Phase 1: keep the current plan and the current trial/paid period
          // unchanged. Phase 2: switch to the lower plan at that exact date.
          //
          // This deliberately includes trialing subscriptions: changing the
          // item now would downgrade the user's access immediately. A schedule
          // preserves the remaining trial days and changes the price only when
          // the trial ends (or at the next paid renewal).
          const currentPriceId = planItem?.price?.id ?? PLAN_PRICE_IDS[currentPlan];

          const currentAddonPrices = sub.items.data
            .filter((item: SubItem) => !planPriceIdSet.has(item.price.id))
            .map((item: SubItem) => ({ price: item.price.id, quantity: item.quantity ?? 1 }));

          const nextAddonPrices = currentAddonPrices.filter((it: { price: string }) => {
            const addonKey = addonPriceToKey[it.price];
            return !addonKey || !targetIncluded.has(addonKey);
          });

          // Compute effective date early — guard null/undefined for trialing subscriptions
          // During trial, current_period_end may be undefined; fall back to trial_end
          const _periodEndTs = sub.current_period_end ?? (isTrialing ? sub.trial_end : undefined);
          const effectiveDate = _periodEndTs
            ? new Date(_periodEndTs * 1000).toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric" })
            : "la prochaine échéance";

          // ── Idempotency: if subscription already has an active schedule, skip ──
          if (sub.schedule) {
            const existingScheduleId = typeof sub.schedule === "string" ? sub.schedule : (sub.schedule as { id: string }).id;
            logger.info({ scheduleId: existingScheduleId, orgId }, "[Billing] downgrade schedule already exists — idempotent return");
            res.json({
              ok:                   true,
              plan,
              downgrade:            true,
              effective:            "period_end",
              effectiveReason:       isTrialing ? "trial_end" : "period_end",
              effectiveDate,
              trialDowngrade:        isTrialing,
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
                    ...(isTrialing && sub.trial_end ? { trial_end: sub.trial_end } : {}),
                  proration_behavior: "none",
                },
                {
                  items: [
                    { price: priceId, quantity: 1 },
                    ...nextAddonPrices,
                  ],
                    metadata: { plan: targetPlan },
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
              effectiveReason:       isTrialing ? "trial_end" : "period_end",
              effectiveDate,
              trialDowngrade:        isTrialing,
              removedIncludedAddons: removedAddonKeys,
              idempotent:           true,
            });
            return;
          }

          // Do NOT change organizations.plan now — the subscription is still
          // on the current (higher) plan until the scheduled effective date.
          // Only store the pending change so the dashboard can show it.
          await persistOrgData(orgId, { pendingPlan: plan, pendingPlanDate: effectiveDate }).catch(() => {});
          logger.info(
            { plan, subId: sub.id, orgId, effectiveDate, removedAddonKeys },
            "[Billing] downgrade scheduled for period end",
          );
          res.json({
            ok:                   true,
            plan,
            downgrade:            true,
            effective:            "period_end",
            effectiveReason:       isTrialing ? "trial_end" : "period_end",
            effectiveDate,
            trialDowngrade:        isTrialing,
            removedIncludedAddons: removedAddonKeys,
          });
          return;
        }

        // ── Upgrade → immediate update ──────────────────────────────────────
        // Downgrades never reach this branch. During a trial, pin trial_end so
        // the remaining trial duration is not changed by the plan update.
        //
        // If a downgrade schedule is attached (user scheduled a downgrade then
        // changed their mind and upgrades), release it first — otherwise Stripe
        // rejects the items update or the schedule later overrides the upgrade.
        if (sub.schedule) {
          const attachedScheduleId = typeof sub.schedule === "string" ? sub.schedule : (sub.schedule as { id: string }).id;
          try {
            await stripe.subscriptionSchedules.release(attachedScheduleId);
            logger.info({ scheduleId: attachedScheduleId, orgId }, "[Billing] released downgrade schedule before upgrade");
            await persistOrgData(orgId, { pendingPlan: "", pendingPlanDate: "" }).catch(() => {});
          } catch (relErr: unknown) {
            const msg = relErr instanceof Error ? relErr.message : String(relErr);
            logger.warn({ scheduleId: attachedScheduleId, orgId, err: msg }, "[Billing] failed to release schedule before upgrade — continuing");
          }
        }
        const prorationBehavior = isUpgrade && !isTrialing ? "create_prorations" : "none";
        await stripe.subscriptions.update(sub.id, {
          items: [
            { id: planItem?.id, price: priceId },
            ...keptAddonItems.map((item: SubItem) => ({ id: item.id })),
          ],
          proration_behavior: prorationBehavior,
          metadata: { plan },
          // Explicitly pin the trial end date so Stripe never re-anchors it on plan change.
          // Without this, some Stripe price trial settings can silently extend the period.
          ...(isTrialing && sub.trial_end ? { trial_end: sub.trial_end } : {}),
        });
        // Mark trialConsumedAt so canStartTrial stays false even if the
        // subscription ID is later cleared.
        try {
          await persistOrgData(orgId, {
            plan,
            subscriptionStatus: sub.status,
            stripeSubscriptionId: sub.id,
            trialEndsAt: isTrialing && sub.trial_end
              ? new Date(sub.trial_end * 1000).toISOString()
              : billingCtx.trialEndsAt ?? undefined,
            trialConsumedAt: new Date().toISOString(),
          });
        } catch (persistErr) {
          // Non-fatal for Stripe-backed subs: Stripe is source of truth;
          // the webhook will reconcile. Log and continue.
          logger.error({ persistErr, orgId, plan }, "[Billing] persistOrgData failed after Stripe sub update (non-fatal)");
        }
        logger.info(
          { plan, subId: sub.id, subStatus: sub.status, isTrialing, isUpgrade, isDowngrade, prorationBehavior, removedAddonKeys, orgId },
          "[Billing] plan change applied immediately",
        );
        // Return the semantically correct key: downgrade vs upgraded
        res.json({
          ok:                    true,
          plan,
          ...(isDowngrade
            ? { downgrade: true, effective: "now" }
            : { upgraded:  true, effective: "now" }
          ),
          removedIncludedAddons: removedAddonKeys,
        });
        return;
      }

      // stripeCustomerId exists but no active/trialing Stripe sub found:
      // Treat as reactivation — create a checkout session reusing the existing customer.
      // This handles data inconsistencies (DB shows "active" but Stripe has no active sub).
      if (!isDowngrade) {
        const _reactPriceId = PLAN_PRICE_IDS[targetPlan];
        if (!_reactPriceId) {
          res.status(400).json({ error: `Unknown plan: ${plan}` });
          return;
        }
        const _reactBucket = Math.floor(Date.now() / (30 * 60 * 1000));
        const _reactKey    = `fp-reactivation-${orgId}-${targetPlan}-${_reactBucket}`;
        const _openSess = await stripe.checkout.sessions.list({
          customer: billingCtx.stripeCustomerId!,
          status:   "open",
          limit:    5,
        });
        const _existSess = (_openSess.data ?? []).find(
          (s: { metadata?: Record<string, string> | null; url?: string | null; id?: string }) =>
            s.metadata?.["reactivation"] === "true" && s.metadata?.["targetPlan"] === targetPlan && s.url,
        );
        if (_existSess) {
          logger.info({ sessionId: _existSess.id, orgId, targetPlan }, "[Billing] reactivation (no-active-sub): returning existing open session");
          res.json({ reactivation: true, checkoutUrl: _existSess.url, customerReused: true, targetPlan, idempotent: true });
          return;
        }
        const _newSess = await stripe.checkout.sessions.create(
          {
            customer:    billingCtx.stripeCustomerId!,
            mode:        "subscription",
            line_items:  [{ price: _reactPriceId, quantity: 1 }],
            success_url: `${publicUrl}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url:  `${publicUrl}/pricing.html`,
            metadata: {
              plan:         targetPlan,
              targetPlan,
              orgId,
              reactivation: "true",
              userId:       String(req.userId ?? ""),
            },
            subscription_data: { metadata: { plan: targetPlan, orgId, reactivation: "true" } },
          },
          { idempotencyKey: _reactKey },
        );
        logger.info({ sessionId: _newSess.id, orgId, targetPlan, customerId: billingCtx.stripeCustomerId }, "[Billing] reactivation checkout (no-active-sub): session created");
        res.json({ reactivation: true, checkoutUrl: _newSess.url, customerReused: true, targetPlan });
        return;
      }
    }

    // No existing sub:
    // — Downgrade (e.g. Pro trial → Standard): no Stripe billing cycle to honour,
    //   update plan in DB immediately and return the upgrade shape.
    // — Upgrade or same level: redirect to checkout.html to start a fresh subscription.
    if (isDowngrade) {
      try {
        await persistOrgData(orgId, { plan });
      } catch (persistErr) {
        logger.error({ persistErr, orgId, plan, currentPlan }, "[Billing] no-sub downgrade: persistOrgData failed");
        res.status(500).json({ error: "Échec de la mise à jour du plan — veuillez réessayer." });
        return;
      }
      logger.info({ plan, orgId, currentPlan }, "[Billing] no-sub downgrade — plan updated in DB immediately");
      res.json({ ok: true, plan, upgraded: true, effective: "now", noSubDowngrade: true });
      return;
    }

    // No existing sub and not a downgrade — redirect to checkout.html to start a fresh subscription.
    logger.info({ plan, orgId }, "[Billing] upgrade: no active subscription — redirecting to checkout.html");
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
  const stripeKey             = getStripeKey();

  // billingCtx.subscriptionStatus is already normalised by the state machine:
  // it NEVER returns "active" when stripeSubscriptionId is null.
  const normalisedStatus = billingCtx.subscriptionStatus ?? "none";

  // ── No Stripe key or no customer → return DB state (already normalised) ───
  if (!stripeKey || !stripeCustomerId) {
    const planIncludedNoStripe = PLAN_INCLUDED_ADDONS[plan.toLowerCase()] ?? new Set<string>();
    const addonsNoStripe: Record<string, { active: boolean | number; includedInPlan: boolean }> = {};
    for (const [key, val] of Object.entries(billingCtx.addons)) {
      addonsNoStripe[key] = { active: val as boolean | number, includedInPlan: planIncludedNoStripe.has(key) };
    }
    for (const key of planIncludedNoStripe) {
      if (!(key in addonsNoStripe)) {
        addonsNoStripe[key] = { active: true, includedInPlan: true };
      }
    }
    // nextBillingDate: trialEndsAt when trialing (no Stripe key available)
    const nextBillingDateNoStripe =
      normalisedStatus === "trialing" ? trialEndsAt : null;
    res.json({
      plan,
      status:            normalisedStatus,
      subscriptionStatus: normalisedStatus,
      trialEndsAt,
      nextBillingDate:   nextBillingDateNoStripe,
      canStartTrial:     billingCtx.canStartTrial,
      hasPremiumAccess:  billingCtx.hasPremiumAccess,
      mustCompleteBilling: billingCtx.mustCompleteBilling,
      addons:            addonsNoStripe,
      addonsFlat:        billingCtx.addons,
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

    // Track post-reconciliation state when the tracked sub is gone from Stripe
    let reconciledDbStatus: string | null = null;

    if (stripeSubscriptionId) {
      try {
        const fetched = await stripe.subscriptions.retrieve(stripeSubscriptionId);
        if (fetched && fetched.id) sub = fetched;
      } catch (fetchErr: unknown) {
        const code = (fetchErr as { code?: string })?.code;
        if (code !== "resource_missing") throw fetchErr;
        // Tracked subscription ID is gone from Stripe.
        // Before clearing, check whether the customer has a replacement live subscription.
        logger.warn({ orgId, stripeSubscriptionId }, "[Billing] resource_missing: tracked Stripe subscription gone — checking for replacement");
        const RM_TERMINAL = new Set(["canceled", "incomplete_expired"]);
        let replacementSub: typeof sub | undefined;
        if (stripeCustomerId) {
          // Use auto-pagination to find any live subscription across all pages
          const replacementArr = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all" }).autoPagingToArray({ limit: 200 });
          replacementSub = (replacementArr as Array<{ id: string; status: string }>).find((s: { id: string; status: string }) => !RM_TERMINAL.has(s.status)) as typeof sub | undefined;
        }
        if (replacementSub) {
          // Customer has a live replacement subscription — adopt it instead of clearing
          sub = replacementSub;
          logger.info({ orgId, newSubId: replacementSub.id, newStatus: replacementSub.status },
            "[Billing] resource_missing: found replacement subscription — adopting");
          try {
            const { pool: pgPool } = await import("@workspace/db");
            const _client = await pgPool.connect();
            try {
              await _client.query(
                `UPDATE organizations
                 SET    stripe_subscription_id = $1,
                        subscription_status    = $2,
                        updated_at             = NOW()
                 WHERE  id = $3`,
                [replacementSub.id, replacementSub.status, orgId]
              );
            } finally { _client.release(); }
          } catch (adoptErr) {
            logger.warn({ adoptErr, orgId }, "[Billing] resource_missing: failed to persist adopted subscription (non-fatal)");
          }
        } else {
          // Truly no active subscription — clear the stale reference
          const newStatus = stripeCustomerId ? "canceled" : "pending_billing";
          try {
            const { pool: pgPool } = await import("@workspace/db");
            const _client = await pgPool.connect();
            try {
              // Jalon 7: write to organizations (source of truth)
              await _client.query(
                `UPDATE organizations
                 SET    stripe_subscription_id = NULL,
                        subscription_status    = $1,
                        updated_at             = NOW()
                 WHERE  id = $2`,
                [newStatus, orgId]
              );
              logger.info({ orgId, newStatus }, "[Billing] resource_missing: DB reconciled — subscription ID cleared (organizations)");
            } finally { _client.release(); }
          } catch (cleanupErr) {
            logger.warn({ cleanupErr, orgId }, "[Billing] resource_missing: DB cleanup failed (non-fatal)");
          }
          // Track the reconciled status so we return it in the response below
          // (normalisedStatus still holds the stale pre-cleanup value)
          reconciledDbStatus = newStatus;
          // sub remains undefined — effectiveSubId will be null below
        }
      }
    } else {
      const subs = await stripe.subscriptions.list({ customer: stripeCustomerId, status: "all", limit: 1 });
      sub = subs.data[0];
    }

    // The Stripe status is authoritative when a subscription is found.
    // When sub is missing (resource_missing path), use the reconciled DB status.
    // Re-apply the state machine to avoid impossible combos from Stripe.
    const stripeStatus = sub?.status ?? null;
    // After resource_missing, effectiveSubId must be null — never re-use the stale ID
    const effectiveSubId = sub?.id ?? null;
    const { normalizeSubscriptionStatus } = await import("../lib/subscription-state.js");
    const reconciledTrialEndsAt = sub?.trial_end
      ? new Date(sub.trial_end * 1000).toISOString()
      : trialEndsAt;
    // rawStatus priority: live Stripe > reconciled DB (post-cleanup) > stale DB
    const rawStatusForNorm = stripeStatus ?? reconciledDbStatus ?? normalisedStatus;
    const reconciled = normalizeSubscriptionStatus({
      rawStatus:            rawStatusForNorm,
      stripeSubscriptionId: effectiveSubId ?? null,
      stripeCustomerId,
      trialEndsAt:          reconciledTrialEndsAt,
      trialConsumedAt:      billingCtx.trialConsumedAt,
    });

    // Real next-invoice amount: sum of the live subscription items (plan + add-ons).
    // Never fabricated — null when there is no live subscription.
    const nextAmount = sub
      ? (sub.items?.data ?? []).reduce((t: number, it: { price?: { unit_amount?: number | null } | null; quantity?: number }) => t + ((it.price?.unit_amount ?? 0) * (it.quantity ?? 1)), 0) / 100
      : null;

    // Bug-5 fix: compute nextBillingDate = trial end if trialing, else current_period_end
    const nextBillingDateSub = (() => {
      if (sub?.status === "trialing" && sub.trial_end) {
        return new Date(sub.trial_end * 1000).toISOString();
      }
      const ts = sub?.current_period_end ?? null;
      return ts ? new Date(ts * 1000).toISOString() : null;
    })();

    // Build addons with includedInPlan flags for dashboard
    const planIncludedSub = PLAN_INCLUDED_ADDONS[plan.toLowerCase()] ?? new Set<string>();
    const addonsWithFlagsSub: Record<string, { active: boolean | number; includedInPlan: boolean }> = {};
    for (const [key, val] of Object.entries(billingCtx.addons)) {
      addonsWithFlagsSub[key] = { active: val as boolean | number, includedInPlan: planIncludedSub.has(key) };
    }
    for (const key of planIncludedSub) {
      if (!(key in addonsWithFlagsSub)) {
        addonsWithFlagsSub[key] = { active: true, includedInPlan: true };
      }
    }

    res.json({
      plan,
      status:              reconciled,
      subscriptionStatus:  reconciled,
      trialEndsAt:         reconciledTrialEndsAt,
      nextBillingDate:     nextBillingDateSub,
      nextAmount,
      // During trial, current_period_end may be undefined — fall back to trial_end
      currentPeriodEnd:    (() => {
        const ts = sub?.current_period_end ?? sub?.trial_end ?? null;
        return ts ? new Date(ts * 1000).toISOString() : null;
      })(),
      cancelAtPeriodEnd:   sub?.cancel_at_period_end ?? false,
      subscriptionId:      effectiveSubId ?? null,
      addons:              addonsWithFlagsSub,
      addonsFlat:          billingCtx.addons,
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
  const plan = parsePlan(req.body?.plan, res);
  if (plan === null) return;
  const addons = parseAddons(req.body?.addons, res);
  if (addons === null) return;
  const coupon = typeof req.body?.coupon === "string" ? req.body.coupon.trim() || undefined : undefined;
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

  const stripeKey = getStripeKey();
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
  const baseLimits = PLAN_LIMITS[billingCtx.plan.toLowerCase()] ?? PLAN_LIMITS["standard"];
  // Expand limits with active add-ons (org_addons is the source of truth)
  const limits = { ...baseLimits };
  try {
    const { getOrgAddons, getQuotaLimits } = await import("../services/addons-service.js");
    const orgAddons = await getOrgAddons(orgId);
    const q = getQuotaLimits(billingCtx.plan, orgAddons);
    limits.monitors    = q.monitors;
    limits.audits      = q.audits;
    limits.reports     = q.reports;
    limits.exports     = q.exports;
    limits.teamMembers = q.seats;
  } catch { /* fall back to base plan limits */ }

  let reportsUsed: number | null = null;
  let teamMembersUsed: number | null = null;
  let monitorsActive: number | null = null;
  let auditsUsed: number | null = null;

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

  try {
    const r = await req.orgDb(`SELECT COUNT(*) FROM monitors WHERE org_id = $1`, [orgId]);
    monitorsActive = Number(r.rows[0]?.count ?? 0);
  } catch { /* monitors table may not exist yet */ }

  try {
    const r = await req.orgDb(
      `SELECT COUNT(*) FROM audits WHERE org_id = $1 AND created_at > date_trunc('month', now())`,
      [orgId]
    );
    auditsUsed = Number(r.rows[0]?.count ?? 0);
  } catch { /* audits table may not exist yet */ }

  // ── Cumulative monthly usage events (append-only — deletion never decrements) ──
  const { getMonthlyUsageCounts } = await import("../services/usage-events.js");
  const events = await getMonthlyUsageCounts(orgId);
  const cumulative = (live: number | null, kind: string): number | null => {
    const ev = events[kind] ?? 0;
    if (live == null) return ev > 0 ? ev : null;
    return Math.max(live, ev);
  };

  const planKey = billingCtx.plan.toLowerCase();
  const includedAddonsCount = (PLAN_INCLUDED_ADDONS[planKey] ?? PLAN_INCLUDED_ADDONS["standard"])?.size ?? 1;

  res.json({
    reportsUsed:      cumulative(reportsUsed, "report_created"),
    reportsLimit:     limits.reports,
    teamMembersUsed,
    teamMembersLimit: limits.teamMembers,
    monitorsUsed:     cumulative(monitorsActive, "monitor_created"),
    monitorsActive,
    monitorsLimit:    limits.monitors,
    auditsUsed:       cumulative(auditsUsed, "audit_created"),
    auditsLimit:      limits.audits,
    pdfExportsUsed:   events["pdf_export"] ?? 0,
    exportsUsed:      (events["export"] ?? 0) + (events["pdf_export"] ?? 0) + (events["health_export"] ?? 0),
    exportsLimit:     limits.exports,
    includedAddonsCount,
    emailsSent:    null,
    apiCalls:      null,
    storageUsed:   null,
    bandwidthUsed: null,
  });
});

// ── POST /billing/usage-events ────────────────────────────────────────────────
// Client-side exports (CSV, Health-Score PDF generated in-browser) report their
// consumption here so the cumulative counters include them.
router.post("/billing/usage-events", async (req: Request, res: Response): Promise<void> => {
  const orgId = req.orgContext?.orgId ?? req.orgId ?? "default";
  const kind = String((req.body as { kind?: string })?.kind ?? "");
  const CLIENT_KINDS = new Set(["export", "health_export", "pdf_export"]);
  if (!CLIENT_KINDS.has(kind)) {
    res.status(400).json({ error: "kind invalide (export | health_export | pdf_export)" });
    return;
  }
  const { recordUsageEvent } = await import("../services/usage-events.js");
  await recordUsageEvent(orgId, kind);
  res.json({ ok: true, kind });
});

// ── POST /billing/checkout-ai-credits ─────────────────────────────────────────
router.post("/billing/checkout-ai-credits", billingCheckoutRateLimit, ownerOnly, async (req: Request, res: Response) => {
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

  const stripeKey = getStripeKey();
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
      // checkout-return.html handles ai_credits type via billing/verify checkoutType field
      success_url: `${publicUrl}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${publicUrl}/dashboard.html#billing`,
      metadata: {
        type:           "ai_credits",
        pack,
        credits:        String(packInfo.credits),
        amountEurCents: String(packInfo.amountEurCents),
        orgId,          // explicit orgId so webhook never relies solely on customer-metadata lookup
      },
    });

    logger.info({ pack, credits: packInfo.credits, orgId }, "[Billing] AI credits checkout session created");
    res.json({ url: session.url, pack, credits: packInfo.credits });
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to create AI credits checkout session");
    const msg = (err as { message?: string })?.message ?? "";
    res.status(500).json({
      error: "Erreur lors de la création du paiement",
      detail: msg.slice(0, 300) || undefined,
    });
  }
});

// ── POST /billing/ai-credits-intent ──────────────────────────────────────────
// In-app AI credit pack purchase: creates a PaymentIntent consumed by a
// PaymentElement modal inside the dashboard — no redirect to checkout.stripe.com.
// The webhook credits the org on payment_intent.succeeded (metadata.type=ai_credits).
router.post("/billing/ai-credits-intent", billingCheckoutRateLimit, ownerOnly, async (req: Request, res: Response) => {
  const { pack = "" } = req.body as { pack?: string };

  const AI_PACK_MAP: Record<string, { addonKey: string; credits: number; amountEurCents: number }> = {
    "ai_credits_50k":  { addonKey: "aiCreditsPack50k",  credits: 50000,  amountEurCents: 400  },
    "ai_credits_200k": { addonKey: "aiCreditsPack200k", credits: 200000, amountEurCents: 900  },
    "ai_credits_500k": { addonKey: "aiCreditsPack500k", credits: 500000, amountEurCents: 1900 },
  };
  const packInfo = AI_PACK_MAP[pack.toLowerCase()];
  if (!packInfo) {
    res.status(400).json({ error: `Pack IA inconnu : ${pack}. Valeurs valides : ai_credits_50k, ai_credits_200k, ai_credits_500k` });
    return;
  }

  const orgId = req.orgId ?? "default";
  const stripeKey = getStripeKey();
  const publishableKey = process.env["STRIPE_PUBLISHABLE_KEY"] ?? process.env["PUBLIC_STRIPE_API_KEY"] ?? "";

  if (!stripeKey || !publishableKey) {
    logger.error({ orgId, pack }, "[Billing] Stripe keys missing — AI credits in-app payment unavailable");
    res.status(503).json({ error: "Paiement indisponible : configuration Stripe manquante. Contactez le support." });
    return;
  }

  try {
    const billingCtx = await loadBillingContext(orgId);
    const stripe = await createStripeClient(stripeKey);
    const customerId = await ensureStripeCustomer(orgId, billingCtx, stripeKey);

    const intent = await stripe.paymentIntents.create({
      amount:   packInfo.amountEurCents,
      currency: "eur",
      customer: customerId,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      description: `FlowPoint AI Credits — ${packInfo.credits.toLocaleString("fr-FR")} crédits`,
      metadata: {
        type:           "ai_credits",
        pack,
        credits:        String(packInfo.credits),
        amountEurCents: String(packInfo.amountEurCents),
        orgId,
      },
    });

    logger.info({ pack, credits: packInfo.credits, orgId }, "[Billing] AI credits PaymentIntent created (in-app)");
    res.json({
      clientSecret:  intent.client_secret,
      publishableKey,
      pack,
      credits:   packInfo.credits,
      amountEur: packInfo.amountEurCents / 100,
    });
  } catch (err) {
    logger.error({ err, orgId, pack }, "[Billing] Failed to create AI credits PaymentIntent");
    const msg = (err as { message?: string })?.message ?? "";
    res.status(500).json({ error: "Erreur lors de la création du paiement", detail: msg.slice(0, 300) || undefined });
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

// ── POST /billing/addon-checkout ───────────────────────────────────────────────
router.post("/billing/addon-checkout", billingCheckoutRateLimit, async (req: Request, res: Response): Promise<void> => {
  const { addonKey = "", addonName = "" } = req.body as { addonKey?: string; addonName?: string; price?: string; quantity?: unknown };
  if (!addonKey) { res.status(400).json({ error: "addonKey required" }); return; }
  // Quantity is honoured only for quantity add-ons (QTY_ADDONS); flag add-ons are always 1.
  const { QTY_ADDONS: _QTY } = await import("../lib/plans.js");
  const _rawQty = (req.body as { quantity?: unknown }).quantity;
  const checkoutQty = _QTY.has(addonKey)
    ? Math.min(20, Math.max(1, Math.floor(Number(_rawQty ?? 1)) || 1))
    : 1;

  const orgId = req.orgId ?? "default";
  const billingCtx = await loadBillingContext(orgId);

  const addonPriceId = ADDON_PRICE_IDS[addonKey];
  const stripeKeyForAddonCheck = getStripeKey();

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

  const stripeKey = getStripeKey();
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

    // Bug-2 fix: pass existing customer so Stripe doesn't create an orphan customer
    // that the webhook can't map back to this org.
    let addonCustomerId: string | undefined;
    if (billingCtx.stripeCustomerId) {
      addonCustomerId = billingCtx.stripeCustomerId;
    } else {
      // Ensure a customer exists so all future webhooks can resolve orgId
      try {
        addonCustomerId = await ensureStripeCustomer(orgId, billingCtx, stripeKey);
      } catch (custErr) {
        logger.warn({ custErr, orgId }, "[Billing] addon-checkout: ensureStripeCustomer failed — proceeding without customer");
      }
    }

    const isAiCreditPack = AI_CREDIT_PACK_KEYS.has(addonKey);
    const session = await stripe.checkout.sessions.create({
      mode: isAiCreditPack ? "payment" : "subscription",
      ...(addonCustomerId ? { customer: addonCustomerId } : {}),
      line_items: [{ price: priceId, quantity: checkoutQty }],
      success_url: `${publicUrl}/billing?addon_success=${encodeURIComponent(addonKey)}`,
      cancel_url:  `${publicUrl}/billing?addon_cancel=1`,
      metadata: { addonKey, addonName, orgId, quantity: String(checkoutQty) },
    });

    const sessionId: string = typeof session.id === "string" ? session.id : String(session.id ?? "");
    store.logActivity({
      type: "billing",
      label: `Add-on checkout initié : ${addonName || addonKey}`,
      targetId: sessionId,
      targetType: "billing",
      metadata: { addonKey },
      orgId,
    }).catch(() => {});

    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err, addonKey, orgId }, "[Billing] addon-checkout failed");
    res.status(500).json({ error: "Erreur lors de la création du paiement" });
  }
});


// ── DELETE /billing/account ───────────────────────────────────────────────────
// Thin wrapper. The entire deletion pipeline lives in services/account-deletion.ts:
// Stripe cleanup → single DB transaction (dynamic org- AND user-scoped table
// discovery, FK-safe ordering, refuses to commit if any row survives) → storage.
router.delete("/billing/account", billingDeleteRateLimit, ownerOnly, async (req: Request, res: Response) => {
  const orgId = req.orgId ?? "default";

  try {
    const billingCtx = await loadBillingContext(orgId);
    const email      = billingCtx.email ?? "";
    const name       = billingCtx.firstName ?? email.split("@")[0] ?? "utilisateur";

    const { deleteAccount } = await import("../services/account-deletion.js");
    const report = await deleteAccount({
      orgId,
      userId:           req.userUuid ?? null,
      email:            email || null,
      stripeCustomerId: billingCtx.stripeCustomerId ?? null,
    });

    // Confirmation email — only after the transaction has committed.
    if (email) {
      mailer.sendAccountDeleted({ to: email, name }).catch((mailErr: unknown) => {
        logger.warn({ mailErr, orgId }, "[Billing/DeleteAccount] Confirmation email failed (non-fatal)");
      });
    }

    logger.info(
      { orgId, rowsDeleted: report.totals.rowsDeleted, tables: report.totals.tablesWithData },
      "[Billing/DeleteAccount] Account deleted",
    );

    // Clear the session cookie so the browser cannot replay it.
    res.clearCookie("fp_token", { path: "/", httpOnly: true, sameSite: "lax", secure: true });

    res.json({
      ok: true,
      deleted: {
        rows:            report.totals.rowsDeleted,
        tablesWithData:  report.totals.tablesWithData,
        tablesScanned:   report.totals.tablesScanned,
        usersDeleted:    report.users.fullyDeleted.length,
        stripeCustomer:  report.stripe.customerDeleted,
        subscriptionsCanceled: report.stripe.subscriptionsCanceled,
      },
    });

  } catch (err) {
    logger.error({ err, orgId }, "[Billing/DeleteAccount] Failed");
    const msg = err instanceof Error ? err.message : "";
    const isStripeErr = msg.includes("Stripe") || msg.includes("stripe");
    res.status(500).json({
      error: isStripeErr
        ? "Échec de la résiliation Stripe. Aucune donnée n'a été supprimée. Réessayez ou contactez le support."
        : "Erreur lors de la suppression du compte. Aucune donnée n'a été supprimée.",
    });
  }
});

export default router;
