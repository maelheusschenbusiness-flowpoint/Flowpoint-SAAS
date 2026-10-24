/**
 * Revokes API keys issued before 2026-10-23 (see src/services/api-key-rotation.ts).
 *
 *   DATABASE_URL=... npx tsx scripts/api-key-rotation.ts            # dry run, read-only
 *   DATABASE_URL=... npx tsx scripts/api-key-rotation.ts --apply    # revoke, one transaction
 *
 * Run only after the 2026-10-23 release is deployed, and only
 * with the owner's explicit approval. Prints counts; organization ids go to a 0600 file for
 * owner notification. No key value is ever printed or written.
 */
import { writeFileSync } from "node:fs";
import { pool } from "@workspace/db";
import { applyApiKeyRotation, planApiKeyRotation } from "../src/services/api-key-rotation.js";

async function main() {
  const apply = process.argv.includes("--apply");
  const client = await pool.connect();
  try {
    const r = apply ? await applyApiKeyRotation(client) : await planApiKeyRotation(client);
    const { affectedOrgIds, ...counts } = r;
    console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...counts, affectedOrganizations: affectedOrgIds.length }, null, 2));
    const file = `api-key-rotation-${apply ? "applied" : "plan"}-${new Date().toISOString().replace(/[:.]/g, "-")}.txt`;
    writeFileSync(file, affectedOrgIds.join("\n") + "\n", { mode: 0o600 });
    console.log(`organization ids (owners to notify): ${file}`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
