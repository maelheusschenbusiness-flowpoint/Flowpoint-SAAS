// stripe.js — FlowPoint Stripe
// Checkout redirect + Embedded checkout + Portal + Webhook
// Sync plan/add-ons -> user/org
// FIX: extraSeat -> extraSeats
// FIX: verifyCheckout renvoie token + refreshToken
// FIX: verifyCheckout trial sync depuis Stripe
// FIX: subscription.deleted reset plus propre
// FIX: update abonnement existant + prorata
// FIX: sync quotas/addons/credits/retention

const Stripe = require("stripe");

// ---- Add-ons price IDs ----
const ADDON_PRICE_ID_TO_KEY = {
  "price_1T6A839eqtbj6iPBTXCaiv0W": "monitorsPack50",
  "price_1T6AB29eqtbj6iPBYcWdWqXZ": "extraSeats",
  "price_1T6AFo9eqtbj6iPBz8eEQaWu": "retention90d",
  "price_1T6AIu9eqtbj6iPBKFWQBxXz": "retention365d",
  "price_1T6AMF9eqtbj6iPB03qrHCdP": "auditsPack200",
  "price_1T6AOu9eqtbj6iPBxmABnPUs": "auditsPack1000",
  "price_1T6ARC9eqtbj6iPBHu7KoqLn": "pdfPack200",
  "price_1T6ATb9eqtbj6iPBTc6dCm5q": "exportsPack1000",
  "price_1T6AXP9eqtbj6iPBVSbenAbR": "prioritySupport",
  "price_1T6AZ39eqtbj6iPB93TgRJvI": "customDomain"
};

const ADDON_KEY_TO_PRICE_ID = Object.fromEntries(
  Object.entries(ADDON_PRICE_ID_TO_KEY).map(([priceId, key]) => [key, priceId])
);

