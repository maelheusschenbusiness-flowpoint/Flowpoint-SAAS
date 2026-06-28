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

export async function createRole(orgId: string, data: { name: string; description?: string; permissions: Record<string, string[]> }): Promise<Role> {
  const client = await pool.connect();
  try {
    const id = `role_${orgId}_${Date.now()}`;
    await client.query(
      `INSERT INTO roles (id, org_id, name, description, is_system, permissions, created_at)
       VALUES ($1,$2,$3,$4,false,$5,NOW())`,
      [id, orgId, data.name, data.description ?? null, JSON.stringify(data.permissions)]
    );
    const res = await client.query(`SELECT * FROM roles WHERE id=$1`, [id]);
    return res.rows[0];
  } finally { client.release(); }
}

export async function updateRole(id: string, data: Partial<{ name: string; description: string; permissions: Record<string, string[]> }>): Promise<Role> {
  const client = await pool.connect();
  try {
    if (data.name) await client.query(`UPDATE roles SET name=$1, updated_at=NOW() WHERE id=$2`, [data.name, id]);
    if (data.permissions) await client.query(`UPDATE roles SET permissions=$1, updated_at=NOW() WHERE id=$2`, [JSON.stringify(data.permissions), id]);
    const res = await client.query(`SELECT * FROM roles WHERE id=$1`, [id]);
    return res.rows[0];
  } finally { client.release(); }
}

export async function deleteRole(id: string): Promise<void> {
  const client = await pool.connect();
  try { await client.query(`DELETE FROM roles WHERE id=$1 AND is_system=false`, [id]); }
  finally { client.release(); }
}

export async function assignRole(userId: string, roleId: string): Promise<void> {
  const client = await pool.connect();
  try { await client.query(`UPDATE team_members SET role_id=$1, updated_at=NOW() WHERE user_id=$2`, [roleId, userId]); }
  finally { client.release(); }
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

export async function logAccess(opts: { orgId: string; userId: string; resource: string; action: string; allowed: boolean; reason?: string }): Promise<void> {
  const client = await pool.connect();
  try {
    const id = `perm_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`;
    await client.query(
      `INSERT INTO permission_logs (id, org_id, user_id, resource, action, allowed, reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) ON CONFLICT DO NOTHING`,
      [id, opts.orgId, opts.userId, opts.resource, opts.action, opts.allowed, opts.reason ?? null]
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
