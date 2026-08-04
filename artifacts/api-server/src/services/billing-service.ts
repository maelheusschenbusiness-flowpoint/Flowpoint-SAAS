import { pool } from "@workspace/db";
import { store } from "./store.js";
import { logger } from "../lib/logger.js";
import { loadOrgSettings } from "./org-settings.js";
import { loadOrgData } from "./org-data.js";
import { loadBillingContext } from "./billing-context.js";
import { PLAN_DEFINITIONS, PLAN_LIMITS, PLAN_AI_CREDITS, PLAN_PRICE_IDS, ADDON_PRICE_IDS, PLAN_INCLUDED_ADDONS } from "../lib/plans.js";

/* ── Presentation-only fields not in PLAN_DEFINITIONS ── */
const _PLAN_PRESENTATION: Record<string, {
  color: string; popular: boolean; annualPrice: number;
  addons: string[]; highlighted: string[];
}> = {
  standard: { color: "#64748b", popular: false, annualPrice: 24, addons: [], highlighted: [] },
  pro:      { color: "#2563eb", popular: true,  annualPrice: 65, addons: ["whiteLabel","prioritySupport","extraSeats","monitorsPack50"], highlighted: ["IA Insights Pro","50 monitors"] },
  ultra:    { color: "#7c3aed", popular: false, annualPrice: 120, addons: [], highlighted: ["1 000 audits/mois","SLA 99.9%"] },
};

