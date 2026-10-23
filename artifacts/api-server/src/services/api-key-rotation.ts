/**
 * Revocation of API keys issued before 2026-10-23: every existing key is removed; owners
 * regenerate them from the dashboard, which shows a new secret once.
 *
 * Never logs, returns or backs up a key value: reports contain counts and organization ids
 * only. Revocation is not reversible by design — recovery is a regeneration.
 */
import type { PoolClient } from "pg";
import { deterministicPublicKey } from "../lib/api-keys.js";

export interface RotationReport {
  organizationsWithKeys: number;
  deterministicPublicKeys: number;
  randomPublicKeys: number;
  secretKeys: number;
  /** Organizations whose owner must regenerate a key (ids only, for notification). */
  affectedOrgIds: string[];
  applied: boolean;
}

interface KeyRow { org_id: string; pub: string | null; has_secret: boolean }

async function inventory(client: PoolClient): Promise<KeyRow[]> {
  const r = await client.query<KeyRow>(
    `SELECT org_id::text AS org_id, settings->>'publicApiKey' AS pub,
            COALESCE(settings->>'secretApiKey', '') <> '' AS has_secret
       FROM user_prefs
      WHERE settings ? 'publicApiKey' OR settings ? 'secretApiKey'`,
  );
  return r.rows;
}

function report(rows: KeyRow[], applied: boolean): RotationReport {
  const deterministic = rows.filter((r) => r.pub && r.pub === deterministicPublicKey(r.org_id));
  const random = rows.filter((r) => r.pub && r.pub !== deterministicPublicKey(r.org_id));
  const secret = rows.filter((r) => r.has_secret);
  return {
    organizationsWithKeys: rows.length,
    deterministicPublicKeys: deterministic.length,
    randomPublicKeys: random.length,
    secretKeys: secret.length,
    affectedOrgIds: [...new Set([...random, ...secret].map((r) => r.org_id))].sort(),
    applied,
  };
}

/** Dry run: what would be revoked. Read-only. */
export async function planApiKeyRotation(client: PoolClient): Promise<RotationReport> {
  return report(await inventory(client), false);
}

/** Revokes every key in one transaction; returns the same report as the dry run. */
export async function applyApiKeyRotation(client: PoolClient): Promise<RotationReport> {
  await client.query("BEGIN");
  try {
    const rows = await inventory(client);
    await client.query(
      `UPDATE user_prefs
          SET settings = settings - 'publicApiKey' - 'secretApiKey' - 'publicApiKeyCreatedAt' - 'secretApiKeyCreatedAt'
              || jsonb_build_object('apiKeysRevokedAt', now()::text),
              updated_at = now()
        WHERE settings ? 'publicApiKey' OR settings ? 'secretApiKey'`,
    );
    await client.query("COMMIT");
    return report(rows, true);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  }
}
