import { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger.js";
import { sanitizeFilename } from "../lib/file-validation.js";

const router = Router();

type OrgReq = Request & {
  orgDb: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  orgId?: string;
  orgContext?: { orgId?: string; userId?: string; role?: string };
};

function getOrg(req: Request): string {
  return (req as OrgReq).orgId ?? "default";
}

function db(req: Request) {
  return (req as OrgReq).orgDb.bind(req);
}

// ─── Security constants ────────────────────────────────────────────────────────

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB per file
const MAX_BASE64_CHARS    = Math.ceil(MAX_FILE_SIZE_BYTES * 4 / 3) + 4; // base64 overhead
const ORG_QUOTA_BYTES     = 100 * 1024 * 1024; // 100 MB total per org
const MAX_FILES_PER_ORG   = 500;

// Allowed MIME types mapped to their canonical extension (one canonical ext per MIME).
// Extension → canonical MIME is the inverse — used for strict extension↔MIME consistency.
const ALLOWED_MIME: Record<string, string> = {
  "application/pdf":                                                                      "pdf",
  "text/csv":                                                                             "csv",
  "text/plain":                                                                           "txt",
  "text/markdown":                                                                        "md",
  "application/json":                                                                     "json",
  "application/zip":                                                                      "zip",
  "application/x-zip-compressed":                                                         "zip",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":                   "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":             "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":           "pptx",
  "application/vnd.ms-excel":                                                             "xls",
  "application/msword":                                                                   "doc",
  "image/jpeg":                                                                           "jpg",
  "image/png":                                                                            "png",
  "image/gif":                                                                            "gif",
  "image/webp":                                                                           "webp",
  "image/svg+xml":                                                                        "svg",
};

// Reverse map: extension → expected MIME(s). Built once for O(1) lookup.
// Where multiple MIMEs share an ext (e.g. zip), all are acceptable.
const EXT_TO_MIMES: Record<string, string[]> = {};
for (const [mime, ext] of Object.entries(ALLOWED_MIME)) {
  if (!EXT_TO_MIMES[ext]) EXT_TO_MIMES[ext] = [];
  EXT_TO_MIMES[ext].push(mime);
}
const ALLOWED_EXTENSIONS = new Set(Object.keys(EXT_TO_MIMES));

// Validate MIME against extension AND enforce extension↔MIME consistency.
// Returns the canonical MIME to store, or null if invalid/mismatched.
function validateMime(suppliedMime: string | undefined, filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(ext)) return null; // extension not on allowlist

  // Browser compatibility: most browsers send .md files as text/plain.
  // Normalise to text/markdown so the AI pipeline resolves the correct extension.
  // This is explicit: only .md + text/plain triggers the normalisation.
  if (ext === "md" && suppliedMime === "text/plain") {
    return "text/markdown";
  }

  const allowedMimesForExt = EXT_TO_MIMES[ext] ?? [];

  if (suppliedMime) {
    // Client MIME must be on the allowlist AND must match the file extension
    if (!ALLOWED_MIME[suppliedMime]) return null; // MIME not on allowlist
    if (!allowedMimesForExt.includes(suppliedMime)) return null; // MIME↔ext mismatch
    return suppliedMime;
  }

  // No client MIME supplied — derive from extension (first canonical MIME for that ext)
  return allowedMimesForExt[0] ?? null;
}

// Check if the requester is at least an editor (viewers cannot upload/delete).
// Role is set by orgContext middleware from the authenticated session.
function requireEditorRole(req: Request, res: Response): boolean {
  const role: string = (req as OrgReq).orgContext?.role ?? "viewer";
  if (["owner", "admin", "editor"].includes(role)) return true;
  res.status(403).json({ error: "Droits insuffisants (editor minimum requis)" });
  return false;
}

// ─── GET /team/files ──────────────────────────────────────────────────────────

