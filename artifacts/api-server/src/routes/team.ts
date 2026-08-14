/**
 * /api/team — Team management + invitation system (Wave 3 Lot B)
 *
 * Public routes (no auth required):
 *   GET  /team/invitations/validate    → validate invitation token
 *   POST /team/invitations/accept      → accept invitation (atomic, creates member + session)
 *
 * Protected routes (requireAuth + orgContext):
 *   GET    /team                        → {members, pendingInvitations, seatUsage}
 *   POST   /team/invite                 → invite member by email
 *   PATCH  /team/:id                    → change member role (canAdmin, owner protected)
 *   DELETE /team/:id                    → soft-remove member + session revocation
 *   POST   /team/invitations/:id/resend → resend invite email (canAdmin, max 3 resends)
 *   DELETE /team/invitations/:id        → revoke invitation (canAdmin)
 *   GET    /organizations               → list caller's organizations
 *   POST   /organizations/:id/switch    → switch active org session
 */

import { Router, type Request, type Response } from "express";
import { logger }                               from "../lib/logger.js";
import { randomBytes, createHash, randomUUID }  from "crypto";
import { pool }                                from "@workspace/db";
import { canAdmin }                             from "../middlewares/requireRole.js";
import { createSession, invalidateAllSessions, SESSION_TTL_MS } from "../services/sessions.js";
import { PLAN_LIMITS }                          from "../lib/plans.js";

// ── Public router (registered before requireAuth in index.ts) ─────────────────
export const publicTeamRouter = Router();

// ── Protected router (default export, registered after requireAuth) ───────────
const router = Router();

// ── Types ─────────────────────────────────────────────────────────────────────

type OrgDbFn = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

