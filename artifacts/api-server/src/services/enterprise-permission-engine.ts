import { pool } from "@workspace/db";
import { PLAN_INCLUDED_ADDONS } from "../lib/plans.js";

export type EnterprisePermissionDecision = boolean | null;
export const ENTERPRISE_PERMISSION_RESOURCES = [
  "audits", "monitors", "reports", "keywords", "competitors", "missions",
] as const;
export const ENTERPRISE_PERMISSION_ACTIONS = ["create", "update"] as const;

export function requestPermission(method: string, rawUrl: string): { resource: string; action: string } | null {
  const path = rawUrl.split("?")[0]!.replace(/^\/api(?=\/)/, "");
  const resource = path.split("/").filter(Boolean)[0];
  if (!resource) return null;
  const resources: Record<string, string> = {
    audits: "audits",
    monitors: "monitors",
    reports: "reports",
    keywords: "keywords",
    competitors: "competitors",
    missions: "missions",
  };
  const action = ({ GET: "view", HEAD: "view", POST: "create", PUT: "update", PATCH: "update", DELETE: "delete" } as Record<string, string>)[method.toUpperCase()];
  if (!action) return null;
  // A member assigned a custom role gets only the six resource domains exposed
  // by the matrix. On any other canWrite-protected route, "__unsupported__"
  // fails closed instead of silently falling back to the broad member role.
  return { resource: resources[resource] ?? "__unsupported__", action };
}

export function hasRolePermission(
  permissions: unknown,
  resource: string,
  action: string,
): boolean {
  if (!ENTERPRISE_PERMISSION_ACTIONS.some(allowed => allowed === action)) return false;
  let parsed = permissions;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed) as unknown; } catch { return false; }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const actions = (parsed as Record<string, unknown>)[resource];
  return Array.isArray(actions) && actions.includes(action);
}

/**
 * Returns null when Enterprise Permissions is inactive or no custom role is
 * assigned. Every lookup is tenant-scoped; database errors propagate so an
 * unavailable entitlement/role store cannot silently bypass a custom policy.
 */
export async function resolveEnterprisePermission(
  orgId: string,
  userId: string,
  plan: string | undefined,
  resource: string,
  action: string,
): Promise<EnterprisePermissionDecision> {
  const included = !!(plan && PLAN_INCLUDED_ADDONS[plan.toLowerCase()]?.has("enterprisePermissions"));
  if (!included) {
    const entitlement = await pool.query<{ active: boolean }>(
      `SELECT active FROM org_addons WHERE org_id=$1 AND addon_key='enterprisePermissions' LIMIT 1`,
      [orgId],
    );
    if (!entitlement.rows[0]?.active) return null;
  }

  const result = await pool.query<{ permissions: unknown }>(
    `SELECT r.permissions
       FROM team_members tm
       JOIN roles r ON r.id=tm.role_id AND r.org_id=tm.org_id AND r.is_system=false
      WHERE tm.org_id=$1 AND tm.user_id=$2 AND tm.status='active'
      LIMIT 1`,
    [orgId, userId],
  );
  if (!result.rows[0]) return null;
  return hasRolePermission(result.rows[0].permissions, resource, action);
}
