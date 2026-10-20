import { Router } from "express";
import { pool } from "@workspace/db";

const router = Router();

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
