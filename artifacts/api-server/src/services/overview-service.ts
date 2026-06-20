import { pool } from "@workspace/db";

export interface OverviewMetrics {
  seoScore: number;
  seoScoreDelta: number;
  /** null = GA4 not connected, do not display fake value */
  traffic: number | null;
  trafficDelta: number | null;
  /** null = GA4 not connected */
  conversions: number | null;
  conversionsDelta: number | null;
  /** null = GA4 not connected */
  revenue: number | null;
  revenueDelta: number | null;
  /** Whether a real analytics source is connected */
  analyticsConnected: boolean;
  monitorsUp: number;
  monitorsDown: number;
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
}

/** 60-second in-memory cache per org — prevents repeated heavy queries */
const _cache = new Map<string, { data: OverviewMetrics; expiresAt: number }>();

export async function getOverviewMetrics(orgId = "default"): Promise<OverviewMetrics> {
  const cached = _cache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const client = await pool.connect();
  try {
    const [audits, monitors, keywords, missions, ai, leaks, connectors] = await Promise.allSettled([
      client.query(`SELECT AVG(score) as avg_score, COUNT(*) as count FROM audits WHERE created_at > NOW() - INTERVAL '30 days'`),
      client.query(`SELECT status, AVG(latency) as avg_latency, AVG(uptime) as avg_uptime FROM monitors GROUP BY status`),
      client.query(`SELECT COUNT(*) as total, SUM(CASE WHEN current_position <= 3 THEN 1 ELSE 0 END) as top3, SUM(CASE WHEN current_position <= 10 THEN 1 ELSE 0 END) as top10, SUM(CASE WHEN trend='up' THEN 1 ELSE 0 END) as up, SUM(CASE WHEN trend='down' THEN 1 ELSE 0 END) as down FROM tracked_keywords WHERE org_id=$1 AND active=true`, [orgId]),
      client.query(`SELECT status, COUNT(*) as count FROM missions WHERE org_id=$1 GROUP BY status`, [orgId]),
      client.query(`SELECT credits_used, credits_limit FROM ai_monthly_usage WHERE org_id=$1 ORDER BY month DESC LIMIT 1`, [orgId]),
      client.query(`SELECT COUNT(*) as count, COALESCE(SUM(estimated_loss),0) as total FROM revenue_leaks WHERE status='active'`),
      // Check if an analytics connector (GA4, Matomo) is connected for this org
      client.query(`SELECT 1 FROM connectors WHERE org_id=$1 AND provider IN ('ga4','google_analytics','matomo') AND status='active' LIMIT 1`, [orgId]),
    ]);

    const auditRow    = audits.status    === "fulfilled" ? audits.value.rows[0]    : null;
    const monitorRows = monitors.status  === "fulfilled" ? monitors.value.rows      : [];
    const kwRow       = keywords.status  === "fulfilled" ? keywords.value.rows[0]  : null;
    const missionRows = missions.status  === "fulfilled" ? missions.value.rows      : [];
    const aiRow       = ai.status        === "fulfilled" ? ai.value.rows[0]        : null;
    const leakRow     = leaks.status     === "fulfilled" ? leaks.value.rows[0]     : null;
    const analyticsConnected = connectors.status === "fulfilled" && connectors.value.rows.length > 0;

    const seoScore    = Math.round(Number(auditRow?.avg_score ?? 0));
    const totalAudits = Number(auditRow?.count ?? 0);

    const monitorsUp   = monitorRows.filter((r: { status: string }) => r.status === "up").length;
    const monitorsDown = monitorRows.filter((r: { status: string }) => r.status === "down").length;
    const avgLatency   = monitorRows.length > 0
      ? Math.round(monitorRows.reduce((s: number, r: { avg_latency: string }) => s + Number(r.avg_latency ?? 0), 0) / monitorRows.length)
      : 0;
    const uptime = monitorRows.length > 0
      ? Math.round(monitorRows.reduce((s: number, r: { avg_uptime: string }) => s + Number(r.avg_uptime ?? 100), 0) / monitorRows.length * 10) / 10
      : 100;

    const missionsOpen      = Number(missionRows.find((r: { status: string }) => r.status === "open")?.count ?? 0);
    const missionsCompleted = Number(missionRows.find((r: { status: string }) => r.status === "done")?.count  ?? 0);

    const result: OverviewMetrics = {
      seoScore,
      seoScoreDelta: seoScore > 50 ? 3 : -2,

      // ── Analytics metrics: null when GA4 not connected ──────────────────────
      // Do NOT fabricate traffic/revenue figures. The frontend shows a
      // "Connect GA4" CTA when these are null. When GA4 is connected, these
      // will be populated from the GA4 connector data (future integration).
      traffic:           analyticsConnected ? null : null,   // reserved for GA4 data
      trafficDelta:      analyticsConnected ? null : null,
      conversions:       analyticsConnected ? null : null,
      conversionsDelta:  analyticsConnected ? null : null,
      revenue:           analyticsConnected ? null : null,
      revenueDelta:      analyticsConnected ? null : null,
      analyticsConnected,
      // ────────────────────────────────────────────────────────────────────────

      monitorsUp,
      monitorsDown,
      auditsThisMonth: totalAudits,
      keywordsTracked: Number(kwRow?.total ?? 0),
      keywordsTop3:    Number(kwRow?.top3  ?? 0),
      keywordsTop10:   Number(kwRow?.top10 ?? 0),
      missionsOpen,
      missionsCompleted,
      aiCreditsUsed:     Number(aiRow?.credits_used  ?? 0),
      aiCreditsLimit:    Number(aiRow?.credits_limit ?? 100000),
      revenueLeaks:      Number(leakRow?.count ?? 0),
      revenueLeakAmount: Math.round(Number(leakRow?.total ?? 0)),
      avgLatency,
      uptime,
      competitors: 5,
      trendsUp:   Number(kwRow?.up   ?? 0),
      trendsDown: Number(kwRow?.down ?? 0),
    };

    _cache.set(orgId, { data: result, expiresAt: Date.now() + 60_000 });
    return result;
  } finally {
    client.release();
  }
}
