// stripe.js — FlowPoint Stripe (helpers + routes + webhook)
// ✅ Checkout plan + addons (redirect) + Embedded checkout + Portal config option

const Stripe = require("stripe");

// ---- Add-ons price IDs (TES 10 add-ons) ----
const ADDON_PRICE_ID_TO_KEY = {
  "price_1T6A839eqtbj6iPBTXCaiv0W": "monitorsPack50",
  "price_1T6AB29eqtbj6iPBYcWdWqXZ": "extraSeat",
  "price_1T6AFo9eqtbj6iPBz8eEQaWu": "retention90d",
  "price_1T6AIu9eqtbj6iPBKFWQBxXz": "retention365d",
  "price_1T6AMF9eqtbj6iPB03qrHCdP": "auditsPack200",
  "price_1T6AOu9eqtbj6iPBxmABnPUs": "auditsPack1000",
  "price_1T6ARC9eqtbj6iPBHu7KoqLn": "pdfPack200",
  "price_1T6ATb9eqtbj6iPBTc6dCm5q": "exportsPack1000",
  "price_1T6AXP9eqtbj6iPBVSbenAbR": "prioritySupport",
  "price_1T6AZ39eqtbj6iPB93TgRJvI": "customDomain",
};

// Optionnel: mapping inverse (utile pour valider côté serveur)
const ADDON_KEY_TO_PRICE_ID = Object.fromEntries(
  Object.entries(ADDON_PRICE_ID_TO_KEY).map(([priceId, key]) => [key, priceId])
);

