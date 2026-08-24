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
import { pool, withOrgDb }                     from "@workspace/db";
import { canAdmin }                             from "../middlewares/requireRole.js";
import { createSession, SESSION_TTL_MS, updateSessionsRole } from "../services/sessions.js";
import { resolveSeatEntitlement, SeatEntitlementUnavailableError } from "../services/seat-entitlement.js";
import { store }                                from "../services/store.js";

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

/** Count used seats: 1 (owner) + active members + pending invitations.
 *
 *  Seat capacity comes from the ONE authoritative resolver
 *  (resolveSeatEntitlement) so GET /team and POST /team/invite can never
 *  disagree.  When capacity cannot be resolved it throws
 *  SeatEntitlementUnavailableError (retryable) — it NEVER silently degrades to
 *  Standard/1, which would wrongly refuse invites for paying Pro/Ultra orgs.
 */
/**
 * Active members that occupy a seat BEYOND the owner's own seat.
 *
 * The owner always occupies exactly 1 seat (added as the constant below), so
 * any active team_members row that *represents the owner* (legacy data can
 * store the owner as a plain 'admin'/'member' row) must be excluded here or
 * the owner would be counted twice — and the visible member list (which
 * de-duplicates the owner) would disagree with seatUsage.used.
 */
const ACTIVE_NON_OWNER_MEMBERS_COUNT_SQL = `
  SELECT COUNT(*)::int AS n
  FROM team_members tm
  WHERE tm.org_id = $1 AND tm.status = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM organizations o
      LEFT JOIN users u ON LOWER(u.email) = LOWER(o.owner_email)
      WHERE o.id::text = tm.org_id
        AND (LOWER(tm.email) = LOWER(o.owner_email)
             OR (u.id IS NOT NULL AND tm.user_id = u.id::text))
    )`;

