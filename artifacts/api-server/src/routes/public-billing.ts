import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { PLAN_PRICE_IDS, ADDON_PRICE_IDS, FLAG_ADDONS, QTY_ADDONS } from "../lib/plans.js";
import { PLAN_CONFIG, ADDON_CATALOG } from "../services/billing-service.js";
import { createRateLimit } from "../middlewares/rateLimiter.js";

const publicCheckoutRateLimit = createRateLimit("reportsPerHour");

const router = Router();

// ── GET /api/billing/plans ────────────────────────────────────────────────────
// Public endpoint — returns the full plan catalog + add-on catalog.
// When an authenticated orgId is present on the request (set by auth middleware
// that runs before this route), we load the org-specific billing context from DB.
// Falls back to "standard" defaults for unauthenticated / public pricing page.
router.get("/billing/plans", async (req: Request, res: Response): Promise<void> => {
  const plans = Object.values(PLAN_CONFIG).map((p) => ({
    ...p,
    priceId: PLAN_PRICE_IDS[p.id] ?? "",
  }));

  const orgId = (req as Request & { orgId?: string }).orgId;
  let current: string = "standard";
  let subscriptionStatus: string | null = null;
  let trialEndsAt: string | null = null;

  if (orgId && orgId !== "default") {
    try {
      const { loadBillingContext } = await import("../services/billing-context.js");
      const ctx = await loadBillingContext(orgId);
      current = (ctx.plan || "standard").toLowerCase();
      subscriptionStatus = ctx.subscriptionStatus ?? null;
      trialEndsAt = ctx.trialEndsAt ?? null;
    } catch (ctxErr) {
      logger.warn({ ctxErr, orgId }, "[PublicBilling] billing-context load failed — using defaults");
    }
  }

  res.json({
    plans,
    addons: ADDON_CATALOG,
    current,
    subscriptionStatus,
    trialEndsAt,
  });
});

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
  const {
    plan = "", addons = {}, source = "checkout_html", embedded = false,
    preRegisterToken = "",
  } = req.body as {
    plan?: string;
    addons?: AddonsMap;
    source?: string;
    embedded?: boolean;
    preRegisterToken?: string;  // New signup flow: opaque token from /auth/pre-register
  };

  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
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
  const planKey     = plan.toLowerCase();
  const hasPlan     = !!PLAN_PRICE_IDS[planKey];
  const addonKeys   = Object.keys(addons).filter(k => addons[k]);
  const hasOnlyAICr = addonKeys.length > 0 && addonKeys.every(k => AI_CREDIT_PACKS.has(k));

  if (!hasPlan && !hasOnlyAICr && addonKeys.length === 0) {
    res.status(400).json({ error: "Sélectionnez un plan avant de continuer." });
    return;
  }

  /* Diagnostic log */
  const keyMode = stripeKey.startsWith("sk_live_") ? "live" : stripeKey.startsWith("sk_test_") ? "test" : "unknown";
  logger.info({ plan, addonCount: addonKeys.length, source, keyMode, hasPreRegisterToken: !!preRegisterToken },
    "[PublicBilling] checkout-session requested");

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    /* ── New signup flow: load pending_signups + create/find Stripe Customer ── */
    let stripeCustomerId: string | undefined;
    let signupOrgId: string | undefined; // = email, used as orgId in FlowPoint

    if (preRegisterToken) {
      const { pool: pgPool } = await import("@workspace/db");
      const dbClient = await pgPool.connect();
      let signupRow: {
        email: string; first_name: string; last_name: string; company_name: string;
        country: string | null; address: string | null; city: string | null;
        postal_code: string | null; phone: string | null; vat: string | null;
      } | null = null;

      try {
        const r = await dbClient.query(
          `SELECT email, first_name, last_name, company_name, country, address, city, postal_code, phone, vat
           FROM pending_signups WHERE token = $1 AND expires_at > NOW() LIMIT 1`,
          [preRegisterToken]
        );
        if (r.rows.length > 0) signupRow = r.rows[0];
      } finally {
        dbClient.release();
      }

      if (!signupRow) {
        res.status(400).json({ error: "Session d'inscription expirée ou invalide. Veuillez recommencer." });
        return;
      }

      signupOrgId = signupRow.email; // orgId = email in FlowPoint

      // Create Stripe Customer with full contact info (never empty)
      const customerData: Parameters<typeof stripe.customers.create>[0] = {
        email: signupRow.email,
        name:  `${signupRow.first_name} ${signupRow.last_name}`.trim(),
        metadata: {
          orgId:       signupRow.email,
          companyName: signupRow.company_name,
          firstName:   signupRow.first_name,
          lastName:    signupRow.last_name,
          ...(signupRow.vat ? { vat: signupRow.vat } : {}),
        },
      };
      if (signupRow.address || signupRow.city || signupRow.country) {
        customerData.address = {
          line1:       signupRow.address  ?? "",
          city:        signupRow.city     ?? "",
          postal_code: signupRow.postal_code ?? "",
          country:     signupRow.country  ?? "",
        };
      }
      if (signupRow.phone) customerData.phone = signupRow.phone;

      const stripeCustomer = await stripe.customers.create(customerData);
      stripeCustomerId = stripeCustomer.id;

      logger.info({ customerId: stripeCustomerId, orgId: signupOrgId },
        "[PublicBilling] Stripe Customer created for new signup");
    }

    const { subscriptionItems, oneTimeItems, checkoutType } = buildLineItems(planKey, addons);

    const selectedAddonNames = addonKeys.join(",");
    const included        = PLAN_INCLUDED_ADDONS[planKey] ?? new Set();
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
      // New signup fields — enable webhook + checkout-complete to create the account
      ...(signupOrgId       ? { orgId: signupOrgId }                     : {}),
      ...(preRegisterToken  ? { pre_register_token: preRegisterToken }    : {}),
    };

    /* ── Helper: build embedded vs redirect params, optionally pre-attach customer ── */
    const returnUrl  = `${publicUrl}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`;
    const successUrl = `${publicUrl}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl  = `${publicUrl}/cancel.html`;

    const customerParam = stripeCustomerId ? { customer: stripeCustomerId } : {};

    function urlOrEmbedded(params: Record<string, unknown>) {
      if (embedded) {
        return { ...params, ...customerParam, ui_mode: "embedded_page", return_url: returnUrl };
      }
      return { ...params, ...customerParam, success_url: successUrl, cancel_url: cancelUrl };
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

/* ─────────────────────────────────────────────────────────────────────────
   EUR prices in cents — mirrors checkout.html / checkout-payment.html
   Used to create PaymentIntents for immediate add-on billing.
 ───────────────────────────────────────────────────────────────────────── */
const ADDON_PRICES_EUR_CENTS: Record<string, number> = {
  monitorsPack10:        900,  monitorsPack50:       2900,
  globalMonitoring:     4900,  slaMonitoring:        1900,
  advancedSeoLab:       2900,  keywordDomination:    3900,
  backlinkIntelligence: 2400,  aiContentStrategist:  3400,
  gbpSlots10:           1900,  aiGbpPosting:         2900,
  reviewIntelligence:   1900,  localDominationMaps:  2400,
  aiCro:                3400,  behavioralAI:         4400,
  revenueLeak:          2900,  abTestingAI:          2400,
  whiteLabel:           1700,  agencyPacks:          4900,
  aiExecutiveReport:    2400,  aiForecasting:        3900,
  marketIntelligence:   4900,  aiWorkflows:          3400,
  extraSeats:           3500,  enterprisePermissions:1900,
  retention90d:          900,  retention365d:        1900,
  advancedWebhooks:     1400,  zapierIntegration:    1900,
  crmIntegration:       2900,  customDomain:          900,
  ssoEnterprise:        4900,  aiWorkspaceLaunch:    4900,
  prioritySupport:      2900,  auditsPack200:        1200,
  auditsPack1000:       3900,  pdfPack200:           1200,
  exportsPack1000:      1400,
  /* AI credit packs (one-time) — 4€ / 9€ / 19€ */
  aiCreditsPack50k:   400, aiCreditsPack200k:  900, aiCreditsPack500k: 1900,
};

/* ─── POST /api/public/payment-intent ────────────────────────────────────
   Creates a PaymentIntent (immediate add-on charge) or a SetupIntent
   (plan-only trial — no charge today, card saved for subscription).
 ───────────────────────────────────────────────────────────────────────── */
router.post("/public/payment-intent", publicCheckoutRateLimit, async (req: Request, res: Response) => {
  const { plan = "", addons = {} } = req.body as { plan?: string; addons?: AddonsMap };
  const stripeKey      = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const publishableKey = process.env["PUBLIC_STRIPE_API_KEY"] || "";

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      res.status(503).json({ error: "Payment service not configured." });
      return;
    }
    res.json({ clientSecret: "seti_test_mock_secret", publishableKey: "pk_test_mock", mode: "setup", immediateAmount: 0 });
    return;
  }

  const planKey  = plan.toLowerCase();
  const hasPlan  = !!PLAN_PRICE_IDS[planKey];
  const included = PLAN_INCLUDED_ADDONS[planKey] ?? new Set();
  const addonKeys = Object.keys(addons as AddonsMap).filter(k => (addons as AddonsMap)[k]);

  /* Calculate immediate charge (add-ons not included, any qty) */
  let immediateAmountCents = 0;
  for (const key of addonKeys) {
    if (included.has(key)) continue; /* skip plan-included add-ons */
    const qty = Number((addons as AddonsMap)[key] || 1);
    immediateAmountCents += (ADDON_PRICES_EUR_CENTS[key] || 0) * qty;
  }

  const metadata: Record<string, string> = {
    source:         "checkout_payment",
    plan:           planKey,
    addons:         JSON.stringify(addons),
    flowpoint_cart: "true",
  };

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    if (immediateAmountCents > 0) {
      /* PaymentIntent — immediate charge for add-ons / credits */
      const pi = await stripe.paymentIntents.create({
        amount:   immediateAmountCents,
        currency: "eur",
        /* save PM for subscription after trial */
        ...(hasPlan ? { setup_future_usage: "off_session" } : {}),
        automatic_payment_methods: { enabled: true },
        metadata,
      });
      logger.info({ plan: planKey, addonCount: addonKeys.length, immediateAmountCents }, "[PublicBilling] PaymentIntent created");
      res.json({ clientSecret: pi.client_secret, publishableKey, mode: "payment", immediateAmount: immediateAmountCents });
      return;
    }

    if (hasPlan) {
      /* SetupIntent — collect card for trial subscription, 0€ today */
      const si = await stripe.setupIntents.create({
        automatic_payment_methods: { enabled: true },
        usage: "off_session",
        metadata,
      });
      logger.info({ plan: planKey }, "[PublicBilling] SetupIntent created");
      res.json({ clientSecret: si.client_secret, publishableKey, mode: "setup", immediateAmount: 0 });
      return;
    }

    res.status(400).json({ error: "Panier invalide." });
  } catch (err) {
    logger.error({ err }, "[PublicBilling] payment-intent failed");
    res.status(500).json({ error: "Erreur lors de la création du paiement." });
  }
});

/* ─── POST /api/public/finalize-checkout ─────────────────────────────────
   Called by checkout-return.html after Stripe redirects back.
   Verifies the PaymentIntent / SetupIntent, creates a Stripe Customer,
   attaches the payment method, and creates the subscription with 14-day
   trial. Add-ons were already charged via the PaymentIntent.
 ───────────────────────────────────────────────────────────────────────── */
router.post("/public/finalize-checkout", publicCheckoutRateLimit, async (req: Request, res: Response) => {
  const { intentId, intentType, plan = "", addons = {} } = req.body as {
    intentId?: string;
    intentType?: string;
    plan?: string;
    addons?: AddonsMap;
  };
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];

  if (!stripeKey) {
    res.status(503).json({ error: "Payment service not configured." });
    return;
  }

  // ── Authentication gate FIRST — before any body validation ───────────────
  // A Stripe PaymentIntent can only be completed for a known, verified org.
  // Anonymous callers (no cookie) must complete signup first.
  // Auth is checked before intentId validation so unauthenticated callers
  // always get 401 and never learn which body fields are required.
  const _fckToken = (req.cookies as Record<string, string>)?.["fp_token"] ?? "";
  let _authenticatedOrgId: string | null = null;
  if (_fckToken) {
    try {
      const { pool: _sp } = await import("@workspace/db");
      const _sc = await _sp.connect();
      try {
        // user_sessions hashes the token with SHA-256 (consistent with requireAuth middleware)
        // user_sessions stores the raw token (see services/sessions.ts: INSERT token=$1)
        const _sr = await _sc.query<{ org_id: string }>(
          `SELECT org_id
           FROM   user_sessions
           WHERE  token = $1
             AND  expires_at > NOW()
           LIMIT  1`,
          [_fckToken]
        );
        if (_sr.rows[0]?.org_id && _sr.rows[0].org_id !== "default") {
          _authenticatedOrgId = _sr.rows[0].org_id;
        }
      } finally { _sc.release(); }
    } catch (sessionErr) {
      logger.warn({ sessionErr }, "[PublicBilling/finalize-checkout] Session lookup failed (non-fatal)");
    }
  }
  if (!_authenticatedOrgId) {
    res.status(401).json({
      error:      "auth_required",
      message:    "Veuillez vous connecter ou créer un compte avant de finaliser votre abonnement.",
      redirectTo: "/login.html",
    });
    return;
  }

  // ── Body validation (after auth so unauthenticated callers don't learn schema) ──
  if (!intentId || !intentType) {
    res.status(400).json({ error: "Intent ID manquant." });
    return;
  }

  // Derive trial eligibility from the authenticated org — never trust the client
  const { loadBillingContext: _lbc } = await import("../services/billing-context.js").catch(() => ({ loadBillingContext: null }));
  const _billingCtxForCheckout = _lbc ? await _lbc(_authenticatedOrgId).catch(() => null) : null;
  const _checkoutCanStartTrial = _billingCtxForCheckout?.canStartTrial ?? false;
  // Expose to the rest of the handler via locals (the handler reads from intent metadata + body)
  (req as Record<string, unknown>)["_authenticatedOrgId"]    = _authenticatedOrgId;
  (req as Record<string, unknown>)["_checkoutCanStartTrial"] = _checkoutCanStartTrial;

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    /* ── 1. Verify intent & get payment method ── */
    let paymentMethodId: string | null = null;
    let intentMeta: Record<string, string> = {};

    if (intentType === "payment") {
      const pi = await stripe.paymentIntents.retrieve(intentId);
      if (pi.status !== "succeeded" && pi.status !== "processing") {
        res.status(400).json({ error: "Paiement non confirmé (statut: " + pi.status + ")." });
        return;
      }
      paymentMethodId = (typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id) ?? null;
      intentMeta = (pi.metadata || {}) as Record<string, string>;
    } else {
      const si = await stripe.setupIntents.retrieve(intentId);
      if (si.status !== "succeeded") {
        res.status(400).json({ error: "Configuration non confirmée (statut: " + si.status + ")." });
        return;
      }
      paymentMethodId = (typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id) ?? null;
      intentMeta = (si.metadata || {}) as Record<string, string>;
    }

    if (!paymentMethodId) {
      res.status(400).json({ error: "Moyen de paiement introuvable." });
      return;
    }

    /* Resolve plan/addons (prefer request body, fallback to intent metadata) */
    const planKey  = (plan || intentMeta["plan"] || "").toLowerCase();
    const addonsResolved: AddonsMap = Object.keys(addons as AddonsMap).length
      ? (addons as AddonsMap)
      : (() => { try { return JSON.parse(intentMeta["addons"] || "{}"); } catch { return {}; } })();

    if (!PLAN_PRICE_IDS[planKey]) {
      /* AI credits only — no subscription needed */
      logger.info({ planKey }, "[PublicBilling] finalize: credits-only, no subscription");
      res.json({ success: true, message: "Crédits activés." });
      return;
    }

    /* ── 2. Resolve or create Stripe customer (deduplicated by email) ── */
    // Retrieve email from payment method to match existing customers
    const pm    = await stripe.paymentMethods.retrieve(paymentMethodId);
    const email = pm.billing_details?.email ?? null;

    let customerId: string | null = null;
    let hasSubscriptionHistory    = false;

    if (email) {
      // Search existing customers by email — prevents duplicate customer records
      const existingCustomers = await stripe.customers.list({ email, limit: 5 });
      for (const ec of existingCustomers.data) {
        if ((ec as { deleted?: boolean }).deleted) continue;
        // Check if this customer already has subscription history (trial already used)
        const prevSubs = await stripe.subscriptions.list({ customer: ec.id, status: "all", limit: 1 });
        if (prevSubs.data.length > 0) {
          customerId = ec.id;
          hasSubscriptionHistory = true;
          logger.info({ customerId, email }, "[PublicBilling] finalize: reusing existing Stripe customer (has history)");
          break;
        }
        // Customer exists but no subs — prefer to reuse to avoid duplication
        if (!customerId) customerId = ec.id;
      }
    }

    if (!customerId) {
      // No existing customer — create a new one
      const customer = await stripe.customers.create({
        ...(email ? { email } : {}),
        payment_method: paymentMethodId,
        invoice_settings: { default_payment_method: paymentMethodId },
        metadata: { source: "checkout_payment", plan: planKey },
      });
      customerId = customer.id;
      logger.info({ customerId }, "[PublicBilling] finalize: new Stripe customer created");
    } else {
      // Attach PM to existing customer (may already be attached — ignore error)
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId }).catch(() => {});
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
    }

    /* ── 3a. Plan subscription — trial only for confirmed first-time subscribers ── */
    const planPriceId = PLAN_PRICE_IDS[planKey];
    if (!planPriceId) {
      res.status(400).json({ error: "Plan introuvable dans Stripe." });
      return;
    }

    // Only grant 14-day trial when we have no prior subscription history on this customer
    const grantTrial = !hasSubscriptionHistory;
    logger.info({ planKey, grantTrial, hasSubscriptionHistory, customerId }, "[PublicBilling] finalize: trial decision");

    const planSubscription = await stripe.subscriptions.create({
      customer:               customerId,
      items:                  [{ price: planPriceId, quantity: 1 }],
      ...(grantTrial ? { trial_period_days: 14 } : {}),
      default_payment_method: paymentMethodId,
      metadata: {
        plan:           planKey,
        source:         "checkout_payment",
        flowpoint_cart: "true",
      },
    });

    /* ── 3b. Add-on subscription — independent of trial ──────────────────
       Add-ons were already charged immediately via PaymentIntent (month 1).
       We create a recurring subscription that starts billing at month 2
       (trial_end = now + 30 days) so the customer is never double-charged.
    ────────────────────────────────────────────────────────────────────── */
    const { subscriptionItems } = buildLineItems(planKey, addonsResolved);
    const addonItems = subscriptionItems.filter(i => i.price !== planPriceId);

    let addonSubscriptionId: string | null = null;
    if (addonItems.length > 0) {
      const thirtyDaysFromNow = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const addonSub = await stripe.subscriptions.create({
        customer:               customerId,
        items:                  addonItems,
        trial_end:              thirtyDaysFromNow,   /* skip first 30d — already paid via PI */
        default_payment_method: paymentMethodId,
        metadata: {
          plan:           planKey,
          addons:         JSON.stringify(addonsResolved),
          source:         "checkout_payment_addons",
          flowpoint_cart: "true",
        },
      });
      addonSubscriptionId = addonSub.id;
    }

    logger.info(
      { plan: planKey, planSubscriptionId: planSubscription.id, addonSubscriptionId, customerId },
      "[PublicBilling] finalize: subscriptions created"
    );
    res.json({ success: true, subscriptionId: planSubscription.id, addonSubscriptionId });
  } catch (err) {
    logger.error({ err }, "[PublicBilling] finalize-checkout failed");
    res.status(500).json({ error: "Erreur lors de la finalisation." });
  }
});

export default router;
