import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const publicLocaleSource = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/fp-locale.js"),
  "utf8",
);
const publicDashboardHtml = readFileSync(
  resolve(process.cwd(), "../flowpoint-export/dashboard.html"),
  "utf8",
);

function loadLocale(initialLanguage = "en") {
  let storedLanguage = initialLanguage;
  const window = { location: { pathname: "/pricing.html" } };
  const document = {
    readyState: "loading",
    title: "",
    documentElement: { lang: "" },
    addEventListener: () => undefined,
    createTreeWalker: () => ({ nextNode: () => null }),
  };
  const localStorage = {
    getItem: (key: string) => key === "fp:language" ? storedLanguage : null,
    setItem: (key: string, value: string) => { storedLanguage = value; },
  };

  runInNewContext(publicLocaleSource, {
    window,
    document,
    localStorage,
    NodeFilter: { SHOW_TEXT: 4 },
  });

  return {
    window: window as typeof window & Record<string, any>,
    readLanguage: () => storedLanguage,
  };
}

describe("public English localization", () => {
  it("translates the exact pricing catalogue labels found during certification", () => {
    const { window } = loadLocale("en");

    expect(window.fpPublicText("Local SEO basique")).toBe("Basic Local SEO");
    expect(window.fpPublicText("Achat unique")).toBe("One-time purchase");
    expect(window.fpPublicText("Suivant")).toBe("Next");
    expect(window.fpPublicText("Facturation client")).toBe("Client billing");
    expect(window.fpPublicText("Analytics concurrents")).toBe("Competitor analytics");
    expect(window.fpPublicText("Support dédié <1h")).toBe("Dedicated support <1 hour");
  });

  it("translates carousel navigation aria-labels in English without changing French", () => {
    const makeButton = () => {
      const attributes = new Map([["aria-label", "Suivant"]]);
      return {
        nodeType: 1,
        tagName: "BUTTON",
        matches: () => true,
        querySelectorAll: () => [],
        getAttribute: (name: string) => attributes.get(name) ?? null,
        setAttribute: (name: string, value: string) => attributes.set(name, value),
        readAttribute: (name: string) => attributes.get(name),
      };
    };

    const english = loadLocale("en").window;
    const englishButton = makeButton();
    english.fpTranslatePublicSubtree(englishButton);
    expect(englishButton.readAttribute("aria-label")).toBe("Next");

    const french = loadLocale("fr").window;
    const frenchButton = makeButton();
    french.fpTranslatePublicSubtree(frenchButton);
    expect(frenchButton.readAttribute("aria-label")).toBe("Suivant");
  });

  it("formats dates and numbers in English without changing the saved language", () => {
    const { window, readLanguage } = loadLocale("en");

    expect(window.fpFormatDate("2026-10-01T12:00:00.000Z", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }, "en")).toBe("October 1, 2026");
    expect(window.fpFormatNumber(1234567.89, undefined, "en")).toBe("1,234,567.89");
    expect(readLanguage()).toBe("en");
  });

  it("retains the existing locale mappings and a user's selected language", () => {
    const { window, readLanguage } = loadLocale("fr");
    const existingLocales: Record<string, string> = {
      en: "en-US",
      fr: "fr-FR",
      es: "es-ES",
      de: "de-DE",
      it: "it-IT",
      pt: "pt-PT",
      nl: "nl-NL",
      pl: "pl-PL",
      sv: "sv-SE",
      ro: "ro-RO",
      cs: "cs-CZ",
      "pt-BR": "pt-BR",
    };

    for (const [language, locale] of Object.entries(existingLocales)) {
      expect(window.fpResolveLocale(language)).toBe(locale);
    }
    expect(window.fpPublicText("Achat unique", "One-time purchase")).toBe("Achat unique");
    expect(readLanguage()).toBe("fr");
  });

  it("loads the locale resolver before backend and dashboard scripts", () => {
    const localeIndex = publicDashboardHtml.indexOf('src="fp-locale.js');
    const backendIndex = publicDashboardHtml.indexOf('src="fp-backend.js');
    const dashboardIndex = publicDashboardHtml.indexOf('src="dashboard.js');

    expect(localeIndex).toBeGreaterThanOrEqual(0);
    expect(backendIndex).toBeGreaterThan(localeIndex);
    expect(dashboardIndex).toBeGreaterThan(backendIndex);
  });
});