async function getSeatUsage(
  db: OrgDbFn,
  orgId: string,
): Promise<{ used: number; limit: number; plan: string }> {
  const [{ limit, plan }, membersRes, invitesRes] = await Promise.all([
    resolveSeatEntitlement(orgId),
    db(ACTIVE_NON_OWNER_MEMBERS_COUNT_SQL, [orgId]),
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

/**
 * Atomically reserve one seat and create the invitation.
 *
 * The public GET display can use a normal count, but the write path MUST lock
 * per organization: otherwise two requests at 9/10 can both count 9 then both
 * insert, resulting in 11/10 seats. `pg_advisory_xact_lock` is database-wide,
 * so this holds across application instances as well as within one process.
 */
async function reserveSeatAndCreateInvitation(input: {
  orgId: string;
  invitationId: string;
  email: string;
  role: string;
  tokenHash: string;
  invitedBy: string | null;
  expiresAt: string;
}): Promise<{ reserved: true; seatUsage: { used: number; limit: number; plan: string } } | {
  reserved: false; seatUsage: { used: number; limit: number; plan: string };
}> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [input.orgId]);

    const [entitlement, membersRes, invitesRes] = await Promise.all([
      resolveSeatEntitlement(input.orgId),
      client.query<{ n: number }>(
        ACTIVE_NON_OWNER_MEMBERS_COUNT_SQL,
        [input.orgId],
      ),
      client.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM team_invitations
         WHERE org_id = $1 AND status = 'pending' AND expires_at > NOW()`,
        [input.orgId],
      ),
    ]);
    const seatUsage = {
      used: 1 + Number(membersRes.rows[0]?.n ?? 0) + Number(invitesRes.rows[0]?.n ?? 0),
      limit: entitlement.limit,
      plan: entitlement.plan,
    };
    if (seatUsage.used >= seatUsage.limit) {
      await client.query("ROLLBACK");
      return { reserved: false, seatUsage };
    }

    await client.query(
      `INSERT INTO team_invitations
         (id, org_id, email, role, token_hash, status, invited_by_user_id, expires_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6, $7, NOW(), NOW())`,
      [
        input.invitationId, input.orgId, input.email, input.role,
        input.tokenHash, input.invitedBy, input.expiresAt,
      ],
    );
    await client.query("COMMIT");
    return { reserved: true, seatUsage };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
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
    const acceptedUserRes = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = lower($1) LIMIT 1`,
      [email],
    );
    const acceptedUserUuid = acceptedUserRes.rows[0]?.id;
    if (!acceptedUserUuid) {
      throw new Error("accepted member has no canonical user id");
    }

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
         SET status = 'active', role = $1, user_id = $2, joined_at = $3, accepted_at = $4, updated_at = $5
         WHERE id = $6`,
        [inv.role, acceptedUserUuid, nowIso, nowIso, nowIso, memberId]
      );
    } else {
      // Fresh insert — no prior member row exists for this email+org
      memberId = randomUUID();
      await client.query(
        `INSERT INTO team_members
           (id, org_id, email, name, role, joined, status, user_id,
            invited_by_user_id, joined_at, accepted_at, invitation_token_hash,
            invited_at, email_status, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, 'active', $7,
                  $8, $9, $10, '',
                  $11, 'sent', $12, $13)`,
        [
          memberId,                    // $1
          inv.org_id,                  // $2
          email,                       // $3
          email.split("@")[0] ?? "",   // $4  name
          inv.role,                    // $5
          joinedDay,                   // $6  joined (text date)
          acceptedUserUuid,            // $7  canonical users.id
          inv.invited_by_user_id ?? null, // $8
          nowIso,                      // $9  joined_at
          nowIso,                      // $10 accepted_at
          nowIso,                      // $11 invited_at
          nowIso,                      // $12 created_at
          nowIso,                      // $13 updated_at
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
      userId:    acceptedUserUuid,
      orgId:     inv.org_id,
      email,
      role:      inv.role,
      userUuid:  acceptedUserUuid,
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

    // The owner occupies a seat (getSeatUsage counts "1 + active members") but
    // usually has NO team_members row — without a synthetic entry, both owner
    // and invited members see a list whose length never matches seatUsage.used,
    // and the member never sees who owns the workspace. Prepend the owner from
    // the organizations row unless an active member row already represents them.
    try {
      const ownerRes = await db(
        `SELECT o.owner_email AS email, o.created_at AS org_created_at,
                COALESCE(u.first_name, '') AS first_name,
                COALESCE(u.last_name,  '') AS last_name,
                u.id::text AS user_id
           FROM organizations o
           LEFT JOIN users u ON LOWER(u.email) = LOWER(o.owner_email)
          WHERE o.id::text = $1`,
        [org]
      );
      const o = ownerRes.rows[0];
      const ownerEmail = String(o?.email ?? "").toLowerCase();
      if (ownerEmail) {
        // Always force the owner to have role='owner', regardless of what may
        // be stored in team_members (legacy rows can have 'admin' or 'member').
        // This is the canonical source: organizations.owner_email.
        const ownerMemberIdx = members.findIndex(m =>
          String(m.email ?? "").toLowerCase() === ownerEmail ||
          (o?.user_id && String(m.userId ?? "") === String(o.user_id)));

        if (ownerMemberIdx !== -1) {
          // Owner already in list — ensure their role is 'owner'
          (members[ownerMemberIdx] as Record<string, unknown>).role = "owner";
        } else {
          // Owner not in team_members — prepend synthetic entry
          members.unshift({
            id:        "owner",
            email:     ownerEmail,
            name:      (o?.first_name && o?.last_name)
                         ? `${o.first_name} ${o.last_name}`.trim()
                         : ((o?.first_name as string) || ownerEmail.split("@")[0] || ""),
            firstName: o?.first_name ?? "",
            lastName:  o?.last_name ?? "",
            role:      "owner",
            status:    "active",
            userId:    o?.user_id ?? null,
            joinedAt:  o?.org_created_at ?? null,
            createdAt: o?.org_created_at ?? null,
          });
        }
      }
    } catch (ownerErr) {
      // Non-fatal: the list simply omits the synthetic owner row.
      logger.warn({ err: (ownerErr as Error).message }, "[team/get] owner row lookup failed");
    }

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
    // Seat capacity could not be authoritatively resolved — surface an explicit
    // retryable error rather than degrading to Standard/1 (which would make the
    // dashboard disagree with the invite gate for paying Pro/Ultra orgs).
    if (err instanceof SeatEntitlementUnavailableError) {
      logger.error({ orgId: org.slice(0, 20), err: err.message }, "[team/get] seat entitlement unavailable");
      res.status(503).json({
        ok:        false,
        code:      "SEAT_ENTITLEMENT_UNAVAILABLE",
        retryable: true,
        error:     "Impossible de déterminer la capacité de sièges. Veuillez réessayer.",
      });
      return;
    }
    logger.error({ orgId: org.slice(0, 20), err: (err as Error).message }, "[team/get] failed");
    res.status(500).json({ ok: false, code: "SERVER_ERROR", error: "Failed to load team" });
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

  // Generate the invitation credential before the atomic seat reservation.
  const rawToken  = randomBytes(32).toString("hex");
  const tHash     = hashToken(rawToken);
  const id        = randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Atomically count and reserve a seat. A plain count followed by a separate
  // INSERT allowed concurrent 9/10 requests to both create the tenth invite.
  let seatUsage: { used: number; limit: number; plan: string };
  try {
    const reservation = await reserveSeatAndCreateInvitation({
      orgId: org,
      invitationId: id,
      email,
      role: memberRole,
      tokenHash: tHash,
      invitedBy: callerEmail,
      expiresAt: expiresAt.toISOString(),
    });
    seatUsage = reservation.seatUsage;
    if (!reservation.reserved) {
      res.status(402).json({
        ok:         false,
        code:       "SEAT_LIMIT_REACHED",
        error:      `Limite de ${seatUsage.limit} siège${seatUsage.limit > 1 ? "s" : ""} atteinte pour le plan ${seatUsage.plan}.`,
        seatUsage,
      });
      return;
    }
  } catch (err) {
    // Entitlement unavailable → explicit retryable error, never a Standard/1
    // refusal. A Standard/1 fallback here caused paying Ultra orgs to be
    // rejected at 1/1 while the dashboard showed Ultra/10.
    if (err instanceof SeatEntitlementUnavailableError) {
      logger.error({ orgId: org.slice(0, 20), err: err.message }, "[team/invite] seat entitlement unavailable");
      res.status(503).json({
        ok:        false,
        code:      "SEAT_ENTITLEMENT_UNAVAILABLE",
        retryable: true,
        error:     "Impossible de déterminer la capacité de sièges. Veuillez réessayer.",
      });
      return;
    }
    logger.error({ orgId: org.slice(0, 20), err: (err as Error).message }, "[team/invite] seat usage failed");
    res.status(500).json({ ok: false, code: "SERVER_ERROR", error: "Failed to check seat quota" });
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
      `SELECT id, email, role, status, user_id FROM team_members WHERE id = $1 AND org_id = $2 LIMIT 1`,
      [memberId, org]
    );
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[team/patch] SELECT failed");
    res.status(500).json({ ok: false, error: "Failed to load member" });
    return;
  }

  const member = memberRes.rows[0];
  if (!member) { res.status(404).json({ ok: false, error: "Member not found" }); return; }

  // Ownership is defined by organizations.owner_email, NOT by the row's role:
  // legacy/inconsistent data can leave the true owner as an 'admin'/'member'
  // team_members row, and that row must be just as immutable. Fail CLOSED if
  // the ownership lookup cannot be resolved.
  let ownerEmail = "";
  let ownerUserId: string | null = null;
  try {
    const ownerRes = await db(
      `SELECT o.owner_email, u.id::text AS owner_user_id
         FROM organizations o
         LEFT JOIN users u ON LOWER(u.email) = LOWER(o.owner_email)
        WHERE o.id::text = $1 LIMIT 1`,
      [org]
    );
    ownerEmail  = String(ownerRes.rows[0]?.owner_email ?? "").toLowerCase();
    ownerUserId = (ownerRes.rows[0]?.owner_user_id as string | null) ?? null;
  } catch (err) {
    logger.error({ err: (err as Error).message }, "[team/patch] owner lookup failed — refusing role change");
    res.status(503).json({ ok: false, code: "OWNER_LOOKUP_UNAVAILABLE", retryable: true, error: "Vérification du propriétaire impossible. Réessayez." });
    return;
  }

  const memberIsOrgOwner =
    member.role === "owner" ||
    (ownerEmail  && String(member.email ?? "").toLowerCase() === ownerEmail) ||
    (ownerUserId && String(member.user_id ?? "") === ownerUserId);

  if (memberIsOrgOwner) {
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

    // Update all active sessions for this member so req.orgContext.role
    // reflects the new role on their very next API request (no logout needed).
    updateSessionsRole(m.email as string, org, newRole).catch(() => {});

    // Broadcast SSE so the affected member's browser immediately re-syncs
    // their role without needing a manual page refresh.
    try {
      store.broadcast(
        { type: "fp:role_updated", memberId, email: m.email, role: m.role },
        org
      );
    } catch (_) { /* non-fatal — member will re-sync on next /api/me poll */ }

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

  const callerEmail = req.orgContext?.email ?? "";
  const memberId    = req.params.id;

  // Removal is security-sensitive: canonical membership removal and session
  // revocation must succeed together. A failure rolls back all changes so we
  // never show a member as removed while their token still grants access.
  try {
    // Legacy invitation accepts stored the email in team_members.user_id.
    // Resolve the immutable canonical UUID with the service pool before
    // entering the RLS-scoped write transaction; querying users under the
    // tenant role can be filtered even for a legitimate organization owner.
    const canonicalLookup = await pool.query<{ team_user_id: string | null; canonical_user_id: string }>(
      `SELECT tm.user_id AS team_user_id, u.id AS canonical_user_id
       FROM team_members tm
       JOIN users u ON lower(u.email) = lower(tm.email)
       WHERE tm.id = $1 AND tm.org_id = $2 AND tm.status = 'active'
       LIMIT 1`,
      [memberId, org],
    );
    const lookup = canonicalLookup.rows[0];

    // Ownership is defined by organizations.owner_email, NOT by the row's
    // role: legacy data can leave the true owner as a non-owner team_members
    // row, and that row must be just as protected from removal. This query
    // failing aborts the whole route (fail closed).
    const orgOwnerRes = await pool.query<{ owner_email: string | null; owner_user_id: string | null }>(
      `SELECT o.owner_email, u.id::text AS owner_user_id
         FROM organizations o
         LEFT JOIN users u ON lower(u.email) = lower(o.owner_email)
        WHERE o.id::text = $1 LIMIT 1`,
      [org],
    );
    const orgOwnerEmail  = String(orgOwnerRes.rows[0]?.owner_email ?? "").toLowerCase();
    const orgOwnerUserId = orgOwnerRes.rows[0]?.owner_user_id ?? null;
    const removed = await withOrgDb(org, async (client) => {
      const memberRes = await client.query<{ id: string; email: string; role: string; user_id: string | null }>(
        `SELECT id, email, role, user_id
         FROM team_members
         WHERE id = $1 AND org_id = $2 AND status = 'active'
         LIMIT 1`,
        [memberId, org],
      );
      const member = memberRes.rows[0];
      if (!member) return { kind: "not_found" as const };

      const memberIsOrgOwner =
        member.role === "owner" ||
        (orgOwnerEmail  && member.email.toLowerCase() === orgOwnerEmail) ||
        (orgOwnerUserId && (String(member.user_id ?? "") === orgOwnerUserId ||
                            lookup?.canonical_user_id === orgOwnerUserId));
      if (memberIsOrgOwner) return { kind: "owner" as const };
      if (callerEmail && member.email.toLowerCase() === callerEmail.toLowerCase()) {
        return { kind: "self" as const };
      }

      // organization_members is the authoritative membership table. Deleting
      // this record (rather than updating it later in the background) closes
      // the canonical access path in the same commit as legacy team cleanup.
      if (!lookup || lookup.team_user_id !== member.user_id) {
        throw new Error("active team member has no resolvable canonical user id");
      }
      const canonicalRes = await client.query<{ user_id: string }>(
        `DELETE FROM organization_members
         WHERE organization_id::text = $1
           AND user_id::text = $2
         RETURNING user_id`,
        [org, lookup.canonical_user_id],
      );
      const canonicalUserId = canonicalRes.rows[0]?.user_id;
      if (!canonicalUserId) {
        throw new Error("active team member has no canonical organization membership");
      }

      // Sessions are scoped by organization. Never revoke another valid org
      // session merely because the user has the same email or UUID.
      await client.query(
        `DELETE FROM user_sessions
         WHERE org_id = $1
           AND (lower(email) = lower($2) OR user_id_v2::text = $3)`,
        [org, member.email, canonicalUserId],
      );

      const teamRes = await client.query(
        `UPDATE team_members
         SET status = 'removed', updated_at = NOW()
         WHERE id = $1 AND org_id = $2 AND status = 'active'
         RETURNING id`,
        [memberId, org],
      );
      if (!teamRes.rows[0]) {
        throw new Error("member disappeared during removal");
      }

      return { kind: "removed" as const, email: member.email };
    });

    if (removed.kind === "not_found") {
      res.status(404).json({ ok: false, error: "Member not found" });
      return;
    }
    if (removed.kind === "owner") {
      res.status(403).json({ ok: false, code: "CANNOT_REMOVE_OWNER", error: "Le propriétaire ne peut pas être retiré de l'équipe." });
      return;
    }
    if (removed.kind === "self") {
      res.status(403).json({ ok: false, code: "CANNOT_REMOVE_SELF", error: "Vous ne pouvez pas vous retirer vous-même." });
      return;
    }

    logger.info({ orgId: org.slice(0, 20), memberId, maskedEmail: maskEmail(removed.email) }, "[team/delete] member access revoked");
    res.json({ ok: true });
  } catch (err) {
    logger.error(
      { orgId: org.slice(0, 20), memberId, err: (err as Error).message },
      "[team/delete] SECURITY: atomic membership/session revocation failed",
    );
    res.status(503).json({ ok: false, code: "MEMBER_REMOVAL_UNAVAILABLE", error: "Le retrait du membre n'a pas pu être sécurisé. Réessayez." });
  }
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

// ── GET /api/team/contributions — per-user action + mission counts from real DB ─
//
// Counts are keyed only by the canonical users.id.  Historical activity rows
// may identify their actor by UUID or email, but that legacy identity is
// resolved to users.id before aggregation.
//
// A genuine zero (table accessible, no rows for a member) is distinct from a
// query error: if EVERY underlying count query fails we surface `ok:false`
// with `error:"contributions_unavailable"` rather than a false-empty {} that
// would wrongly show every member as having done nothing.
//
// Org isolation: every count query is filtered by org_id = $1.
router.get("/team/contributions", async (req: Request, res: Response) => {
  const orgId = (req as OrgReq).orgId;
  if (!orgId || orgId === "default") {
    res.status(401).json({ ok: false, error: "Authentication required" });
    return;
  }
  try {
    const countsRes = await pool.query<{
      user_id: string; audits: number; missions: number; reports: number; monitors: number;
    }>(
      // Path 1: resolve via users table (handles UUIDs and email-shaped user_ids)
      // Path 2: owner activity where legacy user_id doesn't resolve through users
      //         (e.g. 'user-owner-abc' stored before the UUID migration)
      // Both paths emit canonical_user_id = users.id from the org owner lookup.
      `WITH owner_ids AS (
         SELECT
           COALESCE(
             (SELECT u.id::text FROM users u WHERE LOWER(u.email) = LOWER(o.owner_email) LIMIT 1),
             (SELECT u.id::text FROM users u WHERE u.id::text = o.owner_user_id::text LIMIT 1),
             o.owner_user_id::text
           ) AS canonical_uid,
           LOWER(o.owner_email)   AS owner_email,
           o.owner_user_id::text  AS owner_raw_uid
         FROM organizations o WHERE o.id::text = $1 LIMIT 1
       ),
       org_activity AS (
         SELECT owner_email, owner_raw_uid
         FROM owner_ids
       ),
       canonical_activity AS (
         -- Path 1: activity resolved through the users table
         SELECT al.*, u.id::text AS canonical_user_id
         FROM activity_logs al
         LEFT JOIN org_activity oa ON TRUE
         JOIN users u
           ON u.id::text = al.user_id
           OR LOWER(u.email) = LOWER(al.user_id)
         WHERE (
             al.org_id = $1
             OR LOWER(al.org_id) = oa.owner_email
             OR al.org_id = oa.owner_raw_uid
           )
           AND (
             EXISTS (
               SELECT 1 FROM organization_members om
               WHERE om.organization_id::text = $1
                 AND om.user_id = u.id
                 AND om.status = 'active'
             )
             OR EXISTS (
               SELECT 1 FROM organizations o
               WHERE o.id::text = $1
                 AND (LOWER(o.owner_email) = LOWER(u.email)
                      OR o.owner_user_id::text = u.id::text)
             )
           )
         UNION ALL
         -- Path 2: owner legacy activity that doesn't resolve through users
         -- (user_id stored as non-UUID before migration)
         SELECT al.*, (SELECT canonical_uid FROM owner_ids) AS canonical_user_id
         FROM activity_logs al, owner_ids
         WHERE (
             al.org_id = $1
             OR LOWER(al.org_id) = owner_ids.owner_email
             OR al.org_id = owner_ids.owner_raw_uid
           )
           AND al.user_id IS NOT NULL
           AND al.user_id != ''
           AND (
             al.user_id = owner_ids.owner_raw_uid
             OR LOWER(al.user_id) = owner_ids.owner_email
           )
           -- exclude rows that Path 1 already covers (user resolved via JOIN users)
           AND NOT EXISTS (
             SELECT 1 FROM users u2
             WHERE u2.id::text = al.user_id
                OR LOWER(u2.email) = LOWER(al.user_id)
           )
       )
       SELECT canonical_user_id AS user_id,
              COUNT(*) FILTER (
                WHERE type = 'audit' AND target_type = 'audit'
              )::int AS audits,
              COUNT(*) FILTER (
                WHERE target_type = 'mission'
                   OR action_key LIKE 'activity.mission.%'
              )::int AS missions,
              COUNT(*) FILTER (
                WHERE type = 'report' AND target_type = 'report'
              )::int AS reports,
              COUNT(*) FILTER (
                WHERE type = 'monitor' AND target_type = 'monitor'
              )::int AS monitors
       FROM canonical_activity
       GROUP BY canonical_user_id`,
      [orgId]
    );

    const byUser: Record<string, { audits: number; missions: number; reports: number; monitors: number }> = {};
    for (const row of countsRes.rows) {
      if (!row.user_id) continue;
      byUser[row.user_id] = {
        audits: Number(row.audits ?? 0),
        missions: Number(row.missions ?? 0),
        reports: Number(row.reports ?? 0),
        monitors: Number(row.monitors ?? 0),
      };
    }

    // ── Debug log: per-member contribution snapshot ────────────────────────────
    // Lists every key resolved, so we can verify userId/email alignment.
    try {
      const memberSnap = Object.entries(byUser).map(([k, v]) => ({
        key: k.length > 36 ? k.slice(0, 8) + "…" : k,
        ...v,
      }));
      logger.info({ orgId: orgId.slice(0, 8), members: memberSnap }, "[team/contributions] resolved");
    } catch (_) { /* non-fatal */ }

    res.json({ ok: true, contributions: byUser });
  } catch (err) {
    logger.error({ err }, "[team/contributions] failed");
    res.status(503).json({ ok: false, error: "contributions_unavailable", retryable: true });
  }
});

// ── GET /api/team/streaks — per-member streak from member_activity_days ──────
router.get("/team/streaks", async (req: Request, res: Response) => {
  const orgId = (req as OrgReq).orgId;
  if (!orgId) { res.status(401).json({ error: "Unauthorized" }); return; }
  try {
    const tz = await (async () => {
      try {
        const r = await pool.query(`SELECT settings FROM user_prefs WHERE org_id=$1 LIMIT 1`, [orgId]);
        const s = r.rows[0]?.["settings"] as Record<string, unknown> | null;
        return (s && typeof s["timezone"] === "string") ? s["timezone"] : "Europe/Brussels";
      } catch { return "Europe/Brussels"; }
    })();

    // Get ALL active members with their canonical user UUIDs.
    // NO LIMIT — every active member's streak must be computed; capping at 50
    // silently dropped members past the 50th from the leaderboard.
    // Org isolation: filtered by om.organization_id = $1.
    // Prefer organization_members (new schema); fall back to team_members (legacy)
    // so invited members who haven't migrated still get a streak computed.
    let memberRes = await pool.query<{ user_id: string; email: string; name: string; role: string }>(
      `SELECT DISTINCT om.user_id::text AS user_id,
              COALESCE(u.email,'') AS email,
              COALESCE(u.first_name||' '||u.last_name, u.first_name, u.email, om.user_id::text) AS name,
              om.role
       FROM organization_members om
       JOIN users u ON u.id = om.user_id
       WHERE om.organization_id::text = $1 AND om.status = 'active'`,
      [orgId]
    );
    // If organization_members returned no rows, try legacy team_members table.
    if (memberRes.rows.length === 0) {
      try {
        memberRes = await pool.query(
          `SELECT DISTINCT tm.user_id::text AS user_id,
                  COALESCE(u.email,'') AS email,
                  COALESCE(u.first_name||' '||u.last_name, u.first_name, u.email, tm.user_id::text) AS name,
                  COALESCE(tm.role,'member') AS role
           FROM team_members tm
           JOIN users u ON u.id::text = tm.user_id::text
           WHERE tm.org_id = $1 AND tm.status = 'active'`,
          [orgId]
        );
      } catch (_) { /* team_members might not exist — ignore */ }
    }
    // Always include the org owner (may not be in either members table), but
    // only when the owner resolves to a canonical users.id.
    let ownerUserId = "";
    try {
      const ownerQ = await pool.query(
        `SELECT
           COALESCE(
             (SELECT u.id::text FROM users u WHERE LOWER(u.email) = LOWER(o.owner_email) LIMIT 1),
              (SELECT u.id::text FROM users u WHERE u.id::text = o.owner_user_id::text LIMIT 1)
           ) AS user_id,
           COALESCE(LOWER(o.owner_email), '') AS email,
           COALESCE(
             (SELECT u.first_name||' '||u.last_name FROM users u WHERE LOWER(u.email) = LOWER(o.owner_email) LIMIT 1),
             (SELECT u.first_name||' '||u.last_name FROM users u WHERE u.id::text = o.owner_user_id::text LIMIT 1),
             o.owner_email, o.owner_user_id::text, 'Owner'
           ) AS name
         FROM organizations o
         WHERE o.id::text = $1 LIMIT 1`,
        [orgId]
      );
      const own = ownerQ.rows[0];
      if (own?.user_id) {
        ownerUserId = String(own.user_id);
        const existingOwner = memberRes.rows.find(r => r.user_id === own.user_id);
        if (existingOwner) {
          existingOwner.role = "owner";
          if (!existingOwner.email && own.email) existingOwner.email = own.email;
        } else {
          (memberRes.rows as Array<{ user_id: string; email: string; name: string; role: string }>)
            .unshift({ user_id: own.user_id, email: own.email || '', name: (own.name || '').trim() || 'Owner', role: 'owner' });
        }
      }
    } catch (_) { /* non-fatal */ }

    const streaks: Array<{
      userId: string; email: string; name: string; role: string;
      current: number; best: number;
      /** true when this member's streak could not be computed (query error). */
      error?: boolean;
    }> = [];

    for (const member of memberRes.rows) {
      const uid = member.user_id;
      const base = { userId: uid, email: member.email, name: member.name.trim(), role: member.role };
      try {
        // The owner uses the same authoritative org activity source as
        // /api/me/streak. Other members use their canonical per-user rows.
        const isCurrentOwner = uid === ownerUserId;
        const activityTable = isCurrentOwner ? "user_activity_days" : "member_activity_days";
        const identityClause = isCurrentOwner ? "AND $2::text = $2::text" : "AND user_id=$2";
        const actRes = await pool.query<{ d: string }>(
          `SELECT day::text AS d FROM ${activityTable}
           WHERE org_id=$1
              ${identityClause}
              AND day >= (NOW() AT TIME ZONE $3)::date - INTERVAL '365 days'
           ORDER BY d DESC`,
          [orgId, uid, tz]
        );
        logger.info(
          { userId: uid.slice(0, 8), email: member.email, activityRowsFound: actRes.rows.length },
          "[STREAK DEBUG]"
        );
        if (actRes.rows.length === 0) {
          // Genuine zero: table accessible, member simply has no active days.
          logger.info({ userId: uid.slice(0, 8), email: member.email, calculatedCurrentStreak: 0, bestStreak: 0 }, "[STREAK DEBUG]");
          streaks.push({ ...base, current: 0, best: 0 });
          continue;
        }
        const activeDays = new Set(actRes.rows.map(r => String(r.d).slice(0, 10)));
        const todayStr = new Date().toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).slice(0, 10);
        const startOffset = activeDays.has(todayStr) ? 0 : 1;
        let current = 0;
        for (let d = startOffset; d < 365; d++) {
          const dt = new Date(Date.now() - d * 86_400_000);
          const dayStr = dt.toLocaleString("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).slice(0, 10);
          if (activeDays.has(dayStr)) { current++; } else { break; }
        }
        const sorted = Array.from(activeDays).sort();
        let best = 0, run = 0;
        for (let i = 0; i < sorted.length; i++) {
          if (i === 0) { run = 1; } else {
            const diff = Math.round((new Date(sorted[i]!).getTime() - new Date(sorted[i-1]!).getTime()) / 86_400_000);
            run = diff === 1 ? run + 1 : 1;
          }
          if (run > best) best = run;
        }
        streaks.push({ ...base, current, best: Math.max(best, current) });
        logger.info(
          { member: base.name.slice(0, 20), userId: uid.slice(0, 8), email: base.email.slice(0, 20), streakDays: current, best: Math.max(best, current) },
          "[TEAM PERFORMANCE DEBUG]"
        );
      } catch (memberErr) {
        // Query error for THIS member — do NOT fabricate a genuine zero.
        // Mark error:true so the caller can distinguish "no activity" from
        // "could not read activity".
        logger.warn({ err: memberErr, userId: uid.slice(0, 8) }, "[team/streaks] per-member streak query failed");
        streaks.push({ ...base, current: 0, best: 0, error: true });
      }
    }

    res.json({ streaks });
  } catch (err) {
    logger.error({ err }, "[team/streaks] failed");
    res.status(500).json({ error: "Failed to compute member streaks" });
  }
});

export default router;
