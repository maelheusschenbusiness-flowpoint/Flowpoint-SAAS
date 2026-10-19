import { pool } from "@workspace/db";

export interface MarketDashboard {
  trends: MarketTrend[];
  opportunities: MarketOpportunity[];
  signals: IndustrySignal[];
  competitor_movements: CompetitorMovement[];
  summary: { score: number; trendingUp: number; opportunities: number; threats: number };
  stats: { avgOpportunityScore: number; emergingTrends: number };
}

interface MarketTrend { id: string; keyword: string; category: string; search_volume: number; growth_rate: number | null; trend_direction: "up" | "down" | "stable"; opportunity_score: number; geo: string; }
interface MarketOpportunity { id: string; type: string; title: string; description: string; score: number; estimated_impact: string; }
interface IndustrySignal { id: string; type: string; title: string; description: string; severity: string; }
interface CompetitorMovement { id: string; competitor: string; type: string; description: string; detected_at: string; }

type GscTrendInput = {
  keyword: string;
  recent_clicks: number | string | null;
  previous_clicks: number | string | null;
  recent_impressions: number | string | null;
};

export function deriveMarketTrends(rows: readonly GscTrendInput[]): MarketTrend[] {
  return rows.flatMap((row) => {
    const keyword = String(row.keyword ?? "").trim();
    const recent = Number(row.recent_clicks) || 0;
    const previous = Number(row.previous_clicks) || 0;
    const impressions = Number(row.recent_impressions) || 0;
    if (!keyword || impressions <= 0) return [];
    const growth = previous > 0 ? Math.round(((recent - previous) / previous) * 100) : null;
    const opportunityScore = Math.max(0, Math.min(100, Math.round(
      Math.log10(impressions + 1) * 12 + Math.max(0, growth ?? 0) * 0.15
    )));
    const trendDirection: MarketTrend["trend_direction"] = growth === null ? "stable" : growth > 0 ? "up" : growth < 0 ? "down" : "stable";
    return [{
      id: `gsc:${keyword.toLowerCase()}`,
      keyword,
      category: "Google Search Console",
      search_volume: impressions,
      growth_rate: growth,
      trend_direction: trendDirection,
      opportunity_score: opportunityScore,
      geo: "—",
    }];
  }).sort((a, b) => b.opportunity_score - a.opportunity_score).slice(0, 20);
}

type CompetitorSnapshot = {
  competitor_domain: string;
  keyword: string | null;
  position: number | string;
  checked_at: string | Date;
};

