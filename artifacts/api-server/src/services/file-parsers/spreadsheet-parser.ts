/**
 * spreadsheet-parser.ts — Parse XLS / XLSX workbooks from a Buffer using SheetJS.
 *
 * Handles:
 *   - Multiple sheets (limited to maxSheets)
 *   - Empty sheet skipping
 *   - Formula neutralisation (raw value returned, not formula result)
 *   - Row and column limits per sheet
 *   - Markdown table output per sheet
 *   - Invalid workbook detection
 */

import * as XLSX from "xlsx";

export interface SheetResult {
  sheetName: string;
  headers:   string[];
  rows:      string[][];
  rowCount:  number;
  truncated: boolean;
  text:      string;
}

export interface SpreadsheetParseError {
  error: "ATTACHMENT_PARSE_FAILED" | "ATTACHMENT_TABLE_EMPTY";
}

const FORMULA_RE = /^=/;

function neutralizeCell(raw: unknown): string {
  const s = String(raw ?? "");
  return FORMULA_RE.test(s) ? "'" + s : s;
}

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

/**
 * Parse a spreadsheet buffer (XLS or XLSX) and return per-sheet Markdown tables.
 * Formulas are NOT evaluated — cells containing formulas are neutralised.
 */
export function parseSpreadsheetBuffer(
  buf:       Buffer,
  maxSheets: number,
  maxRows:   number,
  maxCols:   number,
  maxChars:  number,
): SheetResult[] | SpreadsheetParseError {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, {
      type:        "buffer",
      cellFormula: false,
      cellHTML:    false,
    });
  } catch {
    return { error: "ATTACHMENT_PARSE_FAILED" };
  }

  // Treat workbooks with no sheets as parse failures (XLSX.read can silently
  // succeed on some non-XLSX buffers and return an empty SheetNames array).
  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    return { error: "ATTACHMENT_PARSE_FAILED" };
  }

  const results: SheetResult[] = [];
  const sheetNames = (wb.SheetNames ?? []).slice(0, maxSheets);

  for (const sheetName of sheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;

    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      defval: "",
      raw:    false,
    });

    if (aoa.length === 0) continue;

    const [rawHeader, ...rawData] = aoa;
    if (!rawHeader || (rawHeader as unknown[]).length === 0) continue;

    const headers   = (rawHeader as unknown[]).slice(0, maxCols).map(neutralizeCell);
    const totalRows = rawData.length;
    const truncatedRows = totalRows > maxRows;
    const limitedRows   = rawData
      .slice(0, maxRows)
      .map(row => (row as unknown[]).slice(0, maxCols).map(neutralizeCell));

    let text = `## Feuille : ${sheetName}\n\n` + buildMarkdownTable(headers, limitedRows);
    const truncatedChars = text.length > maxChars;
    if (truncatedChars) {
      text = text.slice(0, maxChars);
    }

    results.push({
      sheetName,
      headers,
      rows:      limitedRows,
      rowCount:  totalRows,
      truncated: truncatedRows || truncatedChars,
      text,
    });
  }

  if (results.length === 0) {
    return { error: "ATTACHMENT_TABLE_EMPTY" };
  }

  return results;
}
