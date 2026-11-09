import { Router } from "express";
import { pool } from "@workspace/db";
import { hashAgencyPortalToken } from "../services/agency-reporting.js";

const router = Router();

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

router.get("/agency-portal/:token", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Content-Type-Options", "nosniff");
  const token = String(req.params.token || "");
  if (!/^[A-Za-z0-9_-]{40,50}$/.test(token)) {
    res.status(404).send("Customer portal not found or revoked.");
    return;
  }
  const client = await pool.connect();
  let txActive = false;
  try {
    await client.query("BEGIN");
    txActive = true;
    await client.query("SELECT set_config('app.agency_portal_token_hash', $1, true)", [hashAgencyPortalToken(token)]);
    const portalResult = await client.query<{
      org_id: string; client_name: string; report_ids: string[] | string; expires_at: Date; revoked_at: Date | null;
    }>(
      `SELECT org_id, client_name, report_ids, expires_at, revoked_at
         FROM agency_customer_portals WHERE token_hash=$1 LIMIT 1`,
      [hashAgencyPortalToken(token)],
    );
    const portal = portalResult.rows[0];
    if (!portal || portal.revoked_at || new Date(portal.expires_at).getTime() <= Date.now()) {
      await client.query("ROLLBACK");
      txActive = false;
      res.status(404).send("Customer portal not found, expired, or revoked.");
      return;
    }
    const reportIds = typeof portal.report_ids === "string" ? JSON.parse(portal.report_ids) : portal.report_ids;
    if (!Array.isArray(reportIds) || !reportIds.length) {
      await client.query("ROLLBACK");
      txActive = false;
      res.status(404).send("No reports are available in this portal.");
      return;
    }
    await client.query("SELECT set_config('app.current_org_id', $1, true)", [portal.org_id]);
    await client.query("SELECT set_config('app.agency_portal_token_hash', '', true)");
    const reports = await client.query<{
      id: string; name: string; type: string; date: string; template_key: string; generation_metadata_json: string;
    }>(
      `SELECT id, name, type, date, template_key, generation_metadata_json
         FROM reports WHERE org_id=$1 AND id=ANY($2::text[]) ORDER BY date DESC`,
      [portal.org_id, reportIds],
    );
    await client.query("COMMIT");
    txActive = false;
    const rows = reports.rows.map((report: {
      id: string; name: string; type: string; date: string; template_key: string; generation_metadata_json: string;
    }) => {
      let sites: Array<{ url?: string; auditDate?: string; score?: number | null; speed?: number | null; issues?: number | null }> = [];
      try {
        const metadata = JSON.parse(report.generation_metadata_json || "{}") as Record<string, unknown>;
        if (metadata.source === "agency_multi_site" && Array.isArray(metadata.sites)) sites = metadata.sites;
      } catch { /* malformed/non-agency report metadata is never rendered */ }
      const measuredSites = sites.map(site =>
        `<tr><td>${escapeHtml(site.url)}</td><td>${escapeHtml(site.score ?? "—")}</td><td>${escapeHtml(site.speed ?? "—")}</td><td>${escapeHtml(site.issues ?? "—")}</td><td>${escapeHtml(site.auditDate)}</td></tr>`
      ).join("");
      const measured = measuredSites
        ? `<table><thead><tr><th>Site</th><th>SEO score</th><th>Performance</th><th>Issues</th><th>Audit date</th></tr></thead><tbody>${measuredSites}</tbody></table>`
        : "<p>Read-only report access</p>";
      return `<section><h2>${escapeHtml(report.name)}</h2><p>${escapeHtml(report.date)} · ${escapeHtml(report.template_key)} · ${escapeHtml(report.type)}</p>${measured}</section>`;
    }).join("");
    res.type("html").send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>Reports for ${escapeHtml(portal.client_name)}</title><style>body{font:16px system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;color:#182033}section{border:1px solid #dce2ed;border-radius:12px;padding:20px;margin:20px 0}article{background:#f6f8fc;padding:12px;margin:12px 0;border-radius:8px}pre{white-space:pre-wrap;font:inherit}h1{font-size:28px}</style></head><body><h1>Reports for ${escapeHtml(portal.client_name)}</h1><p>Read-only customer portal · Expires ${escapeHtml(new Date(portal.expires_at).toLocaleDateString("en"))}</p>${rows || "<p>No reports are available.</p>"}</body></html>`);
  } catch {
    if (txActive) await client.query("ROLLBACK").catch(() => {});
    res.status(503).send("Customer portal is temporarily unavailable.");
  } finally {
    client.release();
  }
});

/** Extended row shape that includes columns present in the DB but not in the Drizzle schema stub. */
interface ShareTokenRow {
  token: string;
  orgId: string | null;
  expiresAt: Date | null;
  createdAt: Date | null;
  views: number | null;
  reportJson: string | null;
  auditsJson: string | null;
  brandingJson: string | null;
}

router.get("/share/:token", async (req, res) => {
    // Query only the durable share_tokens schema. Older generic share columns
    // (id/type/target_id) are not part of report share links.
  const client = await pool.connect();
  try {
    const result = await client.query<ShareTokenRow>(
      `SELECT token, org_id AS "orgId",
              expires_at AS "expiresAt", created_at AS "createdAt",
              views, report_json AS "reportJson",
              audits_json AS "auditsJson", branding_json AS "brandingJson"
       FROM share_tokens WHERE token = $1 LIMIT 1`,
      [req.params.token],
    );
    const row = result.rows[0] ?? null;

    if (!row) {
      res.status(404).json({ error: "Share link not found or has been revoked." });
      return;
    }
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) {
      res.status(410).json({ error: "This share link has expired." });
      return;
    }

    // Increment view counter (fire-and-forget — non-fatal if column absent)
    client.query(
      `UPDATE share_tokens SET views = COALESCE(views, 0) + 1 WHERE token = $1`,
      [req.params.token],
    ).catch(() => {});

    // Parse the stored report snapshot and strip any internal-only fields
    // (defense in depth: tokens created before the fix may still carry them).
    const reportSnapshot = JSON.parse(row.reportJson ?? "{}") as Record<string, unknown>;
    delete reportSnapshot.meetingNotesJson;

    // Re-scope audits to only those that belong to this report.
    // This also sanitizes legacy tokens whose auditsJson may contain
    // unrelated records bundled before this fix was applied.
    const allowedAuditId = typeof reportSnapshot.auditId === "string"
      ? reportSnapshot.auditId
      : typeof reportSnapshot.audit_id === "string" ? reportSnapshot.audit_id : null;
    const rawAudits = JSON.parse(row.auditsJson ?? "[]") as Record<string, unknown>[];
    const scopedAudits = allowedAuditId
      ? rawAudits.filter((a) => a.id === allowedAuditId)
      : [];

    // Meeting notes are internal and must never be returned on a public link.
    res.json({
      report:    reportSnapshot,
      branding:  JSON.parse(row.brandingJson ?? "{}"),
      audits:    scopedAudits,
      meetingNotes: [],
      createdAt: row.createdAt,
      expiresAt: row.expiresAt,
    });
  } finally {
    client.release();
  }
});

export default router;
