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
const publicLocalePages = [
  "signin.html",
  "login.html",
  "pricing.html",
  "cancel.html",
  "success.html",
  "accept-invitation.html",
  "login-verify.html",
  "report-view.html",
  "checkout-return.html",
];

function loadLocale(
  initialLanguage: string | null = "en",
  options: { readyState?: string; title?: string; metadata?: any[] } = {},
) {
  let storedLanguage: string | null = initialLanguage;
  const window = { location: { pathname: "/pricing.html" } };
  const emptyRoot = {
    nodeType: 1,
    matches: () => false,
    querySelectorAll: () => [],
  };
  const document = {
    readyState: options.readyState ?? "loading",
    title: options.title ?? "",
    documentElement: { lang: "en" },
    head: {
      nodeType: 1,
      matches: () => false,
      querySelectorAll: () => options.metadata ?? [],
    },
    body: emptyRoot,
    addEventListener: () => undefined,
    querySelector: () => null,
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
    document,
    readLanguage: () => storedLanguage,
  };
}

describe("public English localization", () => {
  it("declares English in the initial HTML for every page translated by the public locale loader", () => {
    for (const filename of publicLocalePages) {
      const html = readFileSync(
        resolve(process.cwd(), `../flowpoint-export/${filename}`),
        "utf8",
      );
      expect(html.match(/<html\b[^>]*\blang="([^"]+)"/)?.[1], filename).toBe("en");
    }
  });

  it("keeps the rendered document language aligned with the default and saved French preference", () => {
    const defaultLanguage = loadLocale(null, { readyState: "complete" });
    const frenchLanguage = loadLocale("fr", { readyState: "complete" });

    expect(defaultLanguage.document.documentElement.lang).toBe("en");
    expect(frenchLanguage.document.documentElement.lang).toBe("fr");
  });

  it("translates the exact pricing catalogue labels found during certification", () => {
    const { window } = loadLocale("en");

    expect(window.fpPublicText("Local SEO basique")).toBe("Basic Local SEO");
    expect(window.fpPublicText("Achat unique")).toBe("One-time purchase");
    expect(window.fpPublicText("Suivant")).toBe("Next");
    expect(window.fpPublicText("IA & Copilot")).toBe("AI & Copilot");
    expect(window.fpPublicText("Review Intelligence IA")).toBe("Review Intelligence AI");
    expect(window.fpPublicText("Monitors d'uptime")).toBe("Uptime monitors");
    expect(window.fpPublicText("Copilot IA")).toBe("AI Copilot");
    expect(window.fpPublicText("Complet")).toBe("Full");
    expect(window.fpPublicText("Basiques")).toBe("Basic");
    expect(window.fpPublicText("Inclus")).toBe("Included");
    expect(window.fpPublicText("∞ (Inclus)")).toBe("∞ (Included)");
    expect(window.fpPublicText("Agency Lab complet")).toBe("Full Agency Lab");
    expect(window.fpPublicText("100 000")).toBe("100,000");
    expect(window.fpPublicText("500 000")).toBe("500,000");
    expect(window.fpPublicText("4€")).toBe("€4");
    expect(window.fpPublicText("9€")).toBe("€9");
    expect(window.fpPublicText("19€")).toBe("€19");
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

  it("translates public pricing metadata in English while preserving non-language URLs", () => {
    const makeMeta = (attributes: Record<string, string>) => {
      const values = new Map(Object.entries(attributes));
      return {
        tagName: "META",
        getAttribute: (name: string) => values.get(name) ?? null,
        setAttribute: (name: string, value: string) => values.set(name, value),
        readAttribute: (name: string) => values.get(name),
      };
    };
    const description = makeMeta({
      name: "description",
      content: "Plans FlowPoint : Standard 29€ (30 audits, 10 monitors), Pro 79€ (300 audits, 50 monitors), Ultra 149€ (1000 audits, 300 monitors). Essai 14 jours.",
    });
    const openGraphTitle = makeMeta({
      property: "og:title",
      content: "Tarifs FlowPoint — SEO, monitoring & IA",
    });
    const openGraphDescription = makeMeta({
      property: "og:description",
      content: "Plans flexibles pour indépendants, équipes et agences. 14 jours d'essai inclus.",
    });
    const openGraphUrl = makeMeta({
      property: "og:url",
      content: "https://app.flowpoint.pro/pricing.html",
    });

    const { document } = loadLocale("en", {
      readyState: "complete",
      title: "Tarifs FlowPoint — SEO, monitoring & IA pour votre croissance",
      metadata: [description, openGraphTitle, openGraphDescription, openGraphUrl],
    });

    expect(description.readAttribute("content")).toBe(
      "FlowPoint plans: Standard €29 (30 audits, 10 monitors), Pro €79 (300 audits, 50 monitors), and Ultra €149 (1,000 audits, 300 monitors). Includes a 14-day trial.",
    );
    expect(openGraphTitle.readAttribute("content")).toBe("FlowPoint pricing — SEO, monitoring & AI");
    expect(openGraphDescription.readAttribute("content")).toBe(
      "Flexible plans for freelancers, teams, and agencies. Includes a 14-day trial.",
    );
    expect(openGraphUrl.readAttribute("content")).toBe("https://app.flowpoint.pro/pricing.html");
    expect(document.title).toBe("FlowPoint pricing — SEO, monitoring & AI for your growth");
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
    expect(window.fpPublicText("Monitors d'uptime")).toBe("Monitors d'uptime");
    expect(window.fpPublicText("Agency Lab complet")).toBe("Agency Lab complet");
    expect(window.fpPublicText("4€")).toBe("4€");
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
