import { describe, expect, it } from "vitest";

import { sanitizeFilename } from "./file-validation.js";

describe("sanitizeFilename", () => {
  it("leaves an already safe filename unchanged", () => {
    expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
    expect(sanitizeFilename("My Report-2024_final.txt")).toBe("My Report-2024_final.txt");
  });

  it("keeps only the base name of a path", () => {
    expect(sanitizeFilename("/etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("../../secret/notes.md")).toBe("notes.md");
    // path.basename() is POSIX here, so a Windows path is not split. The
    // backslashes are then deleted by the [/\\] strip that runs before the
    // character-class replacement, so only the drive colon becomes "_".
    expect(sanitizeFilename("C:\\temp\\evil.exe")).toBe("C_tempevil.exe");
  });

  it("replaces a forbidden character with an underscore, but deletes backslashes", () => {
    expect(sanitizeFilename("my<file>:name?.txt")).toBe("my_file__name_.txt");
    expect(sanitizeFilename("caf\u00e9.txt")).toBe("caf_.txt");
    // Backslashes are the exception: stripped outright instead of replaced.
    expect(sanitizeFilename("a\\b.txt")).toBe("ab.txt");
  });

  it("collapses a run of dots into a single dot", () => {
    expect(sanitizeFilename("report....pdf")).toBe("report.pdf");
    // Documented as-is: a bare parent-directory name survives as a lone dot
    // instead of falling back to the default name.
    expect(sanitizeFilename("..")).toBe(".");
  });

  it("truncates a very long name to 200 characters, extension included", () => {
    const result = sanitizeFilename("a".repeat(300) + ".txt");
    expect(result).toHaveLength(200);
    expect(result).toBe("a".repeat(200));
  });

  it("falls back to a default name when no character is left", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("/")).toBe("file");
    // A name made only of forbidden characters reaches the fallback when those
    // characters are backslashes, since stripping them leaves nothing.
    expect(sanitizeFilename("\\")).toBe("file");
  });
});
