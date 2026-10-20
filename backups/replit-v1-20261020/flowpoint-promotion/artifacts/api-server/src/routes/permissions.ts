import { Router } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
const errStatus = (err: unknown): number => (err && typeof err === "object" && typeof (err as { statusCode?: unknown }).statusCode === "number") ? (err as { statusCode: number }).statusCode : 500;
const errMsg = (err: unknown): string => errStatus(err) === 500 ? safeErrMsg(err) : (err instanceof Error ? err.message : String(err));
import { requireAdmin } from "../middlewares/requireAdmin.js";
import { getRoles, createRole, updateRole, deleteRole, assignRole, getPermissionLogs, getAccessAudits, logAccess, getPermissionsStats, ALL_RESOURCES, ALL_ACTIONS } from "../services/permissions-service.js";

const router = Router();
const org  = (req: import("express").Request) => req.orgId ?? "default";
const plan = (req: import("express").Request) => ((req as unknown as { me?: { plan?: string } }).me?.plan ?? "Pro");

router.get("/permissions", requireAdmin, async (req, res) => {
  try {
    const [roles, stats] = await Promise.all([getRoles(org(req)), getPermissionsStats(org(req))]);
    res.json({ roles, stats, resources: ALL_RESOURCES, actions: ALL_ACTIONS, plan: plan(req) });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.get("/permissions/roles", requireAdmin, async (req, res) => {
  try {
    const roles = await getRoles(org(req));
    res.json({ roles, count: roles.length });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.post("/roles/create", requireAdmin, async (req, res) => {
  const { name, description, color, permissions, parentRoleId } = req.body as {
    name?: string; description?: string; color?: string; permissions?: string[]; parentRoleId?: string;
  };
  if (!name) { res.status(400).json({ error: "name requis" }); return; }
  try {
    const role = await createRole(org(req), plan(req), { name, description, color, permissions, parentRoleId });
    await logAccess(org(req), 'system', 'role.created', 'permissions', { roleId: role.id, name });
    res.status(201).json({ ok: true, role });
  } catch (err) {
    const msg = safeErrMsg(err);
    res.status(msg.includes("requis") ? 403 : 500).json({ error: msg });
  }
});

router.patch("/roles/update/:id", requireAdmin, async (req, res) => {
  try {
    await updateRole(org(req), req.params["id"] as string, req.body as Partial<{ name: string; description: string; color: string; permissions: string[] }>);
    await logAccess(org(req), 'system', 'role.updated', 'permissions', { roleId: req.params["id"] as string });
    res.json({ ok: true });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.delete("/roles/delete/:id", requireAdmin, async (req, res) => {
  try {
    await deleteRole(org(req), req.params["id"] as string);
    await logAccess(org(req), 'system', 'role.deleted', 'permissions', { roleId: req.params["id"] as string });
    res.json({ ok: true });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.patch("/team/permissions", requireAdmin, async (req, res) => {
  const { userId, roleId, grantedBy = 'admin' } = req.body as { userId?: string; roleId?: string; grantedBy?: string };
  if (!userId || !roleId) { res.status(400).json({ error: "userId et roleId requis" }); return; }
  try {
    await assignRole(org(req), userId, roleId, grantedBy);
    await logAccess(org(req), grantedBy, 'role.assigned', 'team', { userId, roleId });
    res.json({ ok: true });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

router.get("/access/logs", requireAdmin, async (req, res) => {
  const limit = parseInt(req.query.limit as string || "50", 10);
  try {
    const [logs, audits] = await Promise.all([getPermissionLogs(org(req), limit), getAccessAudits(org(req), limit)]);
    res.json({ logs, audits, count: logs.length });
  } catch (err) { res.status(errStatus(err)).json({ error: errMsg(err) }); }
});

// NOTE: POST /team/invite is handled by teamRouter (routes/team.ts) which does
// the real DB insert + email dispatch. This stub has been removed to avoid the
// duplicate route and the misleading stub response it used to send.

router.post("/team/remove", requireAdmin, async (req, res) => {
  const { userId } = req.body as { userId?: string };
  if (!userId) { res.status(400).json({ error: "userId requis" }); return; }
  await logAccess(org(req), 'admin', 'team.removed', 'team', { userId });
  res.json({ ok: true });
});

export default router;