// ── Plan configuration (public) — derived from plans.ts PLAN_DEFINITIONS ─────
// NEVER add manual values here — edit PLAN_DEFINITIONS in lib/plans.ts instead.
export const PLAN_CONFIG = Object.fromEntries(
  Object.entries(PLAN_DEFINITIONS).map(([id, def]) => {
    const pres = _PLAN_PRESENTATION[id] ?? { color: "#64748b", popular: false, annualPrice: Math.round(def.priceEur * 0.8), addons: [], highlighted: [] };
    return [id, {
      id:           def.id,
      name:         def.name,
      monthlyPrice: def.priceEur,
      annualPrice:  pres.annualPrice,
      badge:        def.badge,
      tagline:      def.tagline,
      color:        pres.color,
      popular:      pres.popular,
      limits:       def.limits,
      aiCredits:    def.aiCredits,
      features:     def.features,
      locked:       def.locked,
      addons:       pres.addons,
      highlighted:  pres.highlighted,
    }];
  })
);

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
export async function getUsageSummary(orgId = "default") {
  // Bug-4 fix: use billing context (not raw orgData.addons) so plan-included addons
  // are overlaid and returned with includedInPlan:true flags.
  // Bug-5 fix: compute nextBillingDate from Stripe subscription or trialEndsAt.
  const billingCtx = await loadBillingContext(orgId).catch(async () => {
    // Fallback to raw org data if billing context fails
    const orgData = await loadOrgData(orgId).catch(() => null);
    return {
      plan: orgData?.plan ?? "standard",
      addons: (orgData?.addons ?? {}) as Record<string, boolean | number>,
      subscriptionStatus: orgData?.subscriptionStatus ?? "inactive",
      trialEndsAt: orgData?.trialEndsAt ?? null,
      stripeSubscriptionId: orgData?.stripeSubscriptionId ?? null,
      stripeCustomerId: orgData?.stripeCustomerId ?? null,
      trialConsumedAt: null,
    };
  });

  const plan = (billingCtx.plan || "standard").toLowerCase();
  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS["standard"]!;

  // Build addon list with includedInPlan flag for the dashboard
  const planIncluded = PLAN_INCLUDED_ADDONS[plan] ?? new Set<string>();
  const addonsWithFlags: Record<string, { active: boolean | number; includedInPlan: boolean }> = {};
  for (const [key, val] of Object.entries(billingCtx.addons)) {
    addonsWithFlags[key] = {
      active: val,
      includedInPlan: planIncluded.has(key),
    };
  }
  // Ensure all plan-included addons appear even if not explicitly in org_addons
  for (const key of planIncluded) {
    if (!(key in addonsWithFlags)) {
      addonsWithFlags[key] = { active: true, includedInPlan: true };
    }
  }

  const extraMonitors = Number(billingCtx.addons["monitorsPack50"] ?? 0);
  const extraSeats    = Number(billingCtx.addons["extraSeats"]    ?? 0);

  // Bug-5 fix: resolve nextBillingDate from Stripe when subscription exists
  let nextBillingDate: string | null = null;
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  if (stripeKey && billingCtx.stripeSubscriptionId) {
    try {
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
      const sub = await stripe.subscriptions.retrieve(billingCtx.stripeSubscriptionId) as unknown as {
        status: string;
        trial_end: number | null;
        current_period_end: number;
      };
      if (sub.status === "trialing" && sub.trial_end) {
        nextBillingDate = new Date(sub.trial_end * 1000).toISOString();
      } else if (sub.current_period_end) {
        nextBillingDate = new Date(sub.current_period_end * 1000).toISOString();
      }
    } catch {
      // Non-fatal — fall back to DB trialEndsAt
      nextBillingDate = billingCtx.trialEndsAt ?? null;
    }
  } else if (billingCtx.subscriptionStatus === "trialing" && billingCtx.trialEndsAt) {
    nextBillingDate = billingCtx.trialEndsAt;
  }

  const client = await pool.connect();
  try {
    const safeCount = async (query: string, params: unknown[]): Promise<number> => {
      try {
        const r = await client.query(query, params);
        return Number(r.rows[0]?.count ?? 0);
      } catch { return 0; }
    };
    const [auditsUsed, monitorsUsed, reportsUsed, seatsUsed, exportsUsed, pdfsUsed] = await Promise.all([
      safeCount(`SELECT COUNT(*) FROM audits WHERE org_id=$1 AND created_at > date_trunc('month', now())`, [orgId]),
      safeCount(`SELECT COUNT(*) FROM monitors WHERE org_id=$1`, [orgId]),
      safeCount(`SELECT COUNT(*) FROM reports WHERE org_id=$1 AND created_at > date_trunc('month', now())`, [orgId]),
      safeCount(`SELECT COUNT(*) FROM team_members WHERE org_id=$1`, [orgId]),
      safeCount(`SELECT COUNT(*) FROM report_exports WHERE org_id=$1 AND created_at > date_trunc('month', now())`, [orgId]),
      safeCount(`SELECT COUNT(*) FROM report_exports WHERE org_id=$1 AND created_at > date_trunc('month', now()) AND (format='pdf' OR format IS NULL)`, [orgId]),
    ]);

    return {
      plan,
      billing_period: new Date().toISOString().slice(0, 7),
      usage: {
        audits:   { used: auditsUsed,   limit: limits.audits,   pct: Math.round((auditsUsed   / Math.max(limits.audits,   1)) * 100) },
        monitors: { used: monitorsUsed, limit: limits.monitors + extraMonitors * 50, pct: Math.round((monitorsUsed / Math.max(limits.monitors, 1)) * 100) },
        reports:  { used: reportsUsed,  limit: limits.reports,  pct: Math.round((reportsUsed  / Math.max(limits.reports,  1)) * 100) },
        exports:  { used: exportsUsed,  limit: limits.exports,  pct: Math.round((exportsUsed  / Math.max(limits.exports ?? limits.reports, 1)) * 100) },
        pdfs:     { used: pdfsUsed,     limit: limits.reports,  pct: Math.round((pdfsUsed     / Math.max(limits.reports,  1)) * 100) },
        seats:    { used: seatsUsed,    limit: limits.teamMembers + extraSeats, pct: Math.round((seatsUsed / Math.max(limits.teamMembers, 1)) * 100) },
      },
      // Bug-4 fix: addons includes plan-included items flagged with includedInPlan:true
      addons: addonsWithFlags,
      // Legacy flat addons map for backward-compat consumers
      addonsFlat: billingCtx.addons,
      subscriptionStatus: billingCtx.subscriptionStatus ?? "inactive",
      trialEndsAt: billingCtx.trialEndsAt ?? null,
      // Bug-5 fix: nextBillingDate exposed here
      nextBillingDate,
    };
  } finally {
    client.release();
  }
}

// ── Quota enforcement ─────────────────────────────────────────────────────────
/**
 * P0-6 FIX: checkQuota now loads plan and live usage from the database using
 * the org's actual orgId — never from store.me (global singleton).
 *
 * This ensures quotas are enforced per-tenant and survive process restarts.
 *
 * @param resource  — resource type to check
 * @param orgId     — the requesting org's ID (required — do NOT pass "default")
 */
