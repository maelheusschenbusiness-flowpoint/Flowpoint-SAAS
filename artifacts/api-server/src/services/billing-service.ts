import { pool } from "@workspace/db";
import { store } from "./store.js";
import { logger } from "../lib/logger.js";
import { PLAN_LIMITS, PLAN_AI_CREDITS, PLAN_PRICE_IDS, ADDON_PRICE_IDS } from "../lib/plans.js";

const ORG_ID = "default";

// ── Plan configuration (public) ───────────────────────────────────────────────
export const PLAN_CONFIG = {
  standard: {
    id: "standard", name: "Standard", monthlyPrice: 29, annualPrice: 24,
    badge: "Démarrage", tagline: "Idéal pour les indépendants et PME",
    color: "#64748b", popular: false,
    limits: PLAN_LIMITS.standard,
    aiCredits: PLAN_AI_CREDITS.standard,
    features: [
      "Jusqu'à 30 audits/mois", "3 monitors", "30 rapports PDF", "1 utilisateur",
      "Local SEO basique", "Support email 48h", "Rétention 30 jours", "Export CSV",
    ],
    addons: [],
    highlighted: [],
  },
  pro: {
    id: "pro", name: "Pro", monthlyPrice: 79, annualPrice: 65,
    badge: "Recommandé", tagline: "Pour les agences et équipes growth",
    color: "#2563eb", popular: true,
    limits: PLAN_LIMITS.pro,
    aiCredits: PLAN_AI_CREDITS.pro,
    features: [
      "300 audits/mois", "50 monitors", "Rapports illimités", "5 utilisateurs",
      "IA Insights Pro", "Local SEO avancé", "White-label rapports", "API Access",
      "Support prioritaire 4h", "Rétention 90 jours", "Analytics concurrents",
      "Webhooks", "2FA / MFA", "Audit log",
    ],
    addons: ["whiteLabel", "prioritySupport", "extraSeats", "monitorsPack50"],
    highlighted: ["IA Insights Pro", "50 monitors"],
  },
  ultra: {
    id: "ultra", name: "Ultra", monthlyPrice: 149, annualPrice: 120,
    badge: "Enterprise", tagline: "Pour les grandes agences et entreprises",
    color: "#7c3aed", popular: false,
    limits: PLAN_LIMITS.ultra,
    aiCredits: PLAN_AI_CREDITS.ultra,
    features: [
      "Audits illimités", "Monitors illimités", "Multi-workspace", "Sièges illimités",
      "IA Stratégiste complet", "White-label portail", "SSO Enterprise", "API illimitée",
      "Custom domain", "SLA 99.9% garanti", "Support dédié < 1h", "Rétention 365 jours",
      "Onboarding dédié", "Agency Lab complet", "Facturation client",
    ],
    addons: [],
    highlighted: ["Audits illimités", "SLA 99.9%"],
  },
};

// ── Add-on catalog ────────────────────────────────────────────────────────────
export const ADDON_CATALOG = [
  { id: "aiCredits",       name: "Crédits IA",         icon: "🤖", price: 19,  unit: "+50k crédits/mois",  desc: "Crédits IA supplémentaires pour les analyses, rapports et recommandations" },
  { id: "monitorsPack50",  name: "Extra Monitors",      icon: "📡", price: 9,   unit: "+50 monitors",        desc: "Ajoutez 50 monitors supplémentaires à votre abonnement" },
  { id: "extraSeats",      name: "Sièges équipe",       icon: "👥", price: 12,  unit: "par siège/mois",     desc: "Ajoutez des membres d'équipe supplémentaires" },
  { id: "exportsPack1000", name: "Exports pack",        icon: "📤", price: 14,  unit: "+1000 exports/mois", desc: "Exports CSV/Excel supplémentaires" },
  { id: "pdfPack200",      name: "PDF Reports pack",    icon: "📄", price: 12,  unit: "+200 PDF/mois",      desc: "Rapports PDF supplémentaires avec white-label" },
  { id: "prioritySupport", name: "Support Prioritaire", icon: "⚡", price: 29,  unit: "< 2h garanti",        desc: "Support technique prioritaire avec SLA 2h" },
  { id: "whiteLabel",      name: "White-Label",         icon: "🏷️", price: 39,  unit: "portail complet",    desc: "Portail client entièrement brandé à votre image" },
  { id: "retention90d",    name: "Rétention 90 jours",  icon: "🗄️", price: 14,  unit: "/mois",              desc: "Conservation des données audit et analytics sur 90 jours" },
  { id: "retention365d",   name: "Rétention 365 jours", icon: "🏛️", price: 29,  unit: "/mois",              desc: "Conservation des données sur 12 mois avec historique complet" },
];

