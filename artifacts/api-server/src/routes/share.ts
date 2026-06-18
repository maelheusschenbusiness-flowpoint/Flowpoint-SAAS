import { Router } from "express";
import { db, shareTokensTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

const router = Router();

router.get("/share/:token", async (req, res) => {
  const [row] = await db.select().from(shareTokensTable).where(eq(shareTokensTable.token, req.params.token));

  if (!row) {
    res.status(404).json({ error: "Share link not found or has been revoked." });
    return;
  }
  if (new Date(row.expiresAt) < new Date()) {
    res.status(410).json({ error: "This share link has expired." });
    return;
  }

  await db.update(shareTokensTable)
    .set({ views: sql`${shareTokensTable.views} + 1` })
    .where(eq(shareTokensTable.token, req.params.token));

  // Parse the stored report snapshot and strip any internal-only fields
  // (defense in depth: tokens created before the fix may still carry them).
  const reportSnapshot = JSON.parse(row.reportJson) as Record<string, unknown>;
  delete reportSnapshot.meetingNotesJson;

  // Re-scope audits to only those that belong to this report.
  // This also sanitizes legacy tokens whose auditsJson may contain
  // unrelated records bundled before this fix was applied.
  const allowedAuditId = typeof reportSnapshot.auditId === "string" ? reportSnapshot.auditId : null;
  const rawAudits = JSON.parse(row.auditsJson) as Record<string, unknown>[];
  const scopedAudits = allowedAuditId
    ? rawAudits.filter((a) => a.id === allowedAuditId)
    : [];

  // Meeting notes are internal and must never be returned on a public link.
  res.json({
    report:    reportSnapshot,
    branding:  JSON.parse(row.brandingJson),
    audits:    scopedAudits,
    meetingNotes: [],
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  });
});

export default router;
