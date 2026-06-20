import { Router } from "express";
import { db, teamMembersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

router.get("/team", async (_req, res) => {
  try {
    const members = await db.select().from(teamMembersTable).limit(100);
    res.json(members);
  } catch {
    res.json([]);
  }
});

router.post("/team/invite", async (req, res) => {
  const { email, role } = req.body as { email?: string; role?: string };
  if (!email) { res.status(400).json({ error: "email required" }); return; }
  const [member] = await db.insert(teamMembersTable).values({
    id: `t${Date.now()}`,
    name: email.split("@")[0] || "Invité",
    email,
    role: role || "viewer",
    joined: new Date().toISOString().slice(0, 10),
  }).returning();
  res.status(201).json({ ok: true, member });
});

router.patch("/team/:id", async (req, res) => {
  const { role } = req.body as { role?: string };
  if (!role) { res.status(400).json({ error: "role required" }); return; }
  const ALLOWED = ["viewer", "editor", "admin", "owner"];
  if (!ALLOWED.includes(role)) { res.status(400).json({ error: "invalid role" }); return; }
  const [updated] = await db
    .update(teamMembersTable)
    .set({ role })
    .where(eq(teamMembersTable.id, req.params.id))
    .returning();
  if (!updated) { res.status(404).json({ error: "member not found" }); return; }
  res.json({ ok: true, member: updated });
});

router.delete("/team/:id", async (req, res) => {
  await db.delete(teamMembersTable).where(eq(teamMembersTable.id, req.params.id));
  res.json({ ok: true });
});

export default router;