function buildStripeModule(ctx) {
  const {
    STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET,
    priceIdForPlan,
    safeBaseUrl,
    signToken,
    issueAuthPayload,
    auth,
    requireActive,
    ensureOrgForUser,
    ensureOrgDefaults,
    User,
    Org,
    sendEmail
  } = ctx;

  if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY manquante dans buildStripeModule");
  }

  const stripe = Stripe(STRIPE_SECRET_KEY);

  function planRank(p) {
    const map = { standard: 1, pro: 2, ultra: 3 };
    return map[String(p || "").toLowerCase()] || 0;
  }

  function isActiveStatus(status) {
    const s = String(status || "").toLowerCase();
    return s === "active" || s === "trialing" || s === "past_due";
  }

  function isBlockingStatus(status) {
    const s = String(status || "").toLowerCase();
    return ["unpaid", "canceled", "incomplete_expired"].includes(s);
  }

  function clampInt(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.max(min, Math.min(max, Math.floor(x)));
  }

  function normalizeAddonSelection(addonsRaw) {
    const out = [];
    if (!addonsRaw) return out;

    if (Array.isArray(addonsRaw)) {
      for (const a of addonsRaw) {
        const priceId = String(a?.priceId || "").trim();
        if (!ADDON_PRICE_ID_TO_KEY[priceId]) continue;

        const q = Number(a?.quantity ?? 1);
        const qty = Number.isFinite(q) && q > 0 ? Math.floor(q) : 1;
        out.push({ price: priceId, quantity: qty });
      }
      return out;
    }

    if (typeof addonsRaw === "object") {
      for (let [k, v] of Object.entries(addonsRaw)) {
        if (k === "extraSeat") k = "extraSeats";

        let priceId = ADDON_KEY_TO_PRICE_ID[k];
        if (!priceId && ADDON_PRICE_ID_TO_KEY[k]) priceId = k;
        if (!priceId || !ADDON_PRICE_ID_TO_KEY[priceId]) continue;

        if (typeof v === "boolean") {
          if (v) out.push({ price: priceId, quantity: 1 });
          continue;
        }

        const q = Number(v);
        const qty = Number.isFinite(q) ? Math.floor(q) : 0;
        if (qty > 0) out.push({ price: priceId, quantity: qty });
      }
    }

    return out;
  }

  function buildDesiredPriceQty({ chosenPlan, addonsRaw }) {
    const desired = new Map();

    if (chosenPlan) {
      const planPriceId = priceIdForPlan(chosenPlan);
      if (planPriceId) desired.set(planPriceId, 1);
    }

    const addonItems = normalizeAddonSelection(addonsRaw);
    for (const it of addonItems) {
      desired.set(it.price, it.quantity || 1);
    }

    return desired;
  }

  function getPlanPriceIds() {
    return [
      process.env.STRIPE_PRICE_ID_STANDARD,
      process.env.STRIPE_PRICE_ID_PRO,
      process.env.STRIPE_PRICE_ID_ULTRA
    ].filter(Boolean);
  }

  async function getOrCreateCustomer(user) {
    if (user.stripeCustomerId) return user.stripeCustomerId;

    const customer = await stripe.customers.create({
      email: user.email,
      name: user.companyName || user.name || undefined,
      metadata: {
        uid: user._id.toString(),
        email: String(user.email || "").toLowerCase()
      }
    });

    user.stripeCustomerId = customer.id;
    await user.save();
    return customer.id;
  }

  async function getActiveSubscriptionForUser(user) {
    if (user.stripeSubscriptionId) {
      try {
        const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
          expand: [
            "items.data.price",
            "latest_invoice.payment_intent",
            "pending_setup_intent"
          ]
        });
        if (sub && isActiveStatus(sub.status)) return sub;
      } catch (_) {}
    }

    if (!user.stripeCustomerId) return null;

    const list = await stripe.subscriptions.list({
      customer: user.stripeCustomerId,
      status: "all",
      limit: 20,
      expand: [
        "data.items.data.price",
        "data.latest_invoice.payment_intent",
        "data.pending_setup_intent"
      ]
    });

    return (list.data || []).find((s) => isActiveStatus(s.status)) || null;
  }

  async function cancelOtherSubscriptions(user, keepSubId) {
    if (!user?.stripeCustomerId) return;

    try {
      const list = await stripe.subscriptions.list({
        customer: user.stripeCustomerId,
        status: "all",
        limit: 20
      });

      for (const sub of list.data || []) {
        if (sub.id === keepSubId) continue;
        const st = String(sub.status || "").toLowerCase();
        if (["active", "trialing", "past_due", "unpaid"].includes(st)) {
          try {
            await stripe.subscriptions.cancel(sub.id);
          } catch (_) {}
        }
      }
    } catch (_) {}
  }

  async function updateExistingSubscription({ sub, chosenPlan, addonsRaw }) {
    const desired = buildDesiredPriceQty({ chosenPlan, addonsRaw });
    const planPriceIds = new Set(getPlanPriceIds());
    const addonPriceIds = new Set(Object.keys(ADDON_PRICE_ID_TO_KEY));
    const items = sub.items?.data || [];
    const existingByPrice = new Map();

    for (const it of items) {
      const pid = it?.price?.id;
      if (pid) existingByPrice.set(pid, it);
    }

    const updates = [];

    if (chosenPlan) {
      const wantedPlanPrice = priceIdForPlan(chosenPlan);
      if (!wantedPlanPrice) throw new Error("PriceId plan manquant");

      for (const it of items) {
        const pid = it?.price?.id;
        if (pid && planPriceIds.has(pid) && pid !== wantedPlanPrice) {
          updates.push({ id: it.id, deleted: true });
        }
      }

      const existingPlanItem = existingByPrice.get(wantedPlanPrice);
      if (existingPlanItem) {
        updates.push({ id: existingPlanItem.id, quantity: 1 });
      } else {
        updates.push({ price: wantedPlanPrice, quantity: 1 });
      }
    }

    for (const it of items) {
      const pid = it?.price?.id;
      if (!pid || !addonPriceIds.has(pid)) continue;
      if (!desired.has(pid)) {
        updates.push({ id: it.id, deleted: true });
      }
    }

    for (const [pid, qty] of desired.entries()) {
      if (!addonPriceIds.has(pid)) continue;
      const ex = existingByPrice.get(pid);
      if (ex) {
        updates.push({ id: ex.id, quantity: qty });
      } else {
        updates.push({ price: pid, quantity: qty });
      }
    }

    if (!updates.length) {
      return { updated: false, subscription: sub };
    }

    const updated = await stripe.subscriptions.update(sub.id, {
      items: updates,
      proration_behavior: "create_prorations",
      payment_behavior: "default_incomplete",
      expand: [
        "latest_invoice.payment_intent",
        "items.data.price",
        "pending_setup_intent"
      ]
    });

    return { updated: true, subscription: updated };
  }

  function extractEntitlementsFromSubscription(sub) {
    const items = sub?.items?.data || [];
    let plan = null;

    const addons = {
      monitorsPack50: 0,
      extraSeats: 0,
      retention90d: false,
      retention365d: false,
      auditsPack200: 0,
      auditsPack1000: 0,
      pdfPack200: 0,
      exportsPack1000: 0,
      prioritySupport: false,
      customDomain: false
    };

    let creditAudits = 0;
    let creditPdf = 0;
    let creditExports = 0;
    let retentionDays = 30;

    for (const it of items) {
      const priceId = it?.price?.id;
      const qty = Number(it?.quantity || 1);

      if (priceId === process.env.STRIPE_PRICE_ID_STANDARD && planRank(plan) < 1) {
        plan = "standard";
      }
      if (priceId === process.env.STRIPE_PRICE_ID_PRO && planRank(plan) < 2) {
        plan = "pro";
      }
      if (priceId === process.env.STRIPE_PRICE_ID_ULTRA) {
        plan = "ultra";
      }

      const addonKey = ADDON_PRICE_ID_TO_KEY[priceId];
      if (!addonKey) continue;

      switch (addonKey) {
        case "monitorsPack50":
          addons.monitorsPack50 += qty;
          break;
        case "extraSeats":
          addons.extraSeats += qty;
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
      }
    }

    if (addons.retention365d) retentionDays = 365;
    else if (addons.retention90d) retentionDays = 90;

    return {
      plan: plan || null,
      addons,
      credits: {
        audits: creditAudits,
        pdf: creditPdf,
        exports: creditExports
      },
      retentionDays
    };
  }

  async function syncOrgFromEntitlements(org, ent) {
    await ensureOrgDefaults(org);

    org.billingAddons.monitorsPack50 = Number(ent.addons.monitorsPack50 || 0);
    org.billingAddons.extraSeats = Number(ent.addons.extraSeats || 0);
    org.billingAddons.retention90d = !!ent.addons.retention90d;
    org.billingAddons.retention365d = !!ent.addons.retention365d;
    org.billingAddons.auditsPack200 = Number(ent.addons.auditsPack200 || 0);
    org.billingAddons.auditsPack1000 = Number(ent.addons.auditsPack1000 || 0);
    org.billingAddons.pdfPack200 = Number(ent.addons.pdfPack200 || 0);
    org.billingAddons.exportsPack1000 = Number(ent.addons.exportsPack1000 || 0);
    org.billingAddons.prioritySupport = !!ent.addons.prioritySupport;
    org.billingAddons.customDomain = !!ent.addons.customDomain;
    org.billingAddons.whiteLabel = true;

    org.retentionDays = clampInt(ent.retentionDays || 30, 7, 3650);
    org.credits.audits = Number(ent.credits.audits || 0);
    org.credits.pdf = Number(ent.credits.pdf || 0);
    org.credits.exports = Number(ent.credits.exports || 0);

    await org.save();
  }

  async function applySubscriptionToUserAndOrg(sub) {
    const customerId = sub.customer;
    const user = await User.findOne({ stripeCustomerId: customerId });
    if (!user) return null;

    const ent = extractEntitlementsFromSubscription(sub);

    user.stripeSubscriptionId = sub.id;
    user.subscriptionStatus = sub.status;
    user.lastPaymentStatus = sub.status;

    const st = String(sub.status || "").toLowerCase();
    if (isActiveStatus(st)) {
      user.accessBlocked = false;
    }
    if (isBlockingStatus(st)) {
      user.accessBlocked = true;
    }

    if (ent.plan) {
      user.plan = ent.plan;
    }

    if (sub.trial_end) {
      user.hasTrial = true;
      user.trialEndsAt = new Date(sub.trial_end * 1000);
      if (!user.trialStartedAt && sub.trial_start) {
        user.trialStartedAt = new Date(sub.trial_start * 1000);
      }
    }

    await ensureOrgForUser(user);
    await user.save();

    const org = user.orgId ? await Org.findById(user.orgId) : null;
    if (!org) return user;

    await syncOrgFromEntitlements(org, ent);
    return user;
  }

  async function resetOrgAfterSubscriptionDelete(user) {
    if (!user?.orgId) return;

    const org = await Org.findById(user.orgId);
    if (!org) return;

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

  function buildCheckoutLineItems({ chosenPlan, addonsRaw }) {
    const desired = buildDesiredPriceQty({ chosenPlan, addonsRaw });
    const lineItems = [];

    for (const [pid, qty] of desired.entries()) {
      lineItems.push({ price: pid, quantity: qty });
    }

    return lineItems;
  }

  function getPaymentIntentInfo(subscription) {
    const pi = subscription?.latest_invoice?.payment_intent;
    if (pi && pi.client_secret && pi.status && pi.status !== "succeeded") {
      return {
        paymentIntentClientSecret: pi.client_secret,
        paymentIntentStatus: pi.status
      };
    }
    return null;
  }

  async function checkoutPlan(req, res) {
    try {
      const chosenPlanRaw = req.body?.plan;
      const chosenPlan = chosenPlanRaw ? String(chosenPlanRaw).toLowerCase() : null;

      if (chosenPlan && !["standard", "pro", "ultra"].includes(chosenPlan)) {
        return res.status(400).json({ error: "Plan invalide" });
      }

      const user = req.dbUser;
      await getOrCreateCustomer(user);

      const activeSub = await getActiveSubscriptionForUser(user);

      if (activeSub) {
        const { updated, subscription } = await updateExistingSubscription({
          sub: activeSub,
          chosenPlan,
          addonsRaw: req.body?.addons
        });

        await applySubscriptionToUserAndOrg(subscription);

        const piInfo = getPaymentIntentInfo(subscription);
        if (piInfo) {
          return res.json({
            ok: true,
            updated,
            subscriptionId: subscription.id,
            ...piInfo
          });
        }

        return res.json({
          ok: true,
          updated,
          subscriptionId: subscription.id
        });
      }

      const lineItems = buildCheckoutLineItems({
        chosenPlan,
        addonsRaw: req.body?.addons
      });

      if (!lineItems.length) {
        return res.status(400).json({ error: "Aucun plan ni add-on sélectionné" });
      }

      const baseUrl = safeBaseUrl(req);
      const cancelNext = encodeURIComponent("/pricing.html");

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: user.stripeCustomerId,
        line_items: lineItems,
        subscription_data: {
          trial_period_days: chosenPlan ? 14 : undefined,
          metadata: {
            uid: user._id.toString(),
            plan: chosenPlan || ""
          }
        },
        metadata: {
          uid: user._id.toString(),
          plan: chosenPlan || ""
        },
        success_url: `${baseUrl}/success.html?session_id={CHECKOUT_SESSION_ID}&next=${encodeURIComponent("/dashboard.html")}`,
        cancel_url: `${baseUrl}/cancel.html?next=${cancelNext}`,
        allow_promotion_codes: true
      });

      return res.json({ url: session.url });
    } catch (e) {
      console.log("checkoutPlan error:", e.message);
      return res.status(500).json({ error: "Erreur Stripe checkout" });
    }
  }

  async function checkoutEmbedded(req, res) {
    try {
      const chosenPlanRaw = req.body?.plan;
      const chosenPlan = chosenPlanRaw ? String(chosenPlanRaw).toLowerCase() : null;

      if (chosenPlan && !["standard", "pro", "ultra"].includes(chosenPlan)) {
        return res.status(400).json({ error: "Plan invalide" });
      }

      const user = req.dbUser;
      await getOrCreateCustomer(user);

      const activeSub = await getActiveSubscriptionForUser(user);

      if (activeSub) {
        const { updated, subscription } = await updateExistingSubscription({
          sub: activeSub,
          chosenPlan,
          addonsRaw: req.body?.addons
        });

        await applySubscriptionToUserAndOrg(subscription);

        const piInfo = getPaymentIntentInfo(subscription);
        if (piInfo) {
          return res.json({
            ok: true,
            updated,
            subscriptionId: subscription.id,
            ...piInfo
          });
        }

        return res.json({
          ok: true,
          updated,
          subscriptionId: subscription.id
        });
      }

      const lineItems = buildCheckoutLineItems({
        chosenPlan,
        addonsRaw: req.body?.addons
      });

      if (!lineItems.length) {
        return res.status(400).json({ error: "Aucun plan ni add-on sélectionné" });
      }

      const baseUrl = safeBaseUrl(req);

      const session = await stripe.checkout.sessions.create({
        ui_mode: "embedded",
        mode: "subscription",
        customer: user.stripeCustomerId,
        line_items: lineItems,
        subscription_data: {
          trial_period_days: chosenPlan ? 14 : undefined,
          metadata: {
            uid: user._id.toString(),
            plan: chosenPlan || ""
          }
        },
        metadata: {
          uid: user._id.toString(),
          plan: chosenPlan || ""
        },
        return_url: `${baseUrl}/checkout-return.html?session_id={CHECKOUT_SESSION_ID}`,
        allow_promotion_codes: true
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
      if (!sessionId) {
        return res.status(400).json({ error: "session_id manquant" });
      }

      const session = await stripe.checkout.sessions.retrieve(sessionId, {
        expand: ["subscription", "customer"]
      });

      const uid = session.metadata?.uid || session.subscription?.metadata?.uid;
      if (!uid) {
        return res.status(400).json({ error: "uid manquant" });
      }

      const user = await User.findById(uid);
      if (!user) {
        return res.status(404).json({ error: "User introuvable" });
      }

      if (session.customer?.id) user.stripeCustomerId = session.customer.id;
      if (session.subscription?.id) user.stripeSubscriptionId = session.subscription.id;

      user.accessBlocked = false;
      user.lastPaymentStatus = "checkout_verified";

      if (session.subscription) {
        await applySubscriptionToUserAndOrg(session.subscription);

        const subStatus = String(session.subscription.status || "").toLowerCase();
        user.subscriptionStatus = subStatus || user.subscriptionStatus;

        if (session.subscription.trial_end) {
          user.hasTrial = true;
          user.trialEndsAt = new Date(session.subscription.trial_end * 1000);
          if (!user.trialStartedAt && session.subscription.trial_start) {
            user.trialStartedAt = new Date(session.subscription.trial_start * 1000);
          }
        }
      }

      await ensureOrgForUser(user);

      if (user.orgId) {
        const org = await Org.findById(user.orgId);
        if (org) await ensureOrgDefaults(org);
      }

      await user.save();
      await cancelOtherSubscriptions(user, user.stripeSubscriptionId);

      const authPayload = issueAuthPayload(user);

      return res.json({
        ok: true,
        token: authPayload.token,
        refreshToken: authPayload.refreshToken
      });
    } catch (e) {
      console.log("verifyCheckout error:", e.message);
      return res.status(500).json({ error: "Erreur verify" });
    }
  }

  async function customerPortal(req, res) {
    try {
      const user = req.dbUser;
      if (!user.stripeCustomerId) {
        return res.status(400).json({ error: "Customer Stripe manquant" });
      }

      const baseUrl = safeBaseUrl(req);

      const session = await stripe.billingPortal.sessions.create({
        customer: user.stripeCustomerId,
        return_url: `${baseUrl}/dashboard.html`
      });

      return res.json({ url: session.url });
    } catch (e) {
      console.log("customerPortal error:", e.message);
      return res.status(500).json({ error: "Erreur portal" });
    }
  }

  async function sendOptionalBillingEmail({ user, subject, text, html }) {
    if (!sendEmail || !user?.email) return;
    try {
      await sendEmail({
        to: user.email,
        subject,
        text,
        html
      });
    } catch (_) {}
  }

  async function webhookHandler(req, res) {
    try {
      if (!STRIPE_WEBHOOK_SECRET) {
        return res.status(200).send("no webhook secret");
      }

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

        const user = await User.findOne({ stripeCustomerId: inv.customer });
        if (user) {
          await sendOptionalBillingEmail({
            user,
            subject: "FlowPoint — Paiement échoué",
            text: "Un paiement Stripe a échoué. Merci de mettre à jour votre moyen de paiement.",
            html: `
              <h2>FlowPoint — Paiement échoué</h2>
              <p>Un paiement Stripe a échoué.</p>
              <p>Merci de mettre à jour votre moyen de paiement depuis votre portail client.</p>
            `
          });
        }
      }

      if (event.type === "invoice.payment_succeeded") {
        const inv = event.data.object;

        await setBlockedByCustomer(inv.customer, false, "payment_succeeded");

        const user = await User.findOne({ stripeCustomerId: inv.customer });
        if (user?.stripeSubscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(user.stripeSubscriptionId, {
              expand: ["items.data.price", "latest_invoice.payment_intent"]
            });
            await applySubscriptionToUserAndOrg(sub);
          } catch (_) {}
        }
      }

      if (
        event.type === "customer.subscription.updated" ||
        event.type === "customer.subscription.created"
      ) {
        const sub = event.data.object;
        await applySubscriptionToUserAndOrg(sub);
      }

      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const subscriptionId = session.subscription;
        if (subscriptionId) {
          try {
            const sub = await stripe.subscriptions.retrieve(subscriptionId, {
              expand: ["items.data.price", "latest_invoice.payment_intent"]
            });
            await applySubscriptionToUserAndOrg(sub);
          } catch (_) {}
        }
      }

      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object;

        await User.updateOne(
          { stripeCustomerId: sub.customer },
          {
            $set: {
              accessBlocked: true,
              subscriptionStatus: "canceled",
              lastPaymentStatus: "subscription_deleted",
              stripeSubscriptionId: sub.id
            }
          }
        );

        const user = await User.findOne({ stripeCustomerId: sub.customer });
        if (user) {
          await resetOrgAfterSubscriptionDelete(user);

          await sendOptionalBillingEmail({
            user,
            subject: "FlowPoint — Abonnement supprimé",
            text: "Votre abonnement a été supprimé et l’accès premium a été désactivé.",
            html: `
              <h2>FlowPoint — Abonnement supprimé</h2>
              <p>Votre abonnement a été supprimé.</p>
              <p>L’accès premium et les add-ons liés à l’abonnement ont été réinitialisés.</p>
            `
          });
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
    customerPortal
  };
}

module.exports = { buildStripeModule };
