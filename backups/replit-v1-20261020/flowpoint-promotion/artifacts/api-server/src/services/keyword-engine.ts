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
  dfsRequest,
} from "./dataforseo-service.js";
import { loadOrgAIPrefs, resolveAIModel } from "./ai-prefs.js";
import { aiChat } from "./ai-provider.js";

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

function extractDomain(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`)
      .hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^www\./, "").split("/")[0] ?? "";
  }
}

async function batchSERP(
  tasks: Array<{ keyword: string; location_name: string; language_code: string; device: string; depth: number }>,
  orgId = "default"
): Promise<Array<{
  status_code: number;
  result?: Array<{
    items?: Array<{ type: string; rank_absolute: number; url?: string; domain?: string }>;
  }>;
}>> {
  return dfsRequest(
    "/serp/google/organic/live/regular",
    tasks,
    orgId
  ) as Promise<Array<{
    status_code: number;
    result?: Array<{
      items?: Array<{ type: string; rank_absolute: number; url?: string; domain?: string }>;
    }>;
  }>>;
}

export async function syncOrgRankings(orgId: string): Promise<{ configured: boolean; synced: number }> {
  if (!await isDataForSEOConfigured(orgId)) {
    logger.warn({ orgId }, "[keyword-engine] DataForSEO not configured — skipping rank sync");
    return { configured: false, synced: 0 };
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
    if (kwRes.rows.length === 0) return { configured: true, synced: 0 };

    // Process in batches of 5 (balance quota vs speed)
    let syncedCount = 0;
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
        results = await batchSERP(tasks, orgId);
      } catch (e) {
        logger.warn({ e, orgId, batch: i }, "[keyword-engine] SERP batch request failed");
        continue;
      }

      for (let j = 0; j < batch.length; j++) {
        const kw     = batch[j]!;
        const result = results[j];

        if (!result || result.status_code !== 20000) continue;
        syncedCount++;

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

    logger.info({ orgId, total: kwRes.rows.length, synced: syncedCount }, "[keyword-engine] syncOrgRankings done");
    return { configured: true, synced: syncedCount };
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

const CLUSTER_COLORS = ["#2563EB", "#8b5cf6", "#22c55e", "#f59e0b", "#ef4444", "#06b6d4", "#ec4899", "#84cc16"];

export async function generateClusters(
  orgId: string
): Promise<Array<{ id: string; name: string; intent: string; keywords: number; avgPosition: number }>> {
  const client = await pool.connect();
  try {
    const kwRes = await client.query<{
      id: string; keyword: string; intent: string | null;
      current_position: number | null; search_volume: number; difficulty: number;
    }>(
      `SELECT id, keyword, intent, current_position,
              COALESCE(search_volume,0)::int AS search_volume,
              COALESCE(difficulty,0)::int    AS difficulty
       FROM tracked_keywords
       WHERE org_id=$1 AND active=true
       ORDER BY search_volume DESC NULLS LAST
       LIMIT 200`,
      [orgId]
    );
    const rows = kwRes.rows;
    if (rows.length < 2) return [];

    // Real AI semantic clustering — fails explicitly if the AI provider is unavailable
    const prefs = await loadOrgAIPrefs(orgId);
    const aiCfg = resolveAIModel(prefs, "strategist");
    const prompt = `Voici la liste des mots-clés SEO suivis (un par ligne) :
${rows.map(r => `- ${r.keyword}`).join("\n")}

Regroupe-les en clusters sémantiques cohérents (thématiques). Chaque mot-clé appartient à au plus un cluster. Retourne UNIQUEMENT un JSON de la forme :
{"clusters":[{"name":"string (nom court en français)","intent":"informational|commercial|transactional|navigational","description":"string (1 phrase)","keywords":["mot-clé exact 1","mot-clé exact 2"]}]}
Utilise les mots-clés EXACTEMENT tels qu'écrits. Entre 2 et 8 clusters.`;

    const aiResult = await aiChat({
      provider: aiCfg.provider,
      model: aiCfg.model,
      systemPrompt: "Tu clusterises des mots-clés SEO. Réponds UNIQUEMENT avec du JSON valide.",
      messages: [{ role: "user", content: prompt }],
      maxTokens: aiCfg.maxTokens,
      json: true,
    });
    // Robust JSON extraction — some providers wrap JSON in prose or ``` fences
    let rawText = String(aiResult.text || "").trim();
    const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch?.[1]) rawText = fenceMatch[1].trim();
    if (!rawText.startsWith("{")) {
      const braceStart = rawText.indexOf("{");
      const braceEnd = rawText.lastIndexOf("}");
      if (braceStart >= 0 && braceEnd > braceStart) rawText = rawText.slice(braceStart, braceEnd + 1);
    }
    let parsed: { clusters?: Array<{ name?: string; intent?: string; description?: string; keywords?: string[] }> };
    try {
      parsed = JSON.parse(rawText);
    } catch (parseErr) {
      logger.warn({ orgId, sample: rawText.slice(0, 200) }, "[keyword-engine] AI cluster response was not valid JSON");
      throw new Error("La réponse IA du clustering n'était pas exploitable — réessayez.");
    }
    const aiClusters = Array.isArray(parsed.clusters) ? parsed.clusters : [];
    if (aiClusters.length === 0) {
      throw new Error("Le clustering IA n'a produit aucun cluster exploitable.");
    }

    // Map AI keyword strings back to tracked rows (case-insensitive)
    const byKeyword = new Map(rows.map(r => [r.keyword.trim().toLowerCase(), r]));
    const validIntents = new Set(["informational", "commercial", "transactional", "navigational"]);

    // Replace previous clustering atomically — a partial/invalid AI result must not erase valid clusters
    await client.query("BEGIN");
    await client.query(`DELETE FROM keyword_clusters WHERE org_id=$1`, [orgId]);
    await client.query(`UPDATE tracked_keywords SET cluster_id=NULL, updated_at=NOW() WHERE org_id=$1`, [orgId]);

    const out: Array<{ id: string; name: string; intent: string; keywords: number; avgPosition: number }> = [];
    const stamp = Date.now();
    let idx = 0;
    for (const c of aiClusters) {
      const members = (Array.isArray(c.keywords) ? c.keywords : [])
        .map(k => byKeyword.get(String(k).trim().toLowerCase()))
        .filter((r): r is NonNullable<typeof r> => Boolean(r));
      if (members.length === 0) continue;

      const id = `cl_${stamp}_${idx}`;
      const name = String(c.name || `Cluster ${idx + 1}`).slice(0, 120);
      const intent = validIntents.has(String(c.intent)) ? String(c.intent) : "mixed";
      const positions = members.map(m => m.current_position).filter((p): p is number => p != null && Number.isFinite(Number(p)));
      const avgPosition = positions.length ? Math.round((positions.reduce((a, b) => a + Number(b), 0) / positions.length) * 10) / 10 : 0;
      const totalVolume = members.reduce((a, m) => a + Number(m.search_volume || 0), 0);
      const avgVolume = Math.round(totalVolume / members.length);
      const avgDifficulty = Math.round(members.reduce((a, m) => a + Number(m.difficulty || 0), 0) / members.length);
      const color = CLUSTER_COLORS[idx % CLUSTER_COLORS.length];

      await client.query(
        `INSERT INTO keyword_clusters
           (id, org_id, name, description, intent, keywords, keyword_count,
            avg_position, avg_volume, avg_difficulty, total_volume, color, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10,$11,$12,NOW(),NOW())`,
        [id, orgId, name, String(c.description || "").slice(0, 500) || null, intent,
         JSON.stringify(members.map(m => m.keyword)), members.length,
         avgPosition || null, avgVolume, avgDifficulty, totalVolume, color]
      );
      await client.query(
        `UPDATE tracked_keywords SET cluster_id=$1, updated_at=NOW() WHERE org_id=$2 AND id = ANY($3::text[])`,
        [id, orgId, members.map(m => m.id)]
      );

      out.push({ id, name, intent, keywords: members.length, avgPosition });
      idx++;
    }
    if (out.length === 0) {
      await client.query("ROLLBACK");
      throw new Error("Le clustering IA n'a associé aucun mot-clé suivi — réessayez.");
    }
    await client.query("COMMIT");
    logger.info({ orgId, clusters: out.length }, "[keyword-engine] AI clustering persisted");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally { client.release(); }
}

