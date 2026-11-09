import { createHash, randomBytes } from "node:crypto";
import { pool } from "@workspace/db";

type Queryable = Pick<typeof pool, "query">;
type TransactionalDatabase = Queryable & Pick<typeof pool, "connect">;

export function isAgencyReportSchedulerEnabled(): boolean {
  return process.env["AGENCY_REPORT_SCHEDULER_ENABLED"]?.trim().toLowerCase() === "true";
}

export function isAgencyReportDeliveryReady(): boolean {
  if (!isAgencyReportSchedulerEnabled()) return false;
  try { getAgencyPublicBaseUrl(); return true; }
  catch { return false; }
}

export function getAgencyPublicBaseUrl(): string {
  const configured = [process.env["PUBLIC_URL"], process.env["PUBLIC_BASE_URL"]]
    .map(value => value?.trim() ?? "")
    .find(Boolean) ?? "";
  if (!configured) throw new Error("AGENCY_PUBLIC_URL_REQUIRED");
  let parsed: URL;
  try { parsed = new URL(configured); }
  catch { throw new Error("AGENCY_PUBLIC_URL_INVALID"); }
  if ((parsed.protocol !== "https:" && parsed.protocol !== "http:") || parsed.username || parsed.password) {
    throw new Error("AGENCY_PUBLIC_URL_INVALID");
  }
  return configured.replace(/\/+$/, "");
}

export type AgencyAudit = {
  id: string;
  url: string;
  score: number | null;
  speed: number | null;
  issues: number | null;
  status: string;
  created_at: string;
};

export async function loadSelectedAgencyAudits(orgId: string, auditIds: string[], database: Queryable = pool): Promise<AgencyAudit[]> {
  const result = await database.query<AgencyAudit>(
    `SELECT id, url, score, speed, issues, status, created_at
       FROM audits
      WHERE org_id=$1 AND id=ANY($2::text[])`,
    [orgId, auditIds],
  );
  const byId = new Map((result.rows as AgencyAudit[]).map((row: AgencyAudit) => [row.id, row]));
  return auditIds.map(id => byId.get(id)).filter((row): row is AgencyAudit => !!row);
}

export async function createConsolidatedAgencyReport(
  orgId: string,
  clientName: string,
  auditIds: string[],
  createdBy = "system",
  database: TransactionalDatabase = pool,
): Promise<{ id: string; name: string; auditCount: number }> {
  // This flow also creates a client portal, so fail before report quota checks
  // or writes if the deployment has no usable public URL.
  getAgencyPublicBaseUrl();
  const client = await database.connect();
  let active = false;
  const reportId = `r_${randomBytes(12).toString("hex")}`;
  const name = `${clientName} — Rapport multi-sites`;
  try {
    await client.query("BEGIN");
    active = true;
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1)::bigint)", [`${orgId}:reports`]);
    const audits = await loadSelectedAgencyAudits(orgId, auditIds, { query: client.query.bind(client) } as Queryable);
    if (audits.length !== auditIds.length) throw new Error("AGENCY_AUDIT_NOT_FOUND");
    if (audits.some(audit => audit.status !== "completed")) throw new Error("AGENCY_AUDIT_NOT_COMPLETE");
    const { checkQuota } = await import("./billing-service.js");
    const quota = await checkQuota("reports", orgId);
    if (!quota.allowed) throw new Error("REPORT_QUOTA_EXCEEDED");

    const notes = audits.map(audit => ({
      title: `Mesures du site ${audit.url}`,
      date: audit.created_at,
      site: audit.url,
      notes: [
        `Audit ${audit.id} (${audit.status})`,
        `Score SEO mesuré : ${audit.score ?? "indisponible"}/100`,
        `Performance mesurée : ${audit.speed ?? "indisponible"}/100`,
        `Problèmes mesurés : ${audit.issues ?? "indisponible"}`,
      ].join("\n"),
    }));
    const measuredSnapshot = {
      source: "agency_multi_site",
      sites: audits.map(audit => ({
        url: audit.url,
        auditDate: audit.created_at,
        score: audit.score,
        speed: audit.speed,
        issues: audit.issues,
      })),
    };
    await client.query(
      `INSERT INTO reports
        (id, org_id, name, type, template_key, date, pages, shared, audit_id,
         white_label, pdf_ready, meeting_notes_json, generation_metadata_json, date_start, date_end, created_by)
       VALUES ($1,$2,$3,'REPORT','executive',$4,0,false,$5,false,false,$6,$7,'','',$8)`,
      [reportId, orgId, name, new Date().toISOString(), audits[0].id, JSON.stringify(notes), JSON.stringify(measuredSnapshot), createdBy],
    );
    await client.query("COMMIT");
    active = false;
    return { id: reportId, name, auditCount: audits.length };
  } catch (error) {
    if (active) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function createAgencyCustomerPortal(
  orgId: string,
  clientName: string,
  reportIds: string[],
  createdBy: string | null,
  database: Queryable = pool,
): Promise<{ id: string; token: string; expiresAt: string }> {
  getAgencyPublicBaseUrl();
  const client = database === pool ? await pool.connect() : null;
  let active = false;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const id = `portal_${randomBytes(12).toString("hex")}`;
  const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  try {
    if (client) {
      await client.query("BEGIN");
      active = true;
      await client.query("SELECT set_config('app.current_org_id', $1, true)", [orgId]);
    }
    const query = client ? client.query.bind(client) : database.query.bind(database);
    const rows = await query(
      `SELECT id FROM reports WHERE org_id=$1 AND id=ANY($2::text[])`,
      [orgId, reportIds],
    );
    if (rows.rows.length !== reportIds.length) throw new Error("AGENCY_REPORT_NOT_FOUND");
    await query(
      `INSERT INTO agency_customer_portals
        (id, org_id, token_hash, client_name, report_ids, expires_at, created_by)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
      [id, orgId, tokenHash, clientName, JSON.stringify(reportIds), expiresAt, createdBy],
    );
    if (client) {
      await client.query("COMMIT");
      active = false;
    }
    return { id, token, expiresAt };
  } catch (error) {
    if (active && client) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client?.release();
  }
}

export function hashAgencyPortalToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
