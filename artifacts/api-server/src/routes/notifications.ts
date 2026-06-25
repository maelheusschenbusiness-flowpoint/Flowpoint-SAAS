import { Router } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

const router = Router();

// ── GET /notifications ────────────────────────────────────────────────────────

router.get("/notifications", async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50`,
    );
    res.json(result.rows.map(n => ({
      id:        n.id,
      type:      n.type,
      title:     n.title,
      message:   n.message,
      read:      n.read,
      link:      n.link,
      createdAt: n.created_at,
    })));
  } catch (err) {
    logger.warn({ err }, "[notifications] GET failed");
    res.json([]);
  }
});

// ── POST /notifications ───────────────────────────────────────────────────────

router.post("/notifications", async (req, res) => {
  const { type = "info", title, message, link } = req.body as {
    type?: string; title?: string; message?: string; link?: string;
  };
  if (!title || !message) {
    res.status(400).json({ error: "title and message required" }); return;
  }
  try {
    const id     = `notif${Date.now()}`;
    const result = await pool.query(
      `INSERT INTO notifications (id, type, title, message, link, read, created_at)
       VALUES ($1,$2,$3,$4,$5,false,NOW()) RETURNING *`,
      [id, type, title, message, link ?? null],
    );
    const n = result.rows[0];
    res.status(201).json({
      id: n.id, type: n.type, title: n.title,
      message: n.message, read: n.read, link: n.link,
    });
  } catch (err) {
    logger.error({ err }, "[notifications] POST failed");
    res.status(500).json({ error: "Failed to create notification" });
  }
});

// ── PATCH /notifications/:id/read ─────────────────────────────────────────────

router.patch("/notifications/:id/read", async (req, res) => {
  try {
    const result = await pool.query(
      `UPDATE notifications SET read = true WHERE id = $1 RETURNING *`,
      [req.params.id],
    );
    const n = result.rows[0];
    res.json(n
      ? { id: n.id, type: n.type, title: n.title, message: n.message, read: n.read }
      : { ok: true });
  } catch (err) {
    logger.error({ err }, "[notifications] PATCH read failed");
    res.status(500).json({ error: "Failed to mark read" });
  }
});

// ── PATCH /notifications/read-all ────────────────────────────────────────────

router.patch("/notifications/read-all", async (_req, res) => {
  try {
    await pool.query(`UPDATE notifications SET read = true`);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[notifications] PATCH read-all failed");
    res.status(500).json({ error: "Failed to mark all read" });
  }
});

// ── DELETE /notifications/:id ─────────────────────────────────────────────────

router.delete("/notifications/:id", async (req, res) => {
  try {
    await pool.query(`DELETE FROM notifications WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch { res.json({ ok: true }); }
});

export default router;
