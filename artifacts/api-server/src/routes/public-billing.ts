import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { PLAN_PRICE_IDS, ADDON_PRICE_IDS, FLAG_ADDONS, QTY_ADDONS, PLAN_INCLUDED_ADDONS, ADDON_DEFINITIONS } from "../lib/plans.js";
import { PLAN_CONFIG, ADDON_CATALOG } from "../services/billing-service.js";
import { createRateLimit } from "../middlewares/rateLimiter.js";
import type Stripe from "stripe";
import { createStripeClient, getStripeKey } from "../services/stripe-factory.js";
import { createBillingQuote, quoteToStripeLineItems, type BillingQuote } from "../services/billing-quote.js";

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

/**
 * Server-authoritative quote. This validates all customer selections and
 * returns the exact price IDs and minor-unit totals later given to Stripe.
 */
router.post("/billing/quote", async (req: Request, res: Response): Promise<void> => {
  const plan = parsePlanOrEmptyPub(req.body?.plan, res);
  if (plan === null) return;
  const addons = parseAddonsPub(req.body?.addons, res);
  if (addons === null) return;
  /* A quote is only truthful for the path that will collect the money, so the
     caller declares it. Defaults to the Payment Element used by checkout. */
  const mechanism = req.body?.mechanism === "checkout_session" ? "checkout_session" as const : "payment_intent" as const;
  try {
    const trialEligible = await resolveTrialEligibility(req);
    const quote = createBillingQuote({ plan, addons, trialEligible, mechanism });
    if (!quote.lines.length) {
      res.status(400).json({ error: "Sélectionnez un plan ou un add-on facturable." });
      return;
    }
    res.json({ quote });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_SELECTION";
    res.status(400).json({ error: "Sélection non facturable.", code });
  }
});

type AddonsMap = Record<string, boolean | number>;

// ── Input validation helpers (mirrors billing.ts) ─────────────────────────────
const ALLOWED_PLANS_PUB    = new Set<string>(["standard", "pro", "ultra"]);
const KNOWN_ADDON_KEYS_PUB = new Set<string>([...FLAG_ADDONS, ...QTY_ADDONS]);
const MAX_ADDON_QTY_PUB    = 500;

function parsePlanPub(raw: unknown, res: Response): string | null {
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
  if (!ALLOWED_PLANS_PUB.has(p)) {
    res.status(400).json({ error: `Plan inconnu : "${raw}". Plans autorisés : standard, pro, ultra` });
    return null;
  }
  return p;
}

function parseAddonsPub(raw: unknown, res: Response): AddonsMap | null {
  if (raw === undefined || raw === null) return {};
  if (Array.isArray(raw) || typeof raw !== "object") {
    res.status(400).json({ error: 'addons doit être un objet (ex: { "whiteLabel": true })' });
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const result: AddonsMap = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!KNOWN_ADDON_KEYS_PUB.has(key)) {
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
    if (val > MAX_ADDON_QTY_PUB) { res.status(400).json({ error: `Quantité invalide pour "${key}" : maximum ${MAX_ADDON_QTY_PUB}` }); return null; }
    result[key] = val;
  }
  return result;
}

/** Like parsePlanPub but allows "" for addon/AI-credits-only flows. null/array/number still fail. */
function parsePlanOrEmptyPub(raw: unknown, res: Response): string | null {
  if (raw === undefined || raw === null || raw === "") return "";
  if (typeof raw !== "string") {
    const typ = Array.isArray(raw) ? "array" : typeof raw;
    res.status(400).json({ error: `plan doit être une chaîne de caractères (reçu : ${typ})` });
    return null;
  }
  const p = raw.trim().toLowerCase();
  if (p !== "" && !ALLOWED_PLANS_PUB.has(p)) {
    res.status(400).json({ error: `Plan inconnu : "${raw}". Plans autorisés : standard, pro, ultra` });
    return null;
  }
  return p;
}

/**
 * Server-authoritative trial eligibility.
 *
 * An authenticated org is checked against its billing context; a brand-new
 * signup has no subscription history and is therefore eligible. The lookup
 * fails closed (no trial) so the "due today" amount can never understate what
 * Stripe is about to take.
 */
async function resolveTrialEligibility(req: Request): Promise<boolean> {
  const authOrgId = (req as Request & { orgId?: string }).orgId;
  if (authOrgId && authOrgId !== "default") {
    try {
      const { loadBillingContext } = await import("../services/billing-context.js");
      const ctx = await loadBillingContext(authOrgId);
      return ctx.canStartTrial === true;
    } catch (err) {
      logger.warn({ err, orgId: authOrgId }, "[PublicBilling] trial eligibility lookup failed — quoting without trial");
      return false;
    }
  }
  /* Anonymous / pre-registration: a new account has no subscription history. */
  return true;
}

/* Add-ons that are one-time purchases (not subscription items) */
const AI_CREDIT_PACKS = new Set(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);

