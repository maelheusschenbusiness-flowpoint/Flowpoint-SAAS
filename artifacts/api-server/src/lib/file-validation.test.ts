import { describe, expect, it } from "vitest";

import { sanitizeFilename } from "./file-validation.js";

describe("sanitizeFilename", () => {
  it("leaves an already safe name unchanged", () => {
    expect(sanitizeFilename("rapport.pdf")).toBe("rapport.pdf");
    expect(sanitizeFilename("mon rapport-2024_v2.pdf")).toBe("mon rapport-2024_v2.pdf");
  });

  it("keeps only the last segment of a path", () => {
    expect(sanitizeFilename("reports/2024/summary.pdf")).toBe("summary.pdf");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
  });

  it("replaces forbidden characters with underscores", () => {
    expect(sanitizeFilename("rapport@2024#final!.txt")).toBe("rapport_2024_final_.txt");
    expect(sanitizeFilename("facture(1);rm.txt")).toBe("facture_1__rm.txt");
  });

  it("collapses runs of dots into a single dot", () => {
    expect(sanitizeFilename("photo...jpg")).toBe("photo.jpg");
    expect(sanitizeFilename("archive..tar.gz")).toBe("archive.tar.gz");
    // Surprising, but this is the current behaviour: a name made only of dots
    // is not empty, so it survives as a single dot instead of the fallback.
    expect(sanitizeFilename("...")).toBe(".");
  });

  it("truncates very long names to 200 characters", () => {
    const result = sanitizeFilename("a".repeat(250) + ".pdf");

    expect(result).toHaveLength(200);
    expect(result).toBe("a".repeat(200));
    // Surprising, but this is the current behaviour: the truncation happens
    // at the end of the string, so the extension is dropped.
    expect(result.endsWith(".pdf")).toBe(false);
  });

  it("falls back to 'file' when no character is left at all", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("///")).toBe("file");
    // Surprising, but this is the current behaviour: forbidden characters are
    // turned into underscores, so a name of only forbidden characters never
    // reaches the fallback.
    expect(sanitizeFilename("???")).toBe("___");
  });
});
