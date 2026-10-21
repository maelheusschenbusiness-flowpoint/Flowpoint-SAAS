import { pool } from "@workspace/db";
import { syncGSCData } from "../services/gsc-service.js";

async function main(): Promise<void> {
  const { rows } = await pool.query<{ org_id: string }>(
    `SELECT org_id FROM gsc_oauth_tokens ORDER BY org_id`
  );
  let failed = 0;
  for (const { org_id: orgId } of rows) {
    try {
      await syncGSCData(orgId);
    } catch (error) {
      failed++;
      console.error("GSC daily sync failed for an organization", error instanceof Error ? error.message : "unknown");
    }
  }
  await pool.end();
  if (failed) process.exitCode = 1;
}

main().catch(async error => {
  console.error("GSC daily sync runner failed", error instanceof Error ? error.message : "unknown");
  await pool.end().catch(() => {});
  process.exitCode = 1;
});
