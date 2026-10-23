import { pool } from "@workspace/db";
import { PLAN_INCLUDED_ADDONS } from "../lib/plans.js";

/**
 * Service-side entitlement check for scheduled work that has no HTTP request.
 * Mirrors requireAddon: an add-on is available when bundled in the org plan or
 * explicitly active in org_addons. Database errors are deliberately surfaced.
 */
export async function hasAddonEntitlementForOrg(orgId: string, addonKey: string): Promise<boolean> {
  if (!orgId || orgId === "default") return false;
  const result = await pool.query<{ plan: string | null; addon_active: boolean }>(
    `SELECT
       COALESCE(
         (SELECT LOWER(plan) FROM organizations WHERE id::text=$1 LIMIT 1),
         (SELECT LOWER(plan) FROM org_settings WHERE org_id=$1 LIMIT 1),
         'standard'
       ) AS plan,
       EXISTS (
         SELECT 1 FROM org_addons
          WHERE org_id::text=$1 AND addon_key=$2 AND active=true
       ) AS addon_active`,
    [orgId, addonKey],
  );
  const row = result.rows[0];
  if (!row) return false;
  return row.addon_active === true || !!PLAN_INCLUDED_ADDONS[row.plan ?? ""]?.has(addonKey);
}
