/**
 * spreadsheet-parser.ts — Parse XLSX workbooks from a Buffer using ExcelJS.
 *
 * ExcelJS replaces SheetJS (xlsx@0.18.5) which had 2 HIGH CVEs with no npm fix.
 * ExcelJS is MIT-licenced, actively maintained, and does NOT evaluate formulas
 * — it reads cached cell values from the file, with no re-computation.
 *
 * XLS (legacy binary format, .xls) is NOT supported — callers should return 415.
 *
 * Handles:
 *   - Multiple sheets (limited to maxSheets)
 *   - Empty sheet skipping
 *   - Row and column limits per sheet
 *   - Formula cells: cached result is used, formula string is never executed
 *   - Formula neutralisation on output (prefix "'" to cells starting with =+-@)
 *   - Markdown table output per sheet
 *   - Invalid XLSX → ATTACHMENT_SPREADSHEET_INVALID (distinct from empty)
 *   - Empty XLSX → ATTACHMENT_SPREADSHEET_EMPTY (distinct from invalid)
 */

import ExcelJS from "exceljs";

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
  | "ATTACHMENT_SPREADSHEET_EMPTY";

export interface SpreadsheetParseError {
  error: SpreadsheetParseErrorCode;
}

// ── Cell value helpers ────────────────────────────────────────────────────────

type CellVal = ExcelJS.CellValue;

function getCellText(value: CellVal): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    // Formula: { formula: "=A1+B1", result: 42 }
    if ("result" in value) {
      return getCellText((value as ExcelJS.CellFormulaValue).result as CellVal);
    }
    // RichText: { richText: [{ text: "..." }] }
    if ("richText" in value) {
      return (value as ExcelJS.CellRichTextValue).richText.map(r => r.text).join("");
    }
    // Hyperlink: { text: "...", hyperlink: "..." }
    if ("text" in value) {
      return getCellText((value as ExcelJS.CellHyperlinkValue).text as CellVal);
    }
    // Error: { error: "#REF!" }
    if ("error" in value) {
      return String((value as { error: string }).error);
    }
  }
  return String(value);
}

const FORMULA_NEUTRALIZE_RE = /^[=+\-@]/;

function neutralizeCell(value: CellVal): string {
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
 * Formula cells are read as their cached values — no formula re-evaluation occurs.
 * The formula neutralisation pass adds "'" to any cell whose string value starts
 * with =, +, -, or @ before writing it to the output text.
 */
export async function parseSpreadsheetBuffer(
  buf:       Buffer,
  maxSheets: number,
  maxRows:   number,
  maxCols:   number,
  maxChars:  number,
): Promise<SheetResult[] | SpreadsheetParseError> {
  const wb = new ExcelJS.Workbook();
  try {
    // ExcelJS.xlsx.load accepts Buffer | ArrayBuffer. Cast required because
    // @types/node@20+ types Buffer as Buffer<ArrayBufferLike> which breaks
    // structural assignment against ExcelJS's unparameterised Buffer type.
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
    // Collect all rows as arrays of CellValue
    const aoa: CellVal[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      // row.values is 1-indexed; index 0 is always undefined
      const vals = (row.values as CellVal[]).slice(1);
      aoa.push(vals);
    });

    if (aoa.length === 0) continue;

    const [rawHeader, ...rawData] = aoa;
    if (!rawHeader || rawHeader.length === 0) continue;

    const headers      = rawHeader.slice(0, maxCols).map(neutralizeCell);
    const totalRows    = rawData.length;
    const truncatedRows = totalRows > maxRows;
    const limitedRows  = rawData
      .slice(0, maxRows)
      .map(row => row.slice(0, maxCols).map(neutralizeCell));

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