/* PLAN_INCLUDED_ADDONS imported from plans.ts — do NOT duplicate here */

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
  // Validate types before any business logic — prevents .toLowerCase() crashes on null/array/number
  const plan = parsePlanOrEmptyPub(req.body?.plan, res);
  if (plan === null) return;
  const addons = parseAddonsPub(req.body?.addons, res);
  if (addons === null) return;
  let quote: BillingQuote;
  try {
    const trialEligible = await resolveTrialEligibility(req);
    quote = createBillingQuote({ plan, addons, trialEligible, mechanism: "checkout_session" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_SELECTION";
    res.status(400).json({ error: "Sélection non facturable.", code });
    return;
  }
  const source           = typeof req.body?.source === "string" ? req.body.source : "checkout_html";
  const embedded         = req.body?.embedded === true;
  // preRegisterToken: optional — two documented modes:
  //   A (token present)  → New signup: creates Stripe Customer from pending_signups record.
  //   B (token absent)   → Authenticated or anonymous session: no customer pre-linked.
  const preRegisterToken = typeof req.body?.preRegisterToken === "string" ? req.body.preRegisterToken : "";

  const stripeKey = getStripeKey();
  const publicUrl = process.env["PUBLIC_URL"] || "https://app.flowpoint.pro";
  const publishableKey = process.env["PUBLIC_STRIPE_API_KEY"] || "";

  /* No key in dev → mock */
  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      res.status(503).json({ error: "Payment service not configured." });
      return;
    }
    res.json({ url: `https://checkout.stripe.com/c/pay/test_mock_${plan}_${Date.now()}`, mock: true, quote });
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
    const stripe = await createStripeClient(stripeKey);

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
        stripe_customer_id: string | null;
      } | null = null;

      try {
        const r = await dbClient.query(
          `SELECT email, first_name, last_name, company_name, country, address, city, postal_code, phone, vat, stripe_customer_id
           FROM pending_signups WHERE token = $1 AND expires_at > NOW() AND consumed_at IS NULL LIMIT 1`,
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

      // ── Idempotent customer: reuse existing if a previous attempt already created one ──
      if (signupRow.stripe_customer_id) {
        try {
          const existing = await stripe.customers.retrieve(signupRow.stripe_customer_id);
          if (!(existing as { deleted?: boolean }).deleted) {
            stripeCustomerId = signupRow.stripe_customer_id;
            logger.info({ customerId: stripeCustomerId }, "[PublicBilling] checkout-session: reusing Stripe Customer from pending_signups");
          }
        } catch { /* deleted or unreachable — fall through to create */ }
      }

      if (!stripeCustomerId) {
        // Create Stripe Customer with full contact info (never empty)
        const customerData: Stripe.CustomerCreateParams = {
          email: signupRow.email,
          name:  `${signupRow.first_name} ${signupRow.last_name}`.trim(),
          metadata: {
            flowpointOrgId:     signupRow.email,
            flowpointUserId:    signupRow.email,
            orgId:              signupRow.email,
            companyName:        signupRow.company_name,
            firstName:          signupRow.first_name,
            lastName:           signupRow.last_name,
            pre_register_token: preRegisterToken,
            signup_source:      "new_signup_flow",
            environment:        process.env["NODE_ENV"] === "production" ? "production" : "development",
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

        // Store for idempotent reuse: prevents duplicate Stripe customers on page-back / retry
        const { pool: _csStorePool } = await import("@workspace/db");
        const _csStoreC = await _csStorePool.connect();
        try {
          await _csStoreC.query(
            `UPDATE pending_signups SET stripe_customer_id = $1 WHERE token = $2`,
            [stripeCustomerId, preRegisterToken]
          );
        } finally { _csStoreC.release(); }

        logger.info({ customerId: stripeCustomerId, orgId: signupOrgId },
          "[PublicBilling] Stripe Customer created and stored in pending_signups");
      }
    }

    // For authenticated users (cookie/Bearer session, no preRegisterToken):
    // The /public/ router has no requireAuth middleware, so req.orgId is never set here.
    // We resolve the session manually from the Bearer token or fp_token cookie so that:
    //   (a) orgId is included in session metadata → webhook resolves the org deterministically
    //   (b) existing Stripe customer is reused → no duplicate customer created
    if (!preRegisterToken) {
      try {
        const _authHeader  = req.headers["authorization"];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const _cookieToken = (req as any).cookies?.["fp_token"];
        let _sessionToken: string | undefined;
        if (typeof _authHeader === "string" && _authHeader.startsWith("Bearer ")) {
          _sessionToken = _authHeader.slice(7).trim();
        } else if (typeof _cookieToken === "string" && _cookieToken.trim()) {
          _sessionToken = _cookieToken.trim();
        }
        if (_sessionToken) {
          const { getSession } = await import("../services/sessions.js");
          const _sess = await getSession(_sessionToken);
          if (_sess?.orgId && _sess.orgId !== "default") {
            signupOrgId = _sess.orgId; // included in session metadata.orgId below
            try {
              const { loadBillingContext: _csLbc } = await import("../services/billing-context.js");
              const _authCtx = await _csLbc(_sess.orgId);
              if (_authCtx.stripeCustomerId) {
                stripeCustomerId = _authCtx.stripeCustomerId;
                logger.info({ customerId: stripeCustomerId, orgId: _sess.orgId },
                  "[PublicBilling] checkout-session: Stripe Customer resolved from authenticated session token");
              }
            } catch (_ctxErr) {
              logger.warn({ _ctxErr, orgId: _sess.orgId },
                "[PublicBilling] checkout-session: billing-context load failed — customer not pre-linked");
            }
          }
        }
      } catch (_optAuthErr) {
        logger.warn({ _optAuthErr },
          "[PublicBilling] checkout-session: optional session resolution failed (non-fatal)");
      }
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
        res.json({ clientSecret: session.client_secret, publishableKey, quote, sessionId: session.id });
      } else {
        res.json({ url: session.url, quote, sessionId: session.id });
      }
    }

    /* ── Case 1: subscription (plan ± recurring add-ons, optional AI credit packs) ── */
    if (checkoutType === "subscription") {
      if (subscriptionItems.length === 0) {
        res.status(400).json({ error: "Plan invalide ou introuvable." });
        return;
      }

      // Stripe checkout sessions support mixed line_items in mode:"subscription":
      // recurring prices → subscription items, one-time prices → first invoice only.
      // Do NOT use add_invoice_items (rejected by 2026-04-22.dahlia) nor
      // invoiceItems.create() (pending items persist if checkout is abandoned).
      // Built from the quote, so Stripe is never asked to charge something the
      // customer was not shown (and never for a bundled add-on).
      const allLineItems = quoteToStripeLineItems(quote);

      const sessionParams = urlOrEmbedded({
        mode: "subscription",
        line_items: allLineItems,
        subscription_data: {
          /* Only grant the trial the server actually quoted. Hardcoding 14 here
             gave an ineligible customer a free period the quote had already
             charged them for — Stripe's invoice and our displayed total then
             disagreed on day zero. */
          ...(quote.trialEligible ? { trial_period_days: quote.trialDays } : {}),
          metadata,
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
        line_items: quoteToStripeLineItems(quote),
        metadata,
      }) as Parameters<typeof stripe.checkout.sessions.create>[0];

      const session = await stripe.checkout.sessions.create(sessionParams);
      respond(session as { id: string; url: string | null; client_secret: string | null });
      return;
    }

    /* ── Case 3: addon_only (client with active plan) ── */
    if (checkoutType === "addon_only") {
      const allItems = quoteToStripeLineItems(quote);
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

/* ─── POST /api/public/payment-intent ────────────────────────────────────
   Creates a PaymentIntent (immediate add-on charge) or a SetupIntent
   (plan-only trial — no charge today, card saved for subscription).
 ───────────────────────────────────────────────────────────────────────── */
router.post("/public/payment-intent", publicCheckoutRateLimit, async (req: Request, res: Response) => {
  const plan = parsePlanOrEmptyPub(req.body?.plan, res);
  if (plan === null) return;
  const addons = parseAddonsPub(req.body?.addons, res);
  if (addons === null) return;
  const preRegisterToken   = typeof req.body?.preRegisterToken === "string" ? req.body.preRegisterToken.trim() : "";
  let quote: BillingQuote;
  try {
    const trialEligible = await resolveTrialEligibility(req);
    quote = createBillingQuote({ plan, addons, trialEligible, mechanism: "payment_intent" });
  } catch (error) {
    const code = error instanceof Error ? error.message : "INVALID_SELECTION";
    res.status(400).json({ error: "Sélection non facturable.", code });
    return;
  }
  /* Trial length comes from the server-validated quote — never from the browser,
     so the "due today" figure shown to the customer always matches the charge. */
  const trialDaysRemaining = quote.trialDays;
  /* Billing address collected from the checkout-payment.html form */
  const _rawAddr = req.body?.billingAddress && typeof req.body.billingAddress === "object" ? req.body.billingAddress : null;
  const billingAddress = _rawAddr ? {
    line1:       typeof _rawAddr.line1       === "string" ? _rawAddr.line1.trim()       : "",
    line2:       typeof _rawAddr.line2       === "string" ? _rawAddr.line2.trim()       : "",
    city:        typeof _rawAddr.city        === "string" ? _rawAddr.city.trim()        : "",
    postal_code: typeof _rawAddr.postal_code === "string" ? _rawAddr.postal_code.trim() : "",
    country:     typeof _rawAddr.country     === "string" ? _rawAddr.country.trim().toUpperCase() : "",
  } : null;
  const stripeKey      = getStripeKey();
  const publishableKey = process.env["PUBLIC_STRIPE_API_KEY"] || "";

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      res.status(503).json({ error: "Payment service not configured." });
      return;
    }
    res.json({ clientSecret: "seti_test_mock_secret", publishableKey: "pk_test_mock", mode: "setup", immediateAmount: 0, defaultValues: null, quote });
    return;
  }

  const planKey  = plan.toLowerCase();
  const hasPlan  = !!PLAN_PRICE_IDS[planKey];
  /* NOT amountDueTodayMinor: the plan is due today when there is no trial, but
     it is invoiced by its own subscription at creation. Collecting it here too
     would debit the first month twice. Zero falls through to a SetupIntent. */
  const immediateAmountCents = quote.paymentIntentAmountMinor;

  // Derive orgId (= email) from pending_signups so the webhook can activate the account
  let piOrgId: string | undefined;
  if (preRegisterToken) {
    try {
      const { pool: pgPool } = await import("@workspace/db");
      const lookupClient = await pgPool.connect();
      try {
        const r = await lookupClient.query<{ email: string }>(
          `SELECT email FROM pending_signups WHERE token = $1 AND expires_at > NOW() AND consumed_at IS NULL LIMIT 1`,
          [preRegisterToken]
        );
        if (r.rows[0]?.email) piOrgId = r.rows[0].email;
      } finally { lookupClient.release(); }
    } catch (e) {
      logger.warn({ e }, "[PublicBilling] Could not resolve orgId for payment-intent metadata");
    }
  }

  const metadata: Record<string, string> = {
    source:              "checkout_payment",
    plan:                planKey,
    addons:              JSON.stringify(addons),
    flowpoint_cart:      "true",
    ...(preRegisterToken   ? { pre_register_token:    preRegisterToken            } : {}),
    ...(piOrgId            ? { orgId:                 piOrgId                     } : {}),
    ...(trialDaysRemaining ? { trial_days_remaining:  String(trialDaysRemaining)  } : {}),
  };

  try {
    const stripe = await createStripeClient(stripeKey);

    // ── Pre-registration: find or create Stripe Customer (1 email = 1 customer invariant) ──
    // Prevents duplicate customers when user goes back and retries checkout with same token.
    let preRegCustomerId: string | undefined;
    /* defaultValues sent back to the frontend to pre-fill the Stripe Address Element */
    let _piDefaultValues: { name: string; email: string; country: string } | null = null;
    if (preRegisterToken) {
      try {
        const { pool: _piPool } = await import("@workspace/db");
        const _piC = await _piPool.connect();
        let _piRow: { email: string; first_name: string; last_name: string; company_name: string; address: string | null; city: string | null; postal_code: string | null; country: string | null; stripe_customer_id: string | null } | null = null;
        try {
          const _piR = await _piC.query(
            `SELECT email, first_name, last_name, company_name,
                    address, city, postal_code, country, stripe_customer_id
             FROM pending_signups WHERE token = $1 AND consumed_at IS NULL AND expires_at > NOW() LIMIT 1`,
            [preRegisterToken]
          );
          _piRow = _piR.rows[0] ?? null;
        } finally { _piC.release(); }

        if (_piRow) {
          const _piEmail = _piRow.email;
          metadata["orgId"]  = _piEmail;
          metadata["org_id"] = _piEmail;

          /* Build full customer identity from pending_signups + submitted billingAddress */
          const _piName = `${_piRow.first_name} ${_piRow.last_name}`.trim() || _piRow.company_name || _piEmail;
          /* Expose to frontend for Address Element pre-fill */
          _piDefaultValues = { name: _piName, email: _piEmail, country: _piRow.country || "FR" };
          /* Merge: submitted form address takes priority over stored address */
          const _piAddr = billingAddress?.line1 ? billingAddress : (
            (_piRow.address || _piRow.city || _piRow.country) ? {
              line1:       _piRow.address  ?? "",
              line2:       "",
              city:        _piRow.city     ?? "",
              postal_code: _piRow.postal_code ?? "",
              country:     _piRow.country  ?? "",
            } : null
          );
          const _piCustomerData = {
            email:              _piEmail,
            name:               _piName,
            preferred_locales:  ["fr"] as string[],
            metadata: {
              orgId: _piEmail, org_id: _piEmail, flowpointOrgId: _piEmail,
              pre_register_token: preRegisterToken,
              signup_source: "payment_intent",
              ..._piRow.company_name ? { companyName: _piRow.company_name } : {},
              environment: process.env["NODE_ENV"] === "production" ? "production" : "development",
            },
            ...(_piAddr?.line1 ? { address: {
              line1:       _piAddr.line1,
              line2:       _piAddr.line2 || undefined,
              city:        _piAddr.city,
              postal_code: _piAddr.postal_code,
              country:     _piAddr.country,
            } } : {}),
          };

          // 1. Reuse customer stored from a previous attempt (checkout-session or prior payment-intent)
          if (_piRow.stripe_customer_id) {
            try {
              const _piEc = await stripe.customers.retrieve(_piRow.stripe_customer_id);
              if (!(_piEc as { deleted?: boolean }).deleted) {
                preRegCustomerId = _piRow.stripe_customer_id;
                /* Patch missing fields on the existing customer */
                const _piEcFull = _piEc as { name?: string | null; address?: unknown };
                const _piNeedsUpdate = !_piEcFull.name || !_piEcFull.address;
                if (_piNeedsUpdate) {
                  await stripe.customers.update(preRegCustomerId, {
                    ...(!_piEcFull.name ? { name: _piCustomerData.name } : {}),
                    preferred_locales: ["fr"],
                    ...(_piAddr?.line1 && !_piEcFull.address && _piCustomerData.address
                      ? { address: _piCustomerData.address as import("stripe").Stripe.AddressParam }
                      : {}),
                  }).catch(() => {});
                }
                logger.info({ customerId: preRegCustomerId }, "[PublicBilling] payment-intent: reusing stored Stripe Customer");
              }
            } catch { /* deleted or unreachable — fall through */ }
          }

          // 2. Search Stripe by email (catches checkout-session customer not yet stored in pending_signups)
          if (!preRegCustomerId) {
            const _piFound = await stripe.customers.list({ email: _piEmail, limit: 5 });
            for (const _piFoundEc of _piFound.data) {
              if ((_piFoundEc as { deleted?: boolean }).deleted) continue;
              preRegCustomerId = _piFoundEc.id;
              /* Patch missing fields */
              const _piFoundFull = _piFoundEc as { name?: string | null; address?: unknown };
              await stripe.customers.update(preRegCustomerId, {
                ...(!_piFoundFull.name ? { name: _piCustomerData.name } : {}),
                preferred_locales: ["fr"],
                ...(_piAddr?.line1 && !_piFoundFull.address && _piCustomerData.address
                  ? { address: _piCustomerData.address as import("stripe").Stripe.AddressParam }
                  : {}),
              }).catch(() => {});
              logger.info({ customerId: preRegCustomerId, email: _piEmail }, "[PublicBilling] payment-intent: found existing customer by email");
              break;
            }
          }

          // 3. Create new customer with full data if none exists
          if (!preRegCustomerId) {
            const _piNewC = await stripe.customers.create(_piCustomerData);
            preRegCustomerId = _piNewC.id;
            logger.info({ customerId: preRegCustomerId }, "[PublicBilling] payment-intent: created Stripe Customer");
          }

          // Always write back so next attempt finds it immediately
          const { pool: _piStorePool } = await import("@workspace/db");
          const _piSc = await _piStorePool.connect();
          try {
            await _piSc.query(`UPDATE pending_signups SET stripe_customer_id = $1 WHERE token = $2`, [preRegCustomerId, preRegisterToken]);
          } finally { _piSc.release(); }
        }
      } catch (_piLookupErr) {
        logger.warn({ _piLookupErr }, "[PublicBilling] payment-intent: customer lookup failed (non-fatal — proceeding without customer)");
      }
    }

    // For authenticated users (cookie session, no preRegisterToken): resolve the Stripe
    // Customer from the org's billing context. Uses ensureStripeCustomer to recover from
    // deleted-customer scenarios (e.g. after an ops purge that removed the Stripe customer
    // but left the DB record intact). This prevents "No such customer" 500 errors during
    // checkout when the stored stripe_customer_id no longer exists in Stripe.
    if (!preRegCustomerId && !preRegisterToken) {
      const _authOrgId = (req as Request & { orgId?: string }).orgId;
      if (_authOrgId && _authOrgId !== "default") {
        try {
          const { loadBillingContext } = await import("../services/billing-context.js");
          const _authCtx = await loadBillingContext(_authOrgId);
          if (_authCtx.stripeCustomerId || _authCtx.email) {
            // Use ensureStripeCustomer instead of raw stripeCustomerId so that a deleted
            // Stripe customer is automatically recreated rather than causing a 500.
            const { ensureStripeCustomer: _ensureForPI } = await import("../services/ensure-stripe-customer.js");
            const _ensuredId = await _ensureForPI(_authOrgId, _authCtx, stripeKey);
            if (_ensuredId) {
              preRegCustomerId = _ensuredId;
              logger.info({ customerId: preRegCustomerId, orgId: _authOrgId, hadOldId: _authCtx.stripeCustomerId },
                "[PublicBilling] payment-intent: ensured Stripe Customer for authenticated org");
            }
          }
        } catch (_authCtxErr) {
          logger.warn({ _authCtxErr }, "[PublicBilling] payment-intent: billing-context/ensureStripeCustomer failed for authenticated org (non-fatal)");
        }
      }
    }

    if (immediateAmountCents > 0) {
      /* PaymentIntent — immediate charge for add-ons / credits */
      const pi = await stripe.paymentIntents.create({
        amount:   immediateAmountCents,
        currency: "eur",
        /* save PM for subscription after trial */
        ...(hasPlan ? { setup_future_usage: "off_session" } : {}),
        ...(preRegCustomerId ? { customer: preRegCustomerId } : {}),
        /* allow_redirects:'never' keeps only non-redirect methods (card, SEPA);
           removes Stripe Link and redirect-based wallets from the Payment Element */
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        metadata,
      });
      logger.info({ plan: planKey, addonCount: quote.lines.filter(l => l.kind === "addon").length, immediateAmountCents }, "[PublicBilling] PaymentIntent created");
      res.json({ clientSecret: pi.client_secret, publishableKey, mode: "payment", immediateAmount: immediateAmountCents, defaultValues: _piDefaultValues, quote, paymentIntentId: pi.id });
      return;
    }

    if (hasPlan) {
      /* SetupIntent — collect card for trial subscription, 0€ today */
      const si = await stripe.setupIntents.create({
        ...(preRegCustomerId ? { customer: preRegCustomerId } : {}),
        /* allow_redirects:'never' keeps only non-redirect methods (card, SEPA);
           removes Stripe Link and redirect-based wallets (Bancontact, PayPal, Klarna)
           which cannot be saved for future off_session charges anyway */
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        usage: "off_session",
        metadata,
      });
      logger.info({ plan: planKey, hasCustomer: !!preRegCustomerId }, "[PublicBilling] SetupIntent created");
      res.json({ clientSecret: si.client_secret, publishableKey, mode: "setup", immediateAmount: 0, defaultValues: _piDefaultValues, quote, setupIntentId: si.id });
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
  // ── P1-6: Payload validation (400 not 500 on bad input) ──────────────────
  const body = req.body as Record<string, unknown>;

  const intentId = body?.intentId;
  if (!intentId || typeof intentId !== "string" || !intentId.trim()) {
    res.status(400).json({ error: "intentId requis (pi_… ou seti_…)" });
    return;
  }
  const intentType = body?.intentType;
  if (!intentType || typeof intentType !== "string" ||
      !["payment", "setup", "checkout_session"].includes(intentType)) {
    res.status(400).json({ error: 'intentType doit être "payment", "setup" ou "checkout_session"' });
    return;
  }
  const _rawPlan = body?.plan;
  if (_rawPlan !== undefined && _rawPlan !== null && _rawPlan !== "" && typeof _rawPlan !== "string") {
    const typ = Array.isArray(_rawPlan) ? "array" : typeof _rawPlan;
    res.status(400).json({ error: `plan doit être une chaîne de caractères (reçu : ${typ})` });
    return;
  }
  const plan  = typeof _rawPlan === "string" ? _rawPlan.trim().toLowerCase() : "";
  const addons = parseAddonsPub(body?.addons ?? {}, res);
  if (addons === null) return; // parseAddonsPub already sent 400

  const _fcPreRegRaw = body?.preRegisterToken;
  const preRegisterToken = typeof _fcPreRegRaw === "string" ? _fcPreRegRaw.trim() : "";
  const stripeKey = getStripeKey();

  if (!stripeKey) {
    res.status(503).json({ error: "Payment service not configured." });
    return;
  }

  // ── Authentication gate ───────────────────────────────────────────────────
  // Two accepted paths:
  //   A) fp_token session cookie  → existing user (upgrade / add-on flow)
  //   B) preRegisterToken in body → new signup who just paid via checkout-payment.html;
  //      validated against pending_signups (must exist and not yet expired).
  //      The account may already be activated by the webhook — that's fine (idempotent).
  const _fckToken = (req.cookies as Record<string, string>)?.["fp_token"] ?? "";
  const _preRegToken = typeof (req.body as Record<string, unknown>)?.preRegisterToken === "string"
    ? ((req.body as Record<string, unknown>).preRegisterToken as string).trim()
    : "";
  let _authenticatedOrgId: string | null = null;

  if (_fckToken) {
    try {
      const { pool: _sp } = await import("@workspace/db");
      const _sc = await _sp.connect();
      try {
        const _sr = await _sc.query<{ org_id: string }>(
          `SELECT org_id FROM user_sessions WHERE token = $1 AND expires_at > NOW() LIMIT 1`,
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

  // Path B: new signup — validate preRegisterToken against pending_signups.
  // Accept both unconsumed AND already-consumed tokens: the webhook may have activated
  // the account before finalize-checkout is called — this path must be idempotent.
  if (!_authenticatedOrgId && preRegisterToken) {
    try {
      const { pool: _fcBypassPool } = await import("@workspace/db");
      const _fcBypassC = await _fcBypassPool.connect();
      try {
        const _fcBypassR = await _fcBypassC.query<{ email: string }>(
          `SELECT email FROM pending_signups WHERE token = $1 AND expires_at > NOW() LIMIT 1`,
          [preRegisterToken]
        );
        if (_fcBypassR.rows[0]?.email) {
          _authenticatedOrgId = _fcBypassR.rows[0].email;
          logger.info({ orgId: _authenticatedOrgId }, "[PublicBilling/finalize-checkout] Authenticated via preRegisterToken (new signup)");
        }
      } finally { _fcBypassC.release(); }
    } catch (_fcBypassErr) {
      logger.warn({ _fcBypassErr }, "[PublicBilling/finalize-checkout] preRegisterToken lookup failed (non-fatal)");
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
  (req as unknown as Record<string, unknown>)["_authenticatedOrgId"]    = _authenticatedOrgId;
  (req as unknown as Record<string, unknown>)["_checkoutCanStartTrial"] = _checkoutCanStartTrial;

  try {
    const stripe = await createStripeClient(stripeKey);

    /* ── 0. checkout_session: Stripe-hosted subscription checkout (reactivation flow) ──
         Early return — no PaymentIntent/SetupIntent involved, webhook is activation source. */
    if (intentType === "checkout_session") {
      try {
        const _csSession = await stripe.checkout.sessions.retrieve(intentId);

        if (_csSession.mode !== "subscription") {
          res.status(400).json({ error: "Session de paiement non valide (mode attendu : subscription)." });
          return;
        }

        // Verify the session belongs to the authenticated org
        const _csMeta = (_csSession.metadata as Record<string, string> | null) ?? {};
        const _csSessionOrgId = _csMeta["orgId"] ?? "";
        if (_csSessionOrgId && _authenticatedOrgId && _csSessionOrgId !== _authenticatedOrgId) {
          logger.warn({ csOrgId: _csSessionOrgId, authOrgId: _authenticatedOrgId },
            "[PublicBilling/finalize-checkout] checkout_session orgId mismatch");
          res.status(403).json({ error: "Cette session ne vous appartient pas." });
          return;
        }

        // Verify payment status
        const _csIsPaid = _csSession.payment_status === "paid" ||
                          _csSession.payment_status === "no_payment_required";
        if (!_csIsPaid) {
          res.status(402).json({
            error: "Paiement non finalisé. Réessayez dans quelques instants.",
            awaitingWebhook: false,
          });
          return;
        }

        // Do NOT activate locally — the Stripe webhook is the sole activation gate.
        const _csPlan = (_csMeta["plan"] ?? "").toLowerCase();
        logger.info({ sessionId: intentId, orgId: _authenticatedOrgId, plan: _csPlan },
          "[PublicBilling] checkout_session verified — awaiting webhook for activation");

        res.json({ success: true, awaitingWebhook: true, plan: _csPlan });
        return;
      } catch (_csErr) {
        const _csMsg = _csErr instanceof Error ? _csErr.message : String(_csErr);
        const _csInvalid = _csMsg.includes("No such") || _csMsg.includes("resource_missing") ||
                           _csMsg.includes("invalid_request");
        if (_csInvalid) {
          res.status(400).json({ error: "Session de paiement introuvable ou expirée." });
          return;
        }
        throw _csErr; // let the outer catch handle unexpected errors
      }
    }

    /* ── 1. Verify intent & get payment method ── */
    let paymentMethodId: string | null = null;
    let intentMeta: Record<string, string> = {};
    let intentCustomerId: string | null = null;

    if (intentType === "payment") {
      const pi = await stripe.paymentIntents.retrieve(intentId);
      if (pi.status !== "succeeded" && pi.status !== "processing") {
        res.status(400).json({ error: "Paiement non confirmé (statut: " + pi.status + ")." });
        return;
      }
      paymentMethodId = (typeof pi.payment_method === "string" ? pi.payment_method : pi.payment_method?.id) ?? null;
      intentMeta = (pi.metadata || {}) as Record<string, string>;
      const _rawPiCust = pi.customer;
      intentCustomerId = _rawPiCust ? (typeof _rawPiCust === "string" ? _rawPiCust : (_rawPiCust as { id: string }).id) : null;
    } else {
      const si = await stripe.setupIntents.retrieve(intentId);
      if (si.status !== "succeeded") {
        res.status(400).json({ error: "Configuration non confirmée (statut: " + si.status + ")." });
        return;
      }
      paymentMethodId = (typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id) ?? null;
      intentMeta = (si.metadata || {}) as Record<string, string>;
      const _rawSiCust = si.customer;
      intentCustomerId = _rawSiCust ? (typeof _rawSiCust === "string" ? _rawSiCust : (_rawSiCust as { id: string }).id) : null;
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

    // Read trial_days_remaining from intent metadata (set by checkout-payment.html via /api/public/payment-intent).
    // Clamped 0–90. Defaults to 14 when the field is absent (legacy intents before this field existed).
    const _rawIntentTrialDays = intentMeta["trial_days_remaining"];
    const intentTrialDays: number = _rawIntentTrialDays !== undefined && Number.isFinite(Number(_rawIntentTrialDays))
      ? Math.max(0, Math.min(90, Math.round(Number(_rawIntentTrialDays))))
      : 14;

    if (!PLAN_PRICE_IDS[planKey]) {
      /* AI credits only — no subscription needed */
      logger.info({ planKey }, "[PublicBilling] finalize: credits-only, no subscription");
      res.json({ success: true, message: "Crédits activés." });
      return;
    }

    /* ── 2. Resolve or create Stripe customer ─────────────────────────────────
       Priority: (a) customer already attached to the intent (set by payment-intent
       endpoint when pre_register_token present — enforces 1 email = 1 customer)
       > (b) email search on payment method billing details
       > (c) pending_signups.stripe_customer_id via pre_register_token
       > (d) last resort: create new.
    ──────────────────────────────────────────────────────────────────────────── */
    let customerId: string | null = intentCustomerId;
    let hasSubscriptionHistory    = false;

    if (customerId) {
      try {
        const _fcEc = await stripe.customers.retrieve(customerId);
        if ((_fcEc as { deleted?: boolean }).deleted) {
          customerId = null;
        } else {
          const _fcPrevSubs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 1 });
          hasSubscriptionHistory = _fcPrevSubs.data.length > 0;
          logger.info({ customerId, hasSubscriptionHistory }, "[PublicBilling] finalize: using customer from intent");
        }
      } catch { customerId = null; }
    }

    if (!customerId) {
      // (b) email from payment method billing details
      const _fcPm    = await stripe.paymentMethods.retrieve(paymentMethodId!);
      const _fcEmail = _fcPm.billing_details?.email ?? null;
      if (_fcEmail) {
        const _fcExisting = await stripe.customers.list({ email: _fcEmail, limit: 5 });
        for (const _fcEc2 of _fcExisting.data) {
          if ((_fcEc2 as { deleted?: boolean }).deleted) continue;
          const _fcSubs = await stripe.subscriptions.list({ customer: _fcEc2.id, status: "all", limit: 1 });
          if (_fcSubs.data.length > 0) {
            customerId = _fcEc2.id; hasSubscriptionHistory = true;
            logger.info({ customerId, email: _fcEmail }, "[PublicBilling] finalize: reusing Stripe customer (has history)");
            break;
          }
          if (!customerId) customerId = _fcEc2.id;
        }
      }
    }

    if (!customerId) {
      // (c) pending_signups.stripe_customer_id via pre_register_token
      const _fcPrt = preRegisterToken || intentMeta["pre_register_token"] || "";
      if (_fcPrt) {
        try {
          const { pool: _fcPsPool } = await import("@workspace/db");
          const _fcPsC = await _fcPsPool.connect();
          try {
            const _fcPsR = await _fcPsC.query(
              `SELECT stripe_customer_id FROM pending_signups WHERE token = $1 AND consumed_at IS NULL LIMIT 1`,
              [_fcPrt]
            );
            if (_fcPsR.rows[0]?.stripe_customer_id) {
              customerId = _fcPsR.rows[0].stripe_customer_id;
              logger.info({ customerId }, "[PublicBilling] finalize: found customer via pre_register_token");
            }
          } finally { _fcPsC.release(); }
        } catch { /* non-fatal */ }
      }
    }

    if (!customerId) {
      // (d) last resort: create new customer
      const _fcPm2   = paymentMethodId ? await stripe.paymentMethods.retrieve(paymentMethodId).catch(() => null) : null;
      const _fcEmail2 = _fcPm2?.billing_details?.email ?? null;
      const _fcOrgForMeta = intentMeta["orgId"] || intentMeta["org_id"] || _authenticatedOrgId;
      const _fcNewC = await stripe.customers.create({
        ...(_fcEmail2 ? { email: _fcEmail2 } : {}),
        payment_method: paymentMethodId!,
        invoice_settings: { default_payment_method: paymentMethodId! },
        metadata: {
          source: "checkout_payment", plan: planKey,
          ...(_fcOrgForMeta ? { orgId: _fcOrgForMeta, org_id: _fcOrgForMeta } : {}),
        },
      });
      customerId = _fcNewC.id;
      logger.warn({ customerId }, "[PublicBilling] finalize: new Stripe customer created (last resort — check for duplicates)");
    }

    // Attach payment method to resolved customer (safe even if already attached)
    await stripe.paymentMethods.attach(paymentMethodId!, { customer: customerId! }).catch(() => {});

    // Keep the canonical billing record in sync before creating the subscription.
    // A trial checkout may create the Stripe customer before the activation
    // webhook creates the UUID organization; persistOrgData mirrors safely for
    // pre-registration IDs and writes organizations for authenticated accounts.
    try {
      const { persistOrgData: persistCheckoutCustomer } = await import("../services/org-data.js");
      await persistCheckoutCustomer(_authenticatedOrgId, { stripeCustomerId: customerId! });
      logger.info({ orgId: _authenticatedOrgId, customerId }, "[PublicBilling] finalize: Stripe customer linked to organization");
    } catch (customerPersistErr) {
      // Do not abandon a successful Stripe confirmation; the later subscription
      // persistence/webhook remains a recovery path, but make the gap visible.
      logger.error({ customerPersistErr, orgId: _authenticatedOrgId, customerId },
        "[PublicBilling] finalize: could not link Stripe customer to organization");
    }

    /* ── Enrich Customer: merge Stripe Address Element data + pending_signups ──
       Source priority:
         • name/email   → pending_signups (signup data) > pm.billing_details
         • address      → pm.billing_details (Stripe Address Element) > pending_signups
       This guarantees 1 Customer with complete identity, billing address and locale.
    ─────────────────────────────────────────────────────────────────────────── */
    try {
      /* 1. Retrieve PM billing_details — populated by Stripe Address Element on confirm */
      const _fcPmFull = await stripe.paymentMethods.retrieve(paymentMethodId!).catch(() => null);
      const _fcPmBd   = (_fcPmFull?.billing_details ?? null) as {
        name?:    string | null;
        email?:   string | null;
        address?: { line1?: string | null; line2?: string | null; city?: string | null; postal_code?: string | null; country?: string | null; state?: string | null } | null;
      } | null;
      const _fcPmAddr = _fcPmBd?.address;

      /* 2. Load signup row (name/email/company fallback) */
      const _fcPrt2 = preRegisterToken || intentMeta["pre_register_token"] || "";
      let _fcSignupName = "";
      let _fcSignupEmail = "";
      if (_fcPrt2) {
        const { pool: _fcEnrichPool } = await import("@workspace/db");
        const _fcEnrichC = await _fcEnrichPool.connect();
        try {
          const _fcER = await _fcEnrichC.query(
            `SELECT email, first_name, last_name, company_name
             FROM pending_signups WHERE token = $1 LIMIT 1`,
            [_fcPrt2]
          );
          const _fcRow = _fcER.rows[0];
          if (_fcRow) {
            _fcSignupName  = `${_fcRow.first_name ?? ""} ${_fcRow.last_name ?? ""}`.trim() || _fcRow.company_name || "";
            _fcSignupEmail = _fcRow.email || "";
          }
        } finally { _fcEnrichC.release(); }
      }

      /* 3. Merge: prefer signup for name/email, PM billing_details for address */
      const _fcFinalName  = _fcSignupName  || _fcPmBd?.name  || "";
      const _fcFinalEmail = _fcSignupEmail || _fcPmBd?.email || "";
      const _fcHasPmAddr  = !!(_fcPmAddr?.line1 && _fcPmAddr?.country);

      const _fcUpdate: Parameters<typeof stripe.customers.update>[1] = {
        invoice_settings: { default_payment_method: paymentMethodId! },
        preferred_locales: ["fr"],
        ...(_fcFinalName  ? { name:  _fcFinalName  } : {}),
        ...(_fcFinalEmail ? { email: _fcFinalEmail } : {}),
        ...(_fcHasPmAddr  ? {
          address: {
            line1:       _fcPmAddr!.line1  ?? "",
            line2:       _fcPmAddr!.line2  ?? undefined,
            city:        _fcPmAddr!.city   ?? "",
            postal_code: _fcPmAddr!.postal_code ?? "",
            country:     _fcPmAddr!.country ?? "",
          }
        } : {}),
      };

      await stripe.customers.update(customerId!, _fcUpdate);
      logger.info({ customerId, hasPmAddr: _fcHasPmAddr, hasName: !!_fcFinalName },
        "[PublicBilling] finalize: customer enriched (Address Element + signup data)");

    } catch (_fcEnrichErr) {
      logger.warn({ _fcEnrichErr }, "[PublicBilling] finalize: customer enrichment non-fatal — invoice_settings only");
      await stripe.customers.update(customerId!, {
        invoice_settings: { default_payment_method: paymentMethodId! },
        preferred_locales: ["fr"],
      }).catch(() => {});
    }

    /* ── 3a. Plan subscription — trial only for confirmed first-time subscribers ── */
    const planPriceId = PLAN_PRICE_IDS[planKey];
    if (!planPriceId) {
      res.status(400).json({ error: "Plan introuvable dans Stripe." });
      return;
    }

    // Grant trial when there is no prior subscription history AND the intent carries trial days > 0.
    // When trial_days_remaining === 0 the user's trial has already expired — bill immediately.
    const grantTrial = !hasSubscriptionHistory && intentTrialDays > 0;
    const trialEndUnix = grantTrial ? Math.floor(Date.now() / 1000) + intentTrialDays * 86400 : undefined;
    logger.info({ planKey, grantTrial, intentTrialDays, hasSubscriptionHistory, customerId }, "[PublicBilling] finalize: trial decision");

    // ── P1-5: Idempotence guard — prevent duplicate subscriptions on retry/refresh ──
    // Check whether this customer already has an active or trialing subscription for
    // the same plan price ID before creating a new one.
    let planSubscription: Awaited<ReturnType<typeof stripe.subscriptions.create>>;
    {
      const existingSubs = await stripe.subscriptions.list({
        customer: customerId!,
        price:    planPriceId,
        limit:    5,
      });
      const reusable = existingSubs.data.find(
        (s: Stripe.Subscription) => s.status === "active" || s.status === "trialing" || s.status === "past_due"
      );
      if (reusable) {
        // Reuse — avoid duplicate subscription on page refresh / double-click
        logger.info({ subscriptionId: reusable.id, planKey, customerId },
          "[PublicBilling] finalize: reusing existing plan subscription (idempotent)");
        planSubscription = reusable as typeof planSubscription;
      } else {
        planSubscription = await stripe.subscriptions.create({
          customer:               customerId,
          items:                  [{ price: planPriceId, quantity: 1 }],
          ...(trialEndUnix !== undefined ? { trial_end: trialEndUnix } : {}),
          default_payment_method: paymentMethodId,
          metadata: {
            plan:           planKey,
            source:         "checkout_payment",
            flowpoint_cart: "true",
            org_id:         _authenticatedOrgId,
            orgId:          _authenticatedOrgId,
            ...(preRegisterToken || intentMeta["pre_register_token"]
              ? { pre_register_token: preRegisterToken || intentMeta["pre_register_token"] }
              : {}),
          },
        });
      }
    }

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
    // ── Persist subscription to DB immediately (don't wait for webhook delay) ──
    try {
      const { persistOrgData: _fcPod } = await import("../services/org-data.js");
      await _fcPod(_authenticatedOrgId, {
        subscriptionStatus:   grantTrial ? "trialing" : "active",
        stripeCustomerId:     customerId!,
        stripeSubscriptionId: planSubscription.id,
        plan:                 planKey,
        ...(trialEndUnix !== undefined ? { trialEndsAt: new Date(trialEndUnix * 1000).toISOString() } : {}),
        // Mark trial consumed so canStartTrial stays definitively false even if
        // stripeSubscriptionId is later cleared (e.g. resource_missing reconciliation).
        trialConsumedAt: new Date().toISOString(),
      });
      logger.info({ orgId: _authenticatedOrgId, planKey }, "[PublicBilling] finalize: subscription persisted to DB");
    } catch (_fcPodErr) {
      logger.warn({ _fcPodErr }, "[PublicBilling] finalize: persistOrgData non-fatal (webhook will sync)");
    }

    // ── Pre-registration: activate new user account and deliver magic link ────
    // A successful finalization must never claim that a login email was sent
    // before the account, token and delivery have all completed successfully.
    const _fcActToken = preRegisterToken || intentMeta["pre_register_token"] || "";
    if (_fcActToken) {
      try {
          const { pool: _fcActPool } = await import("@workspace/db");
          const { randomBytes: _fcRb } = await import("crypto");
          const _fcActC0 = await _fcActPool.connect();
          let _fcSignup: Record<string, string | null> | null = null;
          try {
            const _fcActR0 = await _fcActC0.query(
              `SELECT email, first_name, last_name, company_name FROM pending_signups
               WHERE token = $1 AND consumed_at IS NULL AND expires_at > NOW() LIMIT 1`,
              [_fcActToken]
            );
            _fcSignup = _fcActR0.rows[0] ?? null;
          } finally { _fcActC0.release(); }

          if (!_fcSignup) {
            logger.info({ token: _fcActToken }, "[PublicBilling] finalize: activation skipped — token already consumed");
            return;
          }
          const _fcAEmail = _fcSignup["email"] ?? _authenticatedOrgId;
          // Use a proper UUID for organizations.id — email as PK caused SQLSTATE 42804
          // when organizations.id is UUID-typed. Slug and owner_email remain email-based.
          const { randomUUID: _fcRandUUID } = await import("crypto");
          const _fcAOrgId = _fcRandUUID();

          const _fcActTxC = await _fcActPool.connect();
          try {
            await _fcActTxC.query("BEGIN");
            const _fcUsr = await _fcActTxC.query<{ id: string }>(
              `INSERT INTO users (email, first_name, last_name, auth_provider, email_verified, status)
               VALUES ($1,$2,$3,'magic_link',TRUE,'active')
               ON CONFLICT (email) DO UPDATE
                 SET status='active', email_verified=TRUE,
                     first_name=COALESCE(EXCLUDED.first_name,users.first_name), updated_at=NOW()
               RETURNING id`,
              [_fcAEmail, _fcSignup["first_name"] ?? "", _fcSignup["last_name"] ?? ""]
            );
            const _fcUserId = _fcUsr.rows[0]?.id;
            if (!_fcUserId) throw new Error("upsert user failed for " + _fcAEmail);
            await _fcActTxC.query(
              `INSERT INTO organizations
                 (id,name,slug,owner_user_id,status,plan,subscription_status,owner_email,stripe_customer_id,trial_ends_at)
               VALUES($1,$2,$3,$4,'active',$5,$6,$7,$8,$9)
               ON CONFLICT (id) DO UPDATE
                 SET status='active', plan=EXCLUDED.plan, subscription_status=EXCLUDED.subscription_status,
                     stripe_customer_id=COALESCE(EXCLUDED.stripe_customer_id,organizations.stripe_customer_id),
                     updated_at=NOW()`,
              [
                _fcAOrgId, _fcSignup["company_name"] ?? _fcAEmail,
                _fcAOrgId.replace(/[^a-z0-9]/gi,"-").toLowerCase().slice(0,60),
                _fcUserId, planKey, grantTrial ? "trialing" : "active",
                _fcAEmail, customerId ?? null,
                trialEndUnix !== undefined ? new Date(trialEndUnix * 1000).toISOString() : null,
              ]
            );
            await _fcActTxC.query(
              `INSERT INTO organization_members (organization_id,user_id,role,status)
               VALUES($1,$2,'owner','active')
               ON CONFLICT(organization_id,user_id) DO UPDATE SET status='active',role='owner',updated_at=NOW()`,
              [_fcAOrgId, _fcUserId]
            );
            await _fcActTxC.query(
              `UPDATE pending_signups SET consumed_at=NOW() WHERE token=$1 AND consumed_at IS NULL`,
              [_fcActToken]
            );
            await _fcActTxC.query("COMMIT");
            logger.info({ orgId: _fcAOrgId, userId: _fcUserId }, "[PublicBilling] finalize: new user/org activated");
          } catch (_fcActErr) {
            await _fcActTxC.query("ROLLBACK").catch(() => {});
            logger.error({ _fcActErr }, "[PublicBilling] finalize: activation transaction failed");
            throw _fcActErr;
          } finally { _fcActTxC.release(); }

          // Send activation magic link (24h TTL)
          const _fcMagicToken = _fcRb(32).toString("hex");
          const _fcTokC = await _fcActPool.connect();
          try {
            await _fcTokC.query(
              `INSERT INTO magic_link_tokens(token,email,expires_at,used)
               VALUES($1,$2,NOW()+INTERVAL '24 hours',FALSE) ON CONFLICT(token) DO NOTHING`,
              [_fcMagicToken, _fcAEmail]
            );
          } finally { _fcTokC.release(); }
          const _fcPubUrl = process.env["PUBLIC_URL"] || "https://app.flowpoint.pro";
          const { mailer: _fcMailer } = await import("../services/mailer.js").catch(() => ({ mailer: null }));
          if (!_fcMailer) {
            throw new Error("Activation email service unavailable");
          }
          const _fcMailResult = await _fcMailer.sendActivationMagicLink({
              to:           _fcAEmail,
              name:         _fcSignup["first_name"] || _fcAEmail.split("@")[0],
              plan:         planKey,
              magicLinkUrl: `${_fcPubUrl}/login-verify.html?token=${_fcMagicToken}`,
              isTrial:      grantTrial,
          });
          if (!_fcMailResult?.ok) {
            throw new Error(`Activation email was not delivered: ${_fcMailResult?.error ?? "unknown error"}`);
          }
            logger.info({ email: _fcAEmail }, "[PublicBilling] finalize: activation magic link sent");
      } catch (_fcActTopErr) {
        logger.error({ _fcActTopErr }, "[PublicBilling] finalize: pre-reg activation/link delivery failed");
        res.status(502).json({
          error: "Votre paiement est confirmé, mais le lien de connexion n'a pas pu être envoyé. Réessayez dans quelques instants ou contactez le support.",
          code: "activation_email_failed",
        });
        return;
      }
    }

    res.json({ success: true, subscriptionId: planSubscription.id, addonSubscriptionId, activationEmailSent: !!_fcActToken });
  } catch (err) {
    logger.error({ err }, "[PublicBilling] finalize-checkout failed");
    res.status(500).json({ error: "Erreur lors de la finalisation." });
  }
});

export default router;
