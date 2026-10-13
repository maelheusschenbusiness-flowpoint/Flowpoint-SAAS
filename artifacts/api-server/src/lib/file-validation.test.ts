import { describe, expect, it } from "vitest";

import { sanitizeFilename } from "./file-validation.js";

describe("sanitizeFilename", () => {
  it("leaves a simple name untouched", () => {
    expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
    expect(sanitizeFilename("my invoice-2024_v2.png")).toBe("my invoice-2024_v2.png");
  });

  it("keeps only the last segment of a path", () => {
    expect(sanitizeFilename("/etc/passwd")).toBe("passwd");
    expect(sanitizeFilename("../../secrets/key.pem")).toBe("key.pem");
    expect(sanitizeFilename("uploads/2024/report.pdf")).toBe("report.pdf");
  });

  it("glues segments together for backslash paths instead of splitting them", () => {
    // path.basename is the POSIX one here, so a Windows-style path is not split:
    // the backslashes are only removed afterwards and the segments end up joined.
    expect(sanitizeFilename("folder\\sub\\notes.txt")).toBe("foldersubnotes.txt");
  });

  it("replaces forbidden characters with underscores", () => {
    expect(sanitizeFilename("re:port?<1>.pdf")).toBe("re_port__1_.pdf");
    // Non-ASCII characters are not dropped, they each become one underscore.
    expect(sanitizeFilename("caf\u00e9\u2615.jpg")).toBe("caf__.jpg");
  });

  it("collapses a run of dots into a single dot", () => {
    expect(sanitizeFilename("report..pdf")).toBe("report.pdf");
    expect(sanitizeFilename("archive....tar.gz")).toBe("archive.tar.gz");
    // A name made only of dots is not rejected: it collapses to a lone dot.
    expect(sanitizeFilename("..")).toBe(".");
    expect(sanitizeFilename("...")).toBe(".");
  });

  it("truncates a very long name to 200 characters", () => {
    const long = `${"a".repeat(250)}.pdf`;
    const result = sanitizeFilename(long);

    expect(result).toHaveLength(200);
    expect(result).toBe("a".repeat(200));
    // Truncation happens on the whole name, so the extension can be lost.
    expect(result.endsWith(".pdf")).toBe(false);
  });

  it("falls back to \"file\" when nothing is left", () => {
    expect(sanitizeFilename("")).toBe("file");
    expect(sanitizeFilename("/")).toBe("file");
    expect(sanitizeFilename("///")).toBe("file");
    // The fallback only triggers on an empty result: characters that are merely
    // forbidden are substituted, so they never reach it.
    expect(sanitizeFilename("\u2615\u2615\u2615")).toBe("___");
  });
});
