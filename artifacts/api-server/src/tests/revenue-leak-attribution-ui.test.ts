import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboards = [
  ["source", resolve(process.cwd(), "../../src/frontend/dashboard.js")],
  ["served", resolve(process.cwd(), "../flowpoint-export/dashboard.js")],
] as const;

describe("Behavioral AI / CRO / Revenue Leak : tableau de bord honnete", () => {
  it.each(dashboards)("Revenue Leak : etat d'attribution insuffisante explicite (%s)", (_name, path) => {
    const dashboard = readFileSync(path, "utf8");
    expect(dashboard).toContain("data-attribution-status=");
    expect(dashboard).toContain("Attribution financière : données insuffisantes");
    expect(dashboard).toContain("Revenu observé par GA4");
    expect(dashboard).toContain("observedLoss: null");
    expect(dashboard).toContain("attribution: r.attribution || { status: 'insufficient_data'");
  });

  it.each(dashboards)("Revenue Leak : resolution d'une opportunite observee (%s)", (_name, path) => {
    const dashboard = readFileSync(path, "utf8");
    expect(dashboard).toContain("data-revenue-leak-resolve=");
    expect(dashboard).toContain("data.opportunities = remaining");
  });

  it.each(dashboards)("lit les reponses reelles des routes ported, sans donnees de demonstration (%s)", (_name, path) => {
    const dashboard = readFileSync(path, "utf8");
    // Les clients API lisent opportunities / analysis (et non plus leaks / estimatedMonthlyLoss).
    expect(dashboard).toContain("leaks:          data.opportunities || []");
    expect(dashboard).toContain("analysis:      data.analysis      || null");
    expect(dashboard).toContain("/api/behavioral/funnels/analyze");
    // Le module A/B (autre add-on) n'est pas expose par ce correctif.
    expect(dashboard).not.toContain("FP_AB_TEST_API.create");
  });
});
