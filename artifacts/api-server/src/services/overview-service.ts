import { pool } from "@workspace/db";
import { getGA4Overview } from "./ga4-service.js";
import { getImpressionsOverTime } from "./gsc-service.js";
import { PLAN_AI_CREDITS } from "../lib/plans.js";

export interface OverviewMetrics {
  seoScore: number;
  seoScoreDelta: number;
  avgScore: number;
  traffic: number | null;
  trafficDelta: number | null;
  conversions: number | null;
  conversionsDelta: number | null;
  revenue: number | null;
  revenueDelta: number | null;
  /** Real GA4 conversion rate as % (e.g. 2.31) — null when GA4 not connected */
  conversionRate: number | null;
  /** Backwards-compat alias for conversionRate */
  conversionScore: number | null;
  analyticsConnected: boolean;
  monitorsUp: number;
  monitorsDown: number;
  monitorUptime: number | null;
  auditsThisMonth: number;
  keywordsTracked: number;
  keywordsTop3: number;
  keywordsTop10: number;
  missionsOpen: number;
  missionsCompleted: number;
  aiCreditsUsed: number;
  aiCreditsLimit: number;
  aiPlanLimit: number;
  revenueLeaks: number;
  revenueLeakAmount: number;
  avgLatency: number;
  uptime: number;
  competitors: number;
  trendsUp: number;
  trendsDown: number;
  growthMomentum: number | null;
  localScore: number | null;
  competitorPressure: number | null;
  seoTrendDelta: number | null;
  organicGrowthPct: number | null;
  range: number;
  /** Real weekly audit score history — empty array when no data */
  auditHistory: Array<{ date: string; avg: number }>;
  /** Total GSC clicks in the period — null when GSC not connected */
  gscClicks30d: number | null;
  /** Daily GSC clicks — null when GSC not connected */
  gscClicksHistory: Array<{ date: string; clicks: number }> | null;
  /** Revenue opportunity in € from revenue_leaks — null when no leaks detected */
  revenueOpportunity: number | null;
  /** Audits score<50 + monitors down + unresolved alert events */
  criticalIssues: number;
  /**
   * Workspace health 0-100 — independent of monitoring uptime.
   * Derived from mission completion rate, alert rule coverage, and report activity.
   * null = no workspace activity configured yet.
   */
  workspaceHealth: number | null;
  gbpConnected: boolean;
  gbpRating: number | null;
  gbpReviewCount: number | null;
  gbpUnansweredCount: number | null;
  gbpCompletionPct: number | null;
}

/** In-memory cache keyed by `orgId:range` — 60 s TTL */
const _cache = new Map<string, { data: OverviewMetrics; expiresAt: number }>();

