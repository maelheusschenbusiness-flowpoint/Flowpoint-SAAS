/**
 * D1 : un appui sur un plan avant la fin du chargement de /api/plans/catalog attend le catalogue
 * (etat de chargement) au lieu d'afficher « catalogue indisponible ». Contrat verrouille dans le code livre ;
 * le parcours navigateur est dans tests/browser/certification/09-matrice-plans-langues.cert.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(process.cwd(), "../flowpoint-export");
const PRICING = readFileSync(join(DIR, "pricing.html"), "utf8");

describe("D1 pricing.html : catalogue en cours de chargement", () => {
  const start = PRICING.indexOf("window.goToCheckout = function fpGoToCheckout()");
  const src = PRICING.slice(start, start + 1800);
  it("goToCheckout attend le chargement, relance une fois, puis reprend ; l'erreur seulement a l'echec", () => {
    expect(start).toBeGreaterThan(-1);
    expect(src).toContain("_fpSetCheckoutBusy(true)");
    expect(src).toContain("_fpCatalogPromise || _fpFetchCatalog()");
    expect(src).toMatch(/\.catch\(function \(\) \{ return _fpFetchCatalog\(\); \}\)/);
    expect(src.indexOf("fpGoToCheckout();")).toBeLessThan(src.indexOf("indisponible"));
  });
  it("le chargement echoue proprement : la promesse est reinitialisee (reprise possible)", () => {
    expect(PRICING).toMatch(/_fpCatalogPromise = null; \/\* permet une nouvelle tentative \*\//);
  });
});

