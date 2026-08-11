import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const ALL_RESOURCES = [
  "audits", "monitors", "reports", "keywords", "competitors",
  "missions", "automation", "team", "billing", "integrations",
  "settings", "ai", "exports", "api_keys",
] as const;

export const ALL_ACTIONS = ["view", "create", "update", "delete", "export", "admin"] as const;

export type Resource = typeof ALL_RESOURCES[number];
export type Action   = typeof ALL_ACTIONS[number];

export interface Role {
  id: string; orgId: string; name: string; description: string | null;
  isSystem: boolean; permissions: Record<Resource, Action[]>; memberCount: number; createdAt: string;
}

export interface PermissionLog {
  id: string; orgId: string; userId: string; resource: string; action: string;
  allowed: boolean; reason: string | null; createdAt: string;
}

export interface PermissionsStats {
  totalRoles: number; totalMembers: number; permissionChecksToday: number;
  blockedActionsToday: number; mostActiveResource: string | null; complianceScore: number | null;
}

const SYSTEM_ROLES: Role[] = [
  {
    id: "role_admin", orgId: "default", name: "Administrateur", description: "Accès complet à toutes les fonctionnalités",
    isSystem: true, memberCount: 1, createdAt: new Date().toISOString(),
    permissions: Object.fromEntries(ALL_RESOURCES.map(r => [r, [...ALL_ACTIONS]])) as Record<Resource, Action[]>,
  },
  {
    id: "role_member", orgId: "default", name: "Membre", description: "Accès lecture et création limité",
    isSystem: true, memberCount: 3, createdAt: new Date().toISOString(),
    permissions: Object.fromEntries(ALL_RESOURCES.map(r => [r, ["view", "create"] as Action[]])) as Record<Resource, Action[]>,
  },
  {
    id: "role_viewer", orgId: "default", name: "Observateur", description: "Lecture seule",
    isSystem: true, memberCount: 1, createdAt: new Date().toISOString(),
    permissions: Object.fromEntries(ALL_RESOURCES.map(r => [r, ["view"] as Action[]])) as Record<Resource, Action[]>,
  },
];

