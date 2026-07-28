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

/* Add-ons that are one-time purchases (not subscription items) */
const AI_CREDIT_PACKS = new Set(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);

/* Add-ons included in each plan (excluded from billing) */
const PLAN_INCLUDED_ADDONS: Record<string, Set<string>> = {
  // Canonical add-on inclusion — single source of truth (mirrors billing.ts, checkout.html, dashboard.js)
  // Standard=1 | Pro=6 (cumulative) | Ultra=10 (cumulative)
  standard: new Set(["whiteLabel"]),
  pro:      new Set(["whiteLabel", "customDomain", "advancedWebhooks", "retention90d", "advancedSeoLab", "backlinkIntelligence"]),
  ultra:    new Set(["whiteLabel", "customDomain", "advancedWebhooks", "retention90d", "advancedSeoLab", "backlinkIntelligence",
                     "retention365d", "keywordDomination", "behavioralAI", "aiForecasting"]),
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
  // Validate types before any business logic — prevents .toLowerCase() crashes on null/array/number
  const plan = parsePlanOrEmptyPub(req.body?.plan, res);
  if (plan === null) return;
  const addons = parseAddonsPub(req.body?.addons, res);
  if (addons === null) return;
  const source           = typeof req.body?.source === "string" ? req.body.source : "checkout_html";
  const embedded         = req.body?.embedded === true;
  // preRegisterToken: optional — two documented modes:
  //   A (token present)  → New signup: creates Stripe Customer from pending_signups record.
  //   B (token absent)   → Authenticated or anonymous session: no customer pre-linked.
  const preRegisterToken = typeof req.body?.preRegisterToken === "string" ? req.body.preRegisterToken : "";

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
        const customerData: Parameters<typeof stripe.customers.create>[0] = {
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
      const allLineItems = [...subscriptionItems, ...oneTimeItems];

      const sessionParams = urlOrEmbedded({
        mode: "subscription",
        line_items: allLineItems,
        subscription_data: {
          trial_period_days: 14,
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
  const plan = parsePlanOrEmptyPub(req.body?.plan, res);
  if (plan === null) return;
  const addons = parseAddonsPub(req.body?.addons, res);
  if (addons === null) return;
  const preRegisterToken   = typeof req.body?.preRegisterToken === "string" ? req.body.preRegisterToken.trim() : "";
  const trialDaysRemaining = Number.isFinite(Number(req.body?.trialDaysRemaining)) ? Math.max(0, Math.min(90, Number(req.body.trialDaysRemaining))) : 0;
  /* Billing address collected from the checkout-payment.html form */
  const _rawAddr = req.body?.billingAddress && typeof req.body.billingAddress === "object" ? req.body.billingAddress : null;
  const billingAddress = _rawAddr ? {
    line1:       typeof _rawAddr.line1       === "string" ? _rawAddr.line1.trim()       : "",
    line2:       typeof _rawAddr.line2       === "string" ? _rawAddr.line2.trim()       : "",
    city:        typeof _rawAddr.city        === "string" ? _rawAddr.city.trim()        : "",
    postal_code: typeof _rawAddr.postal_code === "string" ? _rawAddr.postal_code.trim() : "",
    country:     typeof _rawAddr.country     === "string" ? _rawAddr.country.trim().toUpperCase() : "",
  } : null;
  const stripeKey      = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const publishableKey = process.env["PUBLIC_STRIPE_API_KEY"] || "";

  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      res.status(503).json({ error: "Payment service not configured." });
      return;
    }
    res.json({ clientSecret: "seti_test_mock_secret", publishableKey: "pk_test_mock", mode: "setup", immediateAmount: 0, defaultValues: null });
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
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

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
      logger.info({ plan: planKey, addonCount: addonKeys.length, immediateAmountCents }, "[PublicBilling] PaymentIntent created");
      res.json({ clientSecret: pi.client_secret, publishableKey, mode: "payment", immediateAmount: immediateAmountCents, defaultValues: _piDefaultValues });
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
      res.json({ clientSecret: si.client_secret, publishableKey, mode: "setup", immediateAmount: 0, defaultValues: _piDefaultValues });
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
  const { intentId, intentType, plan = "", addons = {}, preRegisterToken: _fcPreRegRaw = "" } = req.body as {
    intentId?: string;
    intentType?: string;
    plan?: string;
    addons?: AddonsMap;
    preRegisterToken?: string;
  };
  const preRegisterToken = typeof _fcPreRegRaw === "string" ? _fcPreRegRaw.trim() : "";
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];

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
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

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

    const planSubscription = await stripe.subscriptions.create({
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
      });
      logger.info({ orgId: _authenticatedOrgId, planKey }, "[PublicBilling] finalize: subscription persisted to DB");
    } catch (_fcPodErr) {
      logger.warn({ _fcPodErr }, "[PublicBilling] finalize: persistOrgData non-fatal (webhook will sync)");
    }

    // ── Pre-registration: activate new user account (fire-and-forget) ─────────
    const _fcActToken = preRegisterToken || intentMeta["pre_register_token"] || "";
    if (_fcActToken) {
      (async () => {
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
          const _fcAOrgId = _fcAEmail;

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
          if (_fcMailer) {
            await _fcMailer.sendActivationMagicLink({
              to:           _fcAEmail,
              name:         _fcSignup["first_name"] || _fcAEmail.split("@")[0],
              plan:         planKey,
              magicLinkUrl: `${_fcPubUrl}/login-verify.html?token=${_fcMagicToken}`,
              isTrial:      grantTrial,
            }).catch((_fcMailErr: unknown) => logger.error({ _fcMailErr }, "[PublicBilling] finalize: activation email failed"));
            logger.info({ email: _fcAEmail }, "[PublicBilling] finalize: activation magic link sent");
          }
        } catch (_fcActTopErr) {
          logger.error({ _fcActTopErr }, "[PublicBilling] finalize: pre-reg activation failed (payment confirmed — manual activation may be needed)");
        }
      })();
    }

    res.json({ success: true, subscriptionId: planSubscription.id, addonSubscriptionId });
  } catch (err) {
    logger.error({ err }, "[PublicBilling] finalize-checkout failed");
    res.status(500).json({ error: "Erreur lors de la finalisation." });
  }
});

export default router;
