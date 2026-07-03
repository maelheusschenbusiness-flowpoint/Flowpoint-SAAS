import { pool, withOrgDb } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { store } from "./store.js";
import { PLAN_AI_CREDITS, PLAN_AI_TOKENS } from "../lib/plans.js";

export type AIModel = "gpt-4o" | "gpt-5-mini" | "gpt-3.5-turbo";
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

const CREDITS_PER_FEATURE: Record<AIFeature, number> = {
  chat:              800,
  strategist:       2400,
  report_gen:       1600,
  mission_auto:      600,
  cro_analysis:     1200,
  forecast:         2000,
  market_intel:     1800,
  behavior_analysis: 1000,
  revenue_leak:      900,
  audit_summary:     500,
};

const MODEL_COST_EUR_PER_1K_TOKENS: Record<AIModel, number> = {
  "gpt-4o":       0.005,
  "gpt-5-mini":   0.0002,
  "gpt-3.5-turbo":0.0003,
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthResetDate(): Date {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1);
}

function planCreditLimit(plan?: string | null): number {
  return PLAN_AI_CREDITS[(plan ?? "pro").toLowerCase()] ?? 100000;
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
  const plan        = store.me.plan?.toLowerCase() || "pro";
  const creditLimit = planCreditLimit(plan);
  const tokenLimit  = PLAN_AI_TOKENS[plan] ?? 150_000;

  type RowT = {
    credits_used: number; credits_limit: number; credits_extra: number;
    cost_eur: number; request_count: number; tokens_used: number;
  };

  const result = await withOrgDb<RowT | null>(orgId, async (client) => {
    const { rows } = await client.query<RowT>(
      `SELECT credits_used, credits_limit, credits_extra, cost_eur, request_count,
              COALESCE(tokens_used, 0) AS tokens_used
       FROM ai_monthly_usage WHERE org_id = $1 AND month = $2 LIMIT 1`,
      [orgId, month]
    );
    if (rows[0]) return rows[0];

    await client.query(
      `INSERT INTO ai_monthly_usage
         (id, org_id, month, credits_used, credits_limit, credits_extra, cost_eur, request_count, tokens_used, reset_at, updated_at)
       VALUES ($1,$2,$3,0,$4,0,0,0,0,$5,NOW())
       ON CONFLICT (org_id, month) DO NOTHING`,
      [`amu_${orgId}_${month}`, orgId, month, creditLimit, monthResetDate()]
    );
    return null;
  });

  if (result) {
    return {
      creditsUsed:  Number(result.credits_used),
      creditsLimit: Number(result.credits_limit),
      creditsExtra: Number(result.credits_extra),
      costEur:      Number(result.cost_eur),
      requestCount: Number(result.request_count),
      tokensUsed:   Number(result.tokens_used),
      tokenLimit,
    };
  }

  return { creditsUsed: 0, creditsLimit: creditLimit, creditsExtra: 0, costEur: 0, requestCount: 0, tokensUsed: 0, tokenLimit };
}

export function selectOptimalModel(feature: AIFeature, quality: "fast" | "balanced" | "max" = "balanced"): AIModel {
  if (quality === "fast") return "gpt-5-mini";
  if (quality === "max")  return "gpt-4o";

  const highQuality: AIFeature[] = ["strategist", "forecast", "market_intel"];
  const fast: AIFeature[]        = ["audit_summary", "mission_auto"];

  if (highQuality.includes(feature)) return "gpt-4o";
  if (fast.includes(feature))        return "gpt-5-mini";
  return "gpt-5-mini";
}

