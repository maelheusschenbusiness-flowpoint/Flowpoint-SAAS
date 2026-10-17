import { describe, expect, it } from "vitest";

import { sanitizeFilename } from "./file-validation.js";

describe("sanitizeFilename", () => {
  it("leaves a simple filename unchanged", () => {
    expect(sanitizeFilename("report-2024 v2.pdf")).toBe("report-2024 v2.pdf");
  });

  it("keeps only the basename when the input contains a path", () => {
    expect(sanitizeFilename("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("/var/tmp/notes.txt")).toBe("notes.txt");
  });

  it("replaces each disallowed character with an underscore", () => {
    expect(sanitizeFilename("my<file>:name?.txt")).toBe("my_file__name_.txt");
  });

  it("collapses every run of dots into a single dot", () => {
    expect(sanitizeFilename("archive...tar..gz")).toBe("archive.tar.gz");
  });

  // Documents the current behaviour, surprising as it is: a name made only of
  // dots collapses to ".", which is truthy, so the "file" fallback never runs
  // and the result is a bare dot rather than a usable filename.
  it("turns a name made only of dots into a single dot", () => {
    expect(sanitizeFilename("..")).toBe(".");
    expect(sanitizeFilename(".....")).toBe(".");
  });

  // Truncation happens after sanitising, and it is a blind slice: the extension
  // is simply cut off when the name is longer than 200 characters.
  it("truncates a very long name to 200 characters, dropping the extension", () => {
    const result = sanitizeFilename(`${"a".repeat(250)}.pdf`);

    expect(result).toHaveLength(200);
    expect(result).toBe("a".repeat(200));
  });

  // The fallback only triggers when the basename is empty: disallowed
  // characters become underscores, so "???" yields "___", not "file".
  it("falls back to \"file\" when no character is left", () => {
    expect(sanitizeFilename("/")).toBe("file");
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("???")).toBe("___");
  });
});
