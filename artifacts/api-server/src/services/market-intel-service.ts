import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface MarketDashboard {
  trends: MarketTrend[];
  opportunities: MarketOpportunity[];
  signals: IndustrySignal[];
  competitorMovements: CompetitorMovement[];
  summary: { score: number; trendingUp: number; opportunities: number; threats: number };
}

interface MarketTrend { id: string; keyword: string; category: string; volume: number; growth: number; opportunityScore: number; }
interface MarketOpportunity { id: string; type: string; title: string; description: string; score: number; estimatedImpact: string; }
interface IndustrySignal { id: string; type: string; title: string; description: string; severity: string; }
interface CompetitorMovement { id: string; competitor: string; type: string; description: string; detectedAt: string; }

const TREND_SEEDS = [
  { keyword: "SEO local IA", category: "AI & SEO", volume: 8400, growth: 124, opportunityScore: 94 },
  { keyword: "Google SGE impact", category: "SERP", volume: 12200, growth: 89, opportunityScore: 88 },
  { keyword: "Core Web Vitals 2025", category: "Performance", volume: 5600, growth: 67, opportunityScore: 82 },
  { keyword: "Zero-click search", category: "SERP", volume: 3800, growth: 45, opportunityScore: 75 },
  { keyword: "AI Overview référencement", category: "AI & SEO", volume: 2900, growth: 156, opportunityScore: 91 },
];

const OPP_SEEDS: Array<{ type: string; title: string; description: string; score: number; estimatedImpact: string }> = [];

export async function seedMarketData(orgId: string): Promise<void> {
  const client = await pool.connect();
  try {
    const ex = await client.query(`SELECT COUNT(*) as c FROM market_trends WHERE org_id=$1`, [orgId]);
    if (Number(ex.rows[0]?.c ?? 0) > 0) return;
    for (const t of TREND_SEEDS) {
      await client.query(
        `INSERT INTO market_trends (id, org_id, keyword, category, volume, growth, opportunity_score, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT DO NOTHING`,
        [`mt_${orgId}_${t.keyword.replace(/\s/g,"_")}`, orgId, t.keyword, t.category, t.volume, t.growth, t.opportunityScore]
      );
    }
    for (const o of OPP_SEEDS) {
      await client.query(
        `INSERT INTO market_opportunities (id, org_id, type, title, description, score, estimated_impact, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT DO NOTHING`,
        [`mo_${orgId}_${o.type}_${Date.now()}`, orgId, o.type, o.title, o.description, o.score, o.estimatedImpact]
      );
    }
  } catch (err) {
    logger.debug({ err }, "[market-intel] seedMarketData failed (non-fatal)");
  } finally { client.release(); }
}

export async function getMarketDashboard(orgId: string): Promise<MarketDashboard> {
  const client = await pool.connect();
  try {
    const [trends, opps, signals, movements] = await Promise.all([
      client.query(`SELECT * FROM market_trends WHERE org_id=$1 ORDER BY opportunity_score DESC LIMIT 20`, [orgId]),
      client.query(`SELECT * FROM market_opportunities WHERE org_id=$1 ORDER BY score DESC LIMIT 15`, [orgId]),
      client.query(`SELECT * FROM industry_signals WHERE org_id=$1 AND (expires_at IS NULL OR expires_at > NOW()) ORDER BY created_at DESC LIMIT 10`, [orgId]),
      client.query(`SELECT * FROM competitor_movements WHERE org_id=$1 ORDER BY detected_at DESC LIMIT 10`, [orgId]),
    ]);
    return {
      trends: trends.rows, opportunities: opps.rows, signals: signals.rows,
      competitorMovements: movements.rows,
      summary: {
        score: trends.rows.length > 0 ? Math.round(trends.rows.reduce((s: number, t: Record<string,unknown>) => s + Number(t["opportunity_score"] ?? 0), 0) / trends.rows.length) : 0,
        trendingUp: trends.rows.filter((t: Record<string, unknown>) => Number(t["growth"]) > 50).length,
        opportunities: opps.rows.length,
        threats: movements.rows.filter((m: Record<string, unknown>) => m["type"] === "ranking_gain").length,
      },
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

export async function detectCompetitorMovements(_orgId: string, _domain?: string): Promise<void> {}
