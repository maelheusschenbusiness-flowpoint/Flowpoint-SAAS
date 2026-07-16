import { logger }                from "../lib/logger.js";
import { AI_ATTACHMENT_LIMITS } from "../config/ai-attachments.js";
import {
  sanitizeFilename,
  extractExtension,
  buildExtToMimes,
  validateMimeExtConsistency,
} from "../lib/file-validation.js";
import type {
  AIAttachmentReference,
  ResolvedAIAttachment,
  AttachmentError,
  AttachmentErrorCode,
} from "../types/ai-attachments.js";

// ── AI-specific MIME allowlist (stricter than team-files) ─────────────────────
// ZIP, DOC, PPTX, SVG, GIF are explicitly excluded from the IA pipeline.
const AI_ALLOWED_MIME: Record<string, string> = {
  "application/pdf":                                                                  "pdf",
  "image/png":                                                                        "png",
  "image/jpeg":                                                                       "jpg",
  "image/webp":                                                                       "webp",
  "text/csv":                                                                         "csv",
  "application/csv":                                                                  "csv",
  "application/vnd.ms-excel":                                                         "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":               "xlsx",
  "text/plain":                                                                       "txt",
  "text/markdown":                                                                    "md",
  "application/json":                                                                 "json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":         "docx",
};

const AI_EXT_TO_MIMES      = buildExtToMimes(AI_ALLOWED_MIME);
const AI_ALLOWED_EXTENSIONS = new Set(Object.keys(AI_EXT_TO_MIMES));

// ── OrgDb ─────────────────────────────────────────────────────────────────────
// Compatible with req.orgDb (Express global augmentation in dbContext.ts).
export type OrgDb = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

// ── Error factory ─────────────────────────────────────────────────────────────
function attachmentError(
  code:       AttachmentErrorCode,
  message:    string,
  httpStatus: 400 | 404 | 413,
): AttachmentError {
  return { code, message, httpStatus };
}

// ── fileId format guard ───────────────────────────────────────────────────────
const FILE_ID_RE = /^[a-zA-Z0-9_\-]{1,128}$/;

function isValidFileId(id: unknown): id is string {
  return typeof id === "string" && FILE_ID_RE.test(id);
}

// ── Base64 validation ─────────────────────────────────────────────────────────
// Validates that the string contains only base64 characters with optional padding.
// Does NOT re-encode to verify round-trip (too expensive for large files).
// Future hook: detectRealMimeType(Buffer.from(b64, "base64")) can be inserted
// in resolveAIAttachments after this check once file-type is installed.
const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

export function isValidBase64(s: string): boolean {
  if (!s || s.length === 0) return false;
  return BASE64_RE.test(s);
}

// ── 1. validateAttachmentReferences ──────────────────────────────────────────
// Pure, synchronous. Validates structure only — no DB, no provider call.
// Returns the deduplicated reference list or an AttachmentError.
// Duplicate fileIds are rejected (not silently deduplicated) so callers can
// distinguish programming errors from valid requests.
export function validateAttachmentReferences(
  input: unknown,
): AIAttachmentReference[] | AttachmentError {
  if (!Array.isArray(input)) {
    return attachmentError(
      "INVALID_ATTACHMENTS",
      "Le champ attachments doit être un tableau.",
      400,
    );
  }

  if (input.length === 0) return [];

  if (input.length > AI_ATTACHMENT_LIMITS.maxFilesPerRequest) {
    return attachmentError(
      "TOO_MANY_ATTACHMENTS",
      `Maximum ${AI_ATTACHMENT_LIMITS.maxFilesPerRequest} pièces jointes par requête.`,
      400,
    );
  }

  const seen = new Set<string>();
  const refs: AIAttachmentReference[] = [];

  for (const item of input) {
    if (item === null || typeof item !== "object") {
      return attachmentError(
        "INVALID_ATTACHMENTS",
        "Chaque pièce jointe doit être un objet avec un champ fileId.",
        400,
      );
    }
    const { fileId } = item as Record<string, unknown>;
    if (!isValidFileId(fileId)) {
      return attachmentError(
        "INVALID_ATTACHMENTS",
        "fileId manquant ou invalide dans une pièce jointe (chaîne alphanumérique requise, max 128 caractères).",
        400,
      );
    }
    if (seen.has(fileId)) {
      return attachmentError(
        "INVALID_ATTACHMENTS",
        "Identifiants de pièces jointes en double.",
        400,
      );
    }
    seen.add(fileId);
    refs.push({ fileId });
  }

  return refs;
}

