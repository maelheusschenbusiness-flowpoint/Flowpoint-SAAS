// stripe.js — FlowPoint Stripe (helpers + routes + webhook)
// Option B: séparé du index.js
// - Centralise plan + addons
// - Webhook en raw body
// - Applique les entitlements dans Mongo (User + Org)

const Stripe = require("stripe");

// ---- Add-ons price IDs (tes 10 add-ons) ----
const ADDON_PRICE_ID_TO_KEY = {
  // 1) monitors pack +50
  "price_1T6A839eqtbj6iPBTXCaiv0W": "monitorsPack50",

  // 2) extra seat
  "price_1T6AB29eqtbj6iPBYcWdWqXZ": "extraSeat",

  // 3) retention +90 days
  "price_1T6AFo9eqtbj6iPBz8eEQaWu": "retention90d",

  // 4) retention +365 days
  "price_1T6AIu9eqtbj6iPBKFWQBxXz": "retention365d",

  // 5) audits pack +200
  "price_1T6AMF9eqtbj6iPB03qrHCdP": "auditsPack200",

  // 6) audits pack +1000
  "price_1T6AOu9eqtbj6iPBxmABnPUs": "auditsPack1000",

  // 7) pdf pack +200
  "price_1T6ARC9eqtbj6iPBHu7KoqLn": "pdfPack200",

  // 8) exports pack +1000
  "price_1T6ATb9eqtbj6iPBTc6dCm5q": "exportsPack1000",

  // 9) priority support
  "price_1T6AXP9eqtbj6iPBVSbenAbR": "prioritySupport",

  // 10) custom domain
  "price_1T6AZ39eqtbj6iPB93TgRJvI": "customDomain",
};

// (optionnel) si tu ajoutes whiteLabel plus tard : mets ici
// const WHITE_LABEL_PRICE_ID = "price_...";

