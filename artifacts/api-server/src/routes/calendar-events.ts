import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";

const router = Router();

router.get("/calendar-events", async (_req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT id, title, site, type, date, start_time, duration, notes, created_at
       FROM calendar_events
       ORDER BY date ASC, start_time ASC
       LIMIT 500`
    );
    const events = r.rows.map((row) => ({
      id:        row.id,
      title:     row.title,
      site:      row.site  || "",
      type:      row.type  || "Autre",
      date:      row.date  || "",
      startTime: row.start_time || "",
      duration:  row.duration || 60,
      notes:     row.notes || "",
    }));
    res.json(events);
  } catch {
    res.json([]);
  } finally {
    client.release();
  }
});

router.post("/calendar-events", async (req: Request, res: Response) => {
  const { title, site, type, date, startTime, duration, notes } = req.body as {
    title?: string; site?: string; type?: string; date?: string;
    startTime?: string; duration?: number; notes?: string;
  };
  if (!title) { res.status(400).json({ error: "title required" }); return; }
  const id = `ce_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO calendar_events (id, title, site, type, date, start_time, duration, notes, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())`,
      [id, title, site || "", type || "Autre", date || "", startTime || "", duration ?? 60, notes || ""]
    );
    res.status(201).json({ id, title, site: site || "", type: type || "Autre", date: date || "", startTime: startTime || "", duration: duration ?? 60, notes: notes || "" });
  } catch (err) {
    res.status(500).json({ error: "Failed to create event" });
  } finally {
    client.release();
  }
});

router.patch("/calendar-events/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { title, site, type, date, startTime, duration, notes } = req.body as {
    title?: string; site?: string; type?: string; date?: string;
    startTime?: string; duration?: number; notes?: string;
  };
  const client = await pool.connect();
  try {
    await client.query(
      `UPDATE calendar_events
       SET title=$1, site=$2, type=$3, date=$4, start_time=$5, duration=$6, notes=$7
       WHERE id=$8`,
      [title, site || "", type || "Autre", date || "", startTime || "", duration ?? 60, notes || "", id]
    );
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to update event" });
  } finally {
    client.release();
  }
});

router.delete("/calendar-events/:id", async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM calendar_events WHERE id=$1`, [req.params.id]);
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "Failed to delete event" });
  } finally {
    client.release();
  }
});

export default router;
