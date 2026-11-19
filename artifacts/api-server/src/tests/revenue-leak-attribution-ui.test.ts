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

      it.each(dashboards)("lets the user resolve an observed opportunity in the %s dashboard", (_name, path) => {
        const dashboard = readFileSync(path, "utf8");
        expect(dashboard).toContain("data-revenue-leak-resolve=");
        expect(dashboard).toContain("window.FP_REVENUE_LEAK_API.resolve(this.dataset.revenueLeakResolve, this)");
        expect(dashboard).toContain("data.opportunities = remaining");
        expect(dashboard).toContain("if (!result?.ok) throw new Error(result?.error || fpT('Erreur'))");
      });

      it.each(dashboards)("puts the resolve button in the revenue-leak list, not in the audits analysis, in the %s dashboard", (_name, path) => {
        const dashboard = readFileSync(path, "utf8");
        const marker = "data-revenue-leak-resolve=";
        expect(dashboard.split(marker)).toHaveLength(2);
        const at = dashboard.indexOf(marker);
        const listStart = dashboard.indexOf("if (sub === 'revenue-leak') {");
        const listEnd = dashboard.indexOf("if (sub === 'cro') {");
        expect(listStart).toBeGreaterThan(-1);
        expect(listEnd).toBeGreaterThan(listStart);
        expect(at).toBeGreaterThan(listStart);
        expect(at).toBeLessThan(listEnd);
        // `l` n'existe que dans leaks.map((l, i) => ...) : le bouton doit etre dans ce rappel.
        const mapAt = dashboard.lastIndexOf("leaks.map((l, i) =>", at);
        expect(mapAt).toBeGreaterThan(listStart);
      });

      it("keeps the source and served dashboards synchronized", () => {
        expect(readFileSync(dashboards[0][1], "utf8")).toBe(readFileSync(dashboards[1][1], "utf8"));
      });
    });
    