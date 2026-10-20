import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const SSO_PROVIDER_TYPES = ["google_workspace", "github", "saml", "okta", "azure_ad"] as const;
export type SSOProviderType = typeof SSO_PROVIDER_TYPES[number];

export interface SSOProvider {
  id: string; orgId: string; type: SSOProviderType; name: string;
  clientId: string | null; issuer: string | null;
  enabled: boolean; defaultRole: string; createdAt: string;
}

export interface OrgAuthConfig {
  orgId: string; ssoRequired: boolean; allowMagicLink: boolean;
  allowPassword: boolean; sessionTtlHours: number; mfaEnabled: boolean;
  allowedDomains: string[];
  /** alias: enforceSso maps to ssoRequired at the route layer */
  enforceSso?: boolean;
  enforceMfa?: boolean;
  sessionTimeout?: number;
  ipWhitelist?: string[];
  loginMessage?: string;
}

export interface LoginAudit {
  id: string; orgId: string; email: string; method: string;
  success: boolean; ip: string | null; userAgent: string | null;
  failureReason: string | null; createdAt: string;
}

export async function getSSODashboard(orgId: string): Promise<{
  providers: SSOProvider[]; config: OrgAuthConfig | null; recentLogins: LoginAudit[]; stats: Record<string, number>;
}> {
  const client = await pool.connect();
  try {
    const [provRes, cfgRes, auditRes] = await Promise.all([
      client.query(`SELECT * FROM sso_providers WHERE org_id=$1 ORDER BY created_at DESC`, [orgId]),
      client.query(`SELECT * FROM org_auth_config WHERE org_id=$1 LIMIT 1`, [orgId]),
      client.query(`SELECT * FROM login_audits WHERE org_id=$1 ORDER BY created_at DESC LIMIT 20`, [orgId]),
    ]);
    const logins: LoginAudit[] = auditRes.rows;
    const successLogins = logins.filter(l => l.success).length;
    return {
      providers: provRes.rows,
      config: cfgRes.rows[0] ?? null,
      recentLogins: logins,
      stats: {
        successLogins,
        failedLogins: logins.length - successLogins,
        totalLogins: logins.length,
        providers: provRes.rows.length,
      },
    };
  } finally { client.release(); }
}

export async function createSSOProvider(orgId: string, planOrData?: string | {
  providerType?: string; type?: SSOProviderType; name?: string; domain?: string;
  clientId?: string; clientSecret?: string; metadataUrl?: string; ssoUrl?: string;
  scopes?: string[]; autoProvision?: boolean; defaultRoleId?: string;
  issuer?: string; defaultRole?: string;
}, data?: {
  providerType?: string; type?: SSOProviderType; name?: string; domain?: string;
  clientId?: string; clientSecret?: string; metadataUrl?: string; ssoUrl?: string;
  scopes?: string[]; autoProvision?: boolean; defaultRoleId?: string;
  issuer?: string; defaultRole?: string;
}): Promise<SSOProvider> {
  // Resolve overloaded call: (orgId, plan, data) or (orgId, data)
  const resolvedData = typeof planOrData === "object" && planOrData !== null ? planOrData : (data ?? {});
  const client = await pool.connect();
  try {
    const provType = resolvedData.type ?? (resolvedData.providerType as SSOProviderType | undefined);
    const id = `sso_${orgId}_${provType ?? "unknown"}_${Date.now()}`;
    await client.query(
      `INSERT INTO sso_providers (id, org_id, type, name, client_id, issuer, enabled, default_role, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7,NOW())`,
      [id, orgId, provType, resolvedData.name, resolvedData.clientId ?? null, resolvedData.issuer ?? null, resolvedData.defaultRole ?? "member"]
    );
    const res = await client.query(`SELECT * FROM sso_providers WHERE id=$1`, [id]);
    return res.rows[0];
  } finally { client.release(); }
}

export async function updateSSOProvider(orgId: string, id: string, data: Partial<{ name: string; clientId: string; issuer: string; enabled: boolean; enforce_sso: boolean; domain: string; auto_provision: boolean; defaultRole: string }> = {}): Promise<SSOProvider> {
  const client = await pool.connect();
  try {
    // Tenant isolation: every mutation is scoped to org_id — an SSO provider id
    // from another organization must never be reachable, even for admins.
    if (data.name !== undefined) {
      const r = await client.query(`UPDATE sso_providers SET name=$1 WHERE id=$2 AND org_id=$3`, [data.name, id, orgId]);
      if (r.rowCount === 0) throw Object.assign(new Error("SSO provider not found"), { statusCode: 404 });
    }
    if (data.enabled !== undefined) {
      const r = await client.query(`UPDATE sso_providers SET enabled=$1 WHERE id=$2 AND org_id=$3`, [data.enabled, id, orgId]);
      if (r.rowCount === 0) throw Object.assign(new Error("SSO provider not found"), { statusCode: 404 });
    }
    if (data.defaultRole !== undefined) {
      const r = await client.query(`UPDATE sso_providers SET default_role=$1 WHERE id=$2 AND org_id=$3`, [data.defaultRole, id, orgId]);
      if (r.rowCount === 0) throw Object.assign(new Error("SSO provider not found"), { statusCode: 404 });
    }
    const res = await client.query(`SELECT * FROM sso_providers WHERE id=$1 AND org_id=$2`, [id, orgId]);
    if (!res.rows[0]) throw Object.assign(new Error("SSO provider not found"), { statusCode: 404 });
    return res.rows[0];
  } finally { client.release(); }
}

