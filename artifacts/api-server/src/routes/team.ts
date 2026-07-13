import { Router, type Request, type Response } from "express";

const router = Router();

type OrgReq = Request & { orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; orgId?: string };

function getOrg(req: Request): string {
  return (req as OrgReq).orgId ?? "default";
}

router.get("/team", async (req: Request, res: Response) => {
  try {
    const r = await (req as OrgReq).orgDb(
      `SELECT id, name, email, role, joined, created_at FROM team_members WHERE org_id = $1 ORDER BY created_at ASC LIMIT 100`,
      [getOrg(req)]
    );
    res.json(r.rows.map(m => ({
      id:        m.id,
      name:      m.name,
      email:     m.email,
      role:      m.role,
      joined:    m.joined,
      createdAt: m.created_at,
    })));
  } catch {
    res.json([]);
  }
});

router.post("/team/invite", async (req: Request, res: Response) => {
  const { email, role } = req.body as { email?: string; role?: string };
  if (!email) { res.status(400).json({ error: "email required" }); return; }
  const org = getOrg(req);
  // Guard: email already in this org
  try {
    const dup = await (req as OrgReq).orgDb(
      `SELECT id FROM team_members WHERE org_id = $1 AND email = $2 LIMIT 1`,
      [org, email]
    );
    if (dup.rows.length) {
      res.status(409).json({ error: "Ce membre est déjà dans l'équipe" });
      return;
    }
  } catch { /* continue even if guard fails */ }
  const id  = `t${Date.now()}`;
  const name = email.split("@")[0] || "Invité";
  const memberRole = role || "viewer";
  const joined = new Date().toISOString().slice(0, 10);
  try {
    const r = await (req as OrgReq).orgDb(
      `INSERT INTO team_members (id, org_id, name, email, role, joined, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING *`,
      [id, org, name, email, memberRole, joined]
    );
    const m = r.rows[0];
    res.status(201).json({ ok: true, member: { id: m.id, name: m.name, email: m.email, role: m.role, joined: m.joined }, invited: true });

    // Fire-and-forget: invitation email
    const { mailer } = await import("../services/mailer.js");
    const { store } = await import("../services/store.js");
    const publicUrl = process.env["PUBLIC_URL"] || process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : "https://app.flowpoint.pro";
    mailer.sendTeamInvitation({
      to: email,
      inviterName: store.me.firstName || store.me.name || "L'équipe FlowPoint",
      orgName: store.me.org?.name,
      role: memberRole,
      inviteUrl: `${publicUrl}/login.html?invite=${encodeURIComponent(id)}&email=${encodeURIComponent(email)}`,
    }).catch(() => {});
  } catch (err) {
    res.status(500).json({ error: "Failed to invite member" });
  }
});

router.patch("/team/:id", async (req: Request, res: Response) => {
  const { role } = req.body as { role?: string };
  if (!role) { res.status(400).json({ error: "role required" }); return; }
  const ALLOWED = ["viewer", "editor", "admin", "owner"];
  if (!ALLOWED.includes(role)) { res.status(400).json({ error: "invalid role" }); return; }
  try {
    const r = await (req as OrgReq).orgDb(
      `UPDATE team_members SET role=$1 WHERE id=$2 RETURNING *`,
      [role, req.params.id]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "member not found" }); return; }
    const m = r.rows[0];
    res.json({ ok: true, member: { id: m.id, name: m.name, email: m.email, role: m.role } });
  } catch {
    res.status(500).json({ error: "Failed to update member" });
  }
});

router.delete("/team/:id", async (req: Request, res: Response) => {
  try {
    await (req as OrgReq).orgDb(`DELETE FROM team_members WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete member" });
  }
});

export default router;
