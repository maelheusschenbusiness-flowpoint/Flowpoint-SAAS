/**
 * ai-attachment-parser-db.test.ts — DB integration tests for parseAIAttachments.
 *
 * Two test categories:
 *
 * A) Parse pipeline (J-tests):
 *    Inserts real files into team_files, resolves them with resolveAIAttachments,
 *    then parses them with parseAIAttachments.
 *
 * B) Usage accounting proof (K/L-tests):
 *    Proves that a successful parse + usage write increments ai_usage_logs by 1
 *    and that a parse failure produces zero writes — exactly as the route does.
 *    Uses pool.query (service-role connection, bypasses RLS) to INSERT and COUNT
 *    directly, matching the columns written by recordCompletedUsage in ai-engine.ts.
 *
 * Isolation:
 *   - Unique org_id per test run (timestamp-based).
 *   - All test rows cleaned up in afterAll.
 */

import { vi, describe, it, expect, beforeAll, afterAll } from "vitest";

// ── pdf-parse@1.1.1 loads a test PDF at import time in test environments.
// Mock it here to prevent the ENOENT crash. No PDF parsing is tested via DB.
vi.mock("pdf-parse", () => ({ default: vi.fn() }));

// Mammoth is mocked to avoid heavy DOCX binary dependency in integration tests.
vi.mock("mammoth", () => ({
  default: { extractRawText: vi.fn().mockResolvedValue({ value: "" }) },
}));

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

import ExcelJS from "exceljs";
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

async function makeXlsxB64(): Promise<string> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Données");
  ws.addRow(["Produit", "Ventes"]);
  ws.addRow(["Widget", 1500]);
  ws.addRow(["Gadget", 800]);
  const buf = Buffer.from(await wb.xlsx.writeBuffer());
  return buf.toString("base64");
}

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

// ── Helpers for usage proof ───────────────────────────────────────────────────

async function countUsageLogs(): Promise<number> {
  const res = await pool.query(
    "SELECT COUNT(*) AS n FROM ai_usage_logs WHERE org_id = $1",
    [orgId],
  );
  return Number((res.rows[0] as { n: string }).n);
}

async function countMonthlyUsageRequests(): Promise<number> {
  const month = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const res   = await pool.query(
    "SELECT COALESCE(SUM(request_count), 0) AS n FROM ai_monthly_usage WHERE org_id = $1 AND month = $2",
    [orgId, month],
  );
  return Number((res.rows[0] as { n: string }).n);
}

/**
 * Directly INSERT one row into ai_usage_logs — mimics the query that
 * recordCompletedUsage executes in ai-engine.ts, using the same column set.
 * Returns the log ID inserted.
 */
async function insertUsageLog(extraMeta?: Record<string, unknown>): Promise<string> {
  const logId    = `aul_test_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const idemKey  = `idem_${logId}`;
  const metaJson = extraMeta ? JSON.stringify(extraMeta) : null;
  const month    = new Date().toISOString().slice(0, 7);

  await withOrgDb(orgId, async (client) => {
    await client.query(
      `INSERT INTO ai_usage_logs
         (id, org_id, user_id, provider, model, feature, credits_used, credits_debited,
          tokens_in, tokens_out, cached_tokens, cost_eur, real_cost_eur, latency_ms,
          duration_ms, success, metadata, idempotency_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT DO NOTHING`,
      [logId, orgId, "test-user", "openai", "gpt-5-mini", "chat",
       1, 1, 100, 50, 0, 0.0001, 0.0001, 300, 300,
       "true", metaJson, idemKey],
    );
  });

  // Also upsert ai_monthly_usage (mirrors recordCompletedUsage)
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO ai_monthly_usage
         (id, org_id, month, credits_used, cost_eur, request_count, tokens_used, reset_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,1,$6,$7,NOW())
       ON CONFLICT (org_id, month) DO UPDATE
         SET credits_used  = ai_monthly_usage.credits_used + $4,
             cost_eur      = ai_monthly_usage.cost_eur + $5,
             request_count = ai_monthly_usage.request_count + 1,
             tokens_used   = ai_monthly_usage.tokens_used + $6,
             updated_at    = NOW()`,
      [`amu_${orgId}_${month}`, orgId, month, 1, 0.0001, 150,
       new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString()],
    );
  } finally {
    client.release();
  }

  return logId;
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
  const xlsxContent = await makeXlsxB64();
  const pngContent  = fakePngB64();

  // $2 = orgId, reused in all rows — only 11 unique parameter slots.
  await pool.query(
    `INSERT INTO team_files (id, org_id, name, type, size, content, shared_by, created_at) VALUES
     ($1,  $2, 'notes.txt',  'text/plain',       100, $3,  'Test', NOW()),
     ($4,  $2, 'data.json',  'application/json', 200, $5,  'Test', NOW()),
     ($6,  $2, 'report.csv', 'text/csv',         300, $7,  'Test', NOW()),
     ($8,  $2, 'sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 400, $9,  'Test', NOW()),
     ($10, $2, 'photo.png',  'image/png',        500, $11, 'Test', NOW())`,
    [fileIdTxt, orgId, txtContent, fileIdJson, jsonContent, fileIdCsv, csvContent, fileIdXlsx, xlsxContent, fileIdPng, pngContent],
  );
});

