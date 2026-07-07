import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
};

function getOrg(req: Request): string {
  return (req as OrgReq).orgId ?? "default";
}

function db(req: Request) {
  return (req as OrgReq).orgDb.bind(req);
}

// GET /team/files
router.get("/team/files", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT id, name, type, size, shared_by, created_at FROM team_files WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [getOrg(req)]
    );
    res.json(r.rows.map(f => ({
      id: f.id,
      name: f.name,
      type: f.type,
      size: f.size,
      sharedBy: f.shared_by,
      createdAt: f.created_at,
    })));
  } catch (err) {
    logger.warn({ err }, "[TeamFiles] list failed");
    res.json([]);
  }
});

// POST /team/files
router.post("/team/files", async (req: Request, res: Response) => {
  const { name, type, size, content, sharedBy } = req.body as {
    name?: string; type?: string; size?: number; content?: string; sharedBy?: string;
  };
  if (!name || !content) {
    res.status(400).json({ error: "name and content required" });
    return;
  }
  const id = `f${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db(req)(
      `INSERT INTO team_files (id, org_id, name, type, size, content, shared_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [id, getOrg(req), name, type || "file", size || 0, content, sharedBy || "Vous"]
    );
    res.status(201).json({ ok: true, file: { id, name, type: type || "file", size: size || 0, sharedBy: sharedBy || "Vous" } });
  } catch (err) {
    logger.error({ err }, "[TeamFiles] upload failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

// GET /team/files/:id/content
router.get("/team/files/:id/content", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT name, type, content FROM team_files WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [req.params.id, getOrg(req)]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "File not found" }); return; }
    const f = r.rows[0];
    const buf = Buffer.from(String(f.content), "base64");
    const mime = String(f.type).includes("pdf") ? "application/pdf"
      : String(f.type).includes("csv") ? "text/csv"
      : String(f.type).includes("xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      : String(f.type).includes("docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      : String(f.type).includes("zip") ? "application/zip"
      : String(f.type).includes("image") ? "image/*"
      : "application/octet-stream";
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${String(f.name).replace(/"/g, "'")}"`);
    res.send(buf);
  } catch (err) {
    logger.error({ err }, "[TeamFiles] download failed");
    res.status(500).json({ error: "Download failed" });
  }
});

// DELETE /team/files/:id
router.delete("/team/files/:id", async (req: Request, res: Response) => {
  try {
    await db(req)(
      `DELETE FROM team_files WHERE id=$1 AND org_id=$2`,
      [req.params.id, getOrg(req)]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[TeamFiles] delete failed");
    res.status(500).json({ error: "Delete failed" });
  }
});

export default router;