// ── Usage tracking ────────────────────────────────────────────────────────────
export async function getUsageSummary(orgId: string = ORG_ID) {
  const me = store.me;
  const plan = (me.plan || "standard").toLowerCase();
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.standard;

  const extraMonitors = (me.addons as Record<string, number>)["monitorsPack50"] || 0;
  const extraSeats = (me.addons as Record<string, number>)["extraSeats"] || 0;

  const client = await pool.connect();
  try {
    const [auditCount, monitorCount, reportCount, memberCount] = await Promise.all([
      client.query(`SELECT COUNT(*) FROM audits WHERE created_at > date_trunc('month', now())`),
      client.query(`SELECT COUNT(*) FROM monitors`),
      client.query(`SELECT COUNT(*) FROM reports WHERE created_at > date_trunc('month', now())`),
      client.query(`SELECT COUNT(*) FROM team_members`),
    ]);

    const usage = (me as Record<string, unknown>).usage as Record<string, Record<string, number>> | undefined;
    const auditsUsed   = Number(auditCount.rows[0]?.count  ?? usage?.audit?.used   ?? 0);
    const monitorsUsed = Number(monitorCount.rows[0]?.count ?? usage?.monitor?.used ?? 0);
    const reportsUsed  = Number(reportCount.rows[0]?.count  ?? usage?.pdf?.used     ?? 0);
    const seatsUsed    = Number(memberCount.rows[0]?.count  ?? 1);

    return {
      plan,
      billing_period: new Date().toISOString().slice(0, 7),
      usage: {
        audits:   { used: auditsUsed,   limit: limits.audits,   pct: Math.round((auditsUsed   / Math.max(limits.audits,   1)) * 100) },
        monitors: { used: monitorsUsed, limit: limits.monitors + extraMonitors * 50, pct: Math.round((monitorsUsed / Math.max(limits.monitors, 1)) * 100) },
        reports:  { used: reportsUsed,  limit: limits.reports,  pct: Math.round((reportsUsed  / Math.max(limits.reports,  1)) * 100) },
        exports:  { used: usage?.exports?.used ?? 0, limit: limits.exports, pct: Math.round(((usage?.exports?.used ?? 0) / Math.max(limits.exports, 1)) * 100) },
        seats:    { used: seatsUsed,    limit: limits.teamMembers + extraSeats, pct: Math.round((seatsUsed / Math.max(limits.teamMembers, 1)) * 100) },
      },
      addons: me.addons,
      subscriptionStatus: me.subscriptionStatus,
      trialEndsAt: me.trialEndsAt,
    };
  } finally {
    client.release();
  }
}

// ── Quota enforcement ─────────────────────────────────────────────────────────
export function checkQuota(resource: "audits" | "monitors" | "reports" | "exports" | "seats"): { allowed: boolean; used: number; limit: number; plan: string } {
  const me = store.me;
  const plan = (me.plan || "standard").toLowerCase();
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.standard;

  const u = (me as Record<string, unknown>).usage as Record<string, Record<string, number>> | undefined;
  const map: Record<string, { used: number; limit: number }> = {
    audits:   { used: u?.audit?.used   ?? 0, limit: u?.audit?.limit   || limits.audits },
    monitors: { used: u?.monitor?.used ?? 0, limit: u?.monitor?.limit || limits.monitors },
    reports:  { used: u?.pdf?.used     ?? 0, limit: u?.pdf?.limit     || limits.reports },
    exports:  { used: u?.exports?.used ?? 0, limit: u?.exports?.limit || limits.exports },
    seats:    { used: 1,                     limit: limits.teamMembers },
  };

  const q = map[resource];
  return { allowed: !q || q.used < q.limit, used: q?.used ?? 0, limit: q?.limit ?? 0, plan };
}