export async function getRoles(orgId: string): Promise<Role[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM roles WHERE org_id=$1 ORDER BY created_at ASC`, [orgId]);
    if (res.rows.length > 0) return res.rows;
    return SYSTEM_ROLES;
  } catch { return SYSTEM_ROLES; } finally { client.release(); }
}

export async function createRole(orgId: string, planOrData?: string | { name: string; description?: string; color?: string; permissions?: string[] | Record<string, string[]>; parentRoleId?: string }, data?: { name?: string; description?: string; color?: string; permissions?: string[] | Record<string, string[]>; parentRoleId?: string }): Promise<Role> {
  // Resolve overloaded call: (orgId, plan, data) or (orgId, data)
  const resolvedData: { name?: string; description?: string; color?: string; permissions?: string[] | Record<string, string[]>; parentRoleId?: string } =
    typeof planOrData === "object" && planOrData !== null ? planOrData : (data ?? {});
  const client = await pool.connect();
  try {
    const id = `role_${orgId}_${Date.now()}`;
    await client.query(
      `INSERT INTO roles (id, org_id, name, description, is_system, permissions, created_at)
       VALUES ($1,$2,$3,$4,false,$5,NOW())`,
      [id, orgId, resolvedData.name, resolvedData.description ?? null, JSON.stringify(resolvedData.permissions ?? {})]
    );
    const res = await client.query(`SELECT * FROM roles WHERE id=$1`, [id]);
    return res.rows[0];
  } finally { client.release(); }
}

export async function updateRole(orgId: string, id: string, data: Partial<{ name: string; description: string; color: string; permissions: string[] | Record<string, string[]> }> = {}): Promise<Role> {
  const client = await pool.connect();
  try {
    // Tenant isolation: every mutation is scoped to org_id — a role id from
    // another organization must never be reachable, even for admins.
    if (data.name) {
      const r = await client.query(`UPDATE roles SET name=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3`, [data.name, id, orgId]);
      if (r.rowCount === 0) throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    }
    if (data.permissions) {
      const r = await client.query(`UPDATE roles SET permissions=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3`, [JSON.stringify(data.permissions), id, orgId]);
      if (r.rowCount === 0) throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    }
    const res = await client.query(`SELECT * FROM roles WHERE id=$1 AND org_id=$2`, [id, orgId]);
    if (!res.rows[0]) throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    return res.rows[0];
  } finally { client.release(); }
}

export async function deleteRole(orgId: string, id: string): Promise<void> {
  const client = await pool.connect();
  try {
    const r = await client.query(`DELETE FROM roles WHERE id=$1 AND org_id=$2 AND is_system=false`, [id, orgId]);
    if (r.rowCount === 0) throw Object.assign(new Error("Role not found"), { statusCode: 404 });
  } finally { client.release(); }
}

export async function assignRole(orgId: string, userId: string, roleId: string, _grantedBy?: string): Promise<void> {
  const client = await pool.connect();
  try {
    // Role must belong to the caller's org (system role ids are org-agnostic),
    // and the member row update is org-scoped.
    if (!roleId.startsWith("role_admin") && !roleId.startsWith("role_member") && !roleId.startsWith("role_viewer")) {
      const owns = await client.query(`SELECT 1 FROM roles WHERE id=$1 AND org_id=$2`, [roleId, orgId]);
      if (owns.rowCount === 0) throw Object.assign(new Error("Role not found"), { statusCode: 404 });
    }
    const r = await client.query(`UPDATE team_members SET role_id=$1, updated_at=NOW() WHERE user_id=$2 AND org_id=$3`, [roleId, userId, orgId]);
    if (r.rowCount === 0) throw Object.assign(new Error("Member not found"), { statusCode: 404 });
  } finally { client.release(); }
}

export async function getPermissionLogs(orgId: string, limit = 50): Promise<PermissionLog[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM permission_logs WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [orgId, limit]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}

export async function getAccessAudits(orgId: string, limit = 50): Promise<PermissionLog[]> {
  return getPermissionLogs(orgId, limit);
}

export async function logAccess(
  optsOrOrgId: { orgId: string; userId: string; resource: string; action: string; allowed: boolean; reason?: string } | string,
  userId?: string,
  action?: string,
  resource?: string,
  _metadata?: Record<string, unknown>,
): Promise<void> {
  // Resolve overloaded call: (opts) or (orgId, userId, action, resource, metadata)
  const orgId    = typeof optsOrOrgId === "string" ? optsOrOrgId : optsOrOrgId.orgId;
  const resolvedUserId   = typeof optsOrOrgId === "string" ? (userId ?? "system") : optsOrOrgId.userId;
  const resolvedAction   = typeof optsOrOrgId === "string" ? (action ?? "") : optsOrOrgId.action;
  const resolvedResource = typeof optsOrOrgId === "string" ? (resource ?? "") : optsOrOrgId.resource;
  const allowed  = typeof optsOrOrgId === "string" ? true : optsOrOrgId.allowed;
  const reason   = typeof optsOrOrgId === "string" ? null : (optsOrOrgId.reason ?? null);
  const client = await pool.connect();
  try {
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
    await client.query(
      `INSERT INTO permission_logs (id, org_id, user_id, resource, action, allowed, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT DO NOTHING`,
      [id, orgId, resolvedUserId, resolvedResource, resolvedAction, allowed, reason]
    );
  } catch (err) { logger.debug({ err }, "[permissions] logAccess error"); }
  finally { client.release(); }
}

export async function getPermissionsStats(orgId: string): Promise<PermissionsStats> {
  const client = await pool.connect();
  try {
    const [rolesRes, logsRes, membersRes, topResourceRes] = await Promise.all([
      client.query(`SELECT COUNT(*) as c FROM roles WHERE org_id=$1`, [orgId]),
      client.query(`SELECT COUNT(*) as total, SUM(CASE WHEN allowed=false THEN 1 ELSE 0 END) as blocked FROM permission_logs WHERE org_id=$1 AND created_at > NOW()-INTERVAL '1 day'`, [orgId]),
      client.query(`SELECT COUNT(*) as c FROM org_members WHERE org_id=$1`, [orgId]),
      client.query(`SELECT resource, COUNT(*) as c FROM permission_logs WHERE org_id=$1 AND created_at > NOW()-INTERVAL '7 days' GROUP BY resource ORDER BY c DESC LIMIT 1`, [orgId]),
    ]);
    const totalChecks = Number(logsRes.rows[0]?.total ?? 0);
    const blockedToday = Number(logsRes.rows[0]?.blocked ?? 0);
    const complianceScore = totalChecks > 0
      ? Math.round(((totalChecks - blockedToday) / totalChecks) * 100)
      : null;
    return {
      totalRoles: Number(rolesRes.rows[0]?.c ?? 0),
      totalMembers: Number(membersRes.rows[0]?.c ?? 0),
      permissionChecksToday: totalChecks,
      blockedActionsToday: blockedToday,
      mostActiveResource: (topResourceRes.rows[0]?.resource as string) ?? null,
      complianceScore,
    };
  } catch {
    return { totalRoles: 0, totalMembers: 0, permissionChecksToday: 0, blockedActionsToday: 0, mostActiveResource: null, complianceScore: null };
  } finally { client.release(); }
}
