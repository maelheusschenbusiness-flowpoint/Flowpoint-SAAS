import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { generateSEOMissions, refreshSEOCache } from "../services/dataforseo-service.js";

export function startDataForSEOCron(): void {
  // Refresh every 6 hours
  const SIX_HOURS = 6 * 60 * 60 * 1000;

  async function run(): Promise<void> {
    logger.info("[DataForSEO Cron] Starting scheduled SEO cache refresh");
    try {
      const client = await pool.connect();
      let domains: string[] = [];
      try {
        const res = await client.query<{ domain: string; org_id: string }>(
          `SELECT DISTINCT domain, org_id FROM seo_domain_metrics WHERE cached_at < now() - interval '6 hours' LIMIT 20`,
        );
        domains = res.rows.map(r => r.domain);
      } finally {
        client.release();
      }

      if (domains.length === 0) {
        logger.info("[DataForSEO Cron] No stale domains to refresh");
        return;
      }

      for (const domain of domains) {
        await refreshSEOCache(domain).catch((e: unknown) =>
          logger.warn({ domain, e }, "[DataForSEO Cron] refresh error"),
        );
        await generateSEOMissions("default", domain).catch(() => {});
      }

      logger.info({ count: domains.length }, "[DataForSEO Cron] Refresh complete");
    } catch (e) {
      logger.error({ e }, "[DataForSEO Cron] Fatal error");
    }
  }

  setInterval(() => { run().catch(() => {}); }, SIX_HOURS);
  logger.info("[DataForSEO Cron] SEO refresh scheduled (every 6h)");
}
