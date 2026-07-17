import { pool } from "@workspace/db";
import { getGA4Overview } from "./ga4-service.js";
import { getImpressionsOverTime } from "./gsc-service.js";
import { PLAN_AI_CREDITS } from "../lib/plans.js";

export interface OverviewMetrics {
  seoScore: number;
  seoScoreDelta: number;
  avgScore: number;
  /** null = GA4 not connected, do not display fake value */
  traffic: number | null;
  trafficDelta: number | null;
  /** null = GA4 not connected */
  conversions: number | null;
  conversionsDelta: number | null;
  /** null = GA4 not connected */
  revenue: number | null;
  revenueDelta: number | null;
  /** null = GA4 not connected — never fabricate */
  conversionScore: number | null;
  /** Whether a real analytics source is connected */
  analyticsConnected: boolean;
  monitorsUp: number;
  monitorsDown: number;
  /** null = not enough audit history */
  monitorUptime: number | null;
  auditsThisMonth: number;
  keywordsTracked: number;
  keywordsTop3: number;
  keywordsTop10: number;
  missionsOpen: number;
  missionsCompleted: number;
  aiCreditsUsed: number;
  /** Total usable credits = plan base + purchased add-ons */
  aiCreditsLimit: number;
  /** Base plan credit allowance (for UI breakdown) */
  aiPlanLimit: number;
  revenueLeaks: number;
  revenueLeakAmount: number;
  avgLatency: number;
  uptime: number;
  competitors: number;
  trendsUp: number;
  trendsDown: number;
  /** Growth momentum 0-100 computed from audit score trend; null = insufficient history (2+ periods) */
  growthMomentum: number | null;
  /** Local SEO score 0-100 derived from GBP activity; null = no local data */
  localScore: number | null;
  /** Competitor pressure 0-100 from competitor count; null = no competitors tracked */
  competitorPressure: number | null;
  /** SEO score delta vs previous period */
  seoTrendDelta: number | null;
  /** Organic growth % (placeholder for GSC; null until connected) */
  organicGrowthPct: number | null;
  /** Range used for this computation (days) */
  range: number;
}

/** In-memory cache keyed by `orgId:range` — 60 s TTL */
const _cache = new Map<string, { data: OverviewMetrics; expiresAt: number }>();

