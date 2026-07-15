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
import { pool }                                from "@workspace/db";

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

/** Mask email for safe logging: j***@example.com */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${(local ?? "?")[0] ?? "?"}***@${domain ?? "?"}`;
}

// ── GET /team ─────────────────────────────────────────────────────────────────

router.get("/team", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;

  const sql = `SELECT id, email, role, joined, status, invited_at, email_status, created_at
               FROM team_members WHERE org_id = $1 ORDER BY created_at ASC LIMIT 100`;
  try {
    const r = await orgDb(req)(sql, [org]);
    res.json(r.rows.map(m => ({
      id:          m.id,
      name:        (m.email as string)?.split("@")[0] ?? "",
      email:       m.email,
      role:        m.role,
      status:      m.status       ?? "active",
      emailStatus: m.email_status ?? null,
      joined:      m.joined,
      invitedAt:   m.invited_at   ?? null,
      createdAt:   m.created_at,
    })));
  } catch (listErr) {
    const le = listErr as Record<string, unknown>;
    logger.error(
      {
        orgId:         org.slice(0, 20),
        sqlCode:       le["code"],
        sqlMsg:        (listErr as Error).message,
        sqlDetail:     le["detail"],
        sqlConstraint: le["constraint"],
        sqlTable:      le["table"],
        sqlColumn:     le["column"],
        stack:         (listErr as Error).stack,
      },
      "[team/get] SELECT failed"
    );
    res.json([]);
  }
});

// ── POST /team/invite ─────────────────────────────────────────────────────────

/*
 * Columns used by the INSERT (logged at STEP 5.5 and STEP 6, never values).
 * Schema repairs run only in initDataTables() at startup — never from here.
 */
const INSERT_COLS = [
  "id", "org_id", "email", "role", "joined", "status",
  "invited_by", "invitation_token_hash", "invited_at", "expires_at",
  "email_status", "created_at", "updated_at",
] as const;

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
  if (typeof (req as OrgReq).orgDb !== "function") {
    logger.error({ reqId }, "[team/invite] STEP 2 FAIL: req.orgDb is not a function");
    res.status(500).json({ ok: false, code: "ORGDB_MISSING", error: "Database context unavailable" });
    return;
  }
  logger.info({ reqId }, "[team/invite] STEP 2 OK: orgDb is available");

  // ── STEP 3 — Input validation ────────────────────────────────────────────
  logger.info({ reqId }, "[team/invite] STEP 3: validating input");
  const { email: rawEmail, role } = req.body as { email?: string; role?: string };
  logger.info({ reqId, hasEmail: !!rawEmail, role }, "[team/invite] STEP 3: raw input received");

  if (!rawEmail || !rawEmail.includes("@")) {
    logger.warn({ reqId }, "[team/invite] STEP 3 FAIL: invalid email → 400");
    res.status(400).json({ ok: false, error: "Valid email required" });
    return;
  }

  const email      = rawEmail.toLowerCase().trim();
  const maskedEmail = maskEmail(email);
  const ROLES      = ["manager", "editor", "viewer"];
  const rawRole    = (role ?? "viewer").toLowerCase();
  if (!ROLES.includes(rawRole)) {
    logger.warn({ reqId, rawRole }, "[team/invite] STEP 3 FAIL: invalid role → 400");
    res.status(400).json({
      ok: false,
      code:  "INVALID_ROLE",
      error: `Rôle invalide. Valeurs acceptées : ${ROLES.join(", ")}.`,
    });
    return;
  }
  const memberRole = rawRole;
  logger.info({ reqId, maskedEmail, memberRole }, "[team/invite] STEP 3 OK");

  // ── STEP 4 — Token generation ────────────────────────────────────────────
  // No SELECT-before-INSERT. The partial unique index on (org_id, lower(email))
  // WHERE status='pending' is the sole source of truth for duplicates.
  // If a pending row already exists the INSERT throws 23505 → 409 in STEP 6.
  logger.info({ reqId }, "[team/invite] STEP 4: generating invitation token");
  const rawToken  = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(rawToken).digest("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
  const id        = `inv_${Date.now()}_${randomBytes(4).toString("hex")}`;
  const joined    = new Date().toISOString().slice(0, 10);
  logger.info({ reqId, id, tokenHashPrefix: tokenHash.slice(0, 8) }, "[team/invite] STEP 4 OK");

  // ── STEP 5.5 — Read-only schema assertion ────────────────────────────────
  // Verifies that every column used in the INSERT exists in production.
  // NO DDL here — schema repairs run only in initDataTables() at startup
  // or via a dedicated migration script.
  logger.info({ reqId, insertCols: INSERT_COLS }, "[team/invite] STEP 5.5: read-only schema assertion");
  try {
    const schemaRows = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'team_members'`
    );
    const present    = new Set(schemaRows.rows.map(r => r.column_name));
    const missing    = (INSERT_COLS as readonly string[]).filter(c => !present.has(c));
    logger.info(
      { reqId, presentColumns: [...present], missingColumns: missing },
      `[team/invite] STEP 5.5: schema assertion — missing: ${missing.length ? missing.join(", ") : "none"}`
    );
    if (missing.length > 0) {
      logger.error(
        { reqId, maskedEmail, orgId: org.slice(0, 20), missingColumns: missing },
        "[team/invite] STEP 5.5 FAIL: team_members is missing required INSERT columns → 500 TEAM_SCHEMA_INVALID"
      );
      res.status(500).json({
        ok:    false,
        code:  "TEAM_SCHEMA_INVALID",
        error: "Database schema error — please contact support",
      });
      return;
    }
    logger.info({ reqId }, "[team/invite] STEP 5.5 OK: all INSERT columns present");
  } catch (schemaErr) {
    // Non-fatal: if information_schema is unreachable, proceed and let the INSERT surface the real error.
    logger.warn(
      { reqId, err: (schemaErr as Error).message },
      "[team/invite] STEP 5.5 WARN: schema assertion query failed — proceeding to INSERT"
    );
  }

  // ── STEP 6 — INSERT team_members ─────────────────────────────────────────
  // Columns logged above (STEP 5.5). Values never logged.
  // joined:                TEXT date string  (YYYY-MM-DD)
  // status:                TEXT literal      'pending'
  // invited_by:            TEXT              org (org_id of inviting org)
  // invitation_token_hash: TEXT              SHA-256 hex
  // invited_at:            TIMESTAMPTZ       NOW()
  // expires_at:            TIMESTAMPTZ       7 days from now
  // email_status:          TEXT literal      'pending' (updated at STEP 10)
  // created_at / updated_at: TIMESTAMPTZ     NOW()
  logger.info(
    { reqId, id, orgId: org.slice(0, 20), maskedEmail, insertCols: INSERT_COLS },
    "[team/invite] STEP 6: INSERT into team_members"
  );
  try {
    await orgDb(req)(
      `INSERT INTO team_members
         (id, org_id, email, role, joined, status,
          invited_by, invitation_token_hash, invited_at, expires_at,
          email_status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending',
               $6, $7, NOW(), $8, 'pending', NOW(), NOW())`,
      [id, org, email, memberRole, joined, org, tokenHash, expiresAt.toISOString()]
    );
    logger.info({ reqId, id }, "[team/invite] STEP 6 OK: INSERT succeeded");
  } catch (insertErr: unknown) {
    const ie     = insertErr as Record<string, unknown>;
    const pgCode = ie["code"] as string | undefined;
    logger.error(
      {
        reqId,
        step:          6,
        maskedEmail,
        orgId:         org.slice(0, 20),
        insertCols:    INSERT_COLS,
        sqlCode:       pgCode,
        sqlMsg:        (insertErr as Error).message,
        sqlDetail:     ie["detail"],
        sqlConstraint: ie["constraint"],
        sqlSchema:     ie["schema"],
        sqlTable:      ie["table"],
        sqlColumn:     ie["column"],
        stack:         (insertErr as Error).stack,
      },
      "[team/invite] STEP 6 FAIL: INSERT error"
    );
    if (pgCode === "23505") {
      res.status(409).json({
        ok:    false,
        code:  "DUPLICATE_INVITATION",
        error: "Une invitation est déjà en attente pour cette adresse.",
      });
      return;
    }
    res.status(500).json({
      ok:    false,
      code:  "INVITATION_DB_ERROR",
      error: "Failed to create invitation",
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
  logger.info({ reqId, maskedEmail }, "[team/invite] STEP 9: calling mailer.sendTeamInvitation");
  const { mailer } = await import("../services/mailer.js");
  type MailResult = { ok: boolean; error?: string; id?: string };
  let mailResult: MailResult;
  try {
    const sent = await mailer.sendTeamInvitation({
      to:          email,
      inviterName,
      orgName,
      role:        memberRole,
      inviteUrl,
    }) as MailResult;
    mailResult = sent;
    logger.info(
      { reqId, mailOk: mailResult.ok, hasMessageId: !!(mailResult.ok && mailResult.id) },
      "[team/invite] STEP 9 OK"
    );
  } catch (mailerErr) {
    logger.error(
      {
        reqId,
        step:    9,
        maskedEmail,
        sqlMsg:  (mailerErr as Error).message,
        stack:   (mailerErr as Error).stack,
      },
      "[team/invite] STEP 9 FAIL: mailer threw → INVITATION_EMAIL_ERROR (invitation row kept)"
    );
    mailResult = { ok: false, error: String(mailerErr) };
  }

  // ── STEP 10 — Persist email delivery status ───────────────────────────────
  const emailStatus  = mailResult.ok ? "sent"   : "failed";
  const resendMsgId  = mailResult.ok ? (mailResult.id ?? null) : null;
  const emailErrSafe = mailResult.ok ? null : ((mailResult.error ?? "unknown error")).slice(0, 250);

  logger.info({ reqId, emailStatus, hasMessageId: !!resendMsgId }, "[team/invite] STEP 10: UPDATE email_status");
  try {
    await orgDb(req)(
      `UPDATE team_members
         SET email_status = $1, resend_message_id = $2, email_error = $3, updated_at = NOW()
       WHERE id = $4`,
      [emailStatus, resendMsgId, emailErrSafe, id]
    );
    logger.info({ reqId, emailStatus }, "[team/invite] STEP 10 OK: email_status updated");
  } catch (updateErr) {
    const ue = updateErr as Record<string, unknown>;
    logger.error(
      {
        reqId,
        step:          10,
        maskedEmail,
        orgId:         org.slice(0, 20),
        code:          "INVITATION_STATUS_UPDATE_ERROR",
        sqlCode:       ue["code"],
        sqlMsg:        (updateErr as Error).message,
        sqlDetail:     ue["detail"],
        sqlConstraint: ue["constraint"],
        sqlTable:      ue["table"],
        sqlColumn:     ue["column"],
        stack:         (updateErr as Error).stack,
      },
      "[team/invite] STEP 10 FAIL: email status UPDATE failed (non-fatal — invitation row was inserted)"
    );
  }

  // ── STEP 11 — Final response ──────────────────────────────────────────────
  if (!mailResult.ok) {
    logger.warn(
      { reqId, maskedEmail, emailErr: emailErrSafe },
      "[team/invite] STEP 11: email failed → INVITATION_EMAIL_ERROR 502"
    );
    res.status(502).json({
      ok:     false,
      code:   "INVITATION_EMAIL_ERROR",
      error:  "L'invitation a été créée, mais l'e-mail n'a pas pu être envoyé.",
      member: { id, email, role: memberRole, status: "pending", invitedAt: new Date().toISOString() },
    });
    return;
  }

  logger.info({ reqId, id, maskedEmail, messageId: resendMsgId }, "[team/invite] STEP 11: SUCCESS → 201");
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
  if (!role) { res.status(400).json({ ok: false, error: "role required" }); return; }
  const ALLOWED = ["viewer", "editor", "admin", "owner", "manager"];
  if (!ALLOWED.includes(role)) { res.status(400).json({ ok: false, error: "invalid role" }); return; }
  try {
    const r = await orgDb(req)(
      `UPDATE team_members SET role = $1, updated_at = NOW()
       WHERE id = $2 AND org_id = $3
       RETURNING id, email, role`,
      [role, req.params.id, org]
    );
    if (!r.rows[0]) { res.status(404).json({ ok: false, error: "member not found" }); return; }
    const m = r.rows[0];
    res.json({
      ok:     true,
      member: { id: m.id, name: (m.email as string)?.split("@")[0] ?? "", email: m.email, role: m.role },
    });
  } catch (patchErr) {
    const pe = patchErr as Record<string, unknown>;
    logger.error(
      {
        orgId:         org.slice(0, 20),
        memberId:      req.params.id,
        sqlCode:       pe["code"],
        sqlMsg:        (patchErr as Error).message,
        sqlDetail:     pe["detail"],
        sqlConstraint: pe["constraint"],
        sqlTable:      pe["table"],
        sqlColumn:     pe["column"],
        stack:         (patchErr as Error).stack,
      },
      "[team/patch] UPDATE failed"
    );
    res.status(500).json({ ok: false, error: "Failed to update member" });
  }
});

// ── DELETE /team/:id — remove member ──────────────────────────────────────────

router.delete("/team/:id", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;
  try {
    await orgDb(req)(
      `DELETE FROM team_members WHERE id = $1 AND org_id = $2`,
      [req.params.id, org]
    );
    res.json({ ok: true });
  } catch (deleteErr) {
    const de = deleteErr as Record<string, unknown>;
    logger.error(
      {
        orgId:         org.slice(0, 20),
        memberId:      req.params.id,
        sqlCode:       de["code"],
        sqlMsg:        (deleteErr as Error).message,
        sqlDetail:     de["detail"],
        sqlConstraint: de["constraint"],
        sqlTable:      de["table"],
        sqlColumn:     de["column"],
        stack:         (deleteErr as Error).stack,
      },
      "[team/delete] DELETE failed"
    );
    res.status(500).json({ ok: false, error: "Failed to delete member" });
  }
});

export default router;
