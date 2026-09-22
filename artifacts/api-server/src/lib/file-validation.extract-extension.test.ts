import { describe, it, expect } from "vitest";

import { extractExtension } from "./file-validation.js";

describe("extractExtension", () => {
  it("returns an empty string when the name has no dot", () => {
    expect(extractExtension("README")).toBe("");
  });

  it("returns the lowercased extension when the name has one", () => {
    expect(extractExtension("Report.PDF")).toBe("pdf");
  });
});
