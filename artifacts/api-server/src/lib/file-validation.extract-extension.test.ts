import { describe, expect, it } from "vitest";

import { extractExtension } from "./file-validation.js";

describe("extractExtension", () => {
  it("returns an empty string when the filename has no dot", () => {
    expect(extractExtension("README")).toBe("");
  });

  it("returns the lowercased extension when the filename has one", () => {
    expect(extractExtension("Report.PDF")).toBe("pdf");
  });
});