// ── 2. resolveAIAttachments ───────────────────────────────────────────────────
// Async, DB-backed. Loads files from team_files via the RLS-scoped orgDb.
// For any ID that is absent OR belongs to another org, returns the same generic
// ATTACHMENT_NOT_FOUND error to prevent cross-org existence leaks.
export async function resolveAIAttachments(
  orgDb:      OrgDb,
  orgId:      string,
  references: AIAttachmentReference[],
): Promise<ResolvedAIAttachment[] | AttachmentError> {
  if (references.length === 0) return [];

  const ids = references.map(r => r.fileId);

  let rows: Record<string, unknown>[];
  try {
    const result = await orgDb(
      `SELECT id, org_id, name, type, size, content
       FROM team_files
       WHERE id = ANY($1) AND org_id = $2`,
      [ids, orgId],
    );
    rows = result.rows as Record<string, unknown>[];
  } catch (err) {
    logger.warn(
      { err, orgId, attachmentCount: ids.length },
      "[AIAttachments] DB query failed",
    );
    return attachmentError(
      "ATTACHMENT_NOT_FOUND",
      "Une ou plusieurs pièces jointes sont introuvables.",
      404,
    );
  }

  if (rows.length !== ids.length) {
    return attachmentError(
      "ATTACHMENT_NOT_FOUND",
      "Une ou plusieurs pièces jointes sont introuvables.",
      404,
    );
  }

  const resolved: ResolvedAIAttachment[] = [];
  let totalBytes = 0;

  for (const row of rows) {
    const name             = sanitizeFilename(String(row["name"] ?? ""));
    const declaredMimeType = String(row["type"] ?? "");

    // ── AI MIME/extension allowlist (stricter than team-files) ──────────────
    const resolvedMime = validateMimeExtConsistency(
      declaredMimeType, name, AI_ALLOWED_MIME, AI_EXT_TO_MIMES,
    );
    if (!resolvedMime) {
      return attachmentError(
        "ATTACHMENT_TYPE_NOT_ALLOWED",
        `Le type de fichier "${declaredMimeType}" n'est pas autorisé pour les pièces jointes IA.`,
        400,
      );
    }

    // ── Base64 validation ──────────────────────────────────────────────────
    // Strip data-URI prefix if present (same as team-files.ts upload logic).
    const rawContent = String(row["content"] ?? "");
    const b64        = rawContent.replace(/^data:[^;]+;base64,/, "");

    if (!isValidBase64(b64)) {
      logger.warn(
        { orgId, fileId: String(row["id"] ?? "") },
        "[AIAttachments] invalid base64 content in team_files record",
      );
      return attachmentError(
        "ATTACHMENT_CONTENT_INVALID",
        "Le contenu d'une pièce jointe est invalide.",
        400,
      );
    }

    // ── Individual size (server-derived — never trust DB size column) ────────
    const sizeBytes = Math.round(b64.length * 0.75);
    if (sizeBytes > AI_ATTACHMENT_LIMITS.maxFileSizeBytes) {
      return attachmentError(
        "ATTACHMENT_TOO_LARGE",
        `Une pièce jointe dépasse la limite de ${AI_ATTACHMENT_LIMITS.maxFileSizeBytes / 1024 / 1024} Mo.`,
        413,
      );
    }

    // ── Running total ─────────────────────────────────────────────────────
    totalBytes += sizeBytes;
    if (totalBytes > AI_ATTACHMENT_LIMITS.maxTotalSizeBytes) {
      return attachmentError(
        "ATTACHMENTS_TOTAL_TOO_LARGE",
        `La taille totale des pièces jointes dépasse ${AI_ATTACHMENT_LIMITS.maxTotalSizeBytes / 1024 / 1024} Mo.`,
        413,
      );
    }

    const extension = extractExtension(name);

    resolved.push({
      id:               String(row["id"] ?? ""),
      orgId:            String(row["org_id"] ?? orgId),
      name,
      declaredMimeType: resolvedMime,
      sizeBytes,
      contentBase64:    b64,
      extension,
    });
  }

  logger.info({
    orgId,
    attachmentCount:      resolved.length,
    attachmentTotalBytes: totalBytes,
    attachmentExtensions: resolved.map(f => f.extension),
  }, "[AIAttachments] resolved");

  return resolved;
}

// ── 3. validateResolvedAttachments ────────────────────────────────────────────
// Pure, synchronous. Runs aggregate checks after resolveAIAttachments.
// Individual size is already checked per-file in resolveAIAttachments.
// Returns null when everything is valid, or an AttachmentError otherwise.
//
// Future hook for Step 3B/3C: call detectRealMimeType(buffer) here before
// returning to detect magic-byte mismatches.
export function validateResolvedAttachments(
  files: ResolvedAIAttachment[],
): AttachmentError | null {
  const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  if (totalBytes > AI_ATTACHMENT_LIMITS.maxTotalSizeBytes) {
    return attachmentError(
      "ATTACHMENTS_TOTAL_TOO_LARGE",
      `La taille totale des pièces jointes dépasse ${AI_ATTACHMENT_LIMITS.maxTotalSizeBytes / 1024 / 1024} Mo.`,
      413,
    );
  }
  return null;
}

export { AI_ALLOWED_MIME, AI_ALLOWED_EXTENSIONS };
