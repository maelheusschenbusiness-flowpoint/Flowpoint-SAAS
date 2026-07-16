/**
 * csv-parser.ts — Parse CSV files from a Buffer using PapaParse.
 *
 * Handles:
 *   - Auto-detection of comma / semicolon / tab delimiter
 *   - BOM stripping
 *   - Formula cell neutralisation (=, +, -, @ prefixes prepended with ')
 *   - Row and column limits
 *   - Markdown table output
 *   - Empty-file detection
 */

import Papa from "papaparse";

export interface CsvParseResult {
  headers:   string[];
  rows:      string[][];
  totalRows: number;
  truncated: boolean;
  text:      string;
}

export interface CsvParseError {
  error: "ATTACHMENT_CSV_INVALID" | "ATTACHMENT_TABLE_EMPTY";
}

const FORMULA_PREFIX_RE = /^[=+\-@]/;

function neutralizeCell(raw: unknown): string {
  const s = String(raw ?? "");
  return FORMULA_PREFIX_RE.test(s) ? "'" + s : s;
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
 * Parse a CSV buffer and return a Markdown table representation.
 */
export function parseCsvBuffer(
  buf:      Buffer,
  maxRows:  number,
  maxCols:  number,
  maxChars: number,
): CsvParseResult | CsvParseError {
  let content = buf.toString("utf-8");

  // Strip UTF-8 BOM
  if (content.charCodeAt(0) === 0xFEFF) {
    content = content.slice(1);
  }

  const result = Papa.parse<string[]>(content, {
    skipEmptyLines: true,
    dynamicTyping:  false,
  });

  if (result.data.length === 0) {
    return { error: "ATTACHMENT_TABLE_EMPTY" };
  }

  if ((result.errors ?? []).length > 0 && result.data.length === 0) {
    return { error: "ATTACHMENT_CSV_INVALID" };
  }

  const [rawHeader, ...rawData] = result.data as string[][];

  if (!rawHeader || rawHeader.length === 0) {
    return { error: "ATTACHMENT_TABLE_EMPTY" };
  }

  const headers   = rawHeader.slice(0, maxCols).map(neutralizeCell);
  const totalRows = rawData.length;
  const truncatedRows = totalRows > maxRows;
  const limitedRows   = rawData
    .slice(0, maxRows)
    .map(row => row.slice(0, maxCols).map(neutralizeCell));

  let text = buildMarkdownTable(headers, limitedRows);
  const truncatedChars = text.length > maxChars;
  if (truncatedChars) {
    text = text.slice(0, maxChars);
  }

  return {
    headers,
    rows:      limitedRows,
    totalRows,
    truncated: truncatedRows || truncatedChars,
    text,
  };
}
