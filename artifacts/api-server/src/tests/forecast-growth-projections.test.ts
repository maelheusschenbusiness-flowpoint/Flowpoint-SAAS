import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

const dashboardSources = [
  {
    label: "source",
    content: readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8"),
  },
  {
    label: "served export",
    content: readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8"),
  },
];

function renderWithHistory(
  dashboard: string,
  auditHistory: Array<{ avg: number }>,
  stepPerWeek = 0,
) {
  const start = dashboard.indexOf("function renderGrowthProjections()");
  const end = dashboard.indexOf("\nfunction renderGrowthObjectives()", start);
  const renderGrowthProjections = dashboard.slice(start, end);
  const context = vm.createContext({
    STATE: { overview: { auditHistory }, missions: [] },
    PREVIEW_MODE: false,
    fpT: (key: string, values?: Record<string, unknown>) =>
      key.replace(/\{(\w+)\}/g, (_match, name: string) =>
        String(values?.[name] ?? ""),
      ),
    avgScore: () => 80,
    computeGrowthProjection: () => ({ stepPerWeek, score30d: 80 }),
    getLocale: () => "fr-BE",
    btn: () => "",
    aiBlock: (copy: string) => copy,
    statCard: (label: string, value: string, detail: string) =>
      `${label}: ${value} (${detail})`,
    displayStat: () => "—",
    growthForecastSvg: () => "",
    svgIcon: () => "",
    escHtml: (value: string) => value,
  });
  vm.runInContext(renderGrowthProjections, context);
  return vm.runInContext("renderGrowthProjections()", context) as string;
}

for (const { label, content } of dashboardSources) {
  describe(`AI forecast score projections (${label})`, () => {
    it("withholds projections until there are two real audit-history points", () => {
      const html = renderWithHistory(content, [{ avg: 80 }]);

      expect(html).toContain("Historique insuffisant pour une projection");
      expect(html).toContain("au moins deux audits SEO");
      expect(html).not.toContain("Score dans 30j");
    });

    it("keeps a measured flat history flat instead of adding default gains", () => {
      const html = renderWithHistory(content, [{ avg: 80 }, { avg: 80 }]);

      expect(html).toContain("Tendance mesurée stable");
      expect(html).toContain("Score dans 30j: 80/100 (0 pts estimés)");
      expect(html).not.toContain("Estimation par défaut");
      expect(html).not.toContain("83/100");
      expect(html).not.toContain("86/100");
    });

    it("preserves a measured declining trend instead of forcing scenario growth", () => {
      const html = renderWithHistory(content, [{ avg: 82 }, { avg: 80 }], -1);

      expect(html).toContain("Tendance mesurée négative");
      expect(html).toContain("Score dans 30j: 76/100 (-4 pts estimés)");
    });
  });
}
