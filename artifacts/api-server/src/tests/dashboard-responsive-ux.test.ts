import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/dashboard.css"),
  "utf8",
);

describe("dashboard responsive UX", () => {
  it("keeps the mobile command-palette search available as an icon", () => {
    const rule = css.match(/\.fp-topbar \.fp-search-trigger\s*\{([^}]+)\}/);
    expect(rule?.[1]).toContain("display: flex !important");
    expect(css).toContain(".fp-search-trigger {\n    display: none !important;");
  });

  it("preserves the top safe area on notched phones", () => {
    expect(css).toContain(
      "padding: env(safe-area-inset-top, 0px) 10px 0 !important;",
    );
  });

  it("shows table row actions without hover and when keyboard-focused", () => {
    expect(css).toContain(
      ".fp-table tbody tr:focus-within .fp-row-actions { opacity: 1; }",
    );
    expect(css).toContain("@media (hover: none), (pointer: coarse)");
    expect(css).toContain(".fp-table tbody tr .fp-row-actions { opacity: 1; }");
  });
});
