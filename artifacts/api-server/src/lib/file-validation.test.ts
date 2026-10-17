import { describe, expect, it } from "vitest";

import { sanitizeFilename } from "./file-validation.js";

describe("sanitizeFilename", () => {
  it("leaves a simple filename unchanged", () => {
    expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
    expect(sanitizeFilename("Notes 2024-01_final.txt")).toBe("Notes 2024-01_final.txt");
  });

  it("keeps only the last segment of a path", () => {
    expect(sanitizeFilename("/etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("uploads/2024/report.pdf")).toBe("report.pdf");
  });

  it("never lets a separator through, even for a backslash-style path", () => {
    // path.basename() only splits on "/" under POSIX; the explicit [/\\] replace
    // is what strips the backslashes, so the segments end up concatenated
    // instead of reduced to the last one.
    const result = sanitizeFilename("..\\..\\windows\\system32\\cmd.exe");
    expect(result).not.toContain("/");
    expect(result).not.toContain("\\");
  });

  it("replaces forbidden characters with an underscore", () => {
    expect(sanitizeFilename("my<file>:name?.txt")).toBe("my_file__name_.txt");
    expect(sanitizeFilename("re;port*.csv")).toBe("re_port_.csv");
    expect(sanitizeFilename("café.txt")).toBe("caf_.txt");
  });

  it("collapses any run of dots into a single dot", () => {
    expect(sanitizeFilename("report..........pdf")).toBe("report.pdf");
    // Documented as-is: a name made only of dots collapses to "." and is
    // returned as such, because "." is truthy so the fallback is never reached.
    expect(sanitizeFilename("...")).toBe(".");
    expect(sanitizeFilename("..")).toBe(".");
  });

  it("truncates to 200 characters, which drops the extension of a very long name", () => {
    const result = sanitizeFilename(`${"a".repeat(300)}.txt`);
    expect(result).toHaveLength(200);
    expect(result).toBe("a".repeat(200));
    expect(result.endsWith(".txt")).toBe(false);
  });

  it("falls back to 'file' only when nothing at all is left", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("/")).toBe("file");
    // Documented as-is: forbidden characters are replaced, not removed, so a
    // name made only of them yields underscores rather than the fallback.
    expect(sanitizeFilename("???")).toBe("___");
  });
});