export async function deleteSSOProvider(orgId: string, id: string): Promise<void> {
  const client = await pool.connect();
  try {
    const r = await client.query(`DELETE FROM sso_providers WHERE id=$1 AND org_id=$2`, [id, orgId]);
    if (r.rowCount === 0) throw Object.assign(new Error("SSO provider not found"), { statusCode: 404 });
  } finally { client.release(); }
}

export async function getOrgAuthConfig(orgId: string): Promise<OrgAuthConfig | null> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM org_auth_config WHERE org_id=$1 LIMIT 1`, [orgId]);
    return res.rows[0] ?? null;
  } finally { client.release(); }
}

export async function upsertOrgAuthConfig(orgId: string, data: Partial<OrgAuthConfig>): Promise<OrgAuthConfig> {
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO org_auth_config (org_id, sso_required, allow_magic_link, allow_password, session_ttl_hours, mfa_enabled, allowed_domains)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (org_id) DO UPDATE SET
         sso_required=COALESCE(EXCLUDED.sso_required, org_auth_config.sso_required),
         allow_magic_link=COALESCE(EXCLUDED.allow_magic_link, org_auth_config.allow_magic_link),
         allow_password=COALESCE(EXCLUDED.allow_password, org_auth_config.allow_password),
         session_ttl_hours=COALESCE(EXCLUDED.session_ttl_hours, org_auth_config.session_ttl_hours),
         mfa_enabled=COALESCE(EXCLUDED.mfa_enabled, org_auth_config.mfa_enabled),
         allowed_domains=COALESCE(EXCLUDED.allowed_domains, org_auth_config.allowed_domains)`,
      [orgId, data.ssoRequired ?? false, data.allowMagicLink ?? true, data.allowPassword ?? true,
       data.sessionTtlHours ?? 24, data.mfaEnabled ?? false, JSON.stringify(data.allowedDomains ?? [])]
    );
    return (await getOrgAuthConfig(orgId))!;
  } finally { client.release(); }
}

export async function logLoginAttempt(optsOrOrgId: {
  orgId?: string; email?: string; method?: string; provider?: string; success?: boolean;
  ip?: string; ipAddress?: string; userAgent?: string; userId?: string; failureReason?: string;
} | string, opts?: {
  orgId?: string; email?: string; method?: string; provider?: string; success?: boolean;
  ip?: string; ipAddress?: string; userAgent?: string; userId?: string; failureReason?: string;
}): Promise<void> {
  // Resolve overloaded call: (orgId, opts) or (opts)
  const resolvedOpts = typeof optsOrOrgId === "string" ? (opts ?? {}) : optsOrOrgId;
  const orgId   = typeof optsOrOrgId === "string" ? optsOrOrgId : (resolvedOpts.orgId ?? "default");
  const method  = resolvedOpts.method ?? resolvedOpts.provider ?? "email";
  const client = await pool.connect();
  try {
    const id = `audit_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await client.query(
      `INSERT INTO login_audits (id, org_id, email, method, success, ip, user_agent, failure_reason, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [id, orgId, resolvedOpts.email, method, resolvedOpts.success ?? true, resolvedOpts.ip ?? resolvedOpts.ipAddress ?? null, resolvedOpts.userAgent ?? null, resolvedOpts.failureReason ?? null]
    );
  } catch (err) { logger.debug({ err }, "[sso] logLoginAttempt error"); }
  finally { client.release(); }
}

export async function invalidateSession(orgId: string, token: string): Promise<void> {
  const client = await pool.connect();
  // Tenant isolation: only sessions belonging to the caller's org may be revoked.
  try { await client.query(`DELETE FROM user_sessions WHERE token=$1 AND org_id=$2`, [token, orgId]); }
  finally { client.release(); }
}

export async function getLoginAudits(orgId: string, limit = 50): Promise<LoginAudit[]> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM login_audits WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`,
      [orgId, limit]
    );
    return res.rows;
  } catch { return []; } finally { client.release(); }
}