export async function checkQuota(
  resource: "audits" | "monitors" | "reports" | "exports" | "seats",
  orgId: string
): Promise<{ allowed: boolean; used: number; limit: number; plan: string }> {

  // Safety net: if orgId is unresolved, fall back to standard limits (most restrictive)
  const resolvedOrgId = orgId && orgId !== "default" ? orgId : null;

  let plan = "standard";
  let extraMonitors = 0;
  let extraSeats = 0;

  if (resolvedOrgId) {
    try {
      const settings = await loadOrgSettings(resolvedOrgId);
      plan = (settings?.plan || "standard").toLowerCase();

      // Load add-ons from DB for accurate quota expansion
      // org_addons has no quantity column — each active row = 1 unit of the addon
      const { pool: pgPool } = await import("@workspace/db");
      const addonsResult = await pgPool.query<{ addon_key: string }>(
        `SELECT addon_key FROM org_addons WHERE org_id = $1 AND active = true`,
        [resolvedOrgId]
      );
      for (const row of addonsResult.rows) {
        if (row.addon_key === "monitorsPack50") extraMonitors += 50;
        if (row.addon_key === "extraSeats")     extraSeats    += 5;
      }
    } catch (err) {
      logger.warn({ err, orgId: resolvedOrgId }, "[Billing] checkQuota: DB load failed — using standard limits");
    }
  }

  const limits = PLAN_LIMITS[plan] || PLAN_LIMITS.standard;

  // Live usage counts from DB
  let usedCount = 0;
  let limit = 0;

  if (resolvedOrgId) {
    try {
      const { pool: pgPool } = await import("@workspace/db");
      const client = await pgPool.connect();
      try {
        switch (resource) {
          case "audits": {
            const r = await client.query(
              `SELECT COUNT(*)::int AS n FROM audits WHERE org_id=$1 AND created_at > date_trunc('month', now())`,
              [resolvedOrgId]
            );
            usedCount = Number(r.rows[0]?.n ?? 0);
            limit = limits.audits;
            break;
          }
          case "monitors": {
            const r = await client.query(
              `SELECT COUNT(*)::int AS n FROM monitors WHERE org_id=$1`,
              [resolvedOrgId]
            );
            usedCount = Number(r.rows[0]?.n ?? 0);
            limit = limits.monitors + extraMonitors;
            break;
          }
          case "reports": {
            const r = await client.query(
              `SELECT COUNT(*)::int AS n FROM reports WHERE org_id=$1 AND created_at > date_trunc('month', now())`,
              [resolvedOrgId]
            );
            usedCount = Number(r.rows[0]?.n ?? 0);
            limit = limits.reports;
            break;
          }
          case "seats": {
            const r = await client.query(
              `SELECT COUNT(*)::int AS n FROM team_members WHERE org_id=$1`,
              [resolvedOrgId]
            );
            usedCount = Number(r.rows[0]?.n ?? 0);
            limit = limits.teamMembers + extraSeats;
            break;
          }
          case "exports": {
            limit = limits.exports;
            usedCount = 0; // exports tracked separately — not blocked here
            break;
          }
        }
      } finally {
        client.release();
      }
    } catch (err) {
      logger.warn({ err, orgId: resolvedOrgId, resource }, "[Billing] checkQuota: usage count failed — allowing");
      return { allowed: true, used: 0, limit: limits[resource as keyof typeof limits] as number || 0, plan };
    }
  } else {
    // No orgId — use standard limits with zero usage (most conservative: allow but log)
    limit = limits[resource as keyof typeof limits] as number || 0;
    logger.warn({ resource }, "[Billing] checkQuota: unresolved orgId — returning standard limit, usage=0");
  }

  return {
    allowed: usedCount < limit,
    used:    usedCount,
    limit,
    plan,
  };
}

// ── Billing events / MRR tracking ─────────────────────────────────────────────
export async function trackBillingEvent(type: string, data: Record<string, unknown>, orgId = "default") {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO billing_events (org_id, type, amount, currency, plan, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,now())`,
      [orgId, type, data.amount ?? 0, data.currency ?? "eur", String(data.plan ?? "unknown"), JSON.stringify(data)]
    );
  } catch (err) {
    logger.warn({ err }, "[Billing] Failed to track billing event");
  } finally {
    client.release();
  }
}

export async function getMRRData(orgId = "default") {
  // Load plan from DB — never from store.me singleton
  const orgData = await loadOrgData(orgId).catch(() => null);
  const plan = (orgData?.plan || "standard").toLowerCase();
  const currentMRR = PLAN_DEFINITIONS[plan]?.priceEur ?? 0;

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
      WHERE org_id=$1 AND created_at > now() - INTERVAL '12 months'
      GROUP BY 1 ORDER BY 1 DESC LIMIT 12
    `, [orgId]);

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
    return { currentMRR, arr: currentMRR * 12, history: [] };
  } finally {
    client.release();
  }
}

