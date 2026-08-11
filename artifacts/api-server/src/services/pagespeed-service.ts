import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export interface PSIScores {
  performance: number;
  seo: number;
  accessibility: number;
  bestPractices: number;
}

export interface PSIResult {
  url: string;
  strategy: "mobile" | "desktop";
  scores: PSIScores;
  metrics: {
    fcp: number;
    lcp: number;
    tbt: number;
    cls: number;
    tti: number;
    si: number;
    fid: number;
  };
  criticalIssues: Array<{ id: string; title: string; description: string; score: number }>;
  opportunities: Array<{ id: string; title: string; savings: number }>;
  analyzedAt: string;
  /** Convenience top-level aliases for scores (populated by getPSIHistory rows) */
  performance?: number;
  accessibility?: number;
  seo?: number;
  bestPractices?: number;
  lcp?: number;
}

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export async function analyzePSI(url: string, strategy: "mobile" | "desktop", _orgId?: string, _force?: boolean): Promise<PSIResult> {
  const apiKey = process.env["PAGESPEED_API_KEY"] ?? process.env["GOOGLE_API_KEY"] ?? "";
  const endpoint = `${PSI_ENDPOINT}?url=${encodeURIComponent(url)}&strategy=${strategy}${apiKey ? `&key=${apiKey}` : ""}`;

  const res = await fetch(endpoint, { signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`PSI API ${res.status}: ${await res.text()}`);

  const data = await res.json() as Record<string, unknown>;
  const cats = (data["lighthouseResult"] as Record<string, unknown>)?.["categories"] as Record<string, { score: number }>;
  const audits = (data["lighthouseResult"] as Record<string, unknown>)?.["audits"] as Record<string, { score: number | null; title: string; description: string; displayValue?: string; numericValue?: number }>;

  const scores: PSIScores = {
    performance:   Math.round((cats?.["performance"]?.score ?? 0) * 100),
    seo:           Math.round((cats?.["seo"]?.score ?? 0) * 100),
    accessibility: Math.round((cats?.["accessibility"]?.score ?? 0) * 100),
    bestPractices: Math.round((cats?.["best-practices"]?.score ?? 0) * 100),
  };

  const criticalIssues = Object.entries(audits ?? {})
    .filter(([, a]) => a.score !== null && a.score < 0.5)
    .slice(0, 10)
    .map(([id, a]) => ({ id, title: a.title, description: a.description, score: Math.round((a.score ?? 0) * 100) }));

  const opportunities = Object.entries(audits ?? {})
    .filter(([, a]) => a.score !== null && a.score < 0.9 && a.numericValue !== undefined)
    .slice(0, 5)
    .map(([id, a]) => ({ id, title: a.title, savings: Math.round((a.numericValue ?? 0) / 1000) }));

  const m = audits ?? {};
  const result: PSIResult = {
    url, strategy, scores,
    metrics: {
      fcp: m["first-contentful-paint"]?.numericValue ?? 0,
      lcp: m["largest-contentful-paint"]?.numericValue ?? 0,
      tbt: m["total-blocking-time"]?.numericValue ?? 0,
      cls: m["cumulative-layout-shift"]?.numericValue ?? 0,
      tti: m["interactive"]?.numericValue ?? 0,
      si:  m["speed-index"]?.numericValue ?? 0,
      fid: m["max-potential-fid"]?.numericValue ?? 0,
    },
    criticalIssues,
    opportunities,
    analyzedAt: new Date().toISOString(),
  };

  await cachePSIResult(url, strategy, result).catch(() => {});
  return result;
}

async function cachePSIResult(url: string, strategy: string, result: PSIResult): Promise<void> {
  try {
    const client = await pool.connect();
    try {
      await client.query(
        `INSERT INTO psi_cache (url, strategy, scores, metrics, critical_issues, opportunities, analyzed_at)
         VALUES ($1,$2,$3,$4,$5,$6,NOW())
         ON CONFLICT (url, strategy) DO UPDATE SET
           scores=$3, metrics=$4, critical_issues=$5, opportunities=$6, analyzed_at=NOW()`,
        [url, strategy, JSON.stringify(result.scores), JSON.stringify(result.metrics),
         JSON.stringify(result.criticalIssues), JSON.stringify(result.opportunities)]
      );
    } finally {
      client.release();
    }
  } catch { /* non-fatal */ }
}

export async function getPSIHistory(url: string, strategy: "mobile" | "desktop" = "mobile", _orgId?: string, days = 30): Promise<PSIResult[]> {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT * FROM psi_history WHERE url=$1 AND analyzed_at > NOW() - INTERVAL '${Math.min(days, 90)} days' ORDER BY analyzed_at DESC LIMIT 100`,
        [url]
      );
      return res.rows.map((r: Record<string, unknown>) => ({
        url: r["url"] as string,
        strategy: r["strategy"] as "mobile" | "desktop",
        scores: r["scores"] as PSIScores,
        metrics: r["metrics"] as PSIResult["metrics"],
        criticalIssues: r["critical_issues"] as PSIResult["criticalIssues"],
        opportunities: r["opportunities"] as PSIResult["opportunities"],
        analyzedAt: String(r["analyzed_at"]),
      }));
    } finally {
      client.release();
    }
  } catch { return []; }
}

export async function getLatestPSIResult(url: string, strategy: "mobile" | "desktop" = "mobile", _orgId?: string): Promise<PSIResult | null> {
  try {
    const client = await pool.connect();
    try {
      const res = await client.query(
        `SELECT * FROM psi_cache WHERE url=$1 AND strategy=$2 LIMIT 1`,
        [url, strategy]
      );
      if (!res.rows[0]) return null;
      const r = res.rows[0];
      return {
        url: r.url, strategy, scores: r.scores, metrics: r.metrics,
        criticalIssues: r.critical_issues, opportunities: r.opportunities,
        analyzedAt: String(r.analyzed_at),
      };
    } finally {
      client.release();
    }
  } catch { return null; }
}

export function invalidatePSICache(_url: string, _orgId?: string): void {
  // Cache invalidation is handled by TTL in DB
}
