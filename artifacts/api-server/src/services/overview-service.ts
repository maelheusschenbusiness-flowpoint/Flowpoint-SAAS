import { pool } from "@workspace/db";

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
  aiCreditsLimit: number;
  revenueLeaks: number;
  revenueLeakAmount: number;
  avgLatency: number;
  uptime: number;
  competitors: number;
  trendsUp: number;
  trendsDown: number;
  /** Growth momentum 0-100 computed from audit score trend; null = insufficient history */
  growthMomentum: number | null;
  /** Local SEO score 0-100 derived from GBP activity; null = no local data */
  localScore: number | null;
  /** Competitor pressure 0-100 from competitor count; null = no competitors tracked */
  competitorPressure: number | null;
  /** SEO score delta vs previous 30-day period */
  seoTrendDelta: number | null;
  /** Organic growth % (placeholder for GSC; null until connected) */
  organicGrowthPct: number | null;
}

/** 60-second in-memory cache per org — prevents repeated heavy queries */
const _cache = new Map<string, { data: OverviewMetrics; expiresAt: number }>();

export async function getOverviewMetrics(orgId = "default"): Promise<OverviewMetrics> {
  const cached = _cache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  try {
    const [audits, auditsPrev, monitors, keywords, missions, ai, leaks, connectors, gbpPosts, competitorsQ] =
      await Promise.allSettled([
        // Current 30-day audit avg + count
        pool.query(
          `SELECT AVG(score) as avg_score, COUNT(*) as count
           FROM audits
           WHERE created_at > NOW() - INTERVAL '30 days'`
        ),
        // Previous 30-60 day period for trend computation
        pool.query(
          `SELECT AVG(score) as prev_avg
           FROM audits
           WHERE created_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() - INTERVAL '30 days'`
        ),
        pool.query(
          `SELECT status,
                  AVG(latency) as avg_latency,
                  AVG(uptime)  as avg_uptime
           FROM monitors
           GROUP BY status`
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
          `SELECT credits_used, credits_limit
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
           WHERE status='active'`
        ),
        // Check if an analytics connector (GA4, Matomo) is connected for this org
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
        // Competitor count from Supabase table for pressure calculation
        pool.query(
          `SELECT COUNT(*) as count FROM competitors WHERE org_id=$1`,
          [orgId]
        ),
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

    const missionsOpen      = Number(missionRows.find((r: { status: string }) => r.status === "open")?.count      ?? 0);
    const missionsCompleted = Number(missionRows.find((r: { status: string }) => r.status === "done")?.count       ?? 0);

    // ── Growth momentum: score trend vs previous period, scaled 0-100 ──────────
    // 50 = flat, >50 = improving, <50 = declining
    let growthMomentum: number | null = null;
    if (prevScore > 0 && seoScore > 0) {
      const delta = seoScore - prevScore;
      growthMomentum = Math.min(100, Math.max(0, Math.round(50 + delta * 5)));
    } else if (totalAudits > 0 && seoScore > 0) {
      // No previous period data but audits exist — use score itself as baseline
      growthMomentum = Math.min(100, Math.round(seoScore * 0.7));
    }

    // ── Local SEO score: derived from GBP posts + monitor health ───────────────
    // Honest proxy: GBP posting activity + uptime. Null if no local activity at all.
    let localScore: number | null = null;
    const gbpCount = Number(gbpRow?.count ?? 0);
    if (gbpCount > 0 || monitorsUp > 0) {
      const gbpContrib  = Math.min(50, gbpCount * 5);      // 0-50 pts from GBP activity
      const monContrib  = monitorsUp > 0 ? 30 : 0;         // 30 pts for having monitors up
      const baseScore   = 20;                               // baseline for having the system
      localScore = Math.min(100, baseScore + gbpContrib + monContrib);
    }

    // ── Competitor pressure: derived from Supabase competitors table count ──────
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

      // ── Analytics metrics: null when GA4 not connected ──────────────────────
      // Do NOT fabricate traffic/revenue figures. Frontend shows a "Connect GA4"
      // CTA when these are null.
      traffic:          null,
      trafficDelta:     null,
      conversions:      null,
      conversionsDelta: null,
      revenue:          null,
      revenueDelta:     null,
      conversionScore:  null,
      analyticsConnected,
      // ────────────────────────────────────────────────────────────────────────

      monitorsUp,
      monitorsDown,
      monitorUptime,
      auditsThisMonth: totalAudits,
      keywordsTracked: Number(kwRow?.total ?? 0),
      keywordsTop3:    Number(kwRow?.top3  ?? 0),
      keywordsTop10:   Number(kwRow?.top10 ?? 0),
      missionsOpen,
      missionsCompleted,
      aiCreditsUsed:     Number(aiRow?.credits_used  ?? 0),
      aiCreditsLimit:    Number(aiRow?.credits_limit ?? 100_000),
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
      organicGrowthPct: null,  // Reserved for GSC integration
    };

    _cache.set(orgId, { data: result, expiresAt: Date.now() + 60_000 });
    return result;
  } catch (err) {
    throw err;
  }
}