export function deriveCompetitorMovements(rows: readonly CompetitorSnapshot[]): CompetitorMovement[] {
  const grouped = new Map<string, CompetitorSnapshot[]>();
  for (const row of rows) {
    const competitor = String(row.competitor_domain ?? "").trim().toLowerCase();
    const keyword = String(row.keyword ?? "").trim();
    const position = Number(row.position);
    if (!competitor || !keyword || !Number.isFinite(position) || position <= 0) continue;
    const key = `${competitor}\u0000${keyword.toLowerCase()}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  const movements: CompetitorMovement[] = [];
  for (const [key, snapshots] of grouped) {
    const ordered = snapshots.sort((a, b) => new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime());
    if (ordered.length < 2) continue;
    const current = Number(ordered[0].position);
    const previous = Number(ordered[1].position);
    if (current === previous) continue;
    const [competitor, keyword] = key.split("\u0000");
    movements.push({
      id: `rank:${competitor}:${keyword}:${new Date(ordered[0].checked_at).toISOString()}`,
      competitor,
      type: current < previous ? "ranking_gain" : "ranking_loss",
      description: `${keyword} : position ${previous} → ${current} (observations enregistrées)`,
      detected_at: new Date(ordered[0].checked_at).toISOString(),
    });
  }
  return movements.sort((a, b) => b.detected_at.localeCompare(a.detected_at)).slice(0, 20);
}

export async function getMarketDashboard(orgId: string): Promise<MarketDashboard> {
  const client = await pool.connect();
  try {
    const [trendRows, opportunityRows, signals, rankingRows] = await Promise.all([
      client.query<GscTrendInput>(
        `SELECT keyword,
                SUM(clicks) FILTER (WHERE date >= CURRENT_DATE - INTERVAL '28 days')::int AS recent_clicks,
                SUM(clicks) FILTER (WHERE date >= CURRENT_DATE - INTERVAL '56 days'
                                    AND date < CURRENT_DATE - INTERVAL '28 days')::int AS previous_clicks,
                SUM(impressions) FILTER (WHERE date >= CURRENT_DATE - INTERVAL '28 days')::int AS recent_impressions
           FROM gsc_keyword_data
          WHERE org_id=$1 AND date >= CURRENT_DATE - INTERVAL '56 days'
          GROUP BY keyword
         HAVING SUM(impressions) FILTER (WHERE date >= CURRENT_DATE - INTERVAL '28 days') > 0
          ORDER BY recent_impressions DESC LIMIT 100`,
        [orgId]
      ),
      client.query(
        `SELECT page, SUM(clicks)::int AS clicks, SUM(impressions)::int AS impressions,
                ROUND(100.0 * SUM(clicks) / NULLIF(SUM(impressions), 0), 2) AS ctr
           FROM gsc_page_data
          WHERE org_id=$1 AND date >= CURRENT_DATE - INTERVAL '28 days'
          GROUP BY page
         HAVING SUM(impressions) >= 100
            AND SUM(clicks)::numeric / NULLIF(SUM(impressions), 0) < 0.02
          ORDER BY SUM(impressions) DESC LIMIT 15`,
        [orgId]
      ),
      client.query(`SELECT * FROM industry_signals WHERE org_id=$1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC LIMIT 10`, [orgId]),
      client.query<CompetitorSnapshot>(
        `WITH recent AS (
           SELECT competitor_domain, keyword, position, checked_at,
                  ROW_NUMBER() OVER (PARTITION BY competitor_domain, keyword ORDER BY checked_at DESC, id DESC) AS rn
             FROM competitor_rankings
            WHERE org_id=$1 AND checked_at >= NOW() - INTERVAL '90 days'
              AND keyword IS NOT NULL AND position IS NOT NULL
         )
         SELECT competitor_domain, keyword, position, checked_at
           FROM recent WHERE rn <= 2
          ORDER BY checked_at DESC LIMIT 2000`,
        [orgId]
      ),
    ]);
    const trends = deriveMarketTrends(trendRows.rows);
    const opportunities: MarketOpportunity[] = opportunityRows.rows.map((row) => {
      const impressions = Number(row.impressions) || 0;
      const ctr = Number(row.ctr) || 0;
      return {
        id: `gsc-page:${String(row.page)}`,
        type: "low_ctr",
        title: `CTR à améliorer : ${String(row.page)}`,
        description: `${impressions} impressions et ${Number(row.clicks) || 0} clics sur 28 jours (CTR observé : ${ctr} %).`,
        score: Math.max(0, Math.min(100, Math.round(Math.log10(impressions + 1) * 20))),
        estimated_impact: "À mesurer",
      };
    });
    const competitorMovements = deriveCompetitorMovements(rankingRows.rows);
    const avgOpportunityScore = trends.length > 0
      ? Math.round(trends.reduce((sum, trend) => sum + trend.opportunity_score, 0) / trends.length)
      : 0;
    const emergingTrends = trends.filter((trend) => trend.growth_rate !== null && trend.growth_rate > 0).length;
    return {
      trends, opportunities, signals: signals.rows, competitor_movements: competitorMovements,
      summary: {
        score: avgOpportunityScore,
        trendingUp: emergingTrends,
        opportunities: opportunities.length,
        threats: competitorMovements.filter((movement) => movement.type === "ranking_gain").length,
      },
      stats: { avgOpportunityScore, emergingTrends },
    };
  } finally { client.release(); }
}

export async function generateMarketReport(orgId: string): Promise<Record<string, unknown>> {
  const dashboard = await getMarketDashboard(orgId);
  const id = `mr_${orgId}_${Date.now()}`;
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ai_market_reports (id, org_id, title, summary, data, generated_at)
       VALUES ($1,$2,$3,$4,$5,NOW()) ON CONFLICT DO NOTHING`,
      [id, orgId, `Rapport Intelligence Marché — ${new Date().toLocaleDateString("fr-FR")}`,
       `${dashboard.trends.length} tendances analysées, ${dashboard.opportunities.length} opportunités identifiées`,
       JSON.stringify(dashboard)]
    );
  } finally { client.release(); }
  return { id, ...dashboard };
}

export async function detectCompetitorMovements(orgId: string, domain?: string): Promise<CompetitorMovement[]> {
  const client = await pool.connect();
  try {
    const values: unknown[] = [orgId];
    let filter = "";
    if (domain) {
      values.push(domain.trim().toLowerCase());
      filter = " AND LOWER(competitor_domain)=$2";
    }
    const result = await client.query<CompetitorSnapshot>(
      `WITH recent AS (
         SELECT competitor_domain, keyword, position, checked_at,
                ROW_NUMBER() OVER (PARTITION BY competitor_domain, keyword ORDER BY checked_at DESC, id DESC) AS rn
           FROM competitor_rankings
          WHERE org_id=$1${filter} AND checked_at >= NOW() - INTERVAL '90 days'
            AND keyword IS NOT NULL AND position IS NOT NULL
       )
       SELECT competitor_domain, keyword, position, checked_at
         FROM recent WHERE rn <= 2
        ORDER BY checked_at DESC LIMIT 2000`,
      values,
    );
    return deriveCompetitorMovements(result.rows);
  } finally {
    client.release();
  }
}
