/**
 * keyword-engine.ts — Keyword tracking + DataForSEO SERP sync
 *
 * syncOrgRankings calls DataForSEO's SERP endpoint to check the current
 * position of each tracked keyword, then updates tracked_keywords and
 * appends a row to keyword_history.
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  isDataForSEOConfigured,
  checkAndIncrementQuota,
} from "./dataforseo-service.js";

export interface KeywordStats {
  total: number; top3: number; top10: number; top100: number;
  gaining: number; losing: number; avgPosition: number;
  totalVolume: number; visibilityScore: number;
}

export function getKeywordLimit(plan: string): number {
  const limits: Record<string, number> = { standard: 50, pro: 500, ultra: 5000, agency: 9999 };
  return limits[plan.toLowerCase()] ?? 500;
}

export async function trackKeyword(
  orgId: string,
  keyword: string,
  opts: { targetUrl?: string; location?: string; device?: string; intent?: string; tag?: string }
): Promise<string> {
  const client = await pool.connect();
  try {
    const loc    = opts.location ?? "France";
    const device = opts.device   ?? "desktop";
    const id = `kw_${orgId}_${keyword.replace(/\s+/g, "_").toLowerCase().slice(0, 40)}_${Date.now()}`;
    await client.query(
      `INSERT INTO tracked_keywords
         (id, org_id, keyword, url, location, device, intent, tag, active, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true,NOW())
       ON CONFLICT (org_id, keyword, device, location)
       DO UPDATE SET active=true, updated_at=NOW()`,
      [id, orgId, keyword, opts.targetUrl ?? null, loc, device, opts.intent ?? null, opts.tag ?? null]
    );
    return id;
  } finally {
    client.release();
  }
}

// ── SERP sync via DataForSEO ──────────────────────────────────────────────────

const DFS_BASE = "https://api.dataforseo.com/v3";

function dfsAuth(): string {
  const login = process.env["DATAFORSEO_LOGIN"] ?? "";
  const pass  = process.env["DATAFORSEO_PASSWORD"] ?? "";
  return `Basic ${Buffer.from(`${login}:${pass}`).toString("base64")}`;
}

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`)
      .hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^www\./, "").split("/")[0] ?? "";
  }
}

async function batchSERP(tasks: Array<{
  keyword: string; location_name: string; language_code: string; device: string; depth: number;
}>): Promise<Array<{
  status_code: number;
  result?: Array<{
    items?: Array<{ type: string; rank_absolute: number; url?: string; domain?: string }>;
  }>;
}>> {
  const res = await fetch(`${DFS_BASE}/serp/google/organic/live/regular`, {
    method:  "POST",
    headers: { Authorization: dfsAuth(), "Content-Type": "application/json" },
    body:    JSON.stringify(tasks),
    signal:  AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`DataForSEO SERP ${res.status}`);
  return res.json() as Promise<Array<{ status_code: number; result?: Array<{ items?: Array<{ type: string; rank_absolute: number; url?: string; domain?: string }> }> }>>;
}

export async function syncOrgRankings(orgId: string): Promise<void> {
  if (!await isDataForSEOConfigured(orgId)) {
    logger.warn({ orgId }, "[keyword-engine] DataForSEO not configured — skipping rank sync");
    return;
  }

  const client = await pool.connect();
  try {
    // Get org's website for domain matching
    const settingsRes = await client.query(
      `SELECT website FROM org_settings WHERE org_id=$1 LIMIT 1`, [orgId]
    );
    const orgWebsite = (settingsRes.rows[0] as Record<string, string> | undefined)?.["website"] ?? "";
    const orgDomain  = orgWebsite ? extractDomain(orgWebsite) : null;

    // Fetch active tracked keywords (capped at 100 per sync to respect quota)
    const kwRes = await client.query<{
      id: string; keyword: string; location: string; device: string; url: string | null;
    }>(
      `SELECT id, keyword,
              COALESCE(location,'France') AS location,
              COALESCE(device,'desktop')  AS device,
              url
       FROM tracked_keywords
       WHERE org_id=$1 AND active=true
       ORDER BY COALESCE(last_sync_at, '1970-01-01') ASC, search_volume DESC NULLS LAST
       LIMIT 100`,
      [orgId]
    );
    if (kwRes.rows.length === 0) return;

    // Process in batches of 5 (balance quota vs speed)
    const BATCH_SIZE = 5;
    for (let i = 0; i < kwRes.rows.length; i += BATCH_SIZE) {
      const batch = kwRes.rows.slice(i, i + BATCH_SIZE);

      const quotaOk = await checkAndIncrementQuota(orgId, batch.length);
      if (!quotaOk) {
        logger.warn({ orgId }, "[keyword-engine] DataForSEO daily quota reached — stopping sync");
        break;
      }

      const tasks = batch.map(kw => ({
        keyword:        kw.keyword,
        location_name:  kw.location,
        language_code:  "fr",
        device:         kw.device === "mobile" ? "mobile" : "desktop",
        depth:          30,
      }));

      let results: Awaited<ReturnType<typeof batchSERP>>;
      try {
        results = await batchSERP(tasks);
      } catch (e) {
        logger.warn({ e, orgId, batch: i }, "[keyword-engine] SERP batch request failed");
        continue;
      }

      for (let j = 0; j < batch.length; j++) {
        const kw     = batch[j]!;
        const result = results[j];

        if (!result || result.status_code !== 20000) continue;

        const items = result.result?.[0]?.items ?? [];

        // Find our domain's rank in organic results
        let position: number | null = null;
        const targetDomain = kw.url ? extractDomain(kw.url) : orgDomain;
        if (targetDomain) {
          const match = items.find(item =>
            item.type === "organic" && (
              (item.domain ?? "").includes(targetDomain) ||
              (item.url    ?? "").includes(targetDomain)
            )
          );
          if (match) position = match.rank_absolute;
        }

        // Update tracked_keywords
        await client.query(
          `UPDATE tracked_keywords SET
             prev_position   = current_position,
             current_position= $1,
             trend = CASE
               WHEN $1 IS NULL OR current_position IS NULL THEN 'stable'
               WHEN $1 < current_position THEN 'up'
               WHEN $1 > current_position THEN 'down'
               ELSE 'stable' END,
             last_sync_at = NOW(),
             updated_at   = NOW()
           WHERE id = $2`,
          [position, kw.id]
        ).catch(e => logger.debug({ e }, "[keyword-engine] update position failed"));

        // Append to history
        await client.query(
          `INSERT INTO keyword_history (org_id, keyword_id, position, search_volume, recorded_at)
           SELECT $1, $2, $3,
                  COALESCE((SELECT search_volume FROM tracked_keywords WHERE id=$2 LIMIT 1), 0),
                  NOW()
           ON CONFLICT DO NOTHING`,
          [orgId, kw.id, position]
        ).catch(() => {});
      }

      logger.debug({ orgId, batch: `${i}-${Math.min(i + BATCH_SIZE, kwRes.rows.length)}` },
        "[keyword-engine] SERP batch complete");
    }

    logger.info({ orgId, total: kwRes.rows.length }, "[keyword-engine] syncOrgRankings done");
  } finally {
    client.release();
  }
}

// ── Read functions ────────────────────────────────────────────────────────────

export async function getRankingHistory(
  orgId: string, keywordId: string, days = 30
): Promise<Array<{ date: string; position: number | null; volume: number }>> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT recorded_at AS date, position, search_volume AS volume
       FROM keyword_history
       WHERE org_id=$1 AND keyword_id=$2
         AND recorded_at > NOW() - INTERVAL '${Math.min(days, 90)} days'
       ORDER BY recorded_at ASC
       LIMIT 200`,
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
         COUNT(*)::int                                                              AS total,
         SUM(CASE WHEN current_position <= 3   THEN 1 ELSE 0 END)::int            AS top3,
         SUM(CASE WHEN current_position <= 10  THEN 1 ELSE 0 END)::int            AS top10,
         SUM(CASE WHEN current_position <= 100 THEN 1 ELSE 0 END)::int            AS top100,
         SUM(CASE WHEN trend='up'   THEN 1 ELSE 0 END)::int                       AS gaining,
         SUM(CASE WHEN trend='down' THEN 1 ELSE 0 END)::int                       AS losing,
         ROUND(AVG(current_position)::numeric, 1)                                 AS avg_pos,
         COALESCE(SUM(search_volume), 0)::int                                     AS total_volume
       FROM tracked_keywords WHERE org_id=$1 AND active=true`,
      [orgId]
    );
    const r     = res.rows[0] as Record<string, unknown> ?? {};
    const top10 = Number(r["top10"] ?? 0);
    const total = Number(r["total"] ?? 0);
    return {
      total,
      top3:           Number(r["top3"] ?? 0),
      top10,
      top100:         Number(r["top100"] ?? 0),
      gaining:        Number(r["gaining"] ?? 0),
      losing:         Number(r["losing"] ?? 0),
      avgPosition:    Number(r["avg_pos"] ?? 0),
      totalVolume:    Number(r["total_volume"] ?? 0),
      visibilityScore:total > 0 ? Math.round((top10 / total) * 100) : 0,
    };
  } catch {
    return { total:0,top3:0,top10:0,top100:0,gaining:0,losing:0,avgPosition:0,totalVolume:0,visibilityScore:0 };
  } finally {
    client.release();
  }
}

export async function generateClusters(
  orgId: string
): Promise<Array<{ id: string; name: string; intent: string; keywords: number; avgPosition: number }>> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         COALESCE(cluster_id,'unclustered')    AS id,
         COALESCE(cluster_id,'Non-classifié') AS name,
         COALESCE(intent,'mixed')             AS intent,
         COUNT(*)::int                        AS keywords,
         ROUND(AVG(current_position)::numeric,1) AS avg_pos
       FROM tracked_keywords
       WHERE org_id=$1 AND active=true
       GROUP BY cluster_id, intent
       ORDER BY keywords DESC`,
      [orgId]
    );
    return res.rows.map((r: Record<string, unknown>) => ({
      id:          String(r["id"]),
      name:        String(r["name"]),
      intent:      String(r["intent"]),
      keywords:    Number(r["keywords"]),
      avgPosition: Number(r["avg_pos"] ?? 0),
    }));
  } catch { return []; } finally { client.release(); }
}

export async function generateOpportunities(
  orgId: string
): Promise<Array<{ keyword: string; position: number; volume: number; potentialTraffic: number; difficulty: number; opportunity: string }>> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT keyword, current_position AS position, search_volume AS volume, difficulty
       FROM tracked_keywords
       WHERE org_id=$1 AND active=true
         AND current_position BETWEEN 4 AND 20
         AND search_volume > 100
       ORDER BY search_volume DESC
       LIMIT 20`,
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

export async function getAIRecommendations(
  orgId: string
): Promise<Array<{ type: string; title: string; description: string; keywords: string[]; priority: string }>> {
  // Returns personalised recs based on actual keyword stats
  const stats = await getKeywordStats(orgId);
  const recs = [];

  if (stats.total === 0) {
    recs.push({
      type: "start", title: "Commencez à suivre vos mots-clés",
      description: "Ajoutez vos premiers mots-clés cibles pour voir leur position dans Google et suivre votre évolution.",
      keywords: [], priority: "high",
    });
    return recs;
  }

  if (stats.top3 / Math.max(stats.total, 1) < 0.1) {
    recs.push({
      type: "cluster", title: "Créer des clusters thématiques",
      description: `Seulement ${stats.top3} mots-clés en Top 3. Regroupez vos contenus en silos sémantiques pour renforcer l'autorité.`,
      keywords: [], priority: "high",
    });
  }
  if (stats.losing > stats.gaining && stats.losing > 0) {
    recs.push({
      type: "content", title: "Contenu en baisse — action requise",
      description: `${stats.losing} mots-clés perdent des positions. Mettez à jour ces pages avec du contenu frais et des données récentes.`,
      keywords: [], priority: "high",
    });
  }
  if (stats.top10 > 0 && stats.top3 / stats.top10 < 0.3) {
    recs.push({
      type: "gap", title: "Optimiser les positions 4–10",
      description: `${stats.top10 - stats.top3} mots-clés entre la 4e et 10e position. Un effort ciblé peut les faire passer Top 3 et tripler le trafic.`,
      keywords: [], priority: "medium",
    });
  }

  return recs;
}