function buildStripeModule(ctx) {
  const {
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    BRAND_NAME,
    priceIdForPlan,
    quotasForPlan,
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

  // -------- Central function: appliquer plan + addons depuis une subscription --------
  function extractEntitlementsFromSubscription(sub) {
    const items = sub?.items?.data || [];

    // 1) Plan (standard/pro/ultra) = on prend le plus haut trouvé
    let plan = null;

    // 2) Addons (quantités/flags)
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
      whiteLabel: false, // prêt si tu ajoutes plus tard
    };

    // 3) Credits dérivés
    let creditAudits = 0;
    let creditPdf = 0;
    let creditExports = 0;

    // 4) Retention dérivée
    let retentionDays = 30;

    for (const it of items) {
      const priceId = it?.price?.id;
      const qty = Number(it?.quantity || 1);

      // Plan ?
      if (priceId === process.env.STRIPE_PRICE_ID_STANDARD) plan = plan ? plan : "standard";
      if (priceId === process.env.STRIPE_PRICE_ID_PRO) plan = planRank(plan) < 2 ? "pro" : plan;
      if (priceId === process.env.STRIPE_PRICE_ID_ULTRA) plan = "ultra";

      // Addon ?
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

    // Retention: 365 > 90 > base
    if (addons.retention365d) retentionDays = 365;
    else if (addons.retention90d) retentionDays = 90;

    return {
      plan: plan || null,
      addons,
      credits: { audits: creditAudits, pdf: creditPdf, exports: creditExports },
      retentionDays,
    };
  }

  function planRank(p) {
    const map = { standard: 1, pro: 2, ultra: 3 };
    return map[String(p || "").toLowerCase()] || 0;
  }

  async function applySubscriptionToUserAndOrg(sub) {
    const customerId = sub.customer;
    const user = await User.findOne({ stripeCustomerId: customerId });
    if (!user) return;

    // Applique plan + statut sur user
    const ent = extractEntitlementsFromSubscription(sub);

    user.stripeSubscriptionId = sub.id;
    user.subscriptionStatus = sub.status;
    user.lastPaymentStatus = sub.status;

    if (["active", "trialing"].includes(sub.status)) user.accessBlocked = false;
    if (["past_due", "unpaid", "canceled", "incomplete_expired"].includes(sub.status)) user.accessBlocked = true;

    if (ent.plan) user.plan = ent.plan;

    await ensureOrgForUser(user);
    await user.save();

    // Applique addons/credits/retention sur org
    const org = user.orgId ? await Org.findById(user.orgId) : null;
    if (org) {
      await ensureOrgDefaults(org);

      // billingAddons (stockage simple)
      org.billingAddons = org.billingAddons || {};
      org.billingAddons.monitorsPack50 = ent.addons.monitorsPack50 || 0;
      org.billingAddons.extraSeats = ent.addons.extraSeat || 0;

      org.billingAddons.prioritySupport = !!ent.addons.prioritySupport;
      org.billingAddons.customDomain = !!ent.addons.customDomain;

      // whiteLabel prêt (si tu ajoutes l’ID plus tard)
      org.billingAddons.whiteLabel = org.billingAddons.whiteLabel ?? true;

      // retention
      org.retentionDays = ent.retentionDays;

      // credits
      org.credits = org.credits || { audits: 0, pdf: 0, exports: 0 };
      org.credits.audits = Number(ent.credits.audits || 0);
      org.credits.pdf = Number(ent.credits.pdf || 0);
      org.credits.exports = Number(ent.credits.exports || 0);

      await org.save();
    }
  }

  // -------- Routes Stripe --------
  async function checkoutPlan(req, res) {
    try {
      const chosenPlan = String(req.body?.plan || "").toLowerCase();
      if (!["standard", "pro", "ultra"].includes(chosenPlan)) return res.status(400).json({ error: "Plan invalide" });

      const user = req.dbUser;
      const priceId = priceIdForPlan(chosenPlan);
      if (!priceId) return res.status(500).json({ error: "PriceId manquant" });

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

      const baseUrl = safeBaseUrl(req);

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: { trial_period_days: 14, metadata: { uid: user._id.toString(), plan: chosenPlan } },
        metadata: { uid: user._id.toString(), plan: chosenPlan },
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

      // IMPORTANT: applique aussi addons si la subscription contient déjà des items
      if (session.subscription) {
        await applySubscriptionToUserAndOrg(session.subscription);
      }

      await sendEmail({
        to: user.email,
        subject: `Bienvenue sur ${BRAND_NAME}`,
        text: `Ton essai est actif. Dashboard: ${process.env.PUBLIC_BASE_URL}/dashboard.html`,
        html: `<p>Ton essai est actif ✅</p><p>Dashboard: <a href="${process.env.PUBLIC_BASE_URL}/dashboard.html">${process.env.PUBLIC_BASE_URL}/dashboard.html</a></p>`,
      });

      return res.json({ ok: true, token: signToken(user) });
    } catch (e) {
      console.log("verify error:", e.message);
      return res.status(500).json({ error: "Erreur verify" });
    }
  }

  async function customerPortal(req, res) {
    try {
      const user = req.dbUser;
      if (!user.stripeCustomerId) return res.status(400).json({ error: "Customer Stripe manquant" });

      const baseUrl = safeBaseUrl(req);
      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${baseUrl}/dashboard.html`,
      });

      return res.json({ url: session.url });
    } catch (e) {
      console.log("portal error:", e.message);
      return res.status(500).json({ error: "Erreur portal" });
    }
  }

  // -------- Webhook handler (RAW) --------
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

      if (
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.created"
      ) {
        const sub = event.data.object;
        await applySubscriptionToUserAndOrg(sub);
      }

      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object;
        await User.updateOne(
          { stripeCustomerId: sub.customer },
          { $set: { accessBlocked: true, subscriptionStatus: "canceled", lastPaymentStatus: "subscription_deleted" } }
        );

        // Option: reset addons/credits sur org
        const user = await User.findOne({ stripeCustomerId: sub.customer });
        if (user?.orgId) {
          const org = await Org.findById(user.orgId);
          if (org) {
            await ensureOrgDefaults(org);
            org.billingAddons.monitorsPack50 = 0;
            org.billingAddons.extraSeats = 0;
            org.billingAddons.prioritySupport = false;
            org.billingAddons.customDomain = false;
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

  // expose
  return {
    stripe,
    webhookHandler,
    checkoutPlan,
    verifyCheckout,
    customerPortal,
  };
}

module.exports = { buildStripeModule };
