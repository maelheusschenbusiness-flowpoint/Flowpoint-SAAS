import { Router, type Request, type Response } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { queryDataExplorer, AVAILABLE_SOURCES, type DESource } from "../services/data-explorer-service.js";
import { logger } from "../lib/logger.js";

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
    logger.warn("[data-explorer] query error:", (err as Error).message);
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
    logger.warn("[data-explorer] export error:", (err as Error).message);
    res.status(500).json({ error: "Export failed" });
  }
});

export default router;