function buildStripeModule(ctx) {
  const {
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    BRAND_NAME,
    priceIdForPlan,
    safeBaseUrl,
    signToken,
    auth,
    requireActive,
    ensureOrgForUser,
    ensureOrgDefaults,
    User,
    Org,
    sendEmail,
  } = ctx;

  const stripe = Stripe(STRIPE_SECRET_KEY);

  function planRank(p) {
    const map = { standard: 1, pro: 2, ultra: 3 };
    return map[String(p || "").toLowerCase()] || 0;
  }

  // -------- Entitlements depuis subscription --------
  function extractEntitlementsFromSubscription(sub) {
    const items = sub?.items?.data || [];
    let plan = null;

    const addons = {
      monitorsPack50: 0,
      extraSeat: 0,
      retention90d: false,
      retention365d: false,
      auditsPack200: 0,
      auditsPack1000: 0,
      pdfPack200: 0,
      exportsPack1000: 0,
      prioritySupport: false,
      customDomain: false,
    };

    let creditAudits = 0;
    let creditPdf = 0;
    let creditExports = 0;
    let retentionDays = 30;

    for (const it of items) {
      const priceId = it?.price?.id;
      const qty = Number(it?.quantity || 1);

      // Plans
      if (priceId === process.env.STRIPE_PRICE_ID_STANDARD) {
        if (planRank(plan) < 1) plan = "standard";
      }
      if (priceId === process.env.STRIPE_PRICE_ID_PRO) {
        if (planRank(plan) < 2) plan = "pro";
      }
      if (priceId === process.env.STRIPE_PRICE_ID_ULTRA) {
        plan = "ultra";
      }

      // Add-ons
      const addonKey = ADDON_PRICE_ID_TO_KEY[priceId];
      if (!addonKey) continue;

      switch (addonKey) {
        case "monitorsPack50":
          addons.monitorsPack50 += qty;
          break;
        case "extraSeat":
          addons.extraSeat += qty;
          break;
        case "retention90d":
          addons.retention90d = true;
          break;
        case "retention365d":
          addons.retention365d = true;
          break;

        case "auditsPack200":
          addons.auditsPack200 += qty;
          creditAudits += 200 * qty;
          break;
        case "auditsPack1000":
          addons.auditsPack1000 += qty;
          creditAudits += 1000 * qty;
          break;

        case "pdfPack200":
          addons.pdfPack200 += qty;
          creditPdf += 200 * qty;
          break;

        case "exportsPack1000":
          addons.exportsPack1000 += qty;
          creditExports += 1000 * qty;
          break;

        case "prioritySupport":
          addons.prioritySupport = true;
          break;

        case "customDomain":
          addons.customDomain = true;
          break;
        default:
          break;
      }
    }

    if (addons.retention365d) retentionDays = 365;
    else if (addons.retention90d) retentionDays = 90;

    return {
      plan: plan || null,
      addons,
      credits: { audits: creditAudits, pdf: creditPdf, exports: creditExports },
      retentionDays,
    };
  }

  async function applySubscriptionToUserAndOrg(sub) {
    const customerId = sub.customer;
    const user = await User.findOne({ stripeCustomerId: customerId });
    if (!user) return;

    const ent = extractEntitlementsFromSubscription(sub);

    user.stripeSubscriptionId = sub.id;
    user.subscriptionStatus = sub.status;
    user.lastPaymentStatus = sub.status;

    if (["active", "trialing"].includes(sub.status)) user.accessBlocked = false;
    if (["past_due", "unpaid", "canceled", "incomplete_expired"].includes(sub.status)) user.accessBlocked = true;

    if (ent.plan) user.plan = ent.plan;

    await ensureOrgForUser(user);
    await user.save();

    const org = user.orgId ? await Org.findById(user.orgId) : null;
    if (!org) return;

    await ensureOrgDefaults(org);

    org.billingAddons.monitorsPack50 = ent.addons.monitorsPack50 || 0;
    org.billingAddons.extraSeats = ent.addons.extraSeat || 0;

    org.billingAddons.retention90d = !!ent.addons.retention90d;
    org.billingAddons.retention365d = !!ent.addons.retention365d;

    org.billingAddons.auditsPack200 = ent.addons.auditsPack200 || 0;
    org.billingAddons.auditsPack1000 = ent.addons.auditsPack1000 || 0;
    org.billingAddons.pdfPack200 = ent.addons.pdfPack200 || 0;
    org.billingAddons.exportsPack1000 = ent.addons.exportsPack1000 || 0;

    org.billingAddons.prioritySupport = !!ent.addons.prioritySupport;
    org.billingAddons.customDomain = !!ent.addons.customDomain;

    org.billingAddons.whiteLabel = true;

    org.retentionDays = ent.retentionDays;
    org.credits.audits = Number(ent.credits.audits || 0);
    org.credits.pdf = Number(ent.credits.pdf || 0);
    org.credits.exports = Number(ent.credits.exports || 0);

    await org.save();
  }

  // -------- Helpers: build line_items --------
  function normalizeAddonSelection(addonsRaw) {
    // Attendu côté front :
    // addons: [{ priceId: "...", quantity: 2 }, ...]
    // OU addons: { monitorsPack50: 1, prioritySupport: true, customDomain: true, ... }
    const lineItems = [];

    if (!addonsRaw) return lineItems;

    // format array
    if (Array.isArray(addonsRaw)) {
      for (const a of addonsRaw) {
        const priceId = String(a?.priceId || "").trim();
        if (!ADDON_PRICE_ID_TO_KEY[priceId]) continue;

        const q = Number(a?.quantity ?? 1);
        const qty = Number.isFinite(q) && q > 0 ? Math.floor(q) : 1;

        lineItems.push({ price: priceId, quantity: qty });
      }
      return lineItems;
    }

    // format object by key
    if (typeof addonsRaw === "object") {
      for (const [key, val] of Object.entries(addonsRaw)) {
        const priceId = ADDON_KEY_TO_PRICE_ID[key];
        if (!priceId) continue;

        if (typeof val === "boolean") {
          if (val) lineItems.push({ price: priceId, quantity: 1 });
          continue;
        }

        const q = Number(val);
        const qty = Number.isFinite(q) && q > 0 ? Math.floor(q) : 0;
        if (qty > 0) lineItems.push({ price: priceId, quantity: qty });
      }
    }

    return lineItems;
  }

  // =========================================================
  // ✅ ROUTE 1 — Checkout redirect (plan optionnel + addons)
  // Body:
  //  {
  //    plan?: "standard"|"pro"|"ultra"|null,
  //    addons?: array/object (voir normalizeAddonSelection)
  //  }
  // =========================================================
  async function checkoutPlan(req, res) {
    try {
      const chosenPlanRaw = req.body?.plan;
      const chosenPlan = chosenPlanRaw ? String(chosenPlanRaw).toLowerCase() : null;

      if (chosenPlan && !["standard", "pro", "ultra"].includes(chosenPlan)) {
        return res.status(400).json({ error: "Plan invalide" });
      }

      const user = req.dbUser;

      // Customer
      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.companyName || user.name || undefined,
          metadata: { uid: user._id.toString() },
        });
        customerId = customer.id;
        user.stripeCustomerId = customerId;
        await user.save();
      }

      // line_items
      const lineItems = [];

      // Plan (optionnel)
      if (chosenPlan) {
        const planPriceId = priceIdForPlan(chosenPlan);
        if (!planPriceId) return res.status(500).json({ error: "PriceId plan manquant" });
        lineItems.push({ price: planPriceId, quantity: 1 });
      }

      // Add-ons
      const addonItems = normalizeAddonSelection(req.body?.addons);
      lineItems.push(...addonItems);

      if (!lineItems.length) {
        return res.status(400).json({ error: "Aucun plan ni add-on sélectionné" });
      }

      const baseUrl = safeBaseUrl(req);

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: lineItems,

        // Trial uniquement si tu veux trial sur plan (sinon enlève)
        subscription_data: {
          trial_period_days: chosenPlan ? 14 : undefined,
          metadata: {
            uid: user._id.toString(),
            plan: chosenPlan || "",
          },
        },

        metadata: {
          uid: user._id.toString(),
          plan: chosenPlan || "",
        },

        success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${baseUrl}/cancel.html`,
        allow_promotion_codes: true,
      });

      return res.json({ url: session.url });
    } catch (e) {
      console.log("checkout error:", e.message);
      return res.status(500).json({ error: "Erreur Stripe checkout" });
    }
  }

  // =========================================================
  // ✅ ROUTE 2 — Embedded Checkout (retourne clientSecret)
  // (Stripe: ui_mode=embedded + return_url)  [oai_citation:1‡docs.stripe.com](https://docs.stripe.com/payments/accept-a-payment?locale=en-GB&payment-ui=checkout&ui=embedded-form)
  // Body:
  //  { plan?: "...", addons?: ... }
  // =========================================================
  async function checkoutEmbedded(req, res) {
    try {
      const chosenPlanRaw = req.body?.plan;
      const chosenPlan = chosenPlanRaw ? String(chosenPlanRaw).toLowerCase() : null;

      if (chosenPlan && !["standard", "pro", "ultra"].includes(chosenPlan)) {
        return res.status(400).json({ error: "Plan invalide" });
      }

      const user = req.dbUser;

      let customerId = user.stripeCustomerId;
      if (!customerId) {
        const customer = await stripe.customers.create({
          email: user.email,
          name: user.companyName || user.name || undefined,
          metadata: { uid: user._id.toString() },
        });
        customerId = customer.id;
        user.stripeCustomerId = customerId;
        await user.save();
      }

      const lineItems = [];

      if (chosenPlan) {
        const planPriceId = priceIdForPlan(chosenPlan);
        if (!planPriceId) return res.status(500).json({ error: "PriceId plan manquant" });
        lineItems.push({ price: planPriceId, quantity: 1 });
      }

      lineItems.push(...normalizeAddonSelection(req.body?.addons));

      if (!lineItems.length) {
        return res.status(400).json({ error: "Aucun plan ni add-on sélectionné" });
      }

      const baseUrl = safeBaseUrl(req);

      const session = await stripe.checkout.sessions.create({
        ui_mode: "embedded", // ✅
        mode: "subscription",
        customer: customerId,
        line_items: lineItems,
        subscription_data: {
          trial_period_days: chosenPlan ? 14 : undefined,
          metadata: { uid: user._id.toString(), plan: chosenPlan || "" },
        },
        metadata: { uid: user._id.toString(), plan: chosenPlan || "" },

        // ✅ Embedded utilise return_url (pas success/cancel)  [oai_citation:2‡docs.stripe.com](https://docs.stripe.com/payments/accept-a-payment?locale=en-GB&payment-ui=checkout&ui=embedded-form)
        return_url: `${baseUrl}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
        allow_promotion_codes: true,
      });

      return res.json({ clientSecret: session.client_secret });
    } catch (e) {
      console.log("checkoutEmbedded error:", e.message);
      return res.status(500).json({ error: "Erreur Stripe embedded checkout" });
    }
  }

  async function verifyCheckout(req, res) {
    try {
      const sessionId = req.query.session_id;
      if (!sessionId) return res.status(400).json({ error: "session_id manquant" });

      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription", "customer"] });
      const uid = session.metadata?.uid || session.subscription?.metadata?.uid;
      if (!uid) return res.status(400).json({ error: "uid manquant" });

      const user = await User.findById(uid);
      if (!user) return res.status(404).json({ error: "User introuvable" });

      if (session.customer?.id) user.stripeCustomerId = session.customer.id;
      if (session.subscription?.id) user.stripeSubscriptionId = session.subscription.id;

      // Trial bookkeeping (si tu veux)
      if (!user.hasTrial) {
        user.hasTrial = true;
        user.trialStartedAt = new Date();
        user.trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
      }

      user.accessBlocked = false;
      user.lastPaymentStatus = "checkout_verified";
      user.subscriptionStatus = user.subscriptionStatus || "trialing";

      await ensureOrgForUser(user);
      await user.save();

      if (session.subscription) await applySubscriptionToUserAndOrg(session.subscription);

      return res.json({ ok: true, token: signToken(user) });
    } catch (e) {
      console.log("verify error:", e.message);
      return res.status(500).json({ error: "Erreur verify" });
    }
  }

  // =========================================================
  // ✅ Customer Portal
  // IMPORTANT: pour voir/éditer add-ons dans le Portal,
  // il faut configurer le portal côté Stripe (dashboard ou API config).
  // =========================================================
  async function customerPortal(req, res) {
    try {
      const user = req.dbUser;
      if (!user.stripeCustomerId) return res.status(400).json({ error: "Customer Stripe manquant" });

      const baseUrl = safeBaseUrl(req);

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${baseUrl}/dashboard.html`,
        // Optionnel si tu crées une configuration dédiée et que tu mets son ID en env :
        // configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID,
      });

      return res.json({ url: session.url });
    } catch (e) {
      console.log("portal error:", e.message);
      return res.status(500).json({ error: "Erreur portal" });
    }
  }

  async function webhookHandler(req, res) {
    try {
      if (!STRIPE_WEBHOOK_SECRET) return res.status(200).send("no webhook secret");

      const sig = req.headers["stripe-signature"];
      const event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);

      async function setBlockedByCustomer(customerId, blocked, status) {
        await User.updateOne(
          { stripeCustomerId: customerId },
          { $set: { accessBlocked: !!blocked, lastPaymentStatus: status || "" } }
        );
      }

      if (event.type === "invoice.payment_failed") {
        const inv = event.data.object;
        await setBlockedByCustomer(inv.customer, true, "payment_failed");
      }

      if (event.type === "invoice.payment_succeeded") {
        const inv = event.data.object;
        await setBlockedByCustomer(inv.customer, false, "payment_succeeded");
      }

      if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
        const sub = event.data.object;
        await applySubscriptionToUserAndOrg(sub);
      }

      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object;
        await User.updateOne(
          { stripeCustomerId: sub.customer },
          { $set: { accessBlocked: true, subscriptionStatus: "canceled", lastPaymentStatus: "subscription_deleted" } }
        );

        const user = await User.findOne({ stripeCustomerId: sub.customer });
        if (user?.orgId) {
          const org = await Org.findById(user.orgId);
          if (org) {
            await ensureOrgDefaults(org);

            org.billingAddons.monitorsPack50 = 0;
            org.billingAddons.extraSeats = 0;
            org.billingAddons.retention90d = false;
            org.billingAddons.retention365d = false;
            org.billingAddons.auditsPack200 = 0;
            org.billingAddons.auditsPack1000 = 0;
            org.billingAddons.pdfPack200 = 0;
            org.billingAddons.exportsPack1000 = 0;
            org.billingAddons.prioritySupport = false;
            org.billingAddons.customDomain = false;
            org.billingAddons.whiteLabel = true;

            org.retentionDays = 30;
            org.credits = { audits: 0, pdf: 0, exports: 0 };
            await org.save();
          }
        }
      }

      return res.json({ received: true });
    } catch (e) {
      console.log("webhook error:", e.message);
      return res.status(400).send(`Webhook Error: ${e.message}`);
    }
  }

  return {
    stripe,
    webhookHandler,
    checkoutPlan,
    checkoutEmbedded,
    verifyCheckout,
    customerPortal,
  };
}

module.exports = { buildStripeModule };
