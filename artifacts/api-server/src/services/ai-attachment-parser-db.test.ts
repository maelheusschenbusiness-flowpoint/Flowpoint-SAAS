/**
 * ai-attachment-parser-db.test.ts — DB integration tests for parseAIAttachments.
 *
 * Inserts real files into team_files, resolves them with resolveAIAttachments,
 * then parses them with parseAIAttachments.
 *
 * Isolation:
 *   - Each test run uses unique org_id (timestamp-based).
 *   - Test rows are deleted in afterAll via DELETE WHERE org_id.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ── Use real @workspace/db ───────────────────────────────────────────────────
vi.mock("@workspace/db", async (importOriginal) => {
  return importOriginal<typeof import("@workspace/db")>();
});

vi.mock("./store.js", () => ({
  store: {
    me: { plan: null, email: null, name: null },
    broadcast:           vi.fn(),
    addSseClient:        vi.fn(),
    removeSseClient:     vi.fn(),
    broadcastPlanUpdate: vi.fn(),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import * as XLSX from "xlsx";
import { pool, withOrgDb }    from "@workspace/db";
import { resolveAIAttachments, type OrgDb } from "./ai-attachments.js";
import { parseAIAttachments, getDefaultParserLimits } from "./ai-attachment-parser.js";

// ── Unique org for test isolation ────────────────────────────────────────────
const orgId  = `test-parser-${Date.now()}`;
const limits = getDefaultParserLimits(1.0);

let fileIdTxt  = "";
let fileIdJson = "";
let fileIdCsv  = "";
let fileIdXlsx = "";
let fileIdPng  = "";

function b64(s: string): string {
  return Buffer.from(s, "utf-8").toString("base64");
}

function padB64(s: string): string {
  // Ensure valid base64 padding (multiple of 4 chars)
  while (s.length % 4 !== 0) s += "=";
  return s;
}

function makeXlsxB64(): string {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([["Produit", "Ventes"], ["Widget", 1500], ["Gadget", 800]]);
  XLSX.utils.book_append_sheet(wb, ws, "Données");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return Buffer.from(buf).toString("base64");
}

// Minimal valid PNG header (8 bytes) padded to valid base64
function fakePngB64(): string {
  const pngHeader = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  return pngHeader.toString("base64");
}

function makeOrgDb(oid: string): OrgDb {
  return async (sql: string, values?: unknown[]) => {
    const result = await withOrgDb(oid, (client) =>
      values !== undefined ? client.query(sql, values as unknown[]) : client.query(sql),
    );
    return { rows: result.rows as Record<string, unknown>[] };
  };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  fileIdTxt  = `f_txt_${Date.now()}`;
  fileIdJson = `f_json_${Date.now()}`;
  fileIdCsv  = `f_csv_${Date.now()}`;
  fileIdXlsx = `f_xlsx_${Date.now()}`;
  fileIdPng  = `f_png_${Date.now()}`;

  const txtContent  = b64("Bonjour, ceci est un fichier texte de test.\nDeuxième ligne.");
  const jsonContent = b64(JSON.stringify({ titre: "Test", valeur: 42, note: "aucune" }));
  const csvContent  = b64("produit,prix,stock\nWidget,9.99,100\nGadget,19.99,50\n");
  const xlsxContent = makeXlsxB64();
  const pngContent  = fakePngB64();

  await pool.query(
    `INSERT INTO team_files (id, org_id, name, type, size, content, shared_by, created_at) VALUES
     ($1, $2, 'notes.txt',   'text/plain',       100, $3,  'Test', NOW()),
     ($4, $2, 'data.json',   'application/json', 200, $5,  'Test', NOW()),
     ($6, $2, 'report.csv',  'text/csv',         300, $7,  'Test', NOW()),
     ($8, $2, 'sheet.xlsx',  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 400, $9,  'Test', NOW()),
     ($10, $2, 'photo.png',  'image/png',        500, $11, 'Test', NOW())`,
    [
      fileIdTxt,  orgId, txtContent,
      fileIdJson, orgId, jsonContent,
      fileIdCsv,  orgId, csvContent,
      fileIdXlsx, orgId, xlsxContent,
      fileIdPng,  orgId, pngContent,
    ],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM team_files WHERE org_id = $1", [orgId]);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("parseAIAttachments — DB integration", () => {
  it("J — parses TXT file from team_files", async () => {
    const orgDb = makeOrgDb(orgId);
    const resolved = await resolveAIAttachments(orgDb, orgId, [{ fileId: fileIdTxt }]);
    expect(Array.isArray(resolved)).toBe(true);

    const parsed = await parseAIAttachments(resolved as Parameters<typeof parseAIAttachments>[0], limits);
    expect(Array.isArray(parsed)).toBe(true);
    if (Array.isArray(parsed)) {
      expect(parsed[0]?.category).toBe("text");
      expect(parsed[0]?.extractedText).toContain("Bonjour");
    }
  });

  it("J — parses JSON file from team_files", async () => {
    const orgDb = makeOrgDb(orgId);
    const resolved = await resolveAIAttachments(orgDb, orgId, [{ fileId: fileIdJson }]);
    expect(Array.isArray(resolved)).toBe(true);

    const parsed = await parseAIAttachments(resolved as Parameters<typeof parseAIAttachments>[0], limits);
    expect(Array.isArray(parsed)).toBe(true);
    if (Array.isArray(parsed)) {
      expect(parsed[0]?.category).toBe("json");
      expect(parsed[0]?.extractedText).toContain("titre");
    }
  });

  it("J — parses CSV file from team_files", async () => {
    const orgDb = makeOrgDb(orgId);
    const resolved = await resolveAIAttachments(orgDb, orgId, [{ fileId: fileIdCsv }]);
    expect(Array.isArray(resolved)).toBe(true);

    const parsed = await parseAIAttachments(resolved as Parameters<typeof parseAIAttachments>[0], limits);
    expect(Array.isArray(parsed)).toBe(true);
    if (Array.isArray(parsed)) {
      expect(parsed[0]?.category).toBe("csv");
      expect(parsed[0]?.extractedText).toContain("produit");
      expect(parsed[0]?.extractedText).toContain("Widget");
    }
  });

  it("J — parses XLSX file from team_files", async () => {
    const orgDb = makeOrgDb(orgId);
    const resolved = await resolveAIAttachments(orgDb, orgId, [{ fileId: fileIdXlsx }]);
    expect(Array.isArray(resolved)).toBe(true);

    const parsed = await parseAIAttachments(resolved as Parameters<typeof parseAIAttachments>[0], limits);
    expect(Array.isArray(parsed)).toBe(true);
    if (Array.isArray(parsed)) {
      expect(parsed[0]?.category).toBe("spreadsheet");
      expect(parsed[0]?.extractedText).toContain("Produit");
    }
  });

  it("J — returns 415 for PNG image attachment", async () => {
    const orgDb = makeOrgDb(orgId);
    const resolved = await resolveAIAttachments(orgDb, orgId, [{ fileId: fileIdPng }]);
    expect(Array.isArray(resolved)).toBe(true);

    const parsed = await parseAIAttachments(resolved as Parameters<typeof parseAIAttachments>[0], limits);
    expect("code" in parsed).toBe(true);
    if ("code" in parsed) {
      expect(parsed.code).toBe("ATTACHMENT_FORMAT_NOT_SUPPORTED_YET");
      expect(parsed.httpStatus).toBe(415);
    }
  });

  it("J — parses multiple files in one call", async () => {
    const orgDb = makeOrgDb(orgId);
    const resolved = await resolveAIAttachments(orgDb, orgId, [
      { fileId: fileIdTxt },
      { fileId: fileIdJson },
    ]);
    expect(Array.isArray(resolved)).toBe(true);

    const parsed = await parseAIAttachments(resolved as Parameters<typeof parseAIAttachments>[0], limits);
    expect(Array.isArray(parsed)).toBe(true);
    if (Array.isArray(parsed)) expect(parsed).toHaveLength(2);
  });
});
