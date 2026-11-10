import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboards = [
  ["source", resolve(process.cwd(), "../../src/frontend/dashboard.js")],
  ["served", resolve(process.cwd(), "../flowpoint-export/dashboard.js")],
] as const;

describe("Revenue Leak attribution UI", () => {
  it.each(dashboards)("renders an explicit insufficient-data state in the %s dashboard", (_name, path) => {
    const dashboard = readFileSync(path, "utf8");
    expect(dashboard).toContain("data-attribution-status=");
    expect(dashboard).toContain("Attribution financière : données insuffisantes");
    expect(dashboard).toContain("ne permettent pas une jointure exacte");
    expect(dashboard).toContain("Revenu observé par GA4");
    expect(dashboard).toContain("_rlFinancial.status === 'observed'");
    expect(dashboard).toContain("observedLoss: null");
    expect(dashboard).toContain("attribution: r.attribution || { status: 'insufficient_data'");
  });

  it("keeps the source and served dashboards synchronized", () => {
    expect(readFileSync(dashboards[0][1], "utf8")).toBe(readFileSync(dashboards[1][1], "utf8"));
  });
});
