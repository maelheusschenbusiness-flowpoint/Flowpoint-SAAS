import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboards = [
  ["source", resolve(process.cwd(), "../../src/frontend/dashboard.js")],
  ["served", resolve(process.cwd(), "../flowpoint-export/dashboard.js")],
] as const;

describe("AI Executive Reporting UI", () => {
  it.each(dashboards)("supports a bounded report subject and saved report consultation in the %s dashboard", (_name, path) => {
    const dashboard = readFileSync(path, "utf8");
    expect(dashboard).toContain('id="fp-ai-exec-subject"');
    expect(dashboard).toContain('maxlength="120"');
    expect(dashboard).toContain("JSON.stringify({ subject })");
    expect(dashboard).toContain("window.fpViewExecutiveReport");
    expect(dashboard).toContain("window._fpReportsAPI.downloadPdf(this.dataset.reportId,this.dataset.reportName)");
  });

  it.each(dashboards)("does not show synthetic executive scores when measurements are missing in the %s dashboard", (_name, path) => {
    const dashboard = readFileSync(path, "utf8");
    const start = dashboard.indexOf("const _hasAiExecutive");
    const end = dashboard.indexOf("if (sub === 'seo')", start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const executive = dashboard.slice(start, end);
    for (const inventedValue of ["72/100", "74/100", "48/100", "88/100", "2.8x", "+12 clients/mois", "+400 sessions/mois", "+14 pts en 4 mois"]) {
      expect(executive).not.toContain(inventedValue);
    }
  });

  it("keeps the source and served dashboards synchronized", () => {
    expect(readFileSync(dashboards[0][1], "utf8")).toBe(readFileSync(dashboards[1][1], "utf8"));
  });
});