export async function consumeAICredits(opts: {
  feature: AIFeature;
  orgId?: string;
  userId?: string;
  model?: AIModel;
  tokensIn?: number;
  tokensOut?: number;
  metadata?: Record<string, unknown>;
}): Promise<{ allowed: boolean; creditsUsed: number; remaining: number }> {
  const orgId    = opts.orgId ?? "default";
  const model    = opts.model ?? selectOptimalModel(opts.feature);
  const credits  = CREDITS_PER_FEATURE[opts.feature] ?? 500;
  const tokensIn = opts.tokensIn  ?? 800;
  const tokensOut= opts.tokensOut ?? 400;
  const costEur  = ((tokensIn + tokensOut) / 1000) * MODEL_COST_EUR_PER_1K_TOKENS[model];
  const month    = currentMonth();

  try {
    const usage = await getOrCreateMonthlyUsage(orgId);
    const totalAvailable = usage.creditsLimit + usage.creditsExtra;
    const remaining = Math.max(0, totalAvailable - usage.creditsUsed);

    if (usage.creditsUsed + credits > totalAvailable * 1.05) {
      logger.warn({ feature: opts.feature, orgId }, "[AI] Credits exhausted — blocking request");
      await triggerAIAlert(orgId, "quota_100pct", usage.creditsUsed, totalAvailable);
      return { allowed: false, creditsUsed: 0, remaining };
    }

    const logId = `aul_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    await withOrgDb(orgId, async (client) => {
      await client.query(
        `INSERT INTO ai_usage_logs
           (id, org_id, user_id, model, feature, credits_used, tokens_in, tokens_out, cost_eur, latency_ms, success, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,0,'true',$10)`,
        [logId, orgId, opts.userId ?? "mael", model, opts.feature, credits,
         tokensIn, tokensOut, costEur, opts.metadata ? JSON.stringify(opts.metadata) : null]
      );
    });

    const lim = planCreditLimit(store.me.plan);
    const client2 = await pool.connect();
    try {
      await client2.query(
        `INSERT INTO ai_monthly_usage
           (id, org_id, month, credits_used, credits_limit, credits_extra, cost_eur, request_count, tokens_used, reset_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,0,$6,1,$7,$8,NOW())
         ON CONFLICT (org_id, month) DO UPDATE
           SET credits_used   = ai_monthly_usage.credits_used   + $4,
               cost_eur       = ai_monthly_usage.cost_eur       + $6,
               request_count  = ai_monthly_usage.request_count  + 1,
               tokens_used    = ai_monthly_usage.tokens_used    + $7,
               updated_at     = NOW()`,
        [`amu_${orgId}_${month}`, orgId, month, credits, lim, costEur, tokensIn + tokensOut, monthResetDate()]
      );
    } finally {
      client2.release();
    }

    const newUsed = usage.creditsUsed + credits;
    const pct     = Math.round((newUsed / totalAvailable) * 100);
    const oldPct  = Math.round((usage.creditsUsed / totalAvailable) * 100);
    if      (pct >= 90 && oldPct < 90) await triggerAIAlert(orgId, "quota_90pct", newUsed, totalAvailable);
    else if (pct >= 70 && oldPct < 70) await triggerAIAlert(orgId, "quota_70pct", newUsed, totalAvailable);

    return { allowed: true, creditsUsed: credits, remaining: Math.max(0, remaining - credits) };
  } catch (err) {
    logger.error({ err }, "[AI] consumeAICredits failed — allowing with degraded tracking");
    return { allowed: true, creditsUsed: credits, remaining: 99999 };
  }
}

export async function trackAIUsage(opts: {
  feature: AIFeature;
  orgId?: string;
  userId?: string;
  model: AIModel;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  success: boolean;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const logId  = `aul_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const costEur= ((opts.tokensIn + opts.tokensOut) / 1000) * MODEL_COST_EUR_PER_1K_TOKENS[opts.model];
  try {
    await withOrgDb(opts.orgId ?? "default", async (client) => {
      await client.query(
        `INSERT INTO ai_usage_logs
           (id, org_id, user_id, model, feature, credits_used, tokens_in, tokens_out, cost_eur, latency_ms, success, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [logId, opts.orgId ?? "default", opts.userId ?? "mael", opts.model, opts.feature,
         CREDITS_PER_FEATURE[opts.feature] ?? 500,
         opts.tokensIn, opts.tokensOut, costEur, opts.latencyMs,
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
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  success: boolean;
}): Promise<void> {
  const { orgId, userId, model, feature, tokensIn, tokensOut, latencyMs } = opts;
  const credits    = CREDITS_PER_FEATURE[feature] ?? 500;
  const costEur    = ((tokensIn + tokensOut) / 1000) * MODEL_COST_EUR_PER_1K_TOKENS[model];
  const month      = currentMonth();
  const logId      = `aul_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

  try {
    await withOrgDb(orgId, async (client) => {
      await client.query(
        `INSERT INTO ai_usage_logs
           (id, org_id, user_id, model, feature, credits_used, tokens_in, tokens_out, cost_eur, latency_ms, success, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL)`,
        [logId, orgId, userId, model, feature, credits, tokensIn, tokensOut,
         costEur, latencyMs, opts.success ? "true" : "false"]
      );
    });
  } catch (err) {
    logger.warn({ err }, "[AI] recordCompletedUsage: log insert failed");
  }

  const lim = planCreditLimit(store.me.plan);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ai_monthly_usage
         (id, org_id, month, credits_used, credits_limit, credits_extra, cost_eur, request_count, tokens_used, reset_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,0,$6,1,$7,$8,NOW())
       ON CONFLICT (org_id, month) DO UPDATE
         SET credits_used   = ai_monthly_usage.credits_used   + $4,
             cost_eur       = ai_monthly_usage.cost_eur       + $6,
             request_count  = ai_monthly_usage.request_count  + 1,
             tokens_used    = ai_monthly_usage.tokens_used    + $7,
             updated_at     = NOW()`,
      [`amu_${orgId}_${month}`, orgId, month, credits, lim, costEur, tokensIn + tokensOut, monthResetDate()]
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
    store.broadcast({ type: "ai:quota_alert", alertType: type, current, limit });
  } catch { /* silent */ } finally {
    client.release();
  }
}

export async function getAIUsageStats(orgId = "default"): Promise<{
  monthly: Awaited<ReturnType<typeof getOrCreateMonthlyUsage>>;
  byFeature: Array<{ feature: string; credits: number; pct: number; cost: number }>;
  dailyHistory: number[];
  alerts: Array<{ alertType: string; message: string; triggeredAt: Date }>;
}> {
  const plan        = store.me.plan?.toLowerCase() || "pro";
  const creditLimit = planCreditLimit(plan);
  const tokenLimit  = PLAN_AI_TOKENS[plan] ?? 150_000;

  const fallback = {
    monthly: {
      creditsUsed: 0, creditsLimit: creditLimit, creditsExtra: 0,
      costEur: 0, requestCount: 0, tokensUsed: 0, tokenLimit,
    },
    byFeature: [] as Array<{ feature: string; credits: number; pct: number; cost: number }>,
    dailyHistory: Array.from({ length: 30 }, () => 0),
    alerts: [] as Array<{ alertType: string; message: string; triggeredAt: Date }>,
  };

  try {
    type MonthRow = {
      credits_used: number; credits_limit: number; credits_extra: number;
      cost_eur: number; request_count: number; tokens_used: number;
    };
    type LogRow    = { feature: string; credits: string; cost: string };
    type AlertRow  = { alert_type: string; message: string; triggered_at: Date };
    type DailyRow  = { day: string; credits: string };

    const [monthly, byFeature, alerts, dailyHistory] = await withOrgDb<
      [ReturnType<typeof fallback.monthly> , typeof fallback.byFeature, typeof fallback.alerts, number[]]
    >(orgId, async (client) => {
      const [mRes, lRes, aRes, dRes] = await Promise.all([
        client.query<MonthRow>(
          `SELECT credits_used, credits_limit, credits_extra, cost_eur, request_count,
                  COALESCE(tokens_used, 0) AS tokens_used
           FROM ai_monthly_usage WHERE org_id=$1 AND month=$2 LIMIT 1`,
          [orgId, currentMonth()]
        ),
        client.query<LogRow>(
          `SELECT feature, SUM(credits_used)::text AS credits, SUM(cost_eur)::text AS cost
           FROM ai_usage_logs WHERE org_id=$1 GROUP BY feature LIMIT 20`,
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
            creditsLimit: Number(mr.credits_limit),
            creditsExtra: Number(mr.credits_extra),
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

      return [m, bf, al, dh];
    });

    return { monthly, byFeature, alerts, dailyHistory };
  } catch (err) {
    logger.error({ err }, "[AI] getAIUsageStats failed — returning plan-based fallback");
    return fallback;
  }
}