export async function generateOpportunities(
  orgId: string
): Promise<Array<{ keyword: string; position: number; volume: number; potentialTraffic: number; difficulty: number; opportunity: string }>> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT id, keyword, current_position AS position, search_volume AS volume, difficulty, intent
       FROM tracked_keywords
       WHERE org_id=$1 AND active=true
         AND current_position BETWEEN 4 AND 20
         AND search_volume > 100
       ORDER BY search_volume DESC
       LIMIT 20`,
      [orgId]
    );
    const opps = res.rows.map((r: Record<string, unknown>) => {
      const pos = Number(r["position"]);
      const vol = Number(r["volume"]);
      const difficulty = Number(r["difficulty"] ?? 50);
      const potentialTraffic = pos <= 10
        ? Math.round(vol * (0.15 - (pos - 4) * 0.01))
        : Math.round(vol * 0.03);
      // Deterministic score derived from real position/volume/difficulty only
      const score = Math.max(1, Math.min(100,
        Math.round((21 - pos) * 3 + Math.min(30, vol / 200) + (100 - difficulty) / 4)));
      return {
        keywordId: String(r["id"]),
        keyword: String(r["keyword"]),
        position: pos,
        volume: vol,
        potentialTraffic,
        difficulty,
        intent: r["intent"] ? String(r["intent"]) : null,
        score,
        type: pos <= 10 ? "quick_win" : "high_traffic",
        opportunity: pos <= 10 ? "Page 1 accessible" : "Progression top 10",
      };
    });

    // Persist so GET /api/keywords/opportunities (keyword_opportunities) reflects the generation
    await client.query(`DELETE FROM keyword_opportunities WHERE org_id=$1`, [orgId]);
    for (const o of opps) {
      await client.query(
        `INSERT INTO keyword_opportunities
           (id, org_id, keyword, search_volume, difficulty, intent, opportunity_score, type,
            current_position, potential_position, estimated_traffic, ai_explanation, status, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'new',NOW(),NOW())
         ON CONFLICT (id) DO UPDATE SET
           search_volume=EXCLUDED.search_volume, difficulty=EXCLUDED.difficulty,
           opportunity_score=EXCLUDED.opportunity_score, type=EXCLUDED.type,
           current_position=EXCLUDED.current_position, potential_position=EXCLUDED.potential_position,
           estimated_traffic=EXCLUDED.estimated_traffic, ai_explanation=EXCLUDED.ai_explanation, updated_at=NOW()`,
        [`opp_${o.keywordId}`, orgId, o.keyword, o.volume, o.difficulty, o.intent, o.score, o.type,
         o.position, o.position <= 10 ? 3 : 10, o.potentialTraffic,
         o.opportunity + ` — position actuelle #${o.position}, ${o.volume.toLocaleString("fr-FR")} recherches/mois.`]
      );
    }
    logger.info({ orgId, count: opps.length }, "[keyword-engine] opportunities persisted");
    return opps.map(({ keyword, position, volume, potentialTraffic, difficulty, opportunity }) =>
      ({ keyword, position, volume, potentialTraffic, difficulty, opportunity }));
  } finally { client.release(); }
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