export async function getOverviewMetrics(orgId = "default", range = 30, rangeLabel = "30d"): Promise<OverviewMetrics> {
  const cacheKey = `${orgId}:${rangeLabel}`;
  const cached = _cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const today    = new Date().toISOString().slice(0, 10);
    const rangeAgo = new Date(Date.now() - range * 86400000).toISOString().slice(0, 10);

    const [
      audits, auditsPrev, auditHistoryQ,
      monitors, keywords, missions, ai, leaks,
      connectors, gbpPosts, competitorsQ, orgPlan,
      ga4Data, gscData,
      alertEventsQ, gbpProfileQ, gbpTokenQ,
    ] = await Promise.allSettled([
      // Current period audit avg + count
      pool.query(
        `SELECT AVG(score) as avg_score, COUNT(*) as count
         FROM audits
         WHERE org_id = $1 AND created_at > NOW() - INTERVAL '1 day' * $2`,
        [orgId, range]
      ),
      // Previous 30-day period for trend
      pool.query(
        `SELECT AVG(score) as prev_avg
         FROM audits
         WHERE org_id = $1
           AND created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'`,
        [orgId]
      ),
      // Real weekly audit score history (last 16 weeks)
      pool.query(
        `SELECT date_trunc('week', created_at)::date::text AS date,
                ROUND(AVG(score))::int AS avg
         FROM audits
         WHERE org_id = $1 AND score IS NOT NULL
           AND created_at > NOW() - INTERVAL '16 weeks'
         GROUP BY date_trunc('week', created_at)
         ORDER BY date_trunc('week', created_at) ASC`,
        [orgId]
      ),
      pool.query(
        `SELECT status,
                AVG(latency) as avg_latency,
                AVG(uptime)  as avg_uptime
         FROM monitors WHERE org_id = $1 GROUP BY status`,
        [orgId]
      ),
      pool.query(
        `SELECT COUNT(*) as total,
                SUM(CASE WHEN current_position <= 3  THEN 1 ELSE 0 END) as top3,
                SUM(CASE WHEN current_position <= 10 THEN 1 ELSE 0 END) as top10,
                SUM(CASE WHEN trend='up'   THEN 1 ELSE 0 END) as up,
                SUM(CASE WHEN trend='down' THEN 1 ELSE 0 END) as down
         FROM tracked_keywords WHERE org_id=$1 AND active=true`,
        [orgId]
      ),
      pool.query(
        `SELECT status, COUNT(*) as count FROM missions WHERE org_id=$1 GROUP BY status`,
        [orgId]
      ),
      pool.query(
        `SELECT credits_used FROM ai_monthly_usage WHERE org_id=$1 ORDER BY month DESC LIMIT 1`,
        [orgId]
      ),
      pool.query(
        `SELECT COUNT(*) as count, COALESCE(SUM(estimated_loss), 0) as total
         FROM revenue_leaks WHERE org_id=$1 AND status='active'`,
        [orgId]
      ),
      pool.query(
        `SELECT 1 FROM connectors
         WHERE org_id=$1 AND provider IN ('ga4','google_analytics','matomo') AND status='active' LIMIT 1`,
        [orgId]
      ),
      pool.query(`SELECT COUNT(*) as count FROM gbp_posts WHERE org_id=$1`, [orgId]),
      pool.query(`SELECT COUNT(*) as count FROM competitors WHERE org_id=$1`, [orgId]),
      pool.query(`SELECT plan, addons FROM org_settings WHERE org_id=$1 LIMIT 1`, [orgId]),
      getGA4Overview(orgId, rangeAgo, today),
      getImpressionsOverTime(orgId, range),
      // Unresolved alert events
      pool.query(
        `SELECT COUNT(*) as count FROM alert_events WHERE org_id=$1 AND resolved_at IS NULL`,
        [orgId]
      ),
      // GBP profile data
      pool.query(
        `SELECT avg_rating, review_count, unanswered_count, completion_pct
         FROM gbp_profiles WHERE org_id=$1
         ORDER BY updated_at DESC NULLS LAST LIMIT 1`,
        [orgId]
      ).catch(() => ({ rows: [] as Array<Record<string, unknown>> })),
      // GBP connected = google_tokens exists
      pool.query(`SELECT 1 FROM google_tokens WHERE org_id=$1 LIMIT 1`, [orgId]),
    ]);

    const auditRow      = audits.status          === "fulfilled" ? audits.value.rows[0]       : null;
    const prevRow       = auditsPrev.status       === "fulfilled" ? auditsPrev.value.rows[0]   : null;
    const auditHistRows = auditHistoryQ.status    === "fulfilled" ? auditHistoryQ.value.rows   : [];
    const monitorRows   = monitors.status         === "fulfilled" ? monitors.value.rows         : [];
    const kwRow         = keywords.status         === "fulfilled" ? keywords.value.rows[0]     : null;
    const missionRows   = missions.status         === "fulfilled" ? missions.value.rows         : [];
    const aiRow         = ai.status               === "fulfilled" ? ai.value.rows[0]           : null;
    const leakRow       = leaks.status            === "fulfilled" ? leaks.value.rows[0]        : null;
    const analyticsConnected = connectors.status  === "fulfilled" && connectors.value.rows.length > 0;
    const gbpRow        = gbpPosts.status         === "fulfilled" ? gbpPosts.value.rows[0]     : null;
    const compRow       = competitorsQ.status     === "fulfilled" ? competitorsQ.value.rows[0] : null;
    const orgPlanRow    = orgPlan.status          === "fulfilled" ? orgPlan.value.rows[0]      : null;
    const alertEvRow    = alertEventsQ.status     === "fulfilled" ? alertEventsQ.value.rows[0] : null;
    const gbpProfileRow = gbpProfileQ.status      === "fulfilled"
      ? (gbpProfileQ.value as { rows: Array<Record<string, unknown>> }).rows[0]
      : null;
    const gbpConnected  = gbpTokenQ.status        === "fulfilled" && gbpTokenQ.value.rows.length > 0;

    // ── Plan credits ─────────────────────────────────────────────────────────────
    const orgPlanKey  = ((orgPlanRow?.plan ?? "standard") as string).toLowerCase();
    const aiPlanLimit = PLAN_AI_CREDITS[orgPlanKey] ?? PLAN_AI_CREDITS["standard"]!;
    const addons      = (orgPlanRow?.addons ?? {}) as Record<string, unknown>;
    const extraCreditMap: Record<string, number> = {
      aiCreditsPack50k: 50_000, aiCreditsPack200k: 200_000, aiCreditsPack500k: 500_000
    };
    let aiExtraCredits = 0;
    for (const pack of Object.keys(extraCreditMap)) {
      if (addons[pack]) aiExtraCredits += extraCreditMap[pack]!;
    }
    const aiCreditsLimit = aiPlanLimit + aiExtraCredits;

    // ── GA4 metrics ──────────────────────────────────────────────────────────────
    const ga4  = ga4Data.status === "fulfilled" ? ga4Data.value : null;
    const gscR = gscData.status === "fulfilled" ? gscData.value : [];

    const _mv  = (idx: number) => Math.round(parseFloat(ga4?.totals?.[0]?.metricValues?.[idx]?.value ?? "0") * 100) / 100;
    const _mvP = (idx: number) => Math.round(parseFloat(ga4?.totals?.[1]?.metricValues?.[idx]?.value ?? "0") * 100) / 100;

    const ga4Sessions     = ga4 ? _mv(0)  : 0;
    const ga4Conversions  = ga4 ? _mv(7)  : 0;
    const ga4SessionsPrev = ga4 ? _mvP(0) : 0;

    const realTraffic: number | null     = ga4Sessions    > 0 ? ga4Sessions    : null;
    const realConversions: number | null = ga4Conversions > 0 ? ga4Conversions : null;
    const realConvRate: number | null    =
      ga4Sessions > 0 ? Math.round((ga4Conversions / ga4Sessions) * 10000) / 100 : null;
    const ga4TrafficDelta: number | null =
      realTraffic !== null && ga4SessionsPrev > 0
        ? Math.round(((ga4Sessions - ga4SessionsPrev) / ga4SessionsPrev) * 100) : null;

    // ── GSC: real clicks history ─────────────────────────────────────────────────
    const gscClicksHistory: Array<{ date: string; clicks: number }> | null =
      gscR.length > 0
        ? (gscR as Array<{ date: string; clicks: number }>).map(r => ({ date: r.date, clicks: Number(r.clicks) }))
        : null;
    const gscClicks30d: number | null =
      gscR.length > 0
        ? (gscR as Array<{ clicks: number }>).reduce((s, r) => s + Number(r.clicks), 0)
        : null;

    // ── GSC organic growth ───────────────────────────────────────────────────────
    let organicGrowthPct: number | null = null;
    if (gscR.length >= 2) {
      const half = Math.floor(gscR.length / 2);
      const prev = (gscR as Array<{ clicks: number }>).slice(0, half).reduce((s, r) => s + Number(r.clicks), 0);
      const cur  = (gscR as Array<{ clicks: number }>).slice(half).reduce((s, r)  => s + Number(r.clicks), 0);
      if (prev > 0) organicGrowthPct = Math.round(((cur - prev) / prev) * 100);
    }

    // ── Real weekly audit history ────────────────────────────────────────────────
    const auditHistory: Array<{ date: string; avg: number }> =
      (auditHistRows as Array<{ date: string; avg: string }>).map(r => ({
        date: r.date,
        avg:  Number(r.avg),
      }));

    // ── Core metrics ─────────────────────────────────────────────────────────────
    const seoScore    = Math.round(Number(auditRow?.avg_score ?? 0));
    const totalAudits = Number(auditRow?.count ?? 0);
    const prevScore   = Math.round(Number(prevRow?.prev_avg ?? 0));

    const monitorsUp   = monitorRows.filter((r: { status: string }) => r.status === "up").length;
    const monitorsDown = monitorRows.filter((r: { status: string }) => r.status === "down").length;
    const avgLatency   = monitorRows.length > 0
      ? Math.round(monitorRows.reduce((s: number, r: { avg_latency: string }) => s + Number(r.avg_latency ?? 0), 0) / monitorRows.length)
      : 0;
    const uptime = monitorRows.length > 0
      ? Math.round((monitorRows.reduce((s: number, r: { avg_uptime: string }) => s + Number(r.avg_uptime ?? 100), 0) / monitorRows.length) * 10) / 10
      : 100;
    const monitorUptime = monitorRows.length > 0 ? uptime : null;

    const missionsCompleted = Number(missionRows.find((r: { status: string }) => r.status === "done")?.count ?? 0);
    const missionsTodo      = Number(missionRows.find((r: { status: string }) => r.status === "todo")?.count ?? 0);
    const missionsInProg    = Number(missionRows.find((r: { status: string }) => r.status === "inprogress")?.count ?? 0);
    const totalMissions     = missionRows.reduce((s: number, r: { count: string }) => s + Number(r.count), 0);

    // ── Growth momentum ──────────────────────────────────────────────────────────
    let growthMomentum: number | null = null;
    if (prevScore > 0 && seoScore > 0) {
      growthMomentum = Math.min(100, Math.max(0, Math.round(50 + (seoScore - prevScore) * 5)));
    }

    // ── Local SEO score ──────────────────────────────────────────────────────────
    let localScore: number | null = null;
    const gbpCount = Number(gbpRow?.count ?? 0);
    if (gbpCount > 0 || monitorsUp > 0) {
      localScore = Math.min(100, 20 + Math.min(50, gbpCount * 5) + (monitorsUp > 0 ? 30 : 0));
    }

    // ── Competitor pressure ──────────────────────────────────────────────────────
    const competitorCount    = Number(compRow?.count ?? 0);
    const competitorPressure: number | null = competitorCount > 0
      ? Math.min(100, Math.round(20 + competitorCount * 15)) : null;
    const seoTrendDelta: number | null = prevScore > 0 && seoScore > 0 ? seoScore - prevScore : null;

    // ── Revenue opportunity: real € from revenue_leaks ───────────────────────────
    const leakAmount         = Math.round(Number(leakRow?.total ?? 0));
    const revenueOpportunity = leakAmount > 0 ? leakAmount : null;

    // ── Critical issues ──────────────────────────────────────────────────────────
    const unresolvedAlerts = Number(alertEvRow?.count ?? 0);
    let lowScoreAudits = 0;
    try {
      const lsQ = await pool.query(
        `SELECT COUNT(*) as count FROM audits
         WHERE org_id=$1 AND score < 50 AND created_at > NOW() - INTERVAL '1 day' * $2`,
        [orgId, range]
      );
      lowScoreAudits = Number(lsQ.rows[0]?.count ?? 0);
    } catch { /* ignore */ }
    const criticalIssues = lowScoreAudits + monitorsDown + unresolvedAlerts;

    // ── Workspace health (independent of uptime) ─────────────────────────────────
    // Components:
    //   Mission completion rate    → 0-50 pts
    //   Active alert rules         → 0-30 pts (5 pts each, max 6)
    //   Reports generated (30d)    → 0-20 pts (5 pts each, max 4)
    let workspaceHealth: number | null = null;
    {
      const [alertRulesQ, reportsQ] = await Promise.allSettled([
        pool.query(`SELECT COUNT(*) as count FROM alert_rules WHERE org_id=$1 AND enabled=true`, [orgId])
          .catch(() => ({ rows: [{ count: 0 }] })),
        pool.query(`SELECT COUNT(*) as count FROM report_exports WHERE org_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [orgId])
          .catch(() => ({ rows: [{ count: 0 }] })),
      ]);
      const enabledRules  = Number(alertRulesQ.status === "fulfilled"
        ? (alertRulesQ.value as { rows: Array<{ count: number }> }).rows[0]?.count : 0);
      const recentReports = Number(reportsQ.status === "fulfilled"
        ? (reportsQ.value as { rows: Array<{ count: number }> }).rows[0]?.count : 0);

      const missionScore = totalMissions > 0
        ? Math.round((missionsCompleted / totalMissions) * 50) : 0;
      const alertScore   = Math.min(30, enabledRules  * 5);
      const reportScore  = Math.min(20, recentReports * 5);

      if (totalMissions > 0 || enabledRules > 0 || recentReports > 0) {
        workspaceHealth = Math.min(100, missionScore + alertScore + reportScore);
      }
    }

    // ── GBP profile fields ───────────────────────────────────────────────────────
    const gbpRating: number | null =
      gbpProfileRow?.avg_rating != null ? Math.round(Number(gbpProfileRow.avg_rating) * 10) / 10 : null;
    const gbpReviewCount: number | null =
      gbpProfileRow?.review_count != null ? Number(gbpProfileRow.review_count) : null;
    const gbpUnansweredCount: number | null =
      gbpProfileRow?.unanswered_count != null ? Number(gbpProfileRow.unanswered_count) : null;
    const gbpCompletionPct: number | null =
      gbpProfileRow?.completion_pct != null ? Number(gbpProfileRow.completion_pct) : null;

    const result: OverviewMetrics = {
      seoScore,
      avgScore:      seoScore,
      seoScoreDelta: seoTrendDelta ?? (seoScore > 50 ? 3 : -2),

      traffic:          realTraffic,
      trafficDelta:     ga4TrafficDelta,
      conversions:      realConversions,
      conversionsDelta: null,
      revenue:          null,
      revenueDelta:     null,
      conversionRate:   realConvRate,
      conversionScore:  realConvRate,
      analyticsConnected: analyticsConnected || realTraffic !== null,

      monitorsUp, monitorsDown, monitorUptime,
      auditsThisMonth: totalAudits,
      keywordsTracked: Number(kwRow?.total ?? 0),
      keywordsTop3:    Number(kwRow?.top3  ?? 0),
      keywordsTop10:   Number(kwRow?.top10 ?? 0),
      missionsOpen:    missionsTodo + missionsInProg,
      missionsCompleted,
      aiCreditsUsed:   Number(aiRow?.credits_used ?? 0),
      aiCreditsLimit,
      aiPlanLimit,
      revenueLeaks:      Number(leakRow?.count ?? 0),
      revenueLeakAmount: leakAmount,
      avgLatency, uptime,
      competitors: competitorCount,
      trendsUp:    Number(kwRow?.up   ?? 0),
      trendsDown:  Number(kwRow?.down ?? 0),
      growthMomentum, localScore, competitorPressure, seoTrendDelta, organicGrowthPct,
      range,

      auditHistory,
      gscClicks30d,
      gscClicksHistory,
      revenueOpportunity,
      criticalIssues,
      workspaceHealth,
      gbpConnected,
      gbpRating,
      gbpReviewCount,
      gbpUnansweredCount,
      gbpCompletionPct,
    };

    _cache.set(cacheKey, { data: result, expiresAt: Date.now() + 60_000 });
    return result;
  } catch (err) {
    throw err;
  }
}

/** Invalidate overview cache for an org (call after audits/monitors mutate) */
export function invalidateOverviewCache(orgId: string): void {
  for (const key of _cache.keys()) {
    if (key.startsWith(`${orgId}:`)) _cache.delete(key);
  }
}
