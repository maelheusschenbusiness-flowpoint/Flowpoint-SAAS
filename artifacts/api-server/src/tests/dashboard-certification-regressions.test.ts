import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(
  resolve(process.cwd(), "../../src/frontend/dashboard.js"),
  "utf8",
);
const seoRoutes = readFileSync(resolve(process.cwd(), "src/routes/seo.ts"), "utf8");
const fullQa = readFileSync(resolve(process.cwd(), "tools/qa-e2e-full.mjs"), "utf8");

describe("dashboard beta certification regressions", () => {
  it("translates dynamic system and risk summaries through the English catalog", () => {
    const dynamicKeys = [
      "{count} site{plural} · Score moyen {score}/100",
      "{down} DOWN · {count} monitor{plural} actif{plural}",
      "{name} — {count} concurrent{plural} suivi{plural}",
      "Taux global : {rate}",
      "{count} rapport{plural} généré{plural}",
      "{active} alerte{activePlural} · {firing} déclenchée{firingPlural}",
      "Plan {plan} actif",
      "{total} mission{totalPlural} · {done} terminée{donePlural}",
      "{count} workflow{plural} actif{plural}",
      "{count} avis Google sans réponse{plural}",
      "Latence élevée — {count} site{plural}",
    ];
    const catalogStart = dashboard.indexOf("var FP_I18N_EN_EXTRA = {");
    const catalogEnd = dashboard.indexOf("\n  };", catalogStart);
    const catalog = dashboard.slice(catalogStart, catalogEnd);

    expect(catalogStart).toBeGreaterThanOrEqual(0);
    expect(catalogEnd).toBeGreaterThan(catalogStart);
    for (const key of dynamicKeys) {
      expect(dashboard).toContain(`fpT('${key}'`);
      expect(catalog).toContain(JSON.stringify(key));
    }
  });

  it("uses the implemented Local SEO and DataForSEO status endpoints", () => {
    expect(dashboard).toContain("apiFetch('/api/local-seo/status')");
    expect(dashboard).not.toMatch(/apiFetch\(['"]\/api\/local-seo['"]\)/);
    expect(seoRoutes).toContain('router.get("/local-seo/status"');
    expect(seoRoutes).toContain('router.get("/seo/status"');
    expect(fullQa).toContain('api("GET", "/api/seo/status")');
  });

  it("keeps mobile navigation delegated outside async bootstrap", () => {
    const helperStart = dashboard.indexOf("function setMobileNavigationOpen(isOpen)");
    const handlerStart = dashboard.indexOf(
      "document.addEventListener('click', function _mobileNavigationDelegation",
    );
    const navigationControls = dashboard.slice(helperStart, handlerStart);
    const navigationHandler = dashboard.slice(handlerStart, handlerStart + 900);

    expect(helperStart).toBeGreaterThanOrEqual(0);
    expect(handlerStart).toBeGreaterThan(helperStart);
    expect(navigationControls).toContain(
      "sidebar.classList.toggle('mobile-open', open)",
    );
    expect(navigationControls).toContain(
      "hamburger.setAttribute('aria-expanded', String(open))",
    );
    expect(navigationHandler).toContain("target.closest('#fp-hamburger')");
    expect(navigationHandler).toContain("target.closest('#fp-mobile-overlay')");
  });

  it("exposes the settings save handler after its definition", () => {
    const definition = dashboard.indexOf("function saveSettings()");
    const exposure = dashboard.indexOf("window.saveSettings = saveSettings;");

    expect(definition).toBeGreaterThanOrEqual(0);
    expect(exposure).toBeGreaterThan(definition);
    expect(dashboard.slice(definition, exposure)).toContain(
      "apiAction('PATCH', '/api/me/prefs'",
    );
  });
});