// ── Billing events / MRR tracking ─────────────────────────────────────────────
export async function trackBillingEvent(type: string, data: Record<string, unknown>) {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO billing_events (org_id, type, amount, currency, plan, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [ORG_ID, type, data.amount ?? 0, data.currency ?? "eur", data.plan ?? store.me.plan, JSON.stringify(data)]
    );
  } catch (err) {
    logger.warn({ err }, "[Billing] Failed to track billing event");
  } finally {
    client.release();
  }
}

export async function getMRRData() {
  const client = await pool.connect();
  try {
    const rows = await client.query(`
      SELECT
        date_trunc('month', created_at) AS month,
        SUM(CASE WHEN type IN ('subscription_created','subscription_renewed') THEN amount ELSE 0 END) AS mrr,
        SUM(CASE WHEN type = 'subscription_canceled' THEN amount ELSE 0 END) AS churn,
        COUNT(CASE WHEN type = 'subscription_created' THEN 1 END) AS new_subs,
        COUNT(CASE WHEN type = 'subscription_canceled' THEN 1 END) AS cancels
      FROM billing_events
      WHERE created_at > now() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12
    `);

    const me = store.me;
    const plan = (me.plan || "standard").toLowerCase();
    const PLAN_PRICES: Record<string, number> = { standard: 29, pro: 79, ultra: 149 };
    const currentMRR = PLAN_PRICES[plan] || 0;

    return {
      currentMRR,
      arr: currentMRR * 12,
      history: rows.rows.map(r => ({
        month: String(r.month).slice(0, 7),
        mrr: Number(r.mrr) || currentMRR,
        churn: Number(r.churn) || 0,
        newSubs: Number(r.new_subs) || 0,
        cancels: Number(r.cancels) || 0,
      })),
    };
  } catch {
    const me = store.me;
    const plan = (me.plan || "standard").toLowerCase();
    const PLAN_PRICES: Record<string, number> = { standard: 29, pro: 79, ultra: 149 };
    const currentMRR = PLAN_PRICES[plan] || 0;
    return { currentMRR, arr: currentMRR * 12, history: [] };
  } finally {
    client.release();
  }
}

export async function getSubscriptionAnalytics() {
  const mrr = await getMRRData();
  const usage = await getUsageSummary();
  const me = store.me;

  const trialDaysLeft = me.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(me.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  return {
    ...mrr,
    usage,
    plan: me.plan,
    subscriptionStatus: me.subscriptionStatus,
    trialDaysLeft,
    stripeCustomerId: me.stripeCustomerId,
    addons: me.addons,
  };
}

// ── Trial management ──────────────────────────────────────────────────────────
export async function startTrial(plan: string = "pro", days: number = 14) {
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("STRIPE_SECRET_KEY is required in production — cannot activate trial");
    }
    const trialEnd = new Date(Date.now() + days * 86400000).toISOString();
    store.me.plan = plan;
    store.me.subscriptionStatus = "trialing";
    store.me.trialEndsAt = trialEnd;
    store.broadcastPlanUpdate(plan);
    logger.info({ plan, days }, "[Billing] Trial activated (dev mode — no Stripe key)");
    return { ok: true, trialEndsAt: trialEnd, plan, mock: true };
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    const planPriceId = PLAN_PRICE_IDS[plan.toLowerCase()];
    if (!planPriceId) {
      const trialEnd = new Date(Date.now() + days * 86400000).toISOString();
      store.me.plan = plan;
      store.me.subscriptionStatus = "trialing";
      store.me.trialEndsAt = trialEnd;
      store.broadcastPlanUpdate(plan);
      return { ok: true, trialEndsAt: trialEnd, plan, noPrice: true };
    }

    let customerId = store.me.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({ name: store.me.firstName, metadata: { plan } });
      customerId = customer.id;
      store.me.stripeCustomerId = customerId;
    }

    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: planPriceId }],
      trial_period_days: days,
    });

    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : new Date(Date.now() + days * 86400000).toISOString();
    store.me.plan = plan;
    store.me.subscriptionStatus = "trialing";
    store.me.trialEndsAt = trialEnd;
    store.broadcastPlanUpdate(plan);

    logger.info({ plan, days, subId: sub.id }, "[Billing] Stripe trial started");
    return { ok: true, trialEndsAt: trialEnd, subscriptionId: sub.id, plan };
  } catch (err) {
    logger.error({ err }, "[Billing] Failed to start trial");
    throw err;
  }
}

