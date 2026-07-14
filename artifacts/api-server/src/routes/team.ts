import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { randomBytes, createHash } from "crypto";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};

function requireOrg(req: Request, res: Response): string | null {
  const orgId = (req as OrgReq).orgId;
  if (!orgId || orgId === "default") {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return orgId;
}

router.get("/team", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;
  try {
    const r = await (req as OrgReq).orgDb(
      `SELECT id, name, email, role, joined, status, invited_at, email_status, created_at
       FROM team_members WHERE org_id = $1 ORDER BY created_at ASC LIMIT 100`,
      [org]
    );
    res.json(r.rows.map(m => ({
      id:          m.id,
      name:        m.name,
      email:       m.email,
      role:        m.role,
      status:      m.status  ?? "active",
      emailStatus: m.email_status ?? null,
      joined:      m.joined,
      invitedAt:   m.invited_at ?? null,
      createdAt:   m.created_at,
    })));
  } catch {
    res.json([]);
  }
});

router.post("/team/invite", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;

  const { email: rawEmail, role } = req.body as { email?: string; role?: string };
  if (!rawEmail || !rawEmail.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  const email      = rawEmail.toLowerCase().trim();
  const ALLOWED_ROLES = ["manager", "editor", "viewer"];
  const memberRole = ALLOWED_ROLES.includes((role || "viewer").toLowerCase())
    ? (role || "viewer").toLowerCase()
    : "viewer";

  // Duplicate guard: same email (case-insensitive), same org → 409
  try {
    const dup = await (req as OrgReq).orgDb(
      `SELECT id FROM team_members WHERE org_id = $1 AND lower(email) = lower($2) LIMIT 1`,
      [org, email]
    );
    if (dup.rows.length) {
      res.status(409).json({
        error: "Une invitation est déjà en attente pour cette adresse.",
        code:  "DUPLICATE_INVITATION",
      });
      return;
    }
  } catch (guardErr) {
    logger.warn({ err: guardErr, org }, "[team/invite] duplicate guard query failed — proceeding");
  }

  // Cryptographically random token — never logged in full
  const rawToken  = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const id     = `inv_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const name   = email.split("@")[0] || "Invité";
  const joined = new Date().toISOString().slice(0, 10);

  try {
    await (req as OrgReq).orgDb(
      `INSERT INTO team_members
         (id, org_id, name, email, role, joined, status,
          invited_by, invitation_token_hash, invited_at, expires_at,
          email_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,NOW(),$9,'pending',NOW(),NOW())`,
      [id, org, name, email, memberRole, joined, org, tokenHash, expiresAt.toISOString()]
    );
  } catch (err: unknown) {
    const pgCode = (err as { code?: string }).code;
    logger.error(
      { sqlCode: pgCode, sqlMsg: (err as Error).message, org, emailDomain: email.split("@")[1] ?? "" },
      "[team/invite] INSERT failed"
    );
    if (pgCode === "23505") {
      res.status(409).json({
        error: "Une invitation est déjà en attente pour cette adresse.",
        code:  "DUPLICATE_INVITATION",
      });
      return;
    }
    res.status(500).json({ error: "Failed to create invitation" });
    return;
  }

  // Load inviter profile for email context (never use global singleton for multi-tenant)
  const { loadOrgSettings } = await import("../services/org-settings.js");
  const inviterProfile = await loadOrgSettings(org).catch(() => null);
  const inviterName    = inviterProfile?.firstName || "Un collègue";
  const orgName        = inviterProfile?.orgName   || "FlowPoint";

  // Invite URL — uses production domain; raw token in URL, only hash in DB
  const inviteUrl = `https://app.flowpoint.pro/login.html?invite=${encodeURIComponent(id)}&token=${rawToken}&email=${encodeURIComponent(email)}`;

  // Send invitation email via existing Resend service
  const { mailer } = await import("../services/mailer.js");
  const mailResult = await mailer.sendTeamInvitation({
    to:          email,
    inviterName,
    orgName,
    role:        memberRole,
    inviteUrl,
  }).catch((e: unknown) => ({ ok: false as const, error: String(e), id: undefined }));

  const emailStatus  = mailResult.ok ? "sent"    : "failed";
  const resendMsgId  = mailResult.ok ? ((mailResult as Record<string, unknown>).id as string ?? null) : null;
  const emailErrSafe = mailResult.ok ? null : (mailResult.error ?? "unknown").slice(0, 250);

  // Persist email delivery status (non-blocking)
  (req as OrgReq).orgDb(
    `UPDATE team_members
     SET email_status=$1, resend_message_id=$2, email_error=$3, updated_at=NOW()
     WHERE id=$4`,
    [emailStatus, resendMsgId, emailErrSafe, id]
  ).catch((e: unknown) => logger.warn({ err: e, id }, "[team/invite] email status update failed"));

  if (!mailResult.ok) {
    logger.warn(
      { emailErr: emailErrSafe, org, emailDomain: email.split("@")[1] ?? "" },
      "[team/invite] Resend delivery failed — invitation row kept"
    );
    res.status(502).json({
      ok:   false,
      code: "INVITATION_EMAIL_FAILED",
      error: "L'invitation a été créée, mais l'e-mail n'a pas pu être envoyé.",
      member: { id, email, role: memberRole, status: "pending", invitedAt: new Date().toISOString() },
    });
    return;
  }

  res.status(201).json({
    ok: true,
    member: { id, email, role: memberRole, status: "pending", invitedAt: new Date().toISOString() },
    email:  { status: "sent", messageId: resendMsgId },
  });
});

router.patch("/team/:id", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;
  const { role } = req.body as { role?: string };
  if (!role) { res.status(400).json({ error: "role required" }); return; }
  const ALLOWED = ["viewer", "editor", "admin", "owner", "manager"];
  if (!ALLOWED.includes(role)) { res.status(400).json({ error: "invalid role" }); return; }
  try {
    const r = await (req as OrgReq).orgDb(
      `UPDATE team_members SET role=$1, updated_at=NOW() WHERE id=$2 AND org_id=$3 RETURNING id, name, email, role`,
      [role, req.params.id, org]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "member not found" }); return; }
    const m = r.rows[0];
    res.json({ ok: true, member: { id: m.id, name: m.name, email: m.email, role: m.role } });
  } catch (err) {
    logger.error({ err, org }, "[team/patch] UPDATE failed");
    res.status(500).json({ error: "Failed to update member" });
  }
});

router.delete("/team/:id", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;
  try {
    await (req as OrgReq).orgDb(
      `DELETE FROM team_members WHERE id=$1 AND org_id=$2`,
      [req.params.id, org]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, org }, "[team/delete] DELETE failed");
    res.status(500).json({ error: "Failed to delete member" });
  }
});

export default router;
