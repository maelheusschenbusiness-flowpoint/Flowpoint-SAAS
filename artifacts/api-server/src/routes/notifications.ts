import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { isUUIDFormat } from "../lib/validate-org-id.js";
import { canWrite, canAdmin } from "../middlewares/requireRole.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
  orgContext?: { email?: string; userId?: string };
};

function getOrg(req: Request): string {
  return (req as OrgReq).orgId ?? "default";
}

// Identities under which the requester can be a notification recipient.
// recipient_id may hold a UUID (userUuid / user_id_v2) when the owner path
// is taken in team-messages.ts (COALESCE(u.id::text, owner_email)), or an
// email when the member was added via team_members with user_id=email.
// Include ALL three identity forms so either storage form matches.
function recipientIds(req: Request): string[] {
  const ctx = (req as OrgReq).orgContext;
  return [ctx?.userUuid, ctx?.userId, ctx?.email].filter((v): v is string => !!v);
}

function getOrganizationUuid(orgId: string): string | null {
  return isUUIDFormat(orgId) ? orgId : null;
}

// ── GET /notifications ────────────────────────────────────────────────────────

router.get("/notifications", async (req: Request, res: Response) => {
  try {
    const orgId = getOrg(req);
    // notifications.org_id is TEXT, while organizations.id is UUID. Keep the
    // two parameter types independent so PostgreSQL never infers uuid = text.
    const organizationId = getOrganizationUuid(orgId);
    // Org-wide rows (recipient_id IS NULL) + rows addressed to this requester.
    // Other members' targeted rows (e.g. their chat alerts) are never returned.
    const rids = recipientIds(req);
    const result = await (req as OrgReq).orgDb(
      `SELECT * FROM notifications
         WHERE org_id = $1
           AND (recipient_id IS NULL OR recipient_id = ANY($3::text[]))
           AND created_at >= COALESCE(
              (SELECT created_at FROM organizations WHERE id = $2::uuid),
             '-infinity'::timestamptz
           )
       ORDER BY created_at DESC LIMIT 50`,
       [orgId, organizationId, rids],
    );
    res.json(result.rows.map((n: Record<string, unknown>) => ({
      id:        n.id,
      type:      n.type,
      title:     n.title,
      message:   n.message,
      read:      n.read,
      link:      n.link,
      createdAt: n.created_at,
    })));
  } catch (err) {
    logger.warn({ err }, "[notifications] GET failed");
    res.json([]);
  }
});

// ── POST /notifications ───────────────────────────────────────────────────────

router.post("/notifications", canAdmin, async (req: Request, res: Response) => {
  const { type = "info", title, message, link } = req.body as {
    type?: string; title?: string; message?: string; link?: string;
  };
  if (!title || !message) {
    res.status(400).json({ error: "title and message required" }); return;
  }
  try {
    const id  = `notif${Date.now()}`;
    const org = getOrg(req);
    const result = await (req as OrgReq).orgDb(
      `INSERT INTO notifications (id, org_id, type, title, message, link, read, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,false,NOW()) RETURNING *`,
      [id, org, type, title, message, link ?? null],
    );
    const n = result.rows[0];
    res.status(201).json({
      id: n.id, type: n.type, title: n.title,
      message: n.message, read: n.read, link: n.link,
    });
  } catch (err) {
    logger.error({ err }, "[notifications] POST failed");
    res.status(500).json({ error: "Failed to create notification" });
  }
});

// ── PATCH /notifications/:id/read ─────────────────────────────────────────────

router.patch("/notifications/:id/read", async (req: Request, res: Response) => {
  try {
    // A member may only mark org-wide rows or their OWN targeted rows as read —
    // never another recipient's (that would erase their chat alerts).
    const result = await (req as OrgReq).orgDb(
      `UPDATE notifications SET read = true
        WHERE id = $1 AND org_id = $2
          AND (recipient_id IS NULL OR recipient_id = ANY($3::text[]))
        RETURNING *`,
      [req.params.id, getOrg(req), recipientIds(req)],
    );
    const n = result.rows[0];
    res.json(n
      ? { id: n.id, type: n.type, title: n.title, message: n.message, read: n.read }
      : { ok: true });
  } catch (err) {
    logger.error({ err }, "[notifications] PATCH read failed");
    res.status(500).json({ error: "Failed to mark read" });
  }
});

// ── PATCH /notifications/read-all ────────────────────────────────────────────

router.patch("/notifications/read-all", async (req: Request, res: Response) => {
  try {
    // Scoped to org-wide rows + the requester's own targeted rows. Another
    // member's per-recipient notifications (chat alerts) are left untouched.
    await (req as OrgReq).orgDb(
      `UPDATE notifications SET read = true
        WHERE org_id = $1
          AND (recipient_id IS NULL OR recipient_id = ANY($2::text[]))`,
      [getOrg(req), recipientIds(req)],
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[notifications] PATCH read-all failed");
    res.status(500).json({ error: "Failed to mark all read" });
  }
});

// ── DELETE /notifications/:id ─────────────────────────────────────────────────

router.delete("/notifications/:id", canWrite, async (req: Request, res: Response) => {
  try {
    const r = await (req as OrgReq).orgDb(
      `DELETE FROM notifications
        WHERE id = $1 AND org_id = $2
          AND (recipient_id IS NULL OR recipient_id = ANY($3::text[]))
        RETURNING id`,
      [req.params.id, getOrg(req), recipientIds(req)],
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Notification not found" }); return; }
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

export default router;
