/**
 * csv-parser.test.ts — Cell neutralisation of parseCsvBuffer.
 *
 * Covers:
 *   - Signed / decimal numbers stay intact (no ' prefix on -12.5, -3, +7, 1,5)
 *   - Real formula cells (=, +, -, @) still get the ' prefix
 *   - Cells starting with a tab or a carriage return get the ' prefix
 *   - An ordinary text cell is returned unchanged
 */

import { describe, it, expect } from "vitest";

import { parseCsvBuffer } from "./csv-parser.js";

/** Parse a CSV string and return its data rows, failing loudly on a parse error. */
function rowsOf(csv: string): string[][] {
  const r = parseCsvBuffer(Buffer.from(csv, "utf-8"), 100, 50, 10_000);
  if ("error" in r) throw new Error(`parseCsvBuffer returned ${r.error}`);
  return r.rows;
}

describe("parseCsvBuffer — cell neutralisation", () => {
  it("keeps signed and decimal numbers intact", () => {
    const rows = rowsOf('a,b,c,d\n-12.5,-3,+7,"1,5"\n');
    expect(rows[0]).toEqual(["-12.5", "-3", "+7", "1,5"]);
  });

  it("prefixes real formula cells with an apostrophe", () => {
    const rows = rowsOf("a,b,c,d\n=SUM(A1),+A1,-A1+B1,@cmd\n");
    expect(rows[0]).toEqual(["'=SUM(A1)", "'+A1", "'-A1+B1", "'@cmd"]);
  });

  it("prefixes cells starting with a tab or a carriage return", () => {
    const rows = rowsOf('label,tab,cr\nrow,"\tTAB","\rCR"\n');
    expect(rows[0]).toEqual(["row", "'\tTAB", "'\rCR"]);
  });

  it("leaves an ordinary text cell unchanged", () => {
    const rows = rowsOf("kind,value\nplain,texte\n");
    expect(rows[0]).toEqual(["plain", "texte"]);
  });
});
