import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { queryDataExplorer, AVAILABLE_SOURCES, type DESource } from "../services/data-explorer-service.js";
import { logger } from "../lib/logger.js";
import { randomBytes } from "crypto";
import { pool } from "@workspace/db";

const router = Router();
router.use(requireAuth);

type OrgReq = Request & {
  orgId?: string;
};
const org = (req: Request): string => (req as OrgReq).orgId ?? "default";

const VALID_SOURCES = new Set<string>(AVAILABLE_SOURCES.map((s) => s.source));

function parseDays(v: unknown, def = 30): number {
  const n = parseInt(String(v ?? def), 10);
  return isFinite(n) && n > 0 ? Math.min(n, 365) : def;
}

function parseLimit(v: unknown, def = 50): number {
  const n = parseInt(String(v ?? def), 10);
  return isFinite(n) && n > 0 ? Math.min(n, 200) : def;
}

function parseOffset(v: unknown): number {
  const n = parseInt(String(v ?? 0), 10);
  return isFinite(n) && n >= 0 ? n : 0;
}

// ── GET /sources ────────────────────────────────────────────────────────────
router.get("/sources", (_req: Request, res: Response) => {
  res.json(AVAILABLE_SOURCES);
});

// ── GET /query ───────────────────────────────────────────────────────────────
router.get("/query", async (req: Request, res: Response) => {
  const { source, days, limit, offset, sort, sortDir, filter } = req.query as Record<string, string | undefined>;
  if (!source || !VALID_SOURCES.has(source)) {
    res.status(400).json({ error: `source required, one of: ${[...VALID_SOURCES].join(", ")}` });
    return;
  }
  try {
    const result = await queryDataExplorer(org(req), source as DESource, {
      days: parseDays(days),
      limit: parseLimit(limit),
      offset: parseOffset(offset),
      sort: sort ?? undefined,
      sortDir: sortDir === "asc" ? "asc" : "desc",
      filter: filter ?? undefined,
    });
    res.json(result);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[data-explorer] query error");
    res.status(500).json({ error: "Query failed" });
  }
});

// ── GET /export ──────────────────────────────────────────────────────────────
router.get("/export", async (req: Request, res: Response) => {
  const { source, days, format, filter } = req.query as Record<string, string | undefined>;
  if (!source || !VALID_SOURCES.has(source)) {
    res.status(400).json({ error: "source required" });
    return;
  }
  const fmt = format === "csv" ? "csv" : "json";
  try {
    const result = await queryDataExplorer(org(req), source as DESource, {
      days: parseDays(days),
      limit: 2000,
      offset: 0,
      filter: filter ?? undefined,
    });
    if (fmt === "csv") {
      const cols = result.columns.map((c) => c.key);
      const header = result.columns.map((c) => `"${c.label}"`).join(",");
      const csvRows = result.rows.map((r) =>
        cols.map((k) => {
          const v = String(r[k] ?? "");
          return v.includes(",") || v.includes('"') || v.includes("\n")
            ? `"${v.replace(/"/g, '""')}"`
            : v;
        }).join(",")
      );
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="data-explorer-${source}-${Date.now()}.csv"`);
      res.send([header, ...csvRows].join("\n"));
    } else {
      res.setHeader("Content-Disposition", `attachment; filename="data-explorer-${source}-${Date.now()}.json"`);
      res.json(result);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[data-explorer] export error");
    res.status(500).json({ error: "Export failed" });
  }
});

// ── GET /dashboards ──────────────────────────────────────────────────────────
// Returns custom dashboards created by the org, newest first.
router.get("/dashboards", async (req: Request, res: Response) => {
  const orgId = org(req);
  try {
    const r = await pool.query(
      `SELECT id, name, description, widgets, icon, color, created_at, updated_at
       FROM custom_dashboards WHERE org_id=$1 ORDER BY created_at DESC LIMIT 100`,
      [orgId]
    );
    res.json({ dashboards: r.rows });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[data-explorer] dashboards fetch error");
    res.status(500).json({ error: "Failed to load dashboards" });
  }
});

// ── POST /dashboards ─────────────────────────────────────────────────────────
// Creates a new custom dashboard.
router.post("/dashboards", async (req: Request, res: Response) => {
  const orgId = org(req);
  const { name, description, icon, color } = req.body as {
    name?: string;
    description?: string;
    icon?: string;
    color?: string;
  };
  if (!name || typeof name !== "string" || !name.trim()) {
    res.status(400).json({ error: "name is required" });
    return;
  }
  const id = randomBytes(12).toString("hex");
  const now = new Date().toISOString();
  try {
    await pool.query(
      `INSERT INTO custom_dashboards (id, org_id, name, description, icon, color, widgets, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        orgId,
        name.trim().slice(0, 120),
        (description ?? "").trim().slice(0, 500),
        (icon ?? "📊").slice(0, 10),
        (color ?? "#2563EB").slice(0, 20),
        JSON.stringify([]),
        now,
        now,
      ]
    );
    res.status(201).json({
      ok: true,
      dashboard: { id, name: name.trim(), description: (description ?? "").trim(), icon: icon ?? "📊", color: color ?? "#2563EB", widgets: [], created_at: now, updated_at: now },
    });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[data-explorer] dashboard create error");
    res.status(500).json({ error: "Failed to create dashboard" });
  }
});

// ── DELETE /dashboards/:id ───────────────────────────────────────────────────
router.delete("/dashboards/:id", async (req: Request, res: Response) => {
  const orgId = org(req);
  try {
    const r = await pool.query(
      `DELETE FROM custom_dashboards WHERE id=$1 AND org_id=$2 RETURNING id`,
      [req.params["id"], orgId]
    );
    if (!r.rowCount) { res.status(404).json({ error: "Not found" }); return; }
    res.json({ ok: true });
  } catch (err) {
    logger.warn({ err: (err as Error).message }, "[data-explorer] dashboard delete error");
    res.status(500).json({ error: "Failed to delete dashboard" });
  }
});

export default router;
