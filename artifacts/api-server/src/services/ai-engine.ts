import { pool, withOrgDb } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { store } from "./store.js";
import { loadOrgSettings } from "./org-settings.js";
import { PLAN_AI_CREDITS, PLAN_AI_TOKENS } from "../lib/plans.js";
import { loadOrgAIPrefs, resolveAIModel } from "./ai-prefs.js";
import {
  getFeatureBaseCost,
  getModelConfig,
  getModelMultiplier,
  computeRealCostEur,
  computeCreditsDebited,
  CREDIT_EUR_RATE,
  type AIProviderId,
} from "../config/ai-config.js";

/** All supported models — openai, anthropic, gemini only */
export type AIModel =
  | "gpt-5" | "gpt-5-mini" | "gpt-5-nano" | "gpt-5.4" | "gpt-5.3-codex" | "gpt-5.2"
  | "gpt-image-1" | "gpt-4o" | "gpt-4o-mini" | "o3" | "o4-mini"
  | "claude-sonnet-4-6" | "claude-sonnet-4-5" | "claude-opus-4-8" | "claude-opus-4-7" | "claude-haiku-4-5"
  | "gemini-3.1-pro-preview" | "gemini-3-flash-preview" | "gemini-3-pro-image-preview"
  | "gemini-2.5-pro" | "gemini-2.5-flash" | "gemini-2.5-flash-image";

