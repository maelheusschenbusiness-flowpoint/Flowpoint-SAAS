/**
 * /api/team — Team management endpoints
 *
 * GET  /team           → list members
 * POST /team/invite    → invite by email (201/409/502)
 * PATCH /team/:id      → change role
 * DELETE /team/:id     → remove member
 *
 * All DB calls go through req.orgDb which:
 *   • checks out a pool connection
 *   • sets ROLE app_user (drops BYPASSRLS)
 *   • sets app.current_org_id GUC (used by RLS policies)
 *   • runs the query in a transaction and commits
 *
 * Email delivery via the central mailer service (Resend, sender: FlowPoint <noreply@flowpoint.pro>)
 */

import { Router, type Request, type Response } from "express";
import { logger }                               from "../lib/logger.js";
import { randomBytes, createHash }             from "crypto";

const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

type OrgDbFn = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

type OrgReq = Request & {
  orgDb:  OrgDbFn;
  orgId?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Return orgId if valid, otherwise send 401 and return null. */
function requireOrg(req: Request, res: Response): string | null {
  const orgId = (req as OrgReq).orgId;
  if (!orgId || orgId === "default") {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return orgId;
}

/** Safely call req.orgDb — throws TypeError if middleware is missing. */
function orgDb(req: Request): OrgDbFn {
  const fn = (req as OrgReq).orgDb;
  if (typeof fn !== "function") throw new Error("orgDb middleware not applied — check app.ts");
  return fn;
}

// ── GET /team ─────────────────────────────────────────────────────────────────

router.get("/team", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;
  try {
    const r = await orgDb(req)(
      `SELECT id, name, email, role, joined, status, invited_at, email_status, created_at
       FROM team_members WHERE org_id = $1 ORDER BY created_at ASC LIMIT 100`,
      [org]
    );
    res.json(r.rows.map(m => ({
      id:          m.id,
      name:        m.name,
      email:       m.email,
      role:        m.role,
      status:      m.status      ?? "active",
      emailStatus: m.email_status ?? null,
      joined:      m.joined,
      invitedAt:   m.invited_at  ?? null,
      createdAt:   m.created_at,
    })));
  } catch {
    res.json([]);
  }
});

// ── POST /team/invite ─────────────────────────────────────────────────────────

router.post("/team/invite", async (req: Request, res: Response) => {
  const reqId = `inv_req_${Date.now()}`;

  // ── STEP 1 — Auth / org context ──────────────────────────────────────────
  logger.info({ reqId }, "[team/invite] STEP 1: resolving org context");
  const org = requireOrg(req, res);
  if (!org) {
    logger.warn({ reqId }, "[team/invite] STEP 1 FAIL: no valid org → 401");
    return;
  }
  logger.info({ reqId, orgPrefix: org.slice(0, 20) }, "[team/invite] STEP 1 OK");

  // ── STEP 2 — orgDb availability ──────────────────────────────────────────
  logger.info({ reqId }, "[team/invite] STEP 2: checking orgDb availability");
  const hasOrgDb = typeof (req as OrgReq).orgDb === "function";
  if (!hasOrgDb) {
    logger.error({ reqId }, "[team/invite] STEP 2 FAIL: req.orgDb is not a function");
    res.status(500).json({ error: "Database context unavailable", code: "ORGDB_MISSING" });
    return;
  }
  logger.info({ reqId }, "[team/invite] STEP 2 OK: orgDb is available");

  // ── STEP 3 — Input validation ────────────────────────────────────────────
  logger.info({ reqId }, "[team/invite] STEP 3: validating input");
  const { email: rawEmail, role } = req.body as { email?: string; role?: string };
  logger.info({ reqId, hasEmail: !!rawEmail, role }, "[team/invite] STEP 3: raw input received");

  if (!rawEmail || !rawEmail.includes("@")) {
    logger.warn({ reqId, rawEmail }, "[team/invite] STEP 3 FAIL: invalid email → 400");
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  const email      = rawEmail.toLowerCase().trim();
  const ROLES      = ["manager", "editor", "viewer"];
  const memberRole = ROLES.includes((role ?? "viewer").toLowerCase())
    ? (role ?? "viewer").toLowerCase()
    : "viewer";
  logger.info({ reqId, emailDomain: email.split("@")[1] ?? "?", memberRole }, "[team/invite] STEP 3 OK");

  // ── STEP 4 — Duplicate guard ─────────────────────────────────────────────
  logger.info({ reqId }, "[team/invite] STEP 4: duplicate guard query");
  try {
    const dup = await orgDb(req)(
      `SELECT id, status FROM team_members WHERE org_id = $1 AND lower(email) = lower($2) LIMIT 1`,
      [org, email]
    );
    logger.info({ reqId, dupFound: dup.rows.length > 0 }, "[team/invite] STEP 4: duplicate check done");
    if (dup.rows.length > 0) {
      logger.warn({ reqId, existingStatus: dup.rows[0]?.status }, "[team/invite] STEP 4 FAIL: duplicate → 409");
      res.status(409).json({
        error: "Une invitation est déjà en attente pour cette adresse.",
        code:  "DUPLICATE_INVITATION",
      });
      return;
    }
  } catch (guardErr) {
    // Non-fatal — proceed; INSERT will catch real uniqueness violations
    logger.warn(
      { reqId, err: (guardErr as Error).message, sqlCode: (guardErr as Record<string, unknown>).code },
      "[team/invite] STEP 4 WARN: duplicate guard query failed — proceeding to INSERT"
    );
  }

  // ── STEP 5 — Token generation ────────────────────────────────────────────
  logger.info({ reqId }, "[team/invite] STEP 5: generating invitation token");
  const rawToken  = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const id        = `inv_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const name      = email.split("@")[0] ?? "Invité";
  const joined    = new Date().toISOString().slice(0, 10);
  logger.info({ reqId, id, tokenHashPrefix: tokenHash.slice(0, 8) }, "[team/invite] STEP 5 OK");

  // ── STEP 6 — INSERT team_members ─────────────────────────────────────────
  logger.info({ reqId, id, org: org.slice(0, 20) }, "[team/invite] STEP 6: INSERT into team_members");
  try {
    await orgDb(req)(
      `INSERT INTO team_members
         (id, org_id, name, email, role, joined, status,
          invited_by, invitation_token_hash, invited_at, expires_at,
          email_status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,NOW(),$9,'pending',NOW(),NOW())`,
      [id, org, name, email, memberRole, joined, org, tokenHash, expiresAt.toISOString()]
    );
    logger.info({ reqId, id }, "[team/invite] STEP 6 OK: INSERT succeeded");
  } catch (insertErr: unknown) {
    const pgCode = (insertErr as Record<string, unknown>).code as string | undefined;
    const pgMsg  = (insertErr as Error).message ?? "unknown SQL error";
    logger.error(
      { reqId, sqlCode: pgCode, sqlMsg: pgMsg, id, org: org.slice(0, 20), emailDomain: email.split("@")[1] ?? "?" },
      "[team/invite] STEP 6 FAIL: INSERT error"
    );
    if (pgCode === "23505") {
      res.status(409).json({
        error: "Une invitation est déjà en attente pour cette adresse.",
        code:  "DUPLICATE_INVITATION",
      });
      return;
    }
    // Return SQL details in response to assist debugging without log access
    res.status(500).json({
      error:     "Failed to create invitation",
      _sqlCode:  pgCode  ?? "unknown",
      _detail:   pgMsg,
    });
    return;
  }

  // ── STEP 7 — Load inviter profile ────────────────────────────────────────
  logger.info({ reqId }, "[team/invite] STEP 7: loading inviter profile from org_settings");
  const { loadOrgSettings } = await import("../services/org-settings.js");
  const inviterProfile = await loadOrgSettings(org).catch((e: unknown) => {
    logger.warn({ reqId, err: (e as Error).message }, "[team/invite] STEP 7 WARN: loadOrgSettings failed");
    return null;
  });
  const inviterName = inviterProfile?.firstName ?? "Un collègue";
  const orgName     = inviterProfile?.orgName   ?? "FlowPoint";
  logger.info({ reqId, inviterName, orgName }, "[team/invite] STEP 7 OK");

  // ── STEP 8 — Build invite URL ─────────────────────────────────────────────
  const inviteUrl = `https://app.flowpoint.pro/login.html?invite=${encodeURIComponent(id)}&token=${rawToken}&email=${encodeURIComponent(email)}`;
  logger.info({ reqId, inviteUrlLength: inviteUrl.length }, "[team/invite] STEP 8 OK: invite URL built");

  // ── STEP 9 — Send invitation email ────────────────────────────────────────
  logger.info({ reqId, toEmailDomain: email.split("@")[1] ?? "?" }, "[team/invite] STEP 9: calling mailer.sendTeamInvitation");
  const { mailer } = await import("../services/mailer.js");
  const mailResult = await mailer.sendTeamInvitation({
    to:          email,
    inviterName,
    orgName,
    role:        memberRole,
    inviteUrl,
  }).catch((e: unknown) => {
    logger.error({ reqId, err: (e as Error).message }, "[team/invite] STEP 9 WARN: mailer threw");
    return { ok: false as const, error: String(e), id: undefined };
  });
  logger.info(
    { reqId, mailOk: mailResult.ok, mailErr: mailResult.ok ? null : mailResult.error },
    "[team/invite] STEP 9: mailer returned"
  );

  // ── STEP 10 — Persist email delivery status ───────────────────────────────
  const emailStatus  = mailResult.ok ? "sent"   : "failed";
  const resendMsgId  = mailResult.ok ? ((mailResult as Record<string, unknown>).id as string ?? null) : null;
  const emailErrSafe = mailResult.ok ? null : ((mailResult.error ?? "unknown error") as string).slice(0, 250);

  logger.info({ reqId, emailStatus, hasMessageId: !!resendMsgId }, "[team/invite] STEP 10: updating email_status in DB");
  orgDb(req)(
    `UPDATE team_members SET email_status=$1, resend_message_id=$2, email_error=$3, updated_at=NOW() WHERE id=$4`,
    [emailStatus, resendMsgId, emailErrSafe, id]
  ).catch((e: unknown) =>
    logger.warn({ reqId, err: (e as Error).message, id }, "[team/invite] STEP 10 WARN: email status UPDATE failed")
  );

  // ── STEP 11 — Final response ──────────────────────────────────────────────
  if (!mailResult.ok) {
    logger.warn({ reqId, emailErr: emailErrSafe }, "[team/invite] STEP 11: email failed → 502 (row kept)");
    res.status(502).json({
      ok:    false,
      code:  "INVITATION_EMAIL_FAILED",
      error: "L'invitation a été créée, mais l'e-mail n'a pas pu être envoyé.",
      member: { id, email, role: memberRole, status: "pending", invitedAt: new Date().toISOString() },
    });
    return;
  }

  logger.info({ reqId, id, messageId: resendMsgId }, "[team/invite] STEP 11: SUCCESS → 201");
  res.status(201).json({
    ok:     true,
    member: { id, email, role: memberRole, status: "pending", invitedAt: new Date().toISOString() },
    email:  { status: "sent", messageId: resendMsgId },
  });
});

// ── PATCH /team/:id — change role ─────────────────────────────────────────────

router.patch("/team/:id", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;
  const { role } = req.body as { role?: string };
  if (!role) { res.status(400).json({ error: "role required" }); return; }
  const ALLOWED = ["viewer", "editor", "admin", "owner", "manager"];
  if (!ALLOWED.includes(role)) { res.status(400).json({ error: "invalid role" }); return; }
  try {
    const r = await orgDb(req)(
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

// ── DELETE /team/:id — remove member ──────────────────────────────────────────

router.delete("/team/:id", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;
  try {
    await orgDb(req)(
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