export async function getSubscriptionAnalytics(orgId = "default") {
  // All fields sourced from DB — never from store.me singleton
  const [mrr, usage, orgData] = await Promise.all([
    getMRRData(orgId),
    getUsageSummary(orgId),
    loadOrgData(orgId).catch(() => null),
  ]);

  const trialDaysLeft = orgData?.trialEndsAt
    ? Math.max(0, Math.ceil((new Date(orgData.trialEndsAt).getTime() - Date.now()) / 86400000))
    : null;

  return {
    ...mrr,
    usage,
    plan: orgData?.plan ?? "standard",
    subscriptionStatus: orgData?.subscriptionStatus ?? "inactive",
    trialDaysLeft,
    stripeCustomerId: orgData?.stripeCustomerId ?? null,
    addons: orgData?.addons ?? {},
  };
}

// ── Trial management ──────────────────────────────────────────────────────────
export async function startTrial(plan: string = "pro", days: number = 14, orgId = "default") {
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  if (!stripeKey) {
    if (process.env["NODE_ENV"] === "production") {
      throw new Error("STRIPE_LIVE_API_KEY is required in production — cannot activate trial");
    }
    const trialEnd = new Date(Date.now() + days * 86400000).toISOString();
    store.broadcastPlanUpdate(plan, orgId);
    logger.info({ plan, days }, "[Billing] Trial activated (dev mode — no Stripe key)");
    return { ok: true, trialEndsAt: trialEnd, plan, mock: true };
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

    const planPriceId = PLAN_PRICE_IDS[plan.toLowerCase()];
    if (!planPriceId) {
      const trialEnd = new Date(Date.now() + days * 86400000).toISOString();
      store.broadcastPlanUpdate(plan, orgId);
      return { ok: true, trialEndsAt: trialEnd, plan, noPrice: true };
    }

    const { ensureStripeCustomer } = await import("./ensure-stripe-customer.js");
    const customerId = await ensureStripeCustomer(orgId, null, stripeKey);

    // Guard: never create a second subscription — idempotent across retries and concurrent calls
    const [existingActive, existingTrialing] = await Promise.all([
      stripe.subscriptions.list({ customer: customerId, status: "active",   limit: 1 }),
      stripe.subscriptions.list({ customer: customerId, status: "trialing", limit: 1 }),
    ]);
    const existingSub = existingActive.data[0] ?? existingTrialing.data[0];
    if (existingSub) {
      const trialEnd = existingSub.trial_end
        ? new Date(existingSub.trial_end * 1000).toISOString()
        : new Date(Date.now() + days * 86400000).toISOString();
      logger.info({ subId: existingSub.id, orgId }, "[Billing] startTrial — existing subscription found, returning idempotent result");
      return { ok: true, trialEndsAt: trialEnd, subscriptionId: existingSub.id, plan, idempotent: true };
    }

    const sub = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: planPriceId }],
      trial_period_days: days,
    });

    const trialEnd = sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : new Date(Date.now() + days * 86400000).toISOString();
    store.broadcastPlanUpdate(plan, orgId);

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
export async function getInvoices(limit: number = 20, stripeCustomerId?: string) {
  const stripeKey = process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"];
  const customerId = stripeCustomerId ?? null;
  if (!stripeKey || !customerId) {
    return { invoices: [], mock: !stripeKey };
  }

  try {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
    const invoices = await stripe.invoices.list({ customer: customerId, limit });

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
  standard: ["audits:30", "monitors:10", "reports:30", "exports:30", "team:1", "email-support", "export-csv"],
  pro: [
    "audits:300", "monitors:50", "reports:300", "exports:300", "team:5",
    "ai-insights", "white-label-reports", "api-access", "priority-support",
    "retention:90", "competitor-analytics", "webhooks", "2fa", "audit-log",
    "keyword-tracking", "behavioral-ai", "cro",
  ],
  ultra: [
    "audits:1000", "monitors:300", "reports:1000", "exports:1000", "team:10",
    "ai-strategist", "white-label-portal", "sso-enterprise", "custom-domain", "sla-999",
    "retention:365", "multi-workspace", "agency-lab", "client-billing", "dedicated-onboarding",
    "forecasting", "revenue-leak", "automation", "market-intelligence",
  ],
};

export function hasFeature(feature: string, plan?: string): boolean {
  const p = (plan || "standard").toLowerCase();
  const features = PLAN_FEATURES[p] || PLAN_FEATURES.standard;
  if (p === "ultra") return true;
  return features.some(f => f === feature || f.startsWith(feature + ":"));
}