export type AIFeature =
  | "chat"
  | "strategist"
  | "report_gen"
  | "mission_auto"
  | "cro_analysis"
  | "forecast"
  | "market_intel"
  | "behavior_analysis"
  | "revenue_leak"
  | "audit_summary";

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthResetDate(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function planCreditLimit(plan?: string | null): number {
  return PLAN_AI_CREDITS[(plan ?? "standard").toLowerCase()] ?? PLAN_AI_CREDITS.standard;
}

export async function getOrCreateMonthlyUsage(orgId = "default"): Promise<{
  creditsUsed: number;
  creditsLimit: number;
  creditsExtra: number;
  costEur: number;
  requestCount: number;
  tokensUsed: number;
  tokenLimit: number;
}> {
  const month       = currentMonth();
  const _dbData     = await loadOrgSettings(orgId).catch(() => null);
  const plan        = (_dbData?.plan || store.me.plan || "standard").toLowerCase();
  const creditLimit = planCreditLimit(plan);
  const tokenLimit  = PLAN_AI_TOKENS[plan] ?? PLAN_AI_TOKENS.standard;

  type RowT = {
    credits_used: number; cost_eur: number; request_count: number; tokens_used: number;
  };

  const result = await withOrgDb<RowT | null>(orgId, async (client) => {
    const { rows } = await client.query<RowT>(
      `SELECT credits_used, cost_eur, request_count, COALESCE(tokens_used, 0) AS tokens_used
       FROM ai_monthly_usage WHERE org_id = $1 AND month = $2 LIMIT 1`,
      [orgId, month]
    );
    if (rows[0]) return rows[0];

    await client.query(
      `INSERT INTO ai_monthly_usage
         (id, org_id, month, credits_used, cost_eur, request_count, tokens_used, reset_at, updated_at)
       VALUES ($1,$2,$3,0,0,0,0,$4,NOW())
       ON CONFLICT (org_id, month) DO NOTHING`,
      [`amu_${orgId}_${month}`, orgId, month, monthResetDate()]
    );
    return null;
  });

  if (result) {
    return {
      creditsUsed:  Number(result.credits_used),
      creditsLimit: creditLimit,
      creditsExtra: 0,
      costEur:      Number(result.cost_eur),
      requestCount: Number(result.request_count),
      tokensUsed:   Number(result.tokens_used),
      tokenLimit,
    };
  }

  return { creditsUsed: 0, creditsLimit: creditLimit, creditsExtra: 0, costEur: 0, requestCount: 0, tokensUsed: 0, tokenLimit };
}

export async function consumeAICredits(opts: {
  feature: AIFeature;
  orgId?: string;
  userId?: string;
  model?: AIModel;
  provider?: AIProviderId;
  tokensIn?: number;
  tokensOut?: number;
  cachedTokens?: number;
  metadata?: Record<string, unknown>;
}): Promise<{ allowed: boolean; creditsUsed: number; remaining: number }> {
  const orgId       = opts.orgId ?? "default";
  const aiCfg       = opts.model ? null : await (async () => {
    try {
      const { selectOptimalModel } = await import("./ai-prefs.js");
      return await selectOptimalModel(opts.feature, orgId);
    } catch { return null; }
  })();
  const model       = opts.model ?? (aiCfg?.model || "gpt-5-mini");
  const provider    = opts.provider ?? aiCfg?.provider ?? "openai";
  const tokensIn    = opts.tokensIn  ?? 800;
  const tokensOut   = opts.tokensOut ?? 400;
  const cachedTokens= opts.cachedTokens ?? 0;

  // ── Dynamic cost calculation ──────────────────────────────────────────────────────────────
  const realCostEur    = computeRealCostEur({ model, tokensIn, tokensOut, cachedTokens });
  const creditsDebited = computeCreditsDebited({ feature: opts.feature, model, realCostEur });
  const month          = currentMonth();

  try {
    const usage = await getOrCreateMonthlyUsage(orgId);
    const totalAvailable = usage.creditsLimit + usage.creditsExtra;
    const remaining = Math.max(0, totalAvailable - usage.creditsUsed);

    if (usage.creditsUsed + creditsDebited > totalAvailable * 1.05) {
      logger.warn({ feature: opts.feature, orgId, creditsDebited }, "[AI] Credits exhausted — blocking request");
      await triggerAIAlert(orgId, "quota_100pct", usage.creditsUsed, totalAvailable);
      return { allowed: false, creditsUsed: 0, remaining };
    }

    const logId = `aul_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    await withOrgDb(orgId, async (client) => {
      await client.query(
        `INSERT INTO ai_usage_logs
           (id, org_id, user_id, provider, model, feature, credits_used, credits_debited,
            tokens_in, tokens_out, cached_tokens, cost_eur, real_cost_eur, latency_ms, duration_ms, success, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,'true',$14)`,
        [logId, orgId, opts.userId ?? "mael", provider, model, opts.feature,
         creditsDebited, creditsDebited,
         tokensIn, tokensOut, cachedTokens,
         realCostEur, realCostEur,
         opts.metadata ? JSON.stringify(opts.metadata) : null]
      );
    });

    const client2 = await pool.connect();
    try {
      await client2.query(
        `INSERT INTO ai_monthly_usage
           (id, org_id, month, credits_used, cost_eur, request_count, tokens_used, reset_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,1,$6,$7,NOW())
         ON CONFLICT (org_id, month) DO UPDATE
           SET credits_used   = ai_monthly_usage.credits_used   + $4,
               cost_eur       = ai_monthly_usage.cost_eur       + $5,
               request_count  = ai_monthly_usage.request_count  + 1,
               tokens_used    = ai_monthly_usage.tokens_used    + $6,
               updated_at     = NOW()`,
        [`amu_${orgId}_${month}`, orgId, month, creditsDebited, realCostEur, tokensIn + tokensOut, monthResetDate()]
      );
    } finally {
      client2.release();
    }

    const newUsed = usage.creditsUsed + creditsDebited;
    const pct     = Math.round((newUsed / totalAvailable) * 100);
    const oldPct  = Math.round((usage.creditsUsed / totalAvailable) * 100);
    if      (pct >= 90 && oldPct < 90) await triggerAIAlert(orgId, "quota_90pct", newUsed, totalAvailable);
    else if (pct >= 70 && oldPct < 70) await triggerAIAlert(orgId, "quota_70pct", newUsed, totalAvailable);

    return { allowed: true, creditsUsed: creditsDebited, remaining: Math.max(0, remaining - creditsDebited) };
  } catch (err) {
    logger.error({ err }, "[AI] consumeAICredits failed — allowing with degraded tracking");
    return { allowed: true, creditsUsed: creditsDebited, remaining: 99999 };
  }
}

/** Read-only quota precheck — no DB writes. Call this before the AI request.
 *  Only debit via consumeAICredits() after the AI call succeeds. */
export async function checkAIQuota(opts: {
  feature: AIFeature;
  orgId?: string;
}): Promise<{ allowed: boolean; remaining: number }> {
  const orgId = opts.orgId ?? "default";
  try {
    const usage = await getOrCreateMonthlyUsage(orgId);
    const totalAvailable = usage.creditsLimit + usage.creditsExtra;
    const remaining = Math.max(0, totalAvailable - usage.creditsUsed);
    const estimatedCost = getFeatureBaseCost(opts.feature);
    if (usage.creditsUsed + estimatedCost > totalAvailable * 1.05) {
      logger.warn({ feature: opts.feature, orgId }, "[AI] checkAIQuota — quota exhausted, blocking request");
      await triggerAIAlert(orgId, "quota_100pct", usage.creditsUsed, totalAvailable);
      return { allowed: false, remaining };
    }
    return { allowed: true, remaining };
  } catch (err) {
    logger.warn({ err, orgId }, "[AI] checkAIQuota failed — allowing with degraded tracking");
    return { allowed: true, remaining: 99999 };
  }
}

export async function trackAIUsage(opts: {
  feature: AIFeature;
  orgId?: string;
  userId?: string;
  model: AIModel;
  provider?: AIProviderId;
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  latencyMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const logId      = `aul_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const provider   = opts.provider ?? "openai";
  const cachedTok  = opts.cachedTokens ?? 0;
  const realCostEur= computeRealCostEur({ model: opts.model, tokensIn: opts.tokensIn, tokensOut: opts.tokensOut, cachedTokens: cachedTok });
  const creditsDeb = computeCreditsDebited({ feature: opts.feature, model: opts.model, realCostEur });

  try {
    await withOrgDb(opts.orgId ?? "default", async (client) => {
      await client.query(
        `INSERT INTO ai_usage_logs
           (id, org_id, user_id, provider, model, feature, credits_used, credits_debited,
            tokens_in, tokens_out, cached_tokens, cost_eur, real_cost_eur, latency_ms, duration_ms, success, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [logId, opts.orgId ?? "default", opts.userId ?? "mael", provider, opts.model, opts.feature,
         creditsDeb, creditsDeb,
         opts.tokensIn, opts.tokensOut, cachedTok,
         realCostEur, realCostEur,
         opts.latencyMs, opts.latencyMs,
         opts.success ? "true" : "false",
         opts.metadata ? JSON.stringify(opts.metadata) : null]
      );
    });
  } catch (err) {
    logger.error({ err }, "[AI] trackAIUsage failed");
  }
}

export async function recordCompletedUsage(opts: {
  feature: AIFeature;
  orgId: string;
  userId: string;
  model: AIModel;
  provider?: AIProviderId;
  tokensIn: number;
  tokensOut: number;
  cachedTokens?: number;
  latencyMs: number;
  success: boolean;
}): Promise<void> {
  const { orgId, userId, model, feature, tokensIn, tokensOut, latencyMs } = opts;
  const provider     = opts.provider ?? "openai";
  const cachedTok    = opts.cachedTokens ?? 0;
  const realCostEur  = computeRealCostEur({ model, tokensIn, tokensOut, cachedTokens: cachedTok });
  const creditsDeb   = computeCreditsDebited({ feature, model, realCostEur });
  const month        = currentMonth();
  const logId        = `aul_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  try {
    await withOrgDb(orgId, async (client) => {
      await client.query(
        `INSERT INTO ai_usage_logs
           (id, org_id, user_id, provider, model, feature, credits_used, credits_debited,
            tokens_in, tokens_out, cached_tokens, cost_eur, real_cost_eur, latency_ms, duration_ms, success, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NULL)`,
        [logId, orgId, userId, provider, model, feature,
         creditsDeb, creditsDeb,
         tokensIn, tokensOut, cachedTok,
         realCostEur, realCostEur,
         latencyMs, latencyMs,
         opts.success ? "true" : "false"]
      );
    });
  } catch (err) {
    logger.warn({ err }, "[AI] recordCompletedUsage: log insert failed");
  }

  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ai_monthly_usage
         (id, org_id, month, credits_used, cost_eur, request_count, tokens_used, reset_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,NOW())
       ON CONFLICT (org_id, month) DO UPDATE
         SET credits_used   = ai_monthly_usage.credits_used   + $4,
             cost_eur       = ai_monthly_usage.cost_eur       + $5,
             request_count  = ai_monthly_usage.request_count  + 1,
             tokens_used    = ai_monthly_usage.tokens_used    + $6,
             updated_at     = NOW()`,
      [`amu_${orgId}_${month}`, orgId, month, creditsDeb, realCostEur, tokensIn + tokensOut, monthResetDate()]
    );
  } catch (err) {
    logger.warn({ err }, "[AI] recordCompletedUsage: monthly upsert failed");
  } finally {
    client.release();
  }
}

async function triggerAIAlert(orgId: string, type: string, current: number, limit: number): Promise<void> {
  const messages: Record<string, string> = {
    quota_70pct:  `70% des AI Credits consommés ce mois (${Math.round(current / 1000)}k / ${Math.round(limit / 1000)}k)`,
    quota_90pct:  `⚠️ 90% des AI Credits consommés — pensez à recharger avant la fin du mois`,
    quota_100pct: `🚨 AI Credits épuisés — toutes les requêtes IA sont bloquées`,
  };
  const client = await pool.connect();
  try {
    const id = `aia_${Date.now()}_${type}`;
    await client.query(
      `INSERT INTO ai_alerts (id, org_id, alert_type, message, threshold, current_value)
       VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
      [id, orgId, type, messages[type] ?? `Alerte quota IA : ${type}`, limit, current]
    );
    store.broadcast({ type: "ai:quota_alert", alertType: type, current, limit }, orgId);
  } catch { /* silent */ } finally {
    client.release();
  }
}

export async function getAIUsageStats(orgId = "default"): Promise<{
  monthly: Awaited<ReturnType<typeof getOrCreateMonthlyUsage>>;
  byFeature: Array<{ feature: string; credits: number; pct: number; cost: number }>;
  byProvider: Array<{ provider: string; credits: number; pct: number; cost: number }>;
  byModel: Array<{ model: string; credits: number; pct: number; cost: number }>;
  dailyHistory: number[];
  alerts: Array<{ alertType: string; message: string; triggeredAt: Date }>;
  estimatedCostEur: number;
}> {
  const _dbData     = await loadOrgSettings(orgId).catch(() => null);
  const plan        = (_dbData?.plan || store.me.plan || "standard").toLowerCase();
  const creditLimit = planCreditLimit(plan);
  const tokenLimit  = PLAN_AI_TOKENS[plan] ?? PLAN_AI_TOKENS.standard;

  const fallback = {
    monthly: {
      creditsUsed: 0, creditsLimit: creditLimit, creditsExtra: 0,
      costEur: 0, requestCount: 0, tokensUsed: 0, tokenLimit,
    },
    byFeature: [] as Array<{ feature: string; credits: number; pct: number; cost: number }>,
    byProvider: [] as Array<{ provider: string; credits: number; pct: number; cost: number }>,
    byModel: [] as Array<{ model: string; credits: number; pct: number; cost: number }>,
    dailyHistory: Array.from({ length: 30 }, () => 0),
    alerts: [] as Array<{ alertType: string; message: string; triggeredAt: Date }>,
    estimatedCostEur: 0,
  };

  try {
    type MonthRow = {
      credits_used: number; cost_eur: number; request_count: number; tokens_used: number;
    };
    type LogRow    = { feature: string; credits: string; cost: string };
    type ProviderRow = { provider: string; credits: string; cost: string };
    type ModelRow    = { model: string; credits: string; cost: string };
    type AlertRow  = { alert_type: string; message: string; triggered_at: Date };
    type DailyRow  = { day: string; credits: string };

    const [monthly, byFeature, byProvider, byModel, alerts, dailyHistory] = await withOrgDb<
      [ReturnType<typeof fallback.monthly> , typeof fallback.byFeature, typeof fallback.byProvider, typeof fallback.byModel, typeof fallback.alerts, number[]]
    >(orgId, async (client) => {
      const [mRes, lRes, pRes, moRes, aRes, dRes] = await Promise.all([
        client.query<MonthRow>(
          `SELECT credits_used, cost_eur, request_count, COALESCE(tokens_used, 0) AS tokens_used
           FROM ai_monthly_usage WHERE org_id=$1 AND month=$2 LIMIT 1`,
          [orgId, currentMonth()]
        ),
        client.query<LogRow>(
          `SELECT feature, SUM(credits_used)::text AS credits, SUM(cost_eur)::text AS cost
           FROM ai_usage_logs WHERE org_id=$1 GROUP BY feature LIMIT 20`,
          [orgId]
        ),
        client.query<ProviderRow>(
          `SELECT provider, SUM(credits_used)::text AS credits, SUM(cost_eur)::text AS cost
           FROM ai_usage_logs WHERE org_id=$1 GROUP BY provider LIMIT 20`,
          [orgId]
        ),
        client.query<ModelRow>(
          `SELECT model, SUM(credits_used)::text AS credits, SUM(cost_eur)::text AS cost
           FROM ai_usage_logs WHERE org_id=$1 GROUP BY model LIMIT 20`,
          [orgId]
        ),
        client.query<AlertRow>(
          `SELECT alert_type, message, triggered_at
           FROM ai_alerts WHERE org_id=$1 ORDER BY triggered_at DESC LIMIT 5`,
          [orgId]
        ),
        client.query<DailyRow>(
          `SELECT date_trunc('day', created_at)::date::text AS day,
                  SUM(credits_used)::text AS credits
           FROM ai_usage_logs
           WHERE org_id=$1 AND created_at >= NOW() - INTERVAL '30 days'
           GROUP BY date_trunc('day', created_at) ORDER BY 1`,
          [orgId]
        ),
      ]);

      const mr = mRes.rows[0];
      const m = mr
        ? {
            creditsUsed:  Number(mr.credits_used),
            creditsLimit: creditLimit,
            creditsExtra: 0,
            costEur:      Number(mr.cost_eur),
            requestCount: Number(mr.request_count),
            tokensUsed:   Number(mr.tokens_used),
            tokenLimit,
          }
        : { ...fallback.monthly };

      const total = lRes.rows.reduce((s, l) => s + Number(l.credits), 0) || 1;
      const bf = lRes.rows.map(l => ({
        feature: l.feature,
        credits: Number(l.credits),
        pct:     Math.round((Number(l.credits) / total) * 100),
        cost:    Number(l.cost),
      }));
      const bp = pRes.rows.map(l => ({
        provider: l.provider,
        credits: Number(l.credits),
        pct:     Math.round((Number(l.credits) / total) * 100),
        cost:    Number(l.cost),
      }));
      const bm = moRes.rows.map(l => ({
        model: l.model,
        credits: Number(l.credits),
        pct:     Math.round((Number(l.credits) / total) * 100),
        cost:    Number(l.cost),
      }));

      const al = aRes.rows.map(r => ({
        alertType:   r.alert_type,
        message:     r.message,
        triggeredAt: r.triggered_at,
      }));

      const dayMap = new Map(dRes.rows.map(l => [l.day, Number(l.credits)]));
      const dh = Array.from({ length: 30 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (29 - i));
        return dayMap.get(d.toISOString().slice(0, 10)) ?? 0;
      });

      return [m, bf, bp, bm, al, dh];
    });

    const estimatedCostEur = byFeature.reduce((s, f) => s + (f.cost || 0), 0);
    return { monthly, byFeature, byProvider, byModel, alerts, dailyHistory, estimatedCostEur };
  } catch (err) {
    logger.error({ err }, "[AI] getAIUsageStats failed — returning plan-based fallback");
    return fallback;
  }
}