export async function getOverviewMetrics(orgId = "default", range = 30, rangeLabel = "30d"): Promise<OverviewMetrics> {
  const cacheKey = `${orgId}:${rangeLabel}`;
  const cached = _cache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const today     = new Date().toISOString().slice(0, 10);
    const rangeAgo  = new Date(Date.now() - range * 86400000).toISOString().slice(0, 10);

    const [audits, auditsPrev, monitors, keywords, missions, ai, leaks, connectors, gbpPosts, competitorsQ, orgPlan, ga4Data, gscData] =
      await Promise.allSettled([
        // Current period audit avg + count
        pool.query(
          `SELECT AVG(score) as avg_score, COUNT(*) as count
           FROM audits
           WHERE org_id = $1 AND created_at > NOW() - INTERVAL '1 day' * $2`,
          [orgId, range]
        ),
        // Previous period (same length) for trend — always 30-day window regardless of range
        pool.query(
          `SELECT AVG(score) as prev_avg
           FROM audits
           WHERE org_id = $1
             AND created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'`,
          [orgId]
        ),
        pool.query(
          `SELECT status,
                  AVG(latency) as avg_latency,
                  AVG(uptime)  as avg_uptime
           FROM monitors
           WHERE org_id = $1
           GROUP BY status`,
          [orgId]
        ),
        pool.query(
          `SELECT COUNT(*) as total,
                  SUM(CASE WHEN current_position <= 3  THEN 1 ELSE 0 END) as top3,
                  SUM(CASE WHEN current_position <= 10 THEN 1 ELSE 0 END) as top10,
                  SUM(CASE WHEN trend='up'   THEN 1 ELSE 0 END) as up,
                  SUM(CASE WHEN trend='down' THEN 1 ELSE 0 END) as down
           FROM tracked_keywords
           WHERE org_id=$1 AND active=true`,
          [orgId]
        ),
        pool.query(
          `SELECT status, COUNT(*) as count
           FROM missions
           WHERE org_id=$1
           GROUP BY status`,
          [orgId]
        ),
        pool.query(
          `SELECT credits_used
           FROM ai_monthly_usage
           WHERE org_id=$1
           ORDER BY month DESC
           LIMIT 1`,
          [orgId]
        ),
        pool.query(
          `SELECT COUNT(*) as count,
                  COALESCE(SUM(estimated_loss), 0) as total
           FROM revenue_leaks
           WHERE org_id=$1 AND status='active'`,
          [orgId]
        ),
        // Check if an analytics connector (GA4, Matomo) is connected
        pool.query(
          `SELECT 1
           FROM connectors
           WHERE org_id=$1
             AND provider IN ('ga4','google_analytics','matomo')
             AND status='active'
           LIMIT 1`,
          [orgId]
        ),
        // GBP posts count — proxy for local SEO activity
        pool.query(
          `SELECT COUNT(*) as count
           FROM gbp_posts
           WHERE org_id=$1`,
          [orgId]
        ),
        // Competitor count
        pool.query(
          `SELECT COUNT(*) as count FROM competitors WHERE org_id=$1`,
          [orgId]
        ),
        // Org plan from org_settings — more reliable than store.me singleton
        pool.query(
          `SELECT plan, addons FROM org_settings WHERE org_id=$1 LIMIT 1`,
          [orgId]
        ),
        // Real GA4 traffic
        getGA4Overview(orgId, rangeAgo, today),
        // Real GSC impressions time series
        getImpressionsOverTime(orgId, range),
      ]);

    const auditRow    = audits.status      === "fulfilled" ? audits.value.rows[0]       : null;
    const prevRow     = auditsPrev.status  === "fulfilled" ? auditsPrev.value.rows[0]   : null;
    const monitorRows = monitors.status    === "fulfilled" ? monitors.value.rows         : [];
    const kwRow       = keywords.status    === "fulfilled" ? keywords.value.rows[0]     : null;
    const missionRows = missions.status    === "fulfilled" ? missions.value.rows         : [];
    const aiRow       = ai.status          === "fulfilled" ? ai.value.rows[0]           : null;
    const leakRow     = leaks.status       === "fulfilled" ? leaks.value.rows[0]        : null;
    const analyticsConnected =
      connectors.status === "fulfilled" && connectors.value.rows.length > 0;
    const gbpRow      = gbpPosts.status    === "fulfilled" ? gbpPosts.value.rows[0]     : null;
    const compRow     = competitorsQ.status === "fulfilled" ? competitorsQ.value.rows[0] : null;
    const orgPlanRow  = orgPlan.status     === "fulfilled" ? orgPlan.value.rows[0]      : null;

    // ── Plan credits — query org_settings directly for accuracy ────────────────
    const orgPlanKey = (orgPlanRow?.plan ?? 'standard').toLowerCase() as string;
    const aiPlanLimit = PLAN_AI_CREDITS[orgPlanKey] ?? PLAN_AI_CREDITS["standard"]!;
    // Extra AI credits purchased as add-on packs (stored in addons JSONB)
    const addons = (orgPlanRow?.addons ?? {}) as Record<string, unknown>;
    const aiExtraPacks = ["aiCreditsPack50k","aiCreditsPack200k","aiCreditsPack500k"];
    const extraCreditMap: Record<string, number> = {
      aiCreditsPack50k: 50_000, aiCreditsPack200k: 200_000, aiCreditsPack500k: 500_000
    };
    let aiExtraCredits = 0;
    for (const pack of aiExtraPacks) {
      if (addons[pack]) aiExtraCredits += extraCreditMap[pack] ?? 0;
    }
    const aiCreditsLimit = aiPlanLimit + aiExtraCredits;

    // ── Real GA4 metrics ────────────────────────────────────────────────────────
    // GA4 metric indices (from getGA4Overview): 0=sessions 1=totalUsers 2=newUsers
    //   3=bounceRate 4=engagementRate 5=avgDuration 6=pageViews 7=conversions
    const ga4     = ga4Data.status === "fulfilled" ? ga4Data.value : null;
    const gscRows = gscData.status === "fulfilled" ? gscData.value : [];

    const _mv  = (idx: number): number => Math.round(parseFloat(ga4?.totals?.[0]?.metricValues?.[idx]?.value ?? "0") * 100) / 100;
    const _mvP = (idx: number): number => Math.round(parseFloat(ga4?.totals?.[1]?.metricValues?.[idx]?.value ?? "0") * 100) / 100;

    const ga4Sessions     = ga4 ? _mv(0) : 0;
    const ga4Conversions  = ga4 ? _mv(7) : 0;
    const ga4SessionsPrev = ga4 ? _mvP(0) : 0;

    const realTraffic: number | null      = ga4Sessions > 0     ? ga4Sessions     : null;
    const realConversions: number | null  = ga4Conversions > 0  ? ga4Conversions  : null;
    const realRevenue: number | null      = null; // not in getGA4Overview metric set
    const realConvRate: number | null     =
      ga4Sessions > 0 ? Math.round((ga4Conversions / ga4Sessions) * 10000) / 100 : null;

    const ga4TrafficDelta: number | null =
      realTraffic !== null && ga4SessionsPrev > 0
        ? Math.round(((ga4Sessions - ga4SessionsPrev) / ga4SessionsPrev) * 100)
        : null;

    // ── GSC organic growth ──────────────────────────────────────────────────────
    let organicGrowthPct: number | null = null;
    if (gscRows.length >= 2) {
      const half = Math.floor(gscRows.length / 2);
      const prev = (gscRows as Array<{ clicks: number }>)
        .slice(0, half).reduce((s, r) => s + Number(r.clicks), 0);
      const cur  = (gscRows as Array<{ clicks: number }>)
        .slice(half).reduce((s, r) => s + Number(r.clicks), 0);
      if (prev > 0) organicGrowthPct = Math.round(((cur - prev) / prev) * 100);
    }

    // ── Core metrics ────────────────────────────────────────────────────────────
    const seoScore    = Math.round(Number(auditRow?.avg_score ?? 0));
    const totalAudits = Number(auditRow?.count ?? 0);
    const prevScore   = Math.round(Number(prevRow?.prev_avg ?? 0));

    const monitorsUp   = monitorRows.filter((r: { status: string }) => r.status === "up").length;
    const monitorsDown = monitorRows.filter((r: { status: string }) => r.status === "down").length;
    const avgLatency   =
      monitorRows.length > 0
        ? Math.round(
            monitorRows.reduce(
              (s: number, r: { avg_latency: string }) => s + Number(r.avg_latency ?? 0),
              0
            ) / monitorRows.length
          )
        : 0;
    const uptime =
      monitorRows.length > 0
        ? Math.round(
            (monitorRows.reduce(
              (s: number, r: { avg_uptime: string }) => s + Number(r.avg_uptime ?? 100),
              0
            ) /
              monitorRows.length) *
              10
          ) / 10
        : 100;
    const monitorUptime = monitorRows.length > 0 ? uptime : null;

    const missionsOpen      = Number(missionRows.find((r: { status: string }) => r.status === "open")?.count  ?? 0);
    const missionsCompleted = Number(missionRows.find((r: { status: string }) => r.status === "done")?.count  ?? 0);

    // ── Growth momentum: requires BOTH periods to have data ────────────────────
    // null = insufficient history (no fallback to avoid inflating score)
    let growthMomentum: number | null = null;
    if (prevScore > 0 && seoScore > 0) {
      const delta = seoScore - prevScore;
      growthMomentum = Math.min(100, Math.max(0, Math.round(50 + delta * 5)));
    }
    // No fallback when only current period exists — let frontend show null state

    // ── Local SEO score ─────────────────────────────────────────────────────────
    let localScore: number | null = null;
    const gbpCount = Number(gbpRow?.count ?? 0);
    if (gbpCount > 0 || monitorsUp > 0) {
      const gbpContrib = Math.min(50, gbpCount * 5);
      const monContrib = monitorsUp > 0 ? 30 : 0;
      localScore = Math.min(100, 20 + gbpContrib + monContrib);
    }

    // ── Competitor pressure ─────────────────────────────────────────────────────
    const competitorCount = Number(compRow?.count ?? 0);
    const competitorPressure: number | null = competitorCount > 0
      ? Math.min(100, Math.round(20 + competitorCount * 15))
      : null;

    // ── Score trend delta ───────────────────────────────────────────────────────
    const seoTrendDelta: number | null =
      prevScore > 0 && seoScore > 0 ? seoScore - prevScore : null;

    const result: OverviewMetrics = {
      seoScore,
      avgScore: seoScore,
      seoScoreDelta: seoTrendDelta ?? (seoScore > 50 ? 3 : -2),

      traffic:          realTraffic,
      trafficDelta:     ga4TrafficDelta,
      conversions:      realConversions,
      conversionsDelta: null,
      revenue:          realRevenue,
      revenueDelta:     null,
      conversionScore:  realConvRate,
      analyticsConnected: analyticsConnected || realTraffic !== null,

      monitorsUp,
      monitorsDown,
      monitorUptime,
      auditsThisMonth: totalAudits,
      keywordsTracked: Number(kwRow?.total ?? 0),
      keywordsTop3:    Number(kwRow?.top3  ?? 0),
      keywordsTop10:   Number(kwRow?.top10 ?? 0),
      missionsOpen,
      missionsCompleted,
      aiCreditsUsed:  Number(aiRow?.credits_used ?? 0),
      aiCreditsLimit,
      aiPlanLimit,
      revenueLeaks:      Number(leakRow?.count ?? 0),
      revenueLeakAmount: Math.round(Number(leakRow?.total ?? 0)),
      avgLatency,
      uptime,
      competitors: competitorCount,
      trendsUp:   Number(kwRow?.up   ?? 0),
      trendsDown: Number(kwRow?.down ?? 0),
      growthMomentum,
      localScore,
      competitorPressure,
      seoTrendDelta,
      organicGrowthPct,
      range,
    };

    _cache.set(cacheKey, { data: result, expiresAt: Date.now() + 60_000 });
    return result;
  } catch (err) {
    throw err;
  }
}