type OrgReq = Request & {
  orgDb:  OrgDbFn;
  orgId?: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function requireOrg(req: Request, res: Response): string | null {
  const orgId = (req as OrgReq).orgId;
  if (!orgId || orgId === "default") {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  return orgId;
}

function orgDb(req: Request): OrgDbFn {
  const fn = (req as OrgReq).orgDb;
  if (typeof fn !== "function") throw new Error("orgDb middleware not applied");
  return fn;
}

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  return `${(local ?? "?")[0] ?? "?"}***@${domain ?? "?"}`;
}

function buildInviteUrl(rawToken: string, email: string): string {
  const base = process.env["PUBLIC_URL"] ?? "https://app.flowpoint.pro";
  return `${base}/accept-invitation.html?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(email)}`;
}

/** Resolve plan seat limit — reads from organizations (Jalon 1 source of truth).
 *  Falls back to org_settings.plan when the webhook has not yet updated organizations.plan,
 *  taking whichever source gives the higher teamMembers limit (avoids blocking invites after upgrade).
 */
async function getOrgSeatLimit(orgId: string): Promise<{ limit: number; plan: string }> {
  try {
    const r = await pool.query<{ plan: string; legacy_plan: string }>(
      `SELECT
         COALESCE(NULLIF(o.plan,''), 'standard')              AS plan,
         COALESCE(NULLIF(os.plan,''), '')                     AS legacy_plan
       FROM organizations o
       LEFT JOIN org_settings os ON os.org_id = o.id::text
       WHERE o.id::text = $1 LIMIT 1`,
      [orgId]
    );
    const plan1  = (r.rows[0]?.plan        ?? "standard").toLowerCase();
    const plan2  = (r.rows[0]?.legacy_plan ?? "").toLowerCase();
    const limit1 = PLAN_LIMITS[plan1]?.teamMembers ?? 1;
    const limit2 = PLAN_LIMITS[plan2]?.teamMembers ?? 0;
    // Prefer whichever plan grants more seats — guards against webhook lag after upgrade.
    if (limit2 > limit1) return { limit: limit2, plan: plan2 };
    return { limit: limit1, plan: plan1 };
  } catch {
    return { limit: 1, plan: "standard" };
  }
}

/** Count used seats: 1 (owner) + active members + pending invitations. */
async function getSeatUsage(
  db: OrgDbFn,
  orgId: string,
): Promise<{ used: number; limit: number; plan: string }> {
  const [{ limit, plan }, membersRes, invitesRes] = await Promise.all([
    getOrgSeatLimit(orgId),
    db(
      `SELECT COUNT(*)::int AS n FROM team_members
       WHERE org_id = $1 AND status = 'active'`,
      [orgId]
    ),
    db(
      `SELECT COUNT(*)::int AS n FROM team_invitations
       WHERE org_id = $1 AND status = 'pending' AND expires_at > NOW()`,
      [orgId]
    ),
  ]);
  const activeMembers  = (membersRes.rows[0]?.n  as number) ?? 0;
  const pendingInvites = (invitesRes.rows[0]?.n   as number) ?? 0;
  const used = 1 + activeMembers + pendingInvites; // 1 = owner always occupies 1 seat
  return { used, limit, plan };
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /team/invitations/validate ───────────────────────────────────────────

publicTeamRouter.get("/team/invitations/validate", async (req: Request, res: Response) => {
  const raw = req.query["token"];
  if (!raw || typeof raw !== "string" || raw.length < 10) {
    res.status(400).json({ valid: false, reason: "missing_token" });
    return;
  }

  const tHash = hashToken(raw);

  try {
    const r = await pool.query<{
      id: string; org_id: string; email: string; role: string;
      status: string; expires_at: string;
    }>(
      `SELECT id, org_id, email, role, status, expires_at
       FROM team_invitations
       WHERE token_hash = $1 LIMIT 1`,
      [tHash]
    );
    const inv = r.rows[0];

    if (!inv) {
      res.status(404).json({ valid: false, reason: "not_found" });
      return;
    }
    if (inv.status === "accepted") {
      res.status(410).json({ valid: false, reason: "already_accepted" });
      return;
    }
    if (inv.status === "revoked") {
      res.status(410).json({ valid: false, reason: "revoked" });
      return;
    }
    if (inv.status !== "pending" || new Date(inv.expires_at) < new Date()) {
      res.status(410).json({ valid: false, reason: "expired" });
      return;
    }

    // Load org name for display
    let orgName = inv.org_id;
    try {
      // Jalon 6: read org name from organizations (source of truth)
      const orgR = await pool.query<{ org_name: string }>(
        `SELECT COALESCE(NULLIF(name,''), id::text) AS org_name
         FROM organizations WHERE id = $1 LIMIT 1`,
        [inv.org_id]
      );
      if (orgR.rows[0]) orgName = orgR.rows[0].org_name;
    } catch { /* non-fatal */ }

    res.json({
      valid: true,
      invitation: {
        id:        inv.id,
        email:     inv.email,
        role:      inv.role,
        orgId:     inv.org_id,
        orgName,
        expiresAt: inv.expires_at,
      },
    });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[team/validate] DB error");
    res.status(500).json({ valid: false, reason: "server_error" });
  }
});

// ── POST /team/invitations/accept ────────────────────────────────────────────

publicTeamRouter.post("/team/invitations/accept", async (req: Request, res: Response) => {
  const { token: rawToken, email: rawEmail } = req.body as { token?: string; email?: string };

  if (!rawToken || typeof rawToken !== "string" || rawToken.length < 10) {
    res.status(400).json({ ok: false, code: "MISSING_TOKEN", error: "token required" });
    return;
  }
  if (!rawEmail || !rawEmail.includes("@")) {
    res.status(400).json({ ok: false, code: "MISSING_EMAIL", error: "valid email required" });
    return;
  }

  const email  = rawEmail.toLowerCase().trim();
  const tHash  = hashToken(rawToken);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Atomic: lock the invitation row, verify all conditions
    const invR = await client.query<{
      id: string; org_id: string; email: string; role: string;
      status: string; expires_at: string; invited_by_user_id: string | null;
    }>(
      `SELECT id, org_id, email, role, status, expires_at, invited_by_user_id
       FROM team_invitations
       WHERE token_hash = $1 AND lower(email) = lower($2)
       FOR UPDATE`,
      [tHash, email]
    );

    const inv = invR.rows[0];

    if (!inv) {
      await client.query("ROLLBACK");
      res.status(404).json({ ok: false, code: "INVALID_TOKEN", error: "Invitation introuvable ou email incorrect." });
      return;
    }
    if (inv.status === "accepted") {
      await client.query("ROLLBACK");
      res.status(409).json({ ok: false, code: "ALREADY_ACCEPTED", error: "Cette invitation a déjà été acceptée." });
      return;
    }
    if (inv.status === "revoked") {
      await client.query("ROLLBACK");
      res.status(410).json({ ok: false, code: "REVOKED", error: "Cette invitation a été révoquée." });
      return;
    }
    if (inv.status !== "pending" || new Date(inv.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      res.status(410).json({ ok: false, code: "EXPIRED", error: "Cette invitation a expiré." });
      return;
    }

    const now = new Date();

    // Mark invitation as accepted
    await client.query(
      `UPDATE team_invitations
         SET status = 'accepted', accepted_at = $1, updated_at = $1
       WHERE id = $2`,
      [now, inv.id]
    );

    // ── Upsert into users so login-verify can find this member on reconnect ──
    // Without this, the invited member cannot use the magic-link flow after their
    // first session expires (login-verify falls through to legacy 404).
    await client.query(
      `INSERT INTO users (id, email, status, email_verified, auth_provider, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'active', true, 'magic_link', NOW(), NOW())
       ON CONFLICT (email) DO UPDATE
         SET email_verified = true,
             status         = CASE
                                WHEN users.status = 'suspended' THEN 'suspended'
                                ELSE 'active'
                              END,
             updated_at     = NOW()`,
      [email]
    );

    // Create or update active team member
    // (no unique constraint on org_id+email → use check-then-insert to avoid duplicates)
    const nowIso    = now.toISOString();
    const joinedDay = now.toISOString().slice(0, 10);
    let memberId: string;
    const existingMemberRes = await client.query<{ id: string }>(
      `SELECT id FROM team_members WHERE org_id = $1 AND lower(email) = lower($2) LIMIT 1`,
      [inv.org_id, email]
    );
    if (existingMemberRes.rows.length > 0) {
      // Update existing row to active (covers re-invites and previous partial failures)
      memberId = existingMemberRes.rows[0]!.id;
      await client.query(
        `UPDATE team_members
         SET status = 'active', role = $1, joined_at = $2, accepted_at = $3, updated_at = $4
         WHERE id = $5`,
        [inv.role, nowIso, nowIso, nowIso, memberId]
      );
    } else {
      // Fresh insert — no prior member row exists for this email+org
      memberId = randomUUID();
      await client.query(
        `INSERT INTO team_members
           (id, org_id, email, name, role, joined, status, user_id,
            invited_by_user_id, joined_at, accepted_at, invitation_token_hash,
            invited_at, email_status, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'active', $3,
                 $7, $8, $9, '',
                 $10, 'sent', $11, $12)`,
        [
          memberId,                    // $1
          inv.org_id,                  // $2
          email,                       // $3  (also used as user_id)
          email.split("@")[0] ?? "",   // $4  name
          inv.role,                    // $5
          joinedDay,                   // $6  joined (text date)
          inv.invited_by_user_id ?? null, // $7
          nowIso,                      // $8  joined_at
          nowIso,                      // $9  accepted_at
          nowIso,                      // $10 invited_at
          nowIso,                      // $11 created_at
          nowIso,                      // $12 updated_at
        ]
      );
    }

    // ── Set RLS context so organization_members FORCE ROW LEVEL SECURITY policies pass ──
    // The policy checks: organization_id = current_setting('app.current_org_id', true).
    // FORCE ROW LEVEL SECURITY applies to ALL users (including superusers/BYPASSRLS),
    // so setting the GUC alone is sufficient — no role change needed or attempted.
    // We use set_config() with the parameterized form to avoid string interpolation.
    await client.query(`SELECT set_config('app.current_org_id', $1, true)`, [inv.org_id]);

    // ── Dual-write to organization_members (inside transaction, users row now guaranteed) ──
    // Use NOT EXISTS guard instead of ON CONFLICT (col, col) to avoid 42P10 when the
    // organization_members_unique constraint does not yet exist on the production DB
    // (table created before the constraint was added to the init script).
    await client.query(
      `INSERT INTO organization_members
             (id, organization_id, user_id, role, status, joined_at, created_at, updated_at)
       SELECT gen_random_uuid(), $1::text, u.id, $2, 'active', NOW(), NOW(), NOW()
       FROM users u
       WHERE lower(u.email) = lower($3)
         AND NOT EXISTS (
           SELECT 1 FROM organization_members om2
           WHERE om2.organization_id = $1::text AND om2.user_id = u.id
         )`,
      [inv.org_id, inv.role, email]
    );
    // If a row already existed (re-accept or previous partial failure), promote it to active.
    await client.query(
      `UPDATE organization_members om
       SET role = $2, status = 'active', updated_at = NOW()
       FROM users u
       WHERE lower(u.email) = lower($3)
         AND om.organization_id = $1::text
         AND om.user_id = u.id
         AND om.status != 'active'`,
      [inv.org_id, inv.role, email]
    );

    await client.query("COMMIT");

    // Create session for the newly accepted member
    const sessionToken = await createSession({
      userId:    email,
      orgId:     inv.org_id,
      email,
      role:      inv.role,
      ipAddress: ((req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()) ?? req.ip ?? undefined,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? undefined,
    });

    // Notify the inviter asynchronously (fire-and-forget)
    if (inv.invited_by_user_id) {
      const inviterEmail = inv.invited_by_user_id;
      const invOrgId     = inv.org_id;
      const invRole      = inv.role;
      Promise.resolve().then(async () => {
        try {
          const { mailer } = await import("../services/mailer.js");
          const { loadOrgSettings } = await import("../services/org-settings.js");
          const settings = await loadOrgSettings(invOrgId).catch(() => null);
          await mailer.sendInvitationAccepted({
            to:          inviterEmail,
            memberEmail: email,
            memberName:  email.split("@")[0],
            orgName:     settings?.orgName ?? invOrgId,
            role:        invRole,
          });
        } catch { /* non-fatal */ }
      });
    }

    logger.info(
      { orgId: inv.org_id.slice(0, 20), maskedEmail: maskEmail(email), role: inv.role },
      "[team/accept] invitation accepted — member created"
    );

    // Set the session cookie so browser navigation (refresh, new tab) stays auth'd.
    const _isProd = !!(process.env["RENDER_SERVICE_NAME"] || process.env["NODE_ENV"] === "production");
    res.cookie("fp_token", sessionToken, {
      httpOnly: true,
      secure:   _isProd,
      sameSite: _isProd ? "none" : "lax",
      maxAge:   SESSION_TTL_MS,
      path:     "/",
    });

    res.json({
      ok:           true,
      sessionToken,
      orgId:        inv.org_id,
      email,
      role:         inv.role,
      memberId,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err: (err as Error).message, stack: (err as Error).stack }, "[team/accept] DB error");
    res.status(500).json({ ok: false, code: "SERVER_ERROR", error: "Failed to accept invitation" });
  } finally {
    client.release();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PROTECTED ROUTES
// ─────────────────────────────────────────────────────────────────────────────

// ── GET /team ─────────────────────────────────────────────────────────────────

router.get("/team", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;

  try {
    const db = orgDb(req);

    const [membersRes, invitationsRes, seatUsage] = await Promise.all([
      db(
        `SELECT id, email, role, status, user_id,
                COALESCE(first_name, '') AS first_name,
                COALESCE(last_name,  '') AS last_name,
                name, joined, joined_at, accepted_at, created_at, updated_at
         FROM team_members
         WHERE org_id = $1 AND status = 'active'
         ORDER BY created_at ASC LIMIT 100`,
        [org]
      ),
      db(
        `SELECT id, email, role, status, invited_by_user_id,
                resend_count, last_resent_at, expires_at, created_at
         FROM team_invitations
         WHERE org_id = $1 AND status = 'pending'
         ORDER BY created_at ASC LIMIT 100`,
        [org]
      ),
      getSeatUsage(orgDb(req), org),
    ]);

    const members = membersRes.rows.map(m => ({
      id:        m.id,
      email:     m.email,
      name:      (m.first_name && m.last_name)
                   ? `${m.first_name} ${m.last_name}`.trim()
                   : ((m.first_name as string) || (m.name as string) || (m.email as string)?.split("@")[0] || ""),
      firstName: m.first_name,
      lastName:  m.last_name,
      role:      m.role,
      status:    m.status,
      userId:    m.user_id,
      joinedAt:  m.joined_at ?? m.accepted_at ?? m.created_at,
      createdAt: m.created_at,
    }));

    const pendingInvitations = invitationsRes.rows.map(i => ({
      id:              i.id,
      email:           i.email,
      role:            i.role,
      status:          i.status,
      invitedByUserId: i.invited_by_user_id,
      resendCount:     i.resend_count,
      lastResentAt:    i.last_resent_at,
      expiresAt:       i.expires_at,
      createdAt:       i.created_at,
    }));

    res.json({ members, pendingInvitations, seatUsage });
  } catch (err) {
    logger.error({ orgId: org.slice(0, 20), err: (err as Error).message }, "[team/get] failed");
    // Use real plan limit in error fallback — hardcoded limit:1 caused 1/1 seats bug for Pro/Ultra
    const fallbackSeat = await getOrgSeatLimit(org).catch(() => ({ limit: 1, plan: "standard" }));
    res.json({ members: [], pendingInvitations: [], seatUsage: { used: 1, limit: fallbackSeat.limit, plan: fallbackSeat.plan } });
  }
});

// ── POST /team/invite ─────────────────────────────────────────────────────────

router.post("/team/invite", canAdmin, async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;

  const { email: rawEmail, role } = req.body as { email?: string; role?: string };

  if (!rawEmail || !rawEmail.includes("@")) {
    res.status(400).json({ ok: false, code: "INVALID_EMAIL", error: "Valid email required" });
    return;
  }

  const ALLOWED_ROLES = ["admin", "member", "viewer"];
  const memberRole = (role ?? "viewer").toLowerCase();

  if (memberRole === "owner") {
    res.status(400).json({ ok: false, code: "INVALID_ROLE", error: "Cannot assign role 'owner' via invitation." });
    return;
  }
  if (!ALLOWED_ROLES.includes(memberRole)) {
    res.status(400).json({
      ok: false, code: "INVALID_ROLE",
      error: `Rôle invalide. Valeurs acceptées : ${ALLOWED_ROLES.join(", ")}.`,
    });
    return;
  }

  const email       = rawEmail.toLowerCase().trim();
  const db          = orgDb(req);
  const callerEmail = req.orgContext?.email ?? null;

  // Prevent self-invite
  if (callerEmail && callerEmail.toLowerCase() === email) {
    res.status(400).json({ ok: false, code: "SELF_INVITE", error: "Vous ne pouvez pas vous inviter vous-même." });
    return;
  }

  // Duplicate check BEFORE seat quota (specific error beats generic one)
  try {
    const existing = await db(
      `SELECT id FROM team_invitations WHERE org_id = $1 AND lower(email) = lower($2) AND status = 'pending' LIMIT 1`,
      [org, email]
    );
    if (existing.rows.length > 0) {
      res.status(409).json({ ok: false, code: "DUPLICATE_INVITATION", error: "Une invitation est déjà en attente pour cette adresse." });
      return;
    }
  } catch { /* non-fatal, let INSERT catch the 23505 */ }

  // Active/suspended member check: cannot invite an already-active member
  try {
    const activeMember = await db(
      `SELECT id FROM team_members
       WHERE org_id = $1 AND lower(trim(email)) = lower($2) AND status IN ('active','suspended')
       LIMIT 1`,
      [org, email]
    );
    if (activeMember.rows.length > 0) {
      res.status(409).json({
        ok: false, code: "ALREADY_MEMBER",
        error: "Un membre actif ou suspendu existe déjà avec cette adresse.",
      });
      return;
    }
  } catch { /* non-fatal */ }

  // Seat quota check
  const seatUsage = await getSeatUsage(db, org);
  if (seatUsage.used >= seatUsage.limit) {
    res.status(402).json({
      ok:         false,
      code:       "SEAT_LIMIT_REACHED",
      error:      `Limite de ${seatUsage.limit} siège${seatUsage.limit > 1 ? "s" : ""} atteinte pour le plan ${seatUsage.plan}.`,
      seatUsage,
    });
    return;
  }

  // Generate token
  const rawToken  = randomBytes(32).toString("hex");
  const tHash     = hashToken(rawToken);
  const id        = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Insert (UNIQUE index on (org_id, lower(email)) WHERE pending blocks duplicates)
  try {
    await db(
      `INSERT INTO team_invitations
         (id, org_id, email, role, token_hash, status, invited_by_user_id, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, NOW(), NOW())`,
      [id, org, email, memberRole, tHash, callerEmail ?? null, expiresAt.toISOString()]
    );
  } catch (insertErr: unknown) {
    const err = insertErr as Error & { code?: string };
    if (err.code === "23505") {
      res.status(409).json({
        ok: false, code: "DUPLICATE_INVITATION",
        error: "Une invitation est déjà en attente pour cette adresse.",
      });
      return;
    }
    logger.error({ orgId: org.slice(0, 20), maskedEmail: maskEmail(email), err: err.message }, "[team/invite] INSERT failed");
    res.status(500).json({ ok: false, code: "DB_ERROR", error: "Failed to create invitation" });
    return;
  }

  // Load inviter profile for email
  let inviterName = "Un collègue";
  let orgName     = "FlowPoint";
  try {
    const { loadOrgSettings } = await import("../services/org-settings.js");
    const settings = await loadOrgSettings(org);
    if (settings) {
      inviterName = settings.firstName ?? inviterName;
      orgName     = settings.orgName   ?? orgName;
    }
  } catch { /* non-fatal */ }

  // Send invitation email
  const inviteUrl = buildInviteUrl(rawToken, email);
  let emailOk  = false;
  let emailId: string | undefined;
  try {
    const { mailer } = await import("../services/mailer.js");
    const result = await mailer.sendTeamInvitation({ to: email, inviterName, orgName, role: memberRole, inviteUrl });
    emailOk = result.ok;
    emailId = result.ok ? result.id : undefined;
  } catch (mailerErr) {
    logger.warn({ err: (mailerErr as Error).message, maskedEmail: maskEmail(email) }, "[team/invite] mailer threw");
  }

  logger.info(
    { id, orgId: org.slice(0, 20), maskedEmail: maskEmail(email), role: memberRole, emailOk },
    "[team/invite] invitation created"
  );

  if (!emailOk) {
    res.status(502).json({
      ok: false, code: "INVITATION_EMAIL_ERROR",
      error: "L'invitation a été créée, mais l'e-mail n'a pas pu être envoyé.",
      invitation: { id, email, role: memberRole, status: "pending", expiresAt: expiresAt.toISOString() },
    });
    return;
  }

  res.status(201).json({
    ok: true,
    invitation: { id, email, role: memberRole, status: "pending", expiresAt: expiresAt.toISOString() },
    email: { status: "sent", messageId: emailId },
  });
});

// ── PATCH /team/:id — change member role ──────────────────────────────────────

router.patch("/team/:id", canAdmin, async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;

  const { role: newRole } = req.body as { role?: string };
  if (!newRole) { res.status(400).json({ ok: false, error: "role required" }); return; }

  const ALLOWED_ROLES = ["admin", "member", "viewer"];
  if (newRole === "owner") {
    res.status(400).json({ ok: false, code: "CANNOT_SET_OWNER", error: "Le rôle 'owner' ne peut pas être assigné via cette route." });
    return;
  }
  if (!ALLOWED_ROLES.includes(newRole)) {
    res.status(400).json({ ok: false, code: "INVALID_ROLE", error: `Rôle invalide. Valeurs : ${ALLOWED_ROLES.join(", ")}.` });
    return;
  }

  const db          = orgDb(req);
  const callerRole  = req.orgContext?.role  ?? "viewer";
  const callerEmail = req.orgContext?.email ?? "";
  const memberId    = req.params.id;

  // Load current member
  let memberRes: { rows: Record<string, unknown>[] };
  try {
    memberRes = await db(
      `SELECT id, email, role, status FROM team_members WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [memberId, org]
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[team/patch] SELECT failed");
    res.status(500).json({ ok: false, error: "Failed to load member" });
    return;
  }

  const member = memberRes.rows[0];
  if (!member) { res.status(404).json({ ok: false, error: "Member not found" }); return; }

  if (member.role === "owner") {
    res.status(403).json({ ok: false, code: "CANNOT_MODIFY_OWNER", error: "Le rôle du propriétaire ne peut pas être modifié." });
    return;
  }

  if (callerEmail && (member.email as string)?.toLowerCase() === callerEmail.toLowerCase()) {
    res.status(403).json({ ok: false, code: "CANNOT_SELF_MODIFY", error: "Vous ne pouvez pas modifier votre propre rôle." });
    return;
  }

  // Admin cannot touch admin roles — only owner can
  if (callerRole === "admin" && (member.role === "admin" || newRole === "admin")) {
    res.status(403).json({ ok: false, code: "INSUFFICIENT_ROLE", error: "Seul le propriétaire peut gérer les rôles admin." });
    return;
  }

  try {
    const r = await db(
      `UPDATE team_members SET role = $1, updated_at = NOW()
       WHERE id = $2 AND org_id = $3
       RETURNING id, email, role, status`,
      [newRole, memberId, org]
    );
    if (!r.rows[0]) { res.status(404).json({ ok: false, error: "Member not found" }); return; }
    const m = r.rows[0];

    // Jalon 3 — dual-write role update to organization_members (fire-and-forget)
    pool.query(
      `UPDATE organization_members om
       SET role = $1, updated_at = NOW()
       FROM users u
       WHERE u.id = om.user_id AND lower(u.email) = lower($2) AND om.organization_id = $3`,
      [newRole, m.email as string, org]
    ).catch(err => logger.warn({ err: (err as Error).message }, "[team/patch] org_members dual-write failed (non-fatal)"));

    res.json({
      ok: true,
      member: {
        id:     m.id,
        email:  m.email,
        name:   (m.email as string)?.split("@")[0] ?? "",
        role:   m.role,
        status: m.status,
      },
    });
  } catch (err) {
    logger.error({ orgId: org.slice(0, 20), memberId, err: (err as Error).message }, "[team/patch] UPDATE failed");
    res.status(500).json({ ok: false, error: "Failed to update member" });
  }
});

// ── DELETE /team/:id — soft-remove member ─────────────────────────────────────

router.delete("/team/:id", canAdmin, async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;

  const db          = orgDb(req);
  const callerEmail = req.orgContext?.email ?? "";
  const memberId    = req.params.id;

  // Load current member
  let memberRes: { rows: Record<string, unknown>[] };
  try {
    memberRes = await db(
      `SELECT id, email, role, status FROM team_members WHERE id = $1 AND org_id = $2 AND status = 'active' LIMIT 1`,
      [memberId, org]
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[team/delete] SELECT failed");
    res.status(500).json({ ok: false, error: "Failed to load member" });
    return;
  }

  const member = memberRes.rows[0];
  if (!member) { res.status(404).json({ ok: false, error: "Member not found" }); return; }

  if (member.role === "owner") {
    res.status(403).json({ ok: false, code: "CANNOT_REMOVE_OWNER", error: "Le propriétaire ne peut pas être retiré de l'équipe." });
    return;
  }

  if (callerEmail && (member.email as string)?.toLowerCase() === callerEmail.toLowerCase()) {
    res.status(403).json({ ok: false, code: "CANNOT_REMOVE_SELF", error: "Vous ne pouvez pas vous retirer vous-même." });
    return;
  }

  try {
    await db(
      `UPDATE team_members SET status = 'removed', updated_at = NOW() WHERE id = $1 AND org_id = $2`,
      [memberId, org]
    );
  } catch (err) {
    logger.error({ orgId: org.slice(0, 20), memberId, err: (err as Error).message }, "[team/delete] UPDATE failed");
    res.status(500).json({ ok: false, error: "Failed to remove member" });
    return;
  }

  const memberEmail = member.email as string;

  // Jalon 3 — dual-write removal to organization_members (fire-and-forget, migration utility)
  pool.query(
    `UPDATE organization_members om
     SET status = 'removed', updated_at = NOW()
     FROM users u
     WHERE u.id = om.user_id AND lower(u.email) = lower($1) AND om.organization_id = $2`,
    [memberEmail, org]
  ).catch(err => logger.warn({ err: (err as Error).message }, "[team/delete] org_members dual-write failed (non-fatal)"));

  // Session revocation is a security operation — must be awaited, never fire-and-forget
  if (memberEmail) {
    try {
      await invalidateAllSessions(memberEmail);
    } catch (err) {
      logger.error(
        { err: (err as Error).message, maskedEmail: maskEmail(memberEmail) },
        "[team/delete] SECURITY: session revocation failed — member removed from DB but sessions may remain valid until expiry"
      );
    }
  }

  logger.info({ orgId: org.slice(0, 20), memberId, maskedEmail: maskEmail(memberEmail) }, "[team/delete] member soft-removed");
  res.json({ ok: true });
});

// ── POST /team/invitations/:id/resend ─────────────────────────────────────────
// NOTE: registered before DELETE /team/invitations/:id to prevent ambiguous matching

router.post("/team/invitations/:id/resend", canAdmin, async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;

  const db    = orgDb(req);
  const invId = req.params.id;

  let invRes: { rows: Record<string, unknown>[] };
  try {
    invRes = await db(
      `SELECT id, email, role, status, resend_count, last_resent_at, expires_at, invited_by_user_id
       FROM team_invitations WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [invId, org]
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[team/resend] SELECT failed");
    res.status(500).json({ ok: false, error: "Failed to load invitation" });
    return;
  }

  const inv = invRes.rows[0];
  if (!inv) { res.status(404).json({ ok: false, error: "Invitation not found" }); return; }
  if (inv.status !== "pending") {
    res.status(409).json({ ok: false, code: "NOT_PENDING", error: "Cette invitation n'est plus active." });
    return;
  }
  if (new Date(inv.expires_at as string) < new Date()) {
    res.status(410).json({ ok: false, code: "EXPIRED", error: "Cette invitation a expiré." });
    return;
  }

  const resendCount = (inv.resend_count as number) ?? 0;
  if (resendCount >= 3) {
    res.status(429).json({
      ok: false, code: "RESEND_LIMIT_REACHED",
      error: "Limite de 3 renvois atteinte pour cette invitation.",
    });
    return;
  }

  const email     = inv.email as string;
  const rawToken  = randomBytes(32).toString("hex");
  const tHash     = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  try {
    await db(
      `UPDATE team_invitations
         SET token_hash     = $1,
             resend_count   = resend_count + 1,
             last_resent_at = NOW(),
             expires_at     = $2,
             updated_at     = NOW()
       WHERE id = $3 AND org_id = $4`,
      [tHash, expiresAt.toISOString(), invId, org]
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[team/resend] UPDATE failed");
    res.status(500).json({ ok: false, error: "Failed to resend invitation" });
    return;
  }

  let emailOk = false;
  try {
    const { mailer }          = await import("../services/mailer.js");
    const { loadOrgSettings } = await import("../services/org-settings.js");
    const settings    = await loadOrgSettings(org).catch(() => null);
    const inviterName = settings?.firstName ?? "Un collègue";
    const orgName     = settings?.orgName   ?? "FlowPoint";
    const inviteUrl   = buildInviteUrl(rawToken, email);
    const result = await mailer.sendTeamInvitation({ to: email, inviterName, orgName, role: inv.role as string, inviteUrl });
    emailOk = result.ok;
  } catch (mailerErr) {
    logger.warn({ err: (mailerErr as Error).message }, "[team/resend] mailer threw");
  }

  logger.info(
    { invId, orgId: org.slice(0, 20), maskedEmail: maskEmail(email), newCount: resendCount + 1 },
    "[team/resend] invitation resent"
  );

  res.json({ ok: true, email: { status: emailOk ? "sent" : "failed" }, resendCount: resendCount + 1 });
});

// ── DELETE /team/invitations/:id — revoke invitation ─────────────────────────

router.delete("/team/invitations/:id", canAdmin, async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;

  const db    = orgDb(req);
  const invId = req.params.id;

  let invRes: { rows: Record<string, unknown>[] };
  try {
    invRes = await db(
      `SELECT id, status FROM team_invitations WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [invId, org]
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[team/revoke] SELECT failed");
    res.status(500).json({ ok: false, error: "Failed to load invitation" });
    return;
  }

  const inv = invRes.rows[0];
  if (!inv) { res.status(404).json({ ok: false, error: "Invitation not found" }); return; }
  if (inv.status !== "pending") {
    res.status(409).json({ ok: false, code: "NOT_PENDING", error: "Seules les invitations en attente peuvent être révoquées." });
    return;
  }

  try {
    await db(
      `UPDATE team_invitations SET status = 'revoked', revoked_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND org_id = $2`,
      [invId, org]
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[team/revoke] UPDATE failed");
    res.status(500).json({ ok: false, error: "Failed to revoke invitation" });
    return;
  }

  logger.info({ invId, orgId: org.slice(0, 20) }, "[team/revoke] invitation revoked");
  res.json({ ok: true });
});

// ── GET /organizations ────────────────────────────────────────────────────────

router.get("/organizations", async (req: Request, res: Response) => {
  const org         = requireOrg(req, res);
  if (!org) return;
  const callerEmail = req.orgContext?.email ?? "";
  const callerRole  = req.orgContext?.role  ?? "viewer";

  try {
    const currentOrg = await pool.query<{ id: string; name: string; slug: string; plan: string }>(
      `SELECT id, COALESCE(NULLIF(name,''), id::text) AS name, slug, plan
       FROM organizations WHERE id = $1 LIMIT 1`,
      [org]
    );

    const results: Array<{
      id: string; name: string; slug: string; plan: string; role: string; isCurrent: boolean;
    }> = [];

    if (currentOrg.rows[0]) {
      results.push({
        id:        currentOrg.rows[0].id,
        name:      currentOrg.rows[0].name,
        slug:      currentOrg.rows[0].slug,
        plan:      currentOrg.rows[0].plan,
        role:      callerRole,
        isCurrent: true,
      });
    }

    // Other orgs where this email is an active member
    if (callerEmail) {
      const otherOrgs = await pool.query<{
        org_id: string; role: string; org_name: string; slug: string; plan: string;
      }>(
        `SELECT tm.org_id, tm.role,
                COALESCE(NULLIF(o.name,''), tm.org_id) AS org_name,
                o.slug, o.plan
         FROM team_members tm
         JOIN organizations o ON o.id::text = tm.org_id
         WHERE lower(tm.email) = lower($1)
           AND tm.status = 'active'
           AND tm.org_id != $2
         LIMIT 20`,
        [callerEmail, org]
      );
      for (const row of otherOrgs.rows) {
        results.push({
          id:        row.org_id,
          name:      row.org_name,
          slug:      row.slug,
          plan:      row.plan,
          role:      row.role,
          isCurrent: false,
        });
      }
    }

    res.json({ organizations: results });
  } catch (err) {
    logger.error({ orgId: org.slice(0, 20), err: (err as Error).message }, "[organizations/get] failed");
    res.status(500).json({ error: "Failed to load organizations" });
  }
});

// ── POST /organizations/:id/switch ────────────────────────────────────────────

router.post("/organizations/:id/switch", async (req: Request, res: Response) => {
  const currentOrg = requireOrg(req, res);
  if (!currentOrg) return;

  const targetOrgId = req.params["id"] as string;
  const callerEmail = req.orgContext?.email ?? "";

  if (!callerEmail) {
    res.status(401).json({ ok: false, error: "Authentication required" });
    return;
  }

  if (targetOrgId === currentOrg) {
    res.status(400).json({ ok: false, code: "SAME_ORG", error: "Already in this organization." });
    return;
  }

  try {
    const [memberRes, ownerRes, orgMemberRes] = await Promise.all([
      pool.query<{ role: string }>(
        `SELECT role FROM team_members
         WHERE org_id = $1 AND lower(email) = lower($2) AND status = 'active'
         LIMIT 1`,
        [targetOrgId, callerEmail]
      ),
      pool.query<{ plan: string }>(
        `SELECT plan FROM organizations WHERE id::text = $1 AND owner_user_id = $2 LIMIT 1`,
        [targetOrgId, callerEmail]
      ),
      // Jalon 3: prefer organization_members as authoritative role source
      pool.query<{ role: string }>(
        `SELECT om.role FROM organization_members om
         JOIN users u ON u.id = om.user_id
         WHERE om.organization_id::text = $1 AND lower(u.email) = lower($2) AND om.status = 'active'
         LIMIT 1`,
        [targetOrgId, callerEmail]
      ),
    ]);

    // Prefer organization_members → team_members (legacy fallback)
    const memberRole = orgMemberRes.rows[0]?.role ?? memberRes.rows[0]?.role;
    const isOwner    = !!ownerRes.rows[0] || orgMemberRes.rows[0]?.role === "owner";

    if (!memberRole && !isOwner) {
      res.status(403).json({ ok: false, code: "ACCESS_DENIED", error: "Vous n'avez pas accès à cette organisation." });
      return;
    }

    const role = isOwner ? "owner" : memberRole;

    const sessionToken = await createSession({
      userId:    callerEmail,
      orgId:     targetOrgId,
      email:     callerEmail,
      role,
      ipAddress: ((req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()) ?? req.ip ?? undefined,
      userAgent: (req.headers["user-agent"] as string | undefined) ?? undefined,
    });

    logger.info(
      { from: currentOrg.slice(0, 20), to: targetOrgId.slice(0, 20), maskedEmail: maskEmail(callerEmail) },
      "[organizations/switch] org switch"
    );

    res.json({ ok: true, sessionToken, orgId: targetOrgId, role });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[organizations/switch] failed");
    res.status(500).json({ ok: false, error: "Failed to switch organization" });
  }
});

export default router;
