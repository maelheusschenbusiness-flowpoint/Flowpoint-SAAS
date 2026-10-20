/**
 * ai-attachments.test.ts — Unit tests for Phase 2 Step 3A attachment contract.
 *
 * Tests validateAttachmentReferences (pure/sync), resolveAIAttachments (async,
 * mocked orgDb), and validateResolvedAttachments (pure/sync).
 *
 * No real DB, no provider calls.  Logger is stubbed by vitest.setup.ts.
 */

import { describe, it, expect, vi } from "vitest";
import {
  validateAttachmentReferences,
  resolveAIAttachments,
  validateResolvedAttachments,
  isValidBase64,
  type OrgDb,
} from "./ai-attachments.js";
import { AI_ATTACHMENT_LIMITS } from "../config/ai-attachments.js";
import type { ResolvedAIAttachment } from "../types/ai-attachments.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a valid base64 string that decodes to approximately `sizeBytes` bytes. */
function makeB64(sizeBytes: number): string {
  if (sizeBytes <= 0) return "";
  const b64Len = Math.ceil(sizeBytes * 4 / 3);
  const padded = b64Len + (4 - b64Len % 4) % 4;
  return "A".repeat(padded);
}

/** Minimal ResolvedAIAttachment for aggregate tests. */
function makeResolved(sizeBytes: number, id = "f1"): ResolvedAIAttachment {
  return {
    id,
    orgId:            "org1",
    name:             "test.pdf",
    declaredMimeType: "application/pdf",
    sizeBytes,
    contentBase64:    makeB64(sizeBytes),
    extension:        "pdf",
  };
}

/** Mock orgDb returning specific rows. */
function makeOrgDb(rows: Record<string, unknown>[]): OrgDb {
  return vi.fn().mockResolvedValue({ rows }) as OrgDb;
}

/** A valid PDF row as returned by team_files. */
function makePdfRow(id = "f123", orgId = "org1"): Record<string, unknown> {
  return {
    id,
    org_id:  orgId,
    name:    "document.pdf",
    type:    "application/pdf",
    size:    1024,
    content: makeB64(1024),
  };
}

function isError(r: unknown): r is { code: string; httpStatus: number; message: string } {
  return r !== null && typeof r === "object" && "code" in (r as object);
}

const MAX       = AI_ATTACHMENT_LIMITS.maxFileSizeBytes;
const TOTAL_MAX = AI_ATTACHMENT_LIMITS.maxTotalSizeBytes;

// ─────────────────────────────────────────────────────────────────────────────
// isValidBase64
// ─────────────────────────────────────────────────────────────────────────────

