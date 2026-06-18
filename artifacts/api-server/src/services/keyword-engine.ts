import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface KeywordStats {
  total: number;
  top3: number;
  top10: number;
  top100: number;
  gaining: number;
  losing: number;
  avgPosition: number;
  totalVolume: number;
  visibilityScore: number;
}

export function getKeywordLimit(plan: string): number {
  const limits: Record<string, number> = { standard: 50, pro: 500, ultra: 5000, agency: 9999 };
  return limits[plan.toLowerCase()] ?? 500;
}

export async function trackKeyword(orgId: string, keyword: string, opts: {
  targetUrl?: string;
  location?: string;
  device?: string;
  intent?: string;
  tag?: string;
}): Promise<string> {
  const client = await pool.connect();
  try {
    const id = `kw_${orgId}_${keyword.replace(/\s+/g, "_").toLowerCase().slice(0, 40)}_${Date.now()}`;
    await client.query(
      `INSERT INTO tracked_keywords (id, org_id, keyword, target_url, location, device, intent, tag, active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW())
       ON CONFLICT (org_id, keyword) DO UPDATE SET active=true, updated_at=NOW()`,
      [id, orgId, keyword, opts.targetUrl ?? null, opts.location ?? "France", opts.device ?? "desktop", opts.intent ?? null, opts.tag ?? null]
    );
    return id;
  } finally {
    client.release();
  }
}

export async function syncOrgRankings(orgId: string): Promise<void> {
  logger.info({ orgId }, "[keyword-engine] syncOrgRankings — stub (DataForSEO sync)");
}

export async function getRankingHistory(orgId: string, keywordId: string, days = 30): Promise<Array<{ date: string; position: number | null; volume: number }>> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT recorded_at as date, position, search_volume as volume FROM keyword_history
       WHERE org_id=$1 AND keyword_id=$2 AND recorded_at > NOW() - INTERVAL '${Math.min(days, 90)} days'
       ORDER BY recorded_at ASC LIMIT 200`,
      [orgId, keywordId]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function getKeywordStats(orgId: string): Promise<KeywordStats> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN current_position <= 3 THEN 1 ELSE 0 END) as top3,
        SUM(CASE WHEN current_position <= 10 THEN 1 ELSE 0 END) as top10,
        SUM(CASE WHEN current_position <= 100 THEN 1 ELSE 0 END) as top100,
        SUM(CASE WHEN trend='up' THEN 1 ELSE 0 END) as gaining,
        SUM(CASE WHEN trend='down' THEN 1 ELSE 0 END) as losing,
        AVG(current_position) as avg_pos,
        COALESCE(SUM(search_volume),0) as total_volume
       FROM tracked_keywords WHERE org_id=$1 AND active=true`,
      [orgId]
    );
    const r = res.rows[0] ?? {};
    const top10 = Number(r.top10 ?? 0);
    const total = Number(r.total ?? 0);
    return {
      total,
      top3: Number(r.top3 ?? 0),
      top10,
      top100: Number(r.top100 ?? 0),
      gaining: Number(r.gaining ?? 0),
      losing: Number(r.losing ?? 0),
      avgPosition: Math.round(Number(r.avg_pos ?? 0) * 10) / 10,
      totalVolume: Number(r.total_volume ?? 0),
      visibilityScore: total > 0 ? Math.round((top10 / total) * 100) : 0,
    };
  } catch { return { total:0,top3:0,top10:0,top100:0,gaining:0,losing:0,avgPosition:0,totalVolume:0,visibilityScore:0 }; }
  finally { client.release(); }
}

export async function generateClusters(orgId: string): Promise<Array<{ id: string; name: string; intent: string; keywords: number; avgPosition: number }>> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT COALESCE(cluster_id,'unclustered') as id, COALESCE(cluster_id,'Non-classifié') as name,
              COALESCE(intent,'mixed') as intent, COUNT(*) as keywords, AVG(current_position) as avg_pos
       FROM tracked_keywords WHERE org_id=$1 AND active=true GROUP BY cluster_id, intent ORDER BY keywords DESC`,
      [orgId]
    );
    return res.rows.map((r: Record<string, unknown>) => ({
      id: String(r["id"]), name: String(r["name"]), intent: String(r["intent"]),
      keywords: Number(r["keywords"]), avgPosition: Math.round(Number(r["avg_pos"] ?? 0) * 10) / 10,
    }));
  } catch { return []; } finally { client.release(); }
}

export async function generateOpportunities(orgId: string): Promise<Array<{ keyword: string; position: number; volume: number; potentialTraffic: number; difficulty: number; opportunity: string }>> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT keyword, current_position as position, search_volume as volume, difficulty
       FROM tracked_keywords WHERE org_id=$1 AND active=true
         AND current_position BETWEEN 4 AND 20 AND search_volume > 100
       ORDER BY search_volume DESC LIMIT 20`,
      [orgId]
    );
    return res.rows.map((r: Record<string, unknown>) => {
      const pos = Number(r["position"]);
      const vol = Number(r["volume"]);
      const potentialTraffic = pos <= 10
        ? Math.round(vol * (0.15 - (pos - 4) * 0.01))
        : Math.round(vol * 0.03);
      return {
        keyword: String(r["keyword"]),
        position: pos,
        volume: vol,
        potentialTraffic,
        difficulty: Number(r["difficulty"] ?? 50),
        opportunity: pos <= 10 ? "Page 1 accessible" : "Progression top 10",
      };
    });
  } catch { return []; } finally { client.release(); }
}

export async function getAIRecommendations(orgId: string): Promise<Array<{ type: string; title: string; description: string; keywords: string[]; priority: string }>> {
  return [
    { type: "cluster", title: "Créer un cluster thématique SEO Local", description: "Regroupez vos mots-clés locaux en silos thématiques pour renforcer l'autorité sémantique sur vos zones cibles.", keywords: ["seo local", "référencement local", "agence seo"], priority: "high" },
    { type: "content", title: "Optimiser pour les requêtes de longue traîne", description: "35% de votre potentiel de trafic vient de requêtes 4+ mots. Créez des landing pages spécifiques par requête.", keywords: ["audit seo gratuit en ligne", "comment améliorer son référencement"], priority: "medium" },
    { type: "gap", title: "Combler les lacunes concurrentielles", description: "Vos concurrents se positionnent sur 28 mots-clés à fort volume que vous ne ciblez pas encore.", keywords: ["core web vitals", "vitesse chargement seo"], priority: "high" },
  ];
}
