import { Router, type Request, type Response } from "express";
import { canWrite } from "../middlewares/requireRole.js";

const router = Router();

type OrgReq = Request & { orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>; orgId?: string };

function getOrg(req: Request): string {
  return (req as OrgReq).orgId ?? "default";
}

// ── Liste ─────────────────────────────────────────────────────────────────
router.get("/calendar-events", async (req: Request, res: Response) => {
  try {
    const r = await (req as OrgReq).orgDb(
      `SELECT id, title, site, type, date, start_time, duration, notes, client_name,
              priority, color, reminder, linked_mission_id, updated_at, created_at
       FROM calendar_events
       ORDER BY date ASC, start_time ASC
       LIMIT 500`
    );
    const events = r.rows.map((row) => ({
      id:              row.id,
      title:           row.title,
      site:            row.site        || "",
      type:            row.type        || "Autre",
      date:            row.date        || "",
      startTime:       row.start_time  || "",
      duration:        row.duration    || 60,
      notes:           row.notes       || "",
      clientName:      row.client_name || "",
      priority:        row.priority    || "normal",
      color:           row.color       || "",
      reminder:        row.reminder    ?? 0,
      linkedMissionId: row.linked_mission_id || null,
    }));
    res.json(events);
  } catch {
    res.json([]);
  }
});

// ── Détail ────────────────────────────────────────────────────────────────
router.get("/calendar-events/:id", async (req: Request, res: Response) => {
  try {
    const r = await (req as OrgReq).orgDb(
      `SELECT id, title, site, type, date, start_time, duration, notes, client_name,
              priority, color, reminder, linked_mission_id, updated_at, created_at
       FROM calendar_events WHERE id=$1 LIMIT 1`,
      [req.params.id]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Event not found" }); return; }
    const row = r.rows[0];
    res.json({
      id:              row.id,
      title:           row.title,
      site:            row.site        || "",
      type:            row.type        || "Autre",
      date:            row.date        || "",
      startTime:       row.start_time  || "",
      duration:        row.duration    || 60,
      notes:           row.notes       || "",
      clientName:      row.client_name || "",
      priority:        row.priority    || "normal",
      color:           row.color       || "",
      reminder:        row.reminder    ?? 0,
      linkedMissionId: row.linked_mission_id || null,
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch event" });
  }
});

// ── Création ──────────────────────────────────────────────────────────────
router.post("/calendar-events", canWrite, async (req: Request, res: Response) => {
  const { title, site, type, date, startTime, duration, notes, clientName,
          priority, color, reminder, linkedMissionId } = req.body as {
    title?: string; site?: string; type?: string; date?: string;
    startTime?: string; duration?: number; notes?: string; clientName?: string;
    priority?: string; color?: string; reminder?: number; linkedMissionId?: string;
  };
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  const id  = `ce_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const org = getOrg(req);
  try {
    await (req as OrgReq).orgDb(
      `INSERT INTO calendar_events
         (id, org_id, title, site, type, date, start_time, duration, notes, client_name,
          priority, color, reminder, linked_mission_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())`,
      [id, org, title, site || "", type || "Autre", date || "", startTime || "",
       duration ?? 60, notes || "", clientName || "",
       priority || "normal", color || "", reminder ?? 0, linkedMissionId || null]
    );
    res.status(201).json({
      id, title, site: site || "", type: type || "Autre", date: date || "",
      startTime: startTime || "", duration: duration ?? 60, notes: notes || "",
      clientName: clientName || "", priority: priority || "normal",
      color: color || "", reminder: reminder ?? 0, linkedMissionId: linkedMissionId || null,
    });
  } catch {
    res.status(500).json({ error: "Failed to create event" });
  }
});

// ── Modification ──────────────────────────────────────────────────────────
router.patch("/calendar-events/:id", canWrite, async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, site, type, date, startTime, duration, notes, clientName,
          priority, color, reminder, linkedMissionId } = req.body as {
    title?: string; site?: string; type?: string; date?: string;
    startTime?: string; duration?: number; notes?: string; clientName?: string;
    priority?: string; color?: string; reminder?: number; linkedMissionId?: string;
  };
  try {
    const r = await (req as OrgReq).orgDb(
      `UPDATE calendar_events
       SET title=$1, site=$2, type=$3, date=$4, start_time=$5, duration=$6, notes=$7,
           client_name=$8, priority=$9, color=$10, reminder=$11, linked_mission_id=$12,
           updated_at=NOW()
       WHERE id=$13 RETURNING *`,
      [title, site || "", type || "Autre", date || "", startTime || "",
       duration ?? 60, notes || "", clientName || "",
       priority || "normal", color || "", reminder ?? 0, linkedMissionId || null, id]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Event not found" }); return; }
    const row = r.rows[0];
    res.json({
      id: row.id, title: row.title, site: row.site || "", type: row.type || "Autre",
      date: row.date || "", startTime: row.start_time || "", duration: row.duration || 60,
      notes: row.notes || "", clientName: row.client_name || "",
      priority: row.priority || "normal", color: row.color || "", reminder: row.reminder ?? 0,
      linkedMissionId: row.linked_mission_id || null,
    });
  } catch {
    res.status(500).json({ error: "Failed to update event" });
  }
});

// ── Suppression ───────────────────────────────────────────────────────────
router.delete("/calendar-events/:id", canWrite, async (req: Request, res: Response) => {
  try {
    const r = await (req as OrgReq).orgDb(
      `DELETE FROM calendar_events WHERE id=$1 RETURNING id`, [req.params.id]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "Event not found" }); return; }
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete event" });
  }
});

export default router;