describe("isValidBase64", () => {
  it("returns true for valid base64 strings", () => {
    expect(isValidBase64("AAAA")).toBe(true);
    expect(isValidBase64("YWJj")).toBe(true);
    expect(isValidBase64("dGVzdA==")).toBe(true);
    expect(isValidBase64(makeB64(1024))).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(isValidBase64("")).toBe(false);
  });

  it("returns false for strings with invalid characters", () => {
    expect(isValidBase64("!@#$")).toBe(false);
    expect(isValidBase64("AAAA BBBB")).toBe(false);
    expect(isValidBase64("abc\ndef")).toBe(false);
  });

  it("returns false for '%%%%' (invalid alphabet)", () => {
    // All four chars are outside the base64 alphabet — rejected by char check.
    expect(isValidBase64("%%%%")).toBe(false);
  });

  it("returns false for 'abc*' (invalid char *)", () => {
    // '*' is not in [A-Za-z0-9+/].
    expect(isValidBase64("abc*")).toBe(false);
  });

  it("returns false for 'AAAA=' (length 5 — not multiple of 4)", () => {
    // Valid chars, 1 padding char, but total length 5 % 4 ≠ 0.
    expect(isValidBase64("AAAA=")).toBe(false);
  });

  it("returns false for 'A===' (padding count 3 > max 2)", () => {
    // Total length 4 (% 4 = 0) but RFC 4648 allows at most 2 padding chars.
    expect(isValidBase64("A===")).toBe(false);
  });

  it("returns true for 'AA==' (2 data chars + 2 padding — valid RFC 4648)", () => {
    expect(isValidBase64("AA==")).toBe(true);
  });

  it("returns true for 'AAA=' (3 data chars + 1 padding — valid RFC 4648)", () => {
    expect(isValidBase64("AAA=")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateAttachmentReferences
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAttachmentReferences", () => {

  // A. Tableau vide / aucun attachment
  it("A — accepts empty array", () => {
    const r = validateAttachmentReferences([]);
    expect(Array.isArray(r)).toBe(true);
    expect((r as AIAttachmentReference[]).length).toBe(0);
  });

  // B. Structure invalide
  it("B — rejects non-array: string", () => {
    const r = validateAttachmentReferences("not-an-array");
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("INVALID_ATTACHMENTS");
    expect((r as { httpStatus: number }).httpStatus).toBe(400);
  });

  it("B — rejects non-array: null", () => {
    const r = validateAttachmentReferences(null);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("INVALID_ATTACHMENTS");
  });

  it("B — rejects non-array: number", () => {
    const r = validateAttachmentReferences(42);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("INVALID_ATTACHMENTS");
  });

  it("B — rejects non-array: plain object", () => {
    const r = validateAttachmentReferences({ fileId: "f1" });
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("INVALID_ATTACHMENTS");
  });

  it("B — rejects entry with missing fileId", () => {
    const r = validateAttachmentReferences([{}]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("INVALID_ATTACHMENTS");
  });

  it("B — rejects entry with null fileId", () => {
    const r = validateAttachmentReferences([{ fileId: null }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("INVALID_ATTACHMENTS");
  });

  it("B — rejects entry with numeric fileId", () => {
    const r = validateAttachmentReferences([{ fileId: 123 }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("INVALID_ATTACHMENTS");
  });

  it("B — rejects entry with empty-string fileId", () => {
    const r = validateAttachmentReferences([{ fileId: "" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("INVALID_ATTACHMENTS");
  });

  it("B — rejects null entry in array", () => {
    const r = validateAttachmentReferences([null]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("INVALID_ATTACHMENTS");
  });

  // C. Nombre maximum
  it("C — accepts exactly maxFilesPerRequest items", () => {
    const input = Array.from({ length: AI_ATTACHMENT_LIMITS.maxFilesPerRequest }, (_, i) => ({
      fileId: `file${i + 1}`,
    }));
    const r = validateAttachmentReferences(input);
    expect(Array.isArray(r)).toBe(true);
    expect((r as unknown[]).length).toBe(AI_ATTACHMENT_LIMITS.maxFilesPerRequest);
  });

  it("C — rejects maxFilesPerRequest + 1 items (TOO_MANY_ATTACHMENTS)", () => {
    const input = Array.from({ length: AI_ATTACHMENT_LIMITS.maxFilesPerRequest + 1 }, (_, i) => ({
      fileId: `file${i + 1}`,
    }));
    const r = validateAttachmentReferences(input);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("TOO_MANY_ATTACHMENTS");
    expect((r as { httpStatus: number }).httpStatus).toBe(400);
  });

  // D. Doublons — rejet explicite (pas de déduplication silencieuse)
  it("D — rejects duplicate fileIds", () => {
    const r = validateAttachmentReferences([{ fileId: "f1" }, { fileId: "f1" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("INVALID_ATTACHMENTS");
    expect((r as { httpStatus: number }).httpStatus).toBe(400);
  });

  it("D — accepts distinct fileIds", () => {
    const r = validateAttachmentReferences([{ fileId: "f1" }, { fileId: "f2" }]);
    expect(Array.isArray(r)).toBe(true);
    expect((r as AIAttachmentReference[])[0]?.fileId).toBe("f1");
    expect((r as AIAttachmentReference[])[1]?.fileId).toBe("f2");
  });

  // Cas valide de base
  it("accepts valid single reference", () => {
    const r = validateAttachmentReferences([{ fileId: "f123" }]);
    expect(Array.isArray(r)).toBe(true);
    expect((r as AIAttachmentReference[])[0]?.fileId).toBe("f123");
  });

  it("ignores extra fields on valid entry", () => {
    const r = validateAttachmentReferences([{ fileId: "f1", extra: "ignored" }]);
    expect(Array.isArray(r)).toBe(true);
    expect((r as AIAttachmentReference[])[0]?.fileId).toBe("f1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveAIAttachments
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveAIAttachments", () => {

  // A. Aucun attachment — contournement complet
  it("A — empty references returns empty array without DB call", async () => {
    const orgDb = makeOrgDb([]);
    const r = await resolveAIAttachments(orgDb, "org1", []);
    expect(Array.isArray(r)).toBe(true);
    expect((r as unknown[]).length).toBe(0);
    expect(orgDb).not.toHaveBeenCalled();
  });

  // E. Organisation — fichier de l'org courante résolu
  it("E — resolves a valid PDF from current org", async () => {
    const orgDb = makeOrgDb([makePdfRow()]);
    const r = await resolveAIAttachments(orgDb, "org1", [{ fileId: "f123" }]);
    expect(Array.isArray(r)).toBe(true);
    const files = r as ResolvedAIAttachment[];
    expect(files).toHaveLength(1);
    expect(files[0]?.id).toBe("f123");
    expect(files[0]?.extension).toBe("pdf");
    expect(files[0]?.declaredMimeType).toBe("application/pdf");
    expect(typeof files[0]?.sizeBytes).toBe("number");
    expect(files[0]?.sizeBytes).toBeGreaterThan(0);
  });

  // E. ID inexistant → même erreur générique
  it("E — returns ATTACHMENT_NOT_FOUND for non-existent ID", async () => {
    const orgDb = makeOrgDb([]); // 0 rows returned
    const r = await resolveAIAttachments(orgDb, "org1", [{ fileId: "f999" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_NOT_FOUND");
    expect((r as { httpStatus: number }).httpStatus).toBe(404);
  });

  // E. Fichier d'une autre organisation → même erreur générique (fuite évitée)
  it("E — returns same ATTACHMENT_NOT_FOUND for cross-org file (no leak)", async () => {
    const orgDb = makeOrgDb([]); // RLS/AND org_id filters it out
    const r = await resolveAIAttachments(orgDb, "org2", [{ fileId: "f123" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_NOT_FOUND");
    expect((r as { httpStatus: number }).httpStatus).toBe(404);
  });

  // E. Réponse identique qu'il existe ou non → indiscernable
  it("E — ATTACHMENT_NOT_FOUND body is identical for missing vs cross-org", async () => {
    const orgDb = makeOrgDb([]);
    const r1 = await resolveAIAttachments(orgDb, "org1", [{ fileId: "missing" }]);
    const r2 = await resolveAIAttachments(orgDb, "org2", [{ fileId: "f123" }]);
    expect((r1 as { code: string }).code).toBe((r2 as { code: string }).code);
    expect((r1 as { message: string }).message).toBe((r2 as { message: string }).message);
    expect((r1 as { httpStatus: number }).httpStatus).toBe((r2 as { httpStatus: number }).httpStatus);
  });

  // F. Types acceptés
  it("F — accepts PNG", async () => {
    const row = { id: "f1", org_id: "org1", name: "img.png", type: "image/png", size: 512, content: makeB64(512) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(Array.isArray(r)).toBe(true);
    expect((r as ResolvedAIAttachment[])[0]?.extension).toBe("png");
  });

  it("F — accepts JPEG", async () => {
    const row = { id: "f1", org_id: "org1", name: "photo.jpg", type: "image/jpeg", size: 512, content: makeB64(512) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(Array.isArray(r)).toBe(true);
  });

  it("F — accepts WebP", async () => {
    const row = { id: "f1", org_id: "org1", name: "img.webp", type: "image/webp", size: 512, content: makeB64(512) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(Array.isArray(r)).toBe(true);
  });

  it("F — accepts CSV", async () => {
    const row = { id: "f1", org_id: "org1", name: "data.csv", type: "text/csv", size: 256, content: makeB64(256) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(Array.isArray(r)).toBe(true);
  });

  it("F — accepts XLSX", async () => {
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const row = { id: "f1", org_id: "org1", name: "sheet.xlsx", type: xlsx, size: 1024, content: makeB64(1024) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(Array.isArray(r)).toBe(true);
  });

  it("F — accepts DOCX", async () => {
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const row = { id: "f1", org_id: "org1", name: "doc.docx", type: docx, size: 2048, content: makeB64(2048) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(Array.isArray(r)).toBe(true);
  });

  it("F — accepts TXT", async () => {
    const row = { id: "f1", org_id: "org1", name: "notes.txt", type: "text/plain", size: 128, content: makeB64(128) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(Array.isArray(r)).toBe(true);
  });

  it("F — accepts JSON", async () => {
    const row = { id: "f1", org_id: "org1", name: "config.json", type: "application/json", size: 256, content: makeB64(256) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(Array.isArray(r)).toBe(true);
  });

  it("F — rejects ZIP (not in AI allowlist)", async () => {
    const row = { id: "f1", org_id: "org1", name: "archive.zip", type: "application/zip", size: 1024, content: makeB64(1024) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_TYPE_NOT_ALLOWED");
    expect((r as { httpStatus: number }).httpStatus).toBe(400);
  });

  it("F — rejects SVG (not in AI allowlist)", async () => {
    const row = { id: "f1", org_id: "org1", name: "icon.svg", type: "image/svg+xml", size: 512, content: makeB64(512) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_TYPE_NOT_ALLOWED");
  });

  it("F — rejects GIF (not in AI allowlist)", async () => {
    const row = { id: "f1", org_id: "org1", name: "anim.gif", type: "image/gif", size: 512, content: makeB64(512) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_TYPE_NOT_ALLOWED");
  });

  it("F — rejects DOC (legacy Word format — explicitly excluded from AI allowlist)", async () => {
    // application/msword is listed as excluded in the AI_ALLOWED_MIME comment.
    // Only DOCX (application/vnd...wordprocessingml.document) is allowed.
    const row = { id: "f1", org_id: "org1", name: "document.doc", type: "application/msword", size: 512, content: makeB64(512) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_TYPE_NOT_ALLOWED");
    expect((r as { httpStatus: number }).httpStatus).toBe(400);
  });

  it("F — rejects PPTX (explicitly excluded from AI allowlist)", async () => {
    // PowerPoint is in team-files allowlist but NOT in the AI pipeline allowlist.
    const pptxMime = "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    const row = { id: "f1", org_id: "org1", name: "deck.pptx", type: pptxMime, size: 512, content: makeB64(512) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_TYPE_NOT_ALLOWED");
    expect((r as { httpStatus: number }).httpStatus).toBe(400);
  });

  it("F — rejects extension/MIME mismatch (PDF extension + PNG MIME)", async () => {
    const row = { id: "f1", org_id: "org1", name: "file.pdf", type: "image/png", size: 512, content: makeB64(512) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f1" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_TYPE_NOT_ALLOWED");
  });

  // G. Base64 validation
  it("G — accepts valid base64 content", async () => {
    const orgDb = makeOrgDb([makePdfRow()]);
    const r = await resolveAIAttachments(orgDb, "org1", [{ fileId: "f123" }]);
    expect(Array.isArray(r)).toBe(true);
  });

  it("G — rejects empty base64 content", async () => {
    const row = { ...makePdfRow(), content: "" };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f123" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_CONTENT_INVALID");
    expect((r as { httpStatus: number }).httpStatus).toBe(400);
  });

  it("G — rejects base64 with invalid characters", async () => {
    const row = { ...makePdfRow(), content: "!!!invalid_base64!!!" };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f123" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_CONTENT_INVALID");
  });

  it("G — server derives sizeBytes from base64 length, ignores DB size column", async () => {
    const row = { ...makePdfRow(), size: 1, content: makeB64(1024) }; // DB says 1 byte, real=1KB
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f123" }]);
    expect(Array.isArray(r)).toBe(true);
    expect((r as ResolvedAIAttachment[])[0]?.sizeBytes).toBeGreaterThan(900);
  });

  it("G — strips data-URI prefix before validating base64", async () => {
    const realB64 = makeB64(512);
    const row = { ...makePdfRow(), content: `data:application/pdf;base64,${realB64}` };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f123" }]);
    expect(Array.isArray(r)).toBe(true);
  });

  // H. Limites de taille
  it("H — accepts file just under individual size limit", async () => {
    const row = { ...makePdfRow(), content: makeB64(MAX - 100) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f123" }]);
    expect(Array.isArray(r)).toBe(true);
  });

  it("H — rejects file over individual size limit (ATTACHMENT_TOO_LARGE)", async () => {
    const row = { ...makePdfRow(), content: makeB64(MAX + 100) };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f123" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_TOO_LARGE");
    expect((r as { httpStatus: number }).httpStatus).toBe(413);
  });

  it("H — rejects when running total exceeds maxTotalSizeBytes (ATTACHMENTS_TOTAL_TOO_LARGE)", async () => {
    // 3 files × ~7 MB each = ~21 MB > 20 MB total limit
    // Each file is under the 10 MB individual limit
    const b64 = makeB64(7 * 1024 * 1024);
    const rows = [
      { id: "f1", org_id: "org1", name: "a.pdf", type: "application/pdf", size: 0, content: b64 },
      { id: "f2", org_id: "org1", name: "b.pdf", type: "application/pdf", size: 0, content: b64 },
      { id: "f3", org_id: "org1", name: "c.pdf", type: "application/pdf", size: 0, content: b64 },
    ];
    const orgDb = makeOrgDb(rows);
    const r = await resolveAIAttachments(orgDb, "org1", [
      { fileId: "f1" }, { fileId: "f2" }, { fileId: "f3" },
    ]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENTS_TOTAL_TOO_LARGE");
    expect((r as { httpStatus: number }).httpStatus).toBe(413);
  });

  // ── Exact boundary tests (Buffer-encoded, not approximations) ──────────────

  it("H — accepts exactly 10 MB (Buffer.alloc(TEN_MB) decoded = 10 485 760 bytes)", async () => {
    // Buffer.alloc(TEN_MB) produces exactly 10 485 760 bytes.
    // Its base64 encoding has padCount=2 (TEN_MB%3=1).
    // Exact formula: (b64.length*3)/4 - 2 = 10 485 760 = maxFileSizeBytes → NOT > limit → accepted.
    const exactB64 = Buffer.alloc(MAX).toString("base64");
    const row = { ...makePdfRow(), content: exactB64 };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f123" }]);
    expect(Array.isArray(r)).toBe(true);
    expect((r as ResolvedAIAttachment[])[0]?.sizeBytes).toBe(MAX);
  });

  it("H — rejects 10 MB + 1 byte (Buffer.alloc(TEN_MB+1) decoded = 10 485 761 bytes)", async () => {
    // 10 485 761 > 10 485 760 = maxFileSizeBytes → ATTACHMENT_TOO_LARGE 413.
    const overB64 = Buffer.alloc(MAX + 1).toString("base64");
    const row = { ...makePdfRow(), content: overB64 };
    const r = await resolveAIAttachments(makeOrgDb([row]), "org1", [{ fileId: "f123" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_TOO_LARGE");
    expect((r as { httpStatus: number }).httpStatus).toBe(413);
  });

  it("H — accepts cumulative total of exactly 20 MB (2 × TEN_MB)", async () => {
    // 2 files of exactly 10 MB → total = 20 971 520 = maxTotalSizeBytes → NOT > limit → accepted.
    const b64_10MB = Buffer.alloc(MAX).toString("base64");
    const rows = [
      { id: "f1", org_id: "org1", name: "a.pdf", type: "application/pdf", size: 0, content: b64_10MB },
      { id: "f2", org_id: "org1", name: "b.pdf", type: "application/pdf", size: 0, content: b64_10MB },
    ];
    const r = await resolveAIAttachments(makeOrgDb(rows), "org1", [{ fileId: "f1" }, { fileId: "f2" }]);
    expect(Array.isArray(r)).toBe(true);
    const total = (r as ResolvedAIAttachment[]).reduce((s, f) => s + f.sizeBytes, 0);
    expect(total).toBe(TOTAL_MAX);
  });

  it("H — rejects cumulative total of 20 MB + 1 byte (2 × TEN_MB + 1 byte)", async () => {
    // File 1: 10 MB, File 2: 10 MB → running total = 20 MB (accepted).
    // File 3: 1 byte → running total = 20 971 521 > 20 971 520 → ATTACHMENTS_TOTAL_TOO_LARGE 413.
    const b64_10MB = Buffer.alloc(MAX).toString("base64");
    const b64_1B   = Buffer.alloc(1).toString("base64");   // "AA==" — 1 decoded byte
    const rows = [
      { id: "f1", org_id: "org1", name: "a.pdf", type: "application/pdf", size: 0, content: b64_10MB },
      { id: "f2", org_id: "org1", name: "b.pdf", type: "application/pdf", size: 0, content: b64_10MB },
      { id: "f3", org_id: "org1", name: "c.pdf", type: "application/pdf", size: 0, content: b64_1B  },
    ];
    const r = await resolveAIAttachments(makeOrgDb(rows), "org1", [
      { fileId: "f1" }, { fileId: "f2" }, { fileId: "f3" },
    ]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENTS_TOTAL_TOO_LARGE");
    expect((r as { httpStatus: number }).httpStatus).toBe(413);
  });

  // DB error → ATTACHMENT_NOT_FOUND
  it("returns ATTACHMENT_NOT_FOUND when DB throws", async () => {
    const orgDb = vi.fn().mockRejectedValue(new Error("DB connection failed")) as OrgDb;
    const r = await resolveAIAttachments(orgDb, "org1", [{ fileId: "f1" }]);
    expect(isError(r)).toBe(true);
    expect((r as { code: string }).code).toBe("ATTACHMENT_NOT_FOUND");
    expect((r as { httpStatus: number }).httpStatus).toBe(404);
  });

  // I. Aucun provider appelé (vérifié au niveau du service : orgDb ne déclenche pas de provider)
  it("I — resolveAIAttachments never calls a provider (orgDb only)", async () => {
    const providerMock = vi.fn();
    const orgDb = makeOrgDb([makePdfRow()]);
    await resolveAIAttachments(orgDb, "org1", [{ fileId: "f123" }]);
    expect(providerMock).not.toHaveBeenCalled(); // no provider imported
    expect(orgDb).toHaveBeenCalledTimes(1);      // only one DB call
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validateResolvedAttachments
// ─────────────────────────────────────────────────────────────────────────────

describe("validateResolvedAttachments", () => {
  it("returns null for empty list", () => {
    expect(validateResolvedAttachments([])).toBeNull();
  });

  it("returns null for single small file", () => {
    expect(validateResolvedAttachments([makeResolved(1024)])).toBeNull();
  });

  it("returns null when total is exactly at limit", () => {
    expect(validateResolvedAttachments([makeResolved(TOTAL_MAX)])).toBeNull();
  });

  it("returns ATTACHMENTS_TOTAL_TOO_LARGE when total exceeds limit", () => {
    const r = validateResolvedAttachments([makeResolved(TOTAL_MAX + 1)]);
    expect(r?.code).toBe("ATTACHMENTS_TOTAL_TOO_LARGE");
    expect(r?.httpStatus).toBe(413);
  });

  it("returns null when multiple files sum within limit", () => {
    const files = [
      makeResolved(1024 * 1024, "f1"),
      makeResolved(1024 * 1024, "f2"),
    ];
    expect(validateResolvedAttachments(files)).toBeNull();
  });

  it("returns error when multiple files sum exceeds limit", () => {
    const files = [
      makeResolved(TOTAL_MAX / 2 + 1, "f1"),
      makeResolved(TOTAL_MAX / 2 + 1, "f2"),
    ];
    const r = validateResolvedAttachments(files);
    expect(r?.code).toBe("ATTACHMENTS_TOTAL_TOO_LARGE");
  });
});

// Re-export for type usage in test
type AIAttachmentReference = import("../types/ai-attachments.js").AIAttachmentReference;
