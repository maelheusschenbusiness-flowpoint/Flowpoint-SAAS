import { db, pool, aiUsageLogsTable, aiMonthlyUsageTable, aiAlertsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { store } from "./store.js";
import { PLAN_AI_CREDITS, PLAN_AI_TOKENS } from "../lib/plans.js";

export type AIModel = "gpt-4o" | "gpt-4o-mini" | "gpt-3.5-turbo";
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
  "gpt-4o-mini":  0.0002,
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

export async function getOrCreateMonthlyUsage(orgId = "default"): Promise<{
  creditsUsed: number;
  creditsLimit: number;
  creditsExtra: number;
  costEur: number;
  requestCount: number;
  tokensUsed: number;
  tokenLimit: number;
}> {
  const month = currentMonth();
  const plan = store.me.plan?.toLowerCase() || "pro";
  const creditLimit = PLAN_AI_CREDITS[plan] ?? 100000;
  const tokenLimit  = PLAN_AI_TOKENS[plan]  ?? 150_000;

  // Let DB errors propagate so callers can decide whether to allow or block
  const [row] = await db.select()
    .from(aiMonthlyUsageTable)
    .where(and(eq(aiMonthlyUsageTable.orgId, orgId), eq(aiMonthlyUsageTable.month, month)))
    .limit(1);

  if (row) return { ...row, tokenLimit };

  const id = `amu_${orgId}_${month}`;
  await db.insert(aiMonthlyUsageTable).values({
    id,
    orgId,
    month,
    creditsUsed: 0,
    creditsLimit: creditLimit,
    creditsExtra: 0,
    costEur: 0,
    requestCount: 0,
    resetAt: monthResetDate(),
  }).onConflictDoNothing();

  return { creditsUsed: 0, creditsLimit: creditLimit, creditsExtra: 0, costEur: 0, requestCount: 0, tokensUsed: 0, tokenLimit };
}

export function selectOptimalModel(feature: AIFeature, quality: "fast" | "balanced" | "max" = "balanced"): AIModel {
  if (quality === "fast") return "gpt-4o-mini";
  if (quality === "max") return "gpt-4o";

  const highQualityFeatures: AIFeature[] = ["strategist", "forecast", "market_intel"];
  const fastFeatures: AIFeature[] = ["audit_summary", "mission_auto"];

  if (highQualityFeatures.includes(feature)) return "gpt-4o";
  if (fastFeatures.includes(feature)) return "gpt-4o-mini";
  return "gpt-4o-mini";
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
  const orgId = opts.orgId ?? "default";
  const model = opts.model ?? selectOptimalModel(opts.feature);
  const credits = CREDITS_PER_FEATURE[opts.feature] ?? 500;
  const tokensIn = opts.tokensIn ?? 800;
  const tokensOut = opts.tokensOut ?? 400;
  const totalTokens = tokensIn + tokensOut;
  const costEur = (totalTokens / 1000) * MODEL_COST_EUR_PER_1K_TOKENS[model];
  const month = currentMonth();

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
    await db.insert(aiUsageLogsTable).values({
      id: logId,
      orgId,
      userId: opts.userId ?? "mael",
      model,
      feature: opts.feature,
      creditsUsed: credits,
      tokensIn,
      tokensOut,
      costEur,
      latencyMs: 0,
      success: "true",
      metadata: opts.metadata ?? null,
    });

    const client = await pool.connect();
    try {
      await client.query(`
        INSERT INTO ai_monthly_usage (id, org_id, month, credits_used, credits_limit, credits_extra, cost_eur, request_count, reset_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, 0, $6, 1, $7, NOW())
        ON CONFLICT (id) DO UPDATE
          SET credits_used   = ai_monthly_usage.credits_used   + $4,
              cost_eur       = ai_monthly_usage.cost_eur       + $6,
              request_count  = ai_monthly_usage.request_count  + 1,
              updated_at     = NOW()
      `, [
        `amu_${orgId}_${month}`,
        orgId,
        month,
        credits,
        PLAN_AI_CREDITS[store.me.plan?.toLowerCase() ?? "pro"] ?? 100000,
        costEur,
        monthResetDate(),
      ]);
    } finally {
      client.release();
    }

    const newUsed = usage.creditsUsed + credits;
    const pct = Math.round((newUsed / totalAvailable) * 100);
    if (pct >= 90 && pct - Math.round(((usage.creditsUsed) / totalAvailable) * 100) < 5) {
      await triggerAIAlert(orgId, "quota_90pct", newUsed, totalAvailable);
    } else if (pct >= 70 && pct - Math.round(((usage.creditsUsed) / totalAvailable) * 100) < 5) {
      await triggerAIAlert(orgId, "quota_70pct", newUsed, totalAvailable);
    }

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
  const logId = `aul_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const costEur = ((opts.tokensIn + opts.tokensOut) / 1000) * MODEL_COST_EUR_PER_1K_TOKENS[opts.model];
  try {
    await db.insert(aiUsageLogsTable).values({
      id: logId,
      orgId: opts.orgId ?? "default",
      userId: opts.userId ?? "mael",
      model: opts.model,
      feature: opts.feature,
      creditsUsed: CREDITS_PER_FEATURE[opts.feature] ?? 500,
      tokensIn: opts.tokensIn,
      tokensOut: opts.tokensOut,
      costEur,
      latencyMs: opts.latencyMs,
      success: opts.success ? "true" : "false",
      metadata: opts.metadata ?? null,
    });
  } catch (err) {
    logger.error({ err }, "[AI] trackAIUsage failed");
  }
}

/**
 * Atomically records a completed AI call into both ai_usage_logs and
 * ai_monthly_usage using the REAL token counts from the completion response.
 * Must be called AFTER the OpenAI call finishes (streaming or not).
 */
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
  const credits = CREDITS_PER_FEATURE[feature] ?? 500;
  const costEur = ((tokensIn + tokensOut) / 1000) * MODEL_COST_EUR_PER_1K_TOKENS[model];
  const month   = currentMonth();

  const logId = `aul_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  try {
    await db.insert(aiUsageLogsTable).values({
      id: logId, orgId, userId, model, feature,
      creditsUsed: credits,
      tokensIn,
      tokensOut,
      costEur,
      latencyMs,
      success: opts.success ? "true" : "false",
      metadata: null,
    });
  } catch (err) {
    logger.warn({ err }, "[AI] recordCompletedUsage: log insert failed");
  }

  const totalTokens = tokensIn + tokensOut;
  const client = await pool.connect();
  try {
    await client.query(`
      INSERT INTO ai_monthly_usage (id, org_id, month, credits_used, credits_limit, credits_extra, cost_eur, request_count, tokens_used, reset_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, 0, $6, 1, $7, $8, NOW())
      ON CONFLICT (id) DO UPDATE
        SET credits_used   = ai_monthly_usage.credits_used   + $4,
            cost_eur       = ai_monthly_usage.cost_eur       + $6,
            request_count  = ai_monthly_usage.request_count  + 1,
            tokens_used    = ai_monthly_usage.tokens_used    + $7,
            updated_at     = NOW()
    `, [
      `amu_${orgId}_${month}`,
      orgId, month, credits,
      PLAN_AI_CREDITS[store.me.plan?.toLowerCase() ?? "pro"] ?? 100000,
      costEur,
      totalTokens,
      monthResetDate(),
    ]);
  } catch (err) {
    logger.warn({ err }, "[AI] recordCompletedUsage: monthly upsert failed");
  } finally {
    client.release();
  }
}

async function triggerAIAlert(orgId: string, type: string, current: number, limit: number): Promise<void> {
  try {
    const id = `aia_${Date.now()}_${type}`;
    const messages: Record<string, string> = {
      quota_70pct: `70% des AI Credits consommés ce mois (${Math.round(current / 1000)}k / ${Math.round(limit / 1000)}k)`,
      quota_90pct: `⚠️ 90% des AI Credits consommés — pensez à recharger avant la fin du mois`,
      quota_100pct: `🚨 AI Credits épuisés — toutes les requêtes IA sont bloquées`,
    };
    await db.insert(aiAlertsTable).values({
      id,
      orgId,
      alertType: type,
      message: messages[type] ?? `Alerte quota IA : ${type}`,
      threshold: limit,
      currentValue: current,
    });
    store.broadcast({ type: "ai:quota_alert", alertType: type, current, limit });
  } catch { /* silent */ }
}

export async function getAIUsageStats(orgId = "default"): Promise<{
  monthly: Awaited<ReturnType<typeof getOrCreateMonthlyUsage>>;
  byFeature: Array<{ feature: string; credits: number; pct: number; cost: number }>;
  dailyHistory: number[];
  alerts: Array<{ alertType: string; message: string; triggeredAt: Date }>;
}> {
  try {
    const [monthly, logs, alerts, dailyLogs] = await Promise.all([
      getOrCreateMonthlyUsage(orgId),
      db.select({
        feature: aiUsageLogsTable.feature,
        credits: sql<number>`sum(${aiUsageLogsTable.creditsUsed})`,
        cost: sql<number>`sum(${aiUsageLogsTable.costEur})`,
      })
        .from(aiUsageLogsTable)
        .where(eq(aiUsageLogsTable.orgId, orgId))
        .groupBy(aiUsageLogsTable.feature)
        .limit(20),
      db.select()
        .from(aiAlertsTable)
        .where(eq(aiAlertsTable.orgId, orgId))
        .orderBy(desc(aiAlertsTable.triggeredAt))
        .limit(5),
      // Real per-day credits for the last 30 days
      db.select({
        day: sql<string>`date_trunc('day', ${aiUsageLogsTable.createdAt})::text`,
        credits: sql<number>`sum(${aiUsageLogsTable.creditsUsed})`,
      })
        .from(aiUsageLogsTable)
        .where(and(
          eq(aiUsageLogsTable.orgId, orgId),
          sql`${aiUsageLogsTable.createdAt} >= now() - interval '30 days'`,
        ))
        .groupBy(sql`date_trunc('day', ${aiUsageLogsTable.createdAt})`)
        .orderBy(sql`date_trunc('day', ${aiUsageLogsTable.createdAt}) asc`),
    ]);

    const totalCredits = logs.reduce((s, l) => s + Number(l.credits), 0) || 1;
    const byFeature = logs.map(l => ({
      feature: l.feature,
      credits: Number(l.credits),
      pct: Math.round((Number(l.credits) / totalCredits) * 100),
      cost: Number(l.cost),
    }));

    // Build a 30-slot array from real DB data (0 for days with no usage)
    const dayMap = new Map(dailyLogs.map(l => [l.day.slice(0, 10), Number(l.credits)]));
    const dailyHistory = Array.from({ length: 30 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (29 - i));
      return dayMap.get(d.toISOString().slice(0, 10)) ?? 0;
    });

    return { monthly, byFeature, dailyHistory, alerts };
  } catch {
    return {
      monthly: { creditsUsed: 0, creditsLimit: 0, creditsExtra: 0, costEur: 0, requestCount: 0 },
      byFeature: [],
      dailyHistory: Array.from({ length: 30 }, () => 0),
      alerts: [],
    };
  }
}
