import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};

/** Returns the authenticated org_id, or sends 401 and returns null. Never falls back to "default". */
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
      `SELECT id, name, email, role, joined, status, invited_at, created_at
       FROM team_members WHERE org_id = $1 ORDER BY created_at ASC LIMIT 100`,
      [org]
    );
    res.json(r.rows.map(m => ({
      id:        m.id,
      name:      m.name,
      email:     m.email,
      role:      m.role,
      status:    m.status ?? "active",
      joined:    m.joined,
      invitedAt: m.invited_at ?? null,
      createdAt: m.created_at,
    })));
  } catch {
    res.json([]);
  }
});

router.post("/team/invite", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;

  const { email, role } = req.body as { email?: string; role?: string };
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Valid email required" });
    return;
  }

  // Duplicate guard: same email, same org → 409
  try {
    const dup = await (req as OrgReq).orgDb(
      `SELECT id FROM team_members WHERE org_id = $1 AND email = $2 LIMIT 1`,
      [org, email.toLowerCase().trim()]
    );
    if (dup.rows.length) {
      res.status(409).json({ error: "Ce membre est déjà dans l'équipe" });
      return;
    }
  } catch (guardErr) {
    logger.warn({ err: guardErr, org }, "[team/invite] duplicate guard query failed — proceeding");
  }

  const id        = `t${Date.now()}`;
  const name      = email.split("@")[0] || "Invité";
  const memberRole = (role || "viewer").toLowerCase();
  const joined    = new Date().toISOString().slice(0, 10);
  const invitedBy = org;

  try {
    const r = await (req as OrgReq).orgDb(
      `INSERT INTO team_members (id, org_id, name, email, role, joined, status, invited_at, invited_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'invited', NOW(), $7, NOW())
       RETURNING id, name, email, role, status, invited_at, joined`,
      [id, org, name, email.toLowerCase().trim(), memberRole, joined, invitedBy]
    );

    const m = r.rows[0];
    if (!m) {
      logger.error({ org, email }, "[team/invite] INSERT returned no row");
      res.status(500).json({ error: "Insert succeeded but returned no row" });
      return;
    }

    res.status(201).json({
      id:        m.id,
      email:     m.email,
      role:      m.role,
      status:    m.status ?? "invited",
      invitedAt: m.invited_at ?? joined,
    });

    // Fire-and-forget invitation email
    const { mailer } = await import("../services/mailer.js");
    const { store }  = await import("../services/store.js");
    const base = process.env["REPLIT_DEV_DOMAIN"]
      ? `https://${process.env["REPLIT_DEV_DOMAIN"]}`
      : (process.env["PUBLIC_URL"] ?? "https://app.flowpoint.pro");
    mailer.sendTeamInvitation({
      to:          email,
      inviterName: store.me.firstName || store.me.name || "L'équipe FlowPoint",
      orgName:     store.me.org?.name,
      role:        memberRole,
      inviteUrl:   `${base}/login.html?invite=${encodeURIComponent(id)}&email=${encodeURIComponent(email)}`,
    }).catch(() => {});

  } catch (err: unknown) {
    const pgCode = (err as { code?: string }).code;
    // Log the exact SQL error (no secrets exposed — only code + message)
    logger.error(
      { sqlCode: pgCode, sqlMsg: (err as Error).message, org, email },
      "[team/invite] INSERT failed"
    );
    if (pgCode === "23505") {
      res.status(409).json({ error: "Ce membre est déjà dans l'équipe" });
      return;
    }
    res.status(500).json({ error: "Failed to invite member" });
  }
});

router.patch("/team/:id", async (req: Request, res: Response) => {
  const org = requireOrg(req, res);
  if (!org) return;

  const { role } = req.body as { role?: string };
  if (!role) { res.status(400).json({ error: "role required" }); return; }
  const ALLOWED = ["viewer", "editor", "admin", "owner"];
  if (!ALLOWED.includes(role)) { res.status(400).json({ error: "invalid role" }); return; }
  try {
    const r = await (req as OrgReq).orgDb(
      `UPDATE team_members SET role = $1 WHERE id = $2 AND org_id = $3 RETURNING id, name, email, role`,
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
      `DELETE FROM team_members WHERE id = $1 AND org_id = $2`,
      [req.params.id, org]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, org }, "[team/delete] DELETE failed");
    res.status(500).json({ error: "Failed to delete member" });
  }
});

export default router;
