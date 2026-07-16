/**
 * spreadsheet-parser.ts — Parse XLSX workbooks from a Buffer using ExcelJS.
 *
 * ExcelJS replaces SheetJS (xlsx@0.18.5 — 2 HIGH CVEs, no npm fix).
 * ExcelJS is loaded lazily (dynamic import) so it is never bundled into
 * dist/index.mjs and never initialised at server startup.
 *
 * XLS (legacy binary format, .xls) is NOT supported — callers should return 415.
 *
 * ExcelJS does NOT evaluate formulas — it reads cached cell values from the
 * file, with no re-computation. Formula cells return their stored result.
 *
 * Handles:
 *   - Dynamic module load failure (ATTACHMENT_PARSER_UNAVAILABLE / HTTP 503)
 *   - Invalid XLSX               (ATTACHMENT_SPREADSHEET_INVALID)
 *   - Empty XLSX                 (ATTACHMENT_SPREADSHEET_EMPTY)
 *   - Multiple sheets (limited to maxSheets)
 *   - Empty sheet skipping
 *   - Row and column limits per sheet
 *   - Formula cell neutralisation on output (prefix "'" to =+-@ cells)
 *   - Markdown table output per sheet
 */

export interface SheetResult {
  sheetName: string;
  headers:   string[];
  rows:      string[][];
  rowCount:  number;
  truncated: boolean;
  text:      string;
}

export type SpreadsheetParseErrorCode =
  | "ATTACHMENT_SPREADSHEET_INVALID"
  | "ATTACHMENT_SPREADSHEET_EMPTY"
  | "ATTACHMENT_PARSER_UNAVAILABLE";

export interface SpreadsheetParseError {
  error: SpreadsheetParseErrorCode;
}

// ── Lazy loader ───────────────────────────────────────────────────────────────

// Minimal ExcelJS surface we need — avoids importing the full type bundle
interface ExcelJSWorksheet {
  name: string;
  eachRow(opts: { includeEmpty: boolean }, cb: (row: { values: unknown[] }) => void): void;
}
interface ExcelJSWorkbook {
  worksheets: ExcelJSWorksheet[];
  xlsx: { load(buf: unknown): Promise<void> };
}
interface ExcelJSModule {
  Workbook: new () => ExcelJSWorkbook;
}

/**
 * Load ExcelJS on first use — NOT at module import time.
 * Returns the ExcelJS constructor or throws if the module is unavailable.
 */
async function loadExcelJS(): Promise<ExcelJSModule> {
  const mod = await import("exceljs");
  const m   = (mod.default ?? mod) as unknown;
  if (typeof (m as ExcelJSModule)?.Workbook !== "function") {
    throw new TypeError("exceljs: Workbook constructor not found");
  }
  return m as ExcelJSModule;
}

// ── Cell value helpers ────────────────────────────────────────────────────────

const FORMULA_NEUTRALIZE_RE = /^[=+\-@]/;

function getCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ("result"   in v) return getCellText(v["result"]);
    if ("richText" in v) {
      return (v["richText"] as Array<{ text: string }>).map(r => r.text).join("");
    }
    if ("text"  in v) return getCellText(v["text"]);
    if ("error" in v) return String(v["error"]);
  }
  return String(value);
}

function neutralizeCell(value: unknown): string {
  const s = getCellText(value);
  return FORMULA_NEUTRALIZE_RE.test(s) ? "'" + s : s;
}

// ── Markdown table builder ────────────────────────────────────────────────────

function buildMarkdownTable(headers: string[], rows: string[][]): string {
  if (headers.length === 0) return "";
  const header    = "| " + headers.join(" | ") + " |";
  const separator = "| " + headers.map(() => "---").join(" | ") + " |";
  const body      = rows.map(row => {
    const padded = [...row];
    while (padded.length < headers.length) padded.push("");
    return "| " + padded.join(" | ") + " |";
  });
  return [header, separator, ...body].join("\n");
}

// ── Main parser ───────────────────────────────────────────────────────────────

/**
 * Parse an XLSX buffer and return per-sheet Markdown tables.
 *
 * Lazy-loads ExcelJS on first call — returns ATTACHMENT_PARSER_UNAVAILABLE (503)
 * if the module cannot be loaded.
 */
export async function parseSpreadsheetBuffer(
  buf:       Buffer,
  maxSheets: number,
  maxRows:   number,
  maxCols:   number,
  maxChars:  number,
): Promise<SheetResult[] | SpreadsheetParseError> {
  // ── Lazy module load ───────────────────────────────────────────────────────
  let ExcelJS: ExcelJSModule;
  try {
    ExcelJS = await loadExcelJS();
  } catch {
    return { error: "ATTACHMENT_PARSER_UNAVAILABLE" };
  }

  // ── Load workbook ──────────────────────────────────────────────────────────
  const wb = new ExcelJS.Workbook();
  try {
    // Cast required: @types/node@20+ types Buffer<ArrayBufferLike> which is
    // not structurally assignable to ExcelJS's unparameterised Buffer type.
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    return { error: "ATTACHMENT_SPREADSHEET_INVALID" };
  }

  if (wb.worksheets.length === 0) {
    return { error: "ATTACHMENT_SPREADSHEET_EMPTY" };
  }

  const results: SheetResult[] = [];
  const sheets  = wb.worksheets.slice(0, maxSheets);

  for (const ws of sheets) {
    const aoa: unknown[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-indexed — index 0 is always undefined
      aoa.push((row.values as unknown[]).slice(1));
    });

    if (aoa.length === 0) continue;

    const [rawHeader, ...rawData] = aoa;
    if (!rawHeader || (rawHeader as unknown[]).length === 0) continue;

    const headers      = (rawHeader as unknown[]).slice(0, maxCols).map(neutralizeCell);
    const totalRows    = rawData.length;
    const truncatedRows = totalRows > maxRows;
    const limitedRows  = rawData
      .slice(0, maxRows)
      .map(row => (row as unknown[]).slice(0, maxCols).map(neutralizeCell));

    let text = `## Feuille : ${ws.name}\n\n` + buildMarkdownTable(headers, limitedRows);
    const truncatedChars = text.length > maxChars;
    if (truncatedChars) text = text.slice(0, maxChars);

    results.push({
      sheetName: ws.name,
      headers,
      rows:      limitedRows,
      rowCount:  totalRows,
      truncated: truncatedRows || truncatedChars,
      text,
    });
  }

  if (results.length === 0) {
    return { error: "ATTACHMENT_SPREADSHEET_EMPTY" };
  }

  return results;
}
