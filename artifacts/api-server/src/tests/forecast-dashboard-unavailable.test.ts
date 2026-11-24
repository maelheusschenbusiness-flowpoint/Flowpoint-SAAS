/**
 * Forecasting Lab : conversions et revenu sans GA4 s'affichent « Indisponible » (jamais 0 / « 0 € »).
 * Execute le vrai bloc `sub === 'forecast'` du dashboard avec des doublures minimales.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const files: Record<string, string> = {
  "src/frontend/dashboard.js": readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8"),
  "artifacts/flowpoint-export/dashboard.js": readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8"),
};
const LOCALES = ["en", "es", "de", "it", "pt", "nl", "pl", "sv", "ro", "cs"];
const NEW_KEYS = ["Données GA4 requises", "Données de revenu requises", "Conv. prévue", "Revenue prévu", "30 jours · GA4", "90 jours · GA4", "Revenu"];

function renderForecast(src: string, forecast: unknown): string {
  const i = src.indexOf("  if (sub === 'forecast') {");
  const j = src.indexOf("  // SUB: DATA EXPORT & REPORTING CENTER", i);
  expect(i).toBeGreaterThan(-1); expect(j).toBeGreaterThan(i);
  const body = src.slice(i, j).replace(/\/\/ ═+\s*$/, "");
  const ctx = vm.createContext({
    window: { FP_DATA: { forecast } },
    getLocale: () => "fr", fpT: (x: string) => x, escHtml: (x: string) => String(x),
    statCard: (l: string, v: string, s: string) => `<stat label="${l}" value="${v}" sub="${s}"/>`,
    svgIcon: () => "<svg stroke=\"currentColor\"></svg>", isUltra: true, isPro: true,
    aiBlock: () => "", fpUpgradeCta: () => {},
  });
  vm.runInContext(`function f(sub){\n${body}\n}\nthis.out = f('forecast');`, ctx);
  return (ctx as any).out as string;
}

const points = (conv: number | null, rev: number | null) => Array.from({ length: 90 }, (_, d) =>
  (["pessimistic", "realistic", "optimistic"] as const).map(scenario => ({
    date: `2026-07-${String((d % 28) + 1).padStart(2, "0")}`, predictedTraffic: 100, predictedConversions: conv, predictedRevenue: rev, confidence: 70, scenario,
  }))).flat();

const noGa4 = {
  available: true, conversionsAvailable: false, revenueAvailable: false, forecasts: points(null, null),
  summary: { expectedTrafficIn30d: 3000, expectedTrafficIn90d: 9000, expectedConversionsIn30d: null, expectedRevenueIn90d: null, confidenceScore: 70, growthScenarios: {} },
};

describe.each(Object.entries(files))("Forecasting Lab — %s", (_l, src) => {
  it("sans GA4 : conversions et revenu = « Indisponible », jamais 0", () => {
    const html = renderForecast(src, noGa4);
    expect(html).toContain('<stat label="Conversion" value="Indisponible" sub="Données GA4 requises"/>');
    expect(html).toContain('<stat label="Revenu" value="Indisponible" sub="Données de revenu requises"/>');
    expect([...html.matchAll(/data-fc-metric="unavailable"[^>]*>Indisponible</g)]).toHaveLength(2);
    expect(html).not.toContain('data-fc-metric="value"');
    expect(html).not.toMatch(/value="0( €)?"/);
    // 3 scenarios x (Conv. + Revenue) = 6 cases « Indisponible »
    expect(html.match(/>Indisponible</g)!.length).toBeGreaterThanOrEqual(8);
    expect(html).toContain("clics"); // le trafic reste affiche
  });

  it("si le serveur annonce des mesures (GA4), les valeurs sont affichees", () => {
    const html = renderForecast(src, {
      available: true, conversionsAvailable: true, revenueAvailable: true, forecasts: points(2, 50),
      summary: { ...noGa4.summary, expectedConversionsIn30d: 60, expectedRevenueIn90d: 4500 },
    });
    expect(html).toContain('<stat label="Conversion" value="60"');
    expect(html).toContain("4");
    expect(html).not.toContain('value="Indisponible"');
  });

  it("chaque nouvelle chaine est traduite dans les 10 locales", () => {
    for (const k of NEW_KEYS) {
      const n = src.split(`    ${JSON.stringify(k)}: `).length - 1;
      expect(n, k).toBe(LOCALES.length);
    }
  });

  it("« Indisponible » n'est pas mal traduit (EN = Unavailable, ES = No disponible)", () => {
    const en = src.indexOf("var FP_I18N_EN_EXTRA = {");
    const es = src.indexOf("\n    es: {", en);
    const enBlock = src.slice(en, es);
    expect(enBlock).not.toContain('"Indisponible": "No disponible"');
    const de = src.indexOf("\n    de: {", es);
    expect(src.slice(es, de)).not.toContain('"Indisponible": "Niet beschikbaar"');
  });
});
