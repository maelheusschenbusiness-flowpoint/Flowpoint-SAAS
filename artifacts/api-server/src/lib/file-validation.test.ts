import { describe, it, expect } from "vitest";
import { sanitizeFilename } from "./file-validation.js";

describe("sanitizeFilename", () => {
  it("returns \"unnamed\" when nothing remains after cleaning", () => {
    expect(sanitizeFilename("")).toBe("unnamed");
  });

  it("returns \"unnamed\" when the input is only separators", () => {
    expect(sanitizeFilename("/")).toBe("unnamed");
  });

  it("keeps a valid filename unchanged", () => {
    expect(sanitizeFilename("report.pdf")).toBe("report.pdf");
  });
});