router.get("/team/files", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT id, name, type, size, shared_by, created_at FROM team_files WHERE org_id=$1 ORDER BY created_at DESC LIMIT 200`,
      [getOrg(req)]
    );
    res.json(r.rows.map((f: Record<string, unknown>) => ({
      id:        f.id,
      name:      f.name,
      type:      f.type,
      size:      f.size,
      sharedBy:  f.shared_by,
      createdAt: f.created_at,
    })));
  } catch (err) {
    logger.warn({ err }, "[TeamFiles] list failed");
    res.json([]);
  }
});

// ─── POST /team/files ─────────────────────────────────────────────────────────

router.post("/team/files", async (req: Request, res: Response) => {
  if (!requireEditorRole(req, res)) return;

  const { name: rawName, type: rawType, size: rawSize, content, sharedBy } = req.body as {
    name?: string; type?: string; size?: number; content?: string; sharedBy?: string;
  };

  // ── Required fields ──
  if (!rawName || !content) {
    res.status(400).json({ error: "name and content required" });
    return;
  }

  // ── Filename sanitization ──
  const name = sanitizeFilename(rawName);

  // ── MIME / extension validation ──
  const resolvedMime = validateMime(rawType, name);
  if (!resolvedMime) {
    res.status(415).json({
      error: `Type de fichier non autorisé. Extensions acceptées : ${[...ALLOWED_EXTENSIONS].join(", ")}`,
    });
    return;
  }

  // ── Content-size guard — server-derived only, never trust client rawSize ──────
  // base64: 4 chars encode 3 bytes; strip data-URI prefix if present.
  if (typeof content !== "string") {
    res.status(400).json({ error: "content must be a base64 string" });
    return;
  }
  const b64 = content.replace(/^data:[^;]+;base64,/, "");
  if (b64.length > MAX_BASE64_CHARS) {
    res.status(413).json({ error: `Fichier trop volumineux. Limite : ${MAX_FILE_SIZE_BYTES / 1024 / 1024} Mo` });
    return;
  }
  // Authoritative byte count derived server-side — client rawSize is ignored for enforcement
  const actualBytes = Math.round(b64.length * 0.75);
  if (actualBytes > MAX_FILE_SIZE_BYTES) {
    res.status(413).json({ error: `Fichier trop volumineux. Limite : ${MAX_FILE_SIZE_BYTES / 1024 / 1024} Mo` });
    return;
  }

  const org = getOrg(req);

  // ── Org quota check (fail-closed: DB error blocks upload) ───────────────────
  try {
    const quotaRes = await db(req)(
      `SELECT COUNT(*) AS cnt, COALESCE(SUM(size),0) AS total_bytes FROM team_files WHERE org_id=$1`,
      [org]
    );
    const cnt        = Number(quotaRes.rows[0]?.cnt ?? 0);
    const totalBytes = Number(quotaRes.rows[0]?.total_bytes ?? 0);

    if (cnt >= MAX_FILES_PER_ORG) {
      res.status(429).json({ error: `Quota atteint : maximum ${MAX_FILES_PER_ORG} fichiers par organisation` });
      return;
    }
    if (totalBytes + actualBytes > ORG_QUOTA_BYTES) {
      res.status(429).json({ error: `Quota de stockage atteint : maximum ${ORG_QUOTA_BYTES / 1024 / 1024} Mo par organisation` });
      return;
    }
  } catch (err) {
    logger.error({ err }, "[TeamFiles] quota check failed — upload blocked");
    res.status(503).json({ error: "Impossible de vérifier le quota de stockage. Veuillez réessayer." });
    return;
  }

  // ── Insert — use server-derived actualBytes for size column ──────────────────
  const id = `f${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await db(req)(
      `INSERT INTO team_files (id, org_id, name, type, size, content, shared_by, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [id, org, name, resolvedMime, actualBytes, b64, sharedBy || "Vous"]
    );
    res.status(201).json({
      ok: true,
      file: { id, name, type: resolvedMime, size: actualBytes, sharedBy: sharedBy || "Vous" },
    });
  } catch (err) {
    logger.error({ err }, "[TeamFiles] upload failed");
    res.status(500).json({ error: "Upload failed" });
  }
});

// ─── GET /team/files/:id/content ─────────────────────────────────────────────
// All authenticated org members (viewer+) may download files.

router.get("/team/files/:id/content", async (req: Request, res: Response) => {
  try {
    const r = await db(req)(
      `SELECT name, type, content FROM team_files WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [req.params.id, getOrg(req)]
    );
    if (!r.rows[0]) { res.status(404).json({ error: "File not found" }); return; }
    const f = r.rows[0];

    const mime = ALLOWED_MIME[String(f.type)]
      ? String(f.type)
      : "application/octet-stream";

    const safeName = sanitizeFilename(String(f.name));
    const buf = Buffer.from(String(f.content), "base64");

    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(buf);
  } catch (err) {
    logger.error({ err }, "[TeamFiles] download failed");
    res.status(500).json({ error: "Download failed" });
  }
});

// ─── DELETE /team/files/:id ───────────────────────────────────────────────────

router.delete("/team/files/:id", async (req: Request, res: Response) => {
  if (!requireEditorRole(req, res)) return;
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