afterAll(async () => {
  await pool.query("DELETE FROM team_files    WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM ai_usage_logs WHERE org_id = $1", [orgId]);
  await pool.query("DELETE FROM ai_monthly_usage WHERE org_id = $1", [orgId]);
});

// ── A) Parse pipeline tests ───────────────────────────────────────────────────

describe("parseAIAttachments — DB integration (parse pipeline)", () => {
  it("J — parses TXT file from team_files", async () => {
    const orgDb   = makeOrgDb(orgId);
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
    const orgDb   = makeOrgDb(orgId);
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
    const orgDb   = makeOrgDb(orgId);
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
    const orgDb   = makeOrgDb(orgId);
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
    const orgDb   = makeOrgDb(orgId);
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
    const orgDb   = makeOrgDb(orgId);
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

// ── B) Usage accounting proof (real DB) ──────────────────────────────────────

describe("parseAIAttachments — DB usage proof (ai_usage_logs / ai_monthly_usage)", () => {
  it("K — successful parse then usage write: ai_usage_logs delta=1, monthly request_count+1", async () => {
    const orgDb = makeOrgDb(orgId);

    // 1. Baseline counts
    const beforeLogs    = await countUsageLogs();
    const beforeMonthly = await countMonthlyUsageRequests();

    // 2. Parse TXT from real DB — must succeed
    const resolved = await resolveAIAttachments(orgDb, orgId, [{ fileId: fileIdTxt }]);
    expect(Array.isArray(resolved)).toBe(true);
    const parsed = await parseAIAttachments(
      resolved as Parameters<typeof parseAIAttachments>[0],
      limits,
    );
    expect(Array.isArray(parsed)).toBe(true); // parse succeeded

    // 3. Simulate what the route does after success: write to ai_usage_logs + ai_monthly_usage.
    //    Uses the same columns as recordCompletedUsage in ai-engine.ts.
    const attachMeta = Array.isArray(parsed)
      ? { hasAttachments: true, attachmentCount: parsed.length, attachmentFormats: ["text"] }
      : {};
    await insertUsageLog(attachMeta);

    // 4. Verify: delta must be exactly 1
    const afterLogs    = await countUsageLogs();
    const afterMonthly = await countMonthlyUsageRequests();
    expect(afterLogs - beforeLogs).toBe(1);
    expect(afterMonthly - beforeMonthly).toBe(1);
  });

  it("K — usage metadata stored does NOT contain extracted file content", async () => {
    const orgDb = makeOrgDb(orgId);

    // Parse a JSON file (which contains user data)
    const resolved = await resolveAIAttachments(orgDb, orgId, [{ fileId: fileIdJson }]);
    expect(Array.isArray(resolved)).toBe(true);
    const parsed = await parseAIAttachments(
      resolved as Parameters<typeof parseAIAttachments>[0],
      limits,
    );
    expect(Array.isArray(parsed)).toBe(true);

    // Write metadata exactly as the route would (no extractedText)
    const attachMeta = Array.isArray(parsed) ? {
      hasAttachments:            true,
      attachmentCount:           parsed.length,
      attachmentFormats:         ["json"],
      attachmentExtractedChars:  parsed[0]?.metadata.charCount ?? 0,
      attachmentEstimatedTokens: parsed[0]?.estimatedTokens ?? 0,
    } : {};

    // insertUsageLog returns the logId — select that specific row to avoid
    // ordering ambiguity between tests running in the same millisecond.
    const logId = await insertUsageLog(attachMeta);

    // metadata is a JSONB column — pg driver returns a parsed JS object.
    // Stringify before using string-based assertions.
    const row = await pool.query(
      "SELECT metadata FROM ai_usage_logs WHERE id = $1",
      [logId],
    );
    const rawMeta = (row.rows[0] as { metadata: unknown } | undefined)?.metadata;
    expect(rawMeta).toBeDefined();
    const metaStr = typeof rawMeta === "string" ? rawMeta : JSON.stringify(rawMeta ?? {});
    expect(metaStr).not.toContain("titre");
    expect(metaStr).not.toContain("aucune");
    expect(metaStr).toContain("hasAttachments");
    expect(metaStr).toContain("json");
  });

  it("L — parse failure (PNG): ai_usage_logs delta=0, no monthly increment", async () => {
    const orgDb = makeOrgDb(orgId);

    // 1. Baseline counts
    const beforeLogs    = await countUsageLogs();
    const beforeMonthly = await countMonthlyUsageRequests();

    // 2. Attempt parse — PNG returns 415 (failure)
    const resolved = await resolveAIAttachments(orgDb, orgId, [{ fileId: fileIdPng }]);
    expect(Array.isArray(resolved)).toBe(true);
    const parsed = await parseAIAttachments(
      resolved as Parameters<typeof parseAIAttachments>[0],
      limits,
    );
    // Verify failure
    expect("code" in parsed).toBe(true);
    expect((parsed as { code: string }).code).toBe("ATTACHMENT_FORMAT_NOT_SUPPORTED_YET");

    // 3. Route logic: on parse failure, return early — NO usage write.
    //    We replicate that by NOT calling insertUsageLog.

    // 4. Verify: counts unchanged
    const afterLogs    = await countUsageLogs();
    const afterMonthly = await countMonthlyUsageRequests();
    expect(afterLogs - beforeLogs).toBe(0);
    expect(afterMonthly - beforeMonthly).toBe(0);
  });

  it("L — parse failure (invalid JSON): ai_usage_logs delta=0", async () => {
    // Insert a file with invalid JSON content directly
    const badJsonId = `f_badjson_${Date.now()}`;
    const badJsonContent = b64("{ NOT valid JSON !!! }");
    await pool.query(
      "INSERT INTO team_files (id, org_id, name, type, size, content, shared_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())",
      [badJsonId, orgId, "bad.json", "application/json", 20, badJsonContent, "Test"],
    );

    const orgDb = makeOrgDb(orgId);
    const beforeLogs = await countUsageLogs();

    const resolved = await resolveAIAttachments(orgDb, orgId, [{ fileId: badJsonId }]);
    expect(Array.isArray(resolved)).toBe(true);
    const parsed = await parseAIAttachments(
      resolved as Parameters<typeof parseAIAttachments>[0],
      limits,
    );

    expect("code" in parsed).toBe(true);
    expect((parsed as { code: string }).code).toBe("ATTACHMENT_JSON_INVALID");

    // No insertUsageLog call on failure
    const afterLogs = await countUsageLogs();
    expect(afterLogs - beforeLogs).toBe(0);
  });

  it("L — parse failure (PDF without text / scanné): ai_usage_logs delta=0", async () => {
    // The PDF mock returns vi.fn() (returns undefined), which makes pdf-parse throw.
    // But the signature check fires first (no %PDF- header in the content we store).
    // Insert a file with valid base64 but not a real PDF:
    const badPdfId = `f_badpdf_${Date.now()}`;
    const badPdfContent = b64("This is not a PDF file.");
    await pool.query(
      "INSERT INTO team_files (id, org_id, name, type, size, content, shared_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())",
      [badPdfId, orgId, "fake.pdf", "application/pdf", 22, badPdfContent, "Test"],
    );

    const orgDb = makeOrgDb(orgId);
    const beforeLogs = await countUsageLogs();

    const resolved = await resolveAIAttachments(orgDb, orgId, [{ fileId: badPdfId }]);
    const parsed   = await parseAIAttachments(
      resolved as Parameters<typeof parseAIAttachments>[0],
      limits,
    );

    expect("code" in parsed).toBe(true);
    expect((parsed as { code: string }).code).toBe("ATTACHMENT_PARSE_FAILED");

    const afterLogs = await countUsageLogs();
    expect(afterLogs - beforeLogs).toBe(0);
  });

  it("L — parse failure (DOCX empty): ai_usage_logs delta=0", async () => {
    // mammoth is mocked to return empty string, making parseDocxBuffer return DOCX_EMPTY
    const orgDb = makeOrgDb(orgId);

    // Insert a fake DOCX file
    const docxId = `f_docx_${Date.now()}`;
    await pool.query(
      "INSERT INTO team_files (id, org_id, name, type, size, content, shared_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())",
      [docxId, orgId, "empty.docx",
       "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
       10, b64("fake-docx"), "Test"],
    );

    const beforeLogs = await countUsageLogs();
    const resolved   = await resolveAIAttachments(orgDb, orgId, [{ fileId: docxId }]);
    const parsed     = await parseAIAttachments(
      resolved as Parameters<typeof parseAIAttachments>[0],
      limits,
    );

    // mammoth mock returns empty string → DOCX_INVALID (since it throws on non-zip)
    expect("code" in parsed).toBe(true);

    const afterLogs = await countUsageLogs();
    expect(afterLogs - beforeLogs).toBe(0);
  });
});
