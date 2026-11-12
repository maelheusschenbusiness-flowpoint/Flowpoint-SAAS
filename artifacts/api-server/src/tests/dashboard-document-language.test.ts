import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/dashboard.js"),
  "utf8",
);
function extractFunction(startMarker: string, endMarker: string): string {
  const start = dashboardSource.indexOf(startMarker);
  expect(start, `missing dashboard function: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const end = dashboardSource.indexOf(endMarker, start);
  expect(end, `missing function terminator for: ${startMarker}`).toBeGreaterThan(start);
  return dashboardSource.slice(start, end + endMarker.length);
}

const languageSetter = extractFunction(
  "function _setDocumentLanguage(language) {",
  "\n}",
);
const applyLanguagePref = extractFunction(
  "window.applyLanguagePref = function(val) {",
  "\n  };",
);
const fpT = extractFunction(
  "window.fpT = window._fpTFn = function(str, vars) {",
  "\n  };",
);

function createHarness(savedLanguage: string | null, settingsLanguage?: string) {
  const stored = new Map<string, string>();
  if (savedLanguage) stored.set("fp:language", savedLanguage);
  const document = { documentElement: { lang: "" } };
  const window: Record<string, any> = {
    fpResolveLocale(language: string) {
      const base = String(language).toLowerCase().split(/[-_]/)[0];
      return ({ en: "en-US", fr: "fr-FR" } as Record<string, string>)[base] ?? language;
    },
  };
  const STATE = { settings: settingsLanguage ? { language: settingsLanguage } : {} as Record<string, string> };
  const FP_I18N = { en: { Bonjour: "Hello" } };
  const localStorage = {
    getItem(key: string) { return stored.get(key) ?? null; },
    setItem(key: string, value: string) { stored.set(key, value); },
  };
  const renderedLabels: string[] = [];
  const context = {
    window,
    document,
    STATE,
    FP_I18N,
    localStorage,
    render() {
      renderedLabels.push(window.fpT("Bonjour"));
    },
  };

  runInNewContext(
    `${languageSetter}\n${fpT}\n${applyLanguagePref}`,
    context,
  );

  return {
    context,
    document,
    window,
    STATE,
    stored,
    renderedLabels,
  };
}

describe("dashboard document language", () => {
  it("keeps the source and served dashboard copies identical", () => {
    const sourceCopy = readFileSync(
      resolve(process.cwd(), "../../src/frontend/dashboard.js"),
      "utf8",
    );
    expect(sourceCopy).toBe(dashboardSource);
  });

  it("uses the canonical locale resolver for every document language update", () => {
    expect(dashboardSource.match(/document\.documentElement\.lang\s*=/g)).toHaveLength(1);
    expect(dashboardSource).toContain("_setDocumentLanguage(_prefs.settings.language)");
    expect(dashboardSource).toContain("_setDocumentLanguage(lang)");
    expect(dashboardSource).toContain("_setDocumentLanguage(val)");
    expect(dashboardSource).toContain("_setDocumentLanguage(_lang)");
    expect(dashboardSource).toContain('onchange="applyLanguagePref(this.value);saveSettings();');
  });

  it("round-trips English → French → English across reloads without losing translations", () => {
    const firstPage = createHarness("en", "en");
    runInNewContext(
      `var selected = (STATE.settings && STATE.settings.language) || localStorage.getItem("fp:language") || "en"; _setDocumentLanguage(selected);`,
      firstPage.context,
    );

    firstPage.window.applyLanguagePref("fr");
    expect(firstPage.document.documentElement.lang).toBe("fr-FR");
    expect(firstPage.stored.get("fp:language")).toBe("fr");
    expect(firstPage.renderedLabels.at(-1)).toBe("Bonjour");

    const frenchReload = createHarness(firstPage.stored.get("fp:language") ?? null);
    runInNewContext(
      `var selected = (STATE.settings && STATE.settings.language) || localStorage.getItem("fp:language") || "en"; _setDocumentLanguage(selected);`,
      frenchReload.context,
    );
    expect(frenchReload.document.documentElement.lang).toBe("fr-FR");
    expect(frenchReload.window.fpT("Bonjour")).toBe("Bonjour");

    frenchReload.window.applyLanguagePref("en");
    expect(frenchReload.document.documentElement.lang).toBe("en-US");
    expect(frenchReload.stored.get("fp:language")).toBe("en");
    expect(frenchReload.renderedLabels.at(-1)).toBe("Hello");

    const englishReload = createHarness(frenchReload.stored.get("fp:language") ?? null);
    runInNewContext(
      `var selected = (STATE.settings && STATE.settings.language) || localStorage.getItem("fp:language") || "en"; _setDocumentLanguage(selected);`,
      englishReload.context,
    );
    expect(englishReload.document.documentElement.lang).toBe("en-US");
    expect(englishReload.window.fpT("Bonjour")).toBe("Hello");
  });
});