// ── Coupon validation ─────────────────────────────────────────────────────────
export async function validateCoupon(code: string) {
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      return { valid: false, error: "Payment service not configured" };
    }
    if (code === "FLOWPOINT20") return { valid: true, discount: 20, type: "percent", name: "Demo coupon (dev)", mock: true };
    return { valid: false, error: "Code invalide (mode dev)" };
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
    const coupon = await stripe.coupons.retrieve(code);

    if (!coupon.valid) return { valid: false, error: "Code expiré ou invalide" };

    return {
      valid: true,
      id: coupon.id,
      name: coupon.name || code,
      type: coupon.percent_off ? "percent" : "amount",
      discount: coupon.percent_off || (coupon.amount_off ? coupon.amount_off / 100 : 0),
      duration: coupon.duration,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No such coupon")) return { valid: false, error: "Code coupon introuvable" };
    throw err;
  }
}

// ── Invoices ──────────────────────────────────────────────────────────────────
export async function getInvoices(limit: number = 20) {
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  if (!stripeKey || !store.me.stripeCustomerId) {
    return { invoices: [], mock: true };
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
    const invoices = await stripe.invoices.list({ customer: store.me.stripeCustomerId, limit });

    return {
      invoices: invoices.data.map(inv => ({
        id: inv.id,
        number: inv.number,
        amount: (inv.amount_paid || inv.amount_due) / 100,
        currency: inv.currency.toUpperCase(),
        status: inv.status,
        date: new Date((inv.created || 0) * 1000).toISOString(),
        pdfUrl: inv.invoice_pdf,
        hostedUrl: inv.hosted_invoice_url,
        period: {
          start: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
          end: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
        },
      })),
    };
  } catch (err) {
    logger.warn({ err }, "[Billing] Failed to fetch invoices");
    return { invoices: [], error: "Failed to fetch invoices" };
  }
}

// ── Feature gating ────────────────────────────────────────────────────────────
export const PLAN_FEATURES: Record<string, string[]> = {
  standard: ["audits:30", "monitors:3", "reports:30", "exports:30", "team:1", "email-support", "export-csv"],
  pro: [
    "audits:300", "monitors:50", "reports:300", "exports:300", "team:5",
    "ai-insights", "white-label-reports", "api-access", "priority-support",
    "retention:90", "competitor-analytics", "webhooks", "2fa", "audit-log",
    "keyword-tracking", "behavioral-ai", "cro",
  ],
  ultra: [
    "audits:unlimited", "monitors:unlimited", "reports:unlimited", "exports:unlimited", "team:unlimited",
    "ai-strategist", "white-label-portal", "sso-enterprise", "custom-domain", "sla-999",
    "retention:365", "multi-workspace", "agency-lab", "client-billing", "dedicated-onboarding",
    "forecasting", "revenue-leak", "automation", "market-intelligence",
  ],
};

export function hasFeature(feature: string, plan?: string): boolean {
  const p = (plan || store.me.plan || "standard").toLowerCase();
  const features = PLAN_FEATURES[p] || PLAN_FEATURES.standard;
  if (p === "ultra") return true;
  return features.some(f => f === feature || f.startsWith(feature + ":"));
}
