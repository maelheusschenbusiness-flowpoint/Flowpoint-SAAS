import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_LANGUAGES,
  inferEmailLanguageFromCountry,
  normalizeEmailLanguage,
  resolveEmailLocale,
  resolveEmailLocaleFromSources,
} from "./email-localization.js";

describe("email locale resolution", () => {
  it("uses explicit language before user, organization, and country hints", () => {
    const locale = resolveEmailLocaleFromSources({
      explicitLanguage: "de-AT",
      userLanguage: "es",
      organizationLanguage: "it",
      country: "France",
    });
    expect(locale.language).toBe("de");
    expect(locale.source).toBe("explicit");
  });

  it("uses saved user preference before organization language and country", () => {
    const locale = resolveEmailLocaleFromSources({
      userLanguage: "pt-BR",
      organizationLanguage: "de",
      country: "France",
    });
    expect(locale.language).toBe("pt-br");
    expect(locale.source).toBe("user-preference");
  });

  it("uses organization language unless it is the legacy French default", () => {
    expect(resolveEmailLocaleFromSources({
      organizationLanguage: "nl",
      country: "Germany",
    }).language).toBe("nl");
    const legacyDefault = resolveEmailLocaleFromSources({
      organizationLanguage: "fr-FR",
      country: "Germany",
    });
    expect(legacyDefault.language).toBe("de");
    expect(legacyDefault.source).toBe("country-region");
  });

  it("falls through an unsupported explicit language to an unambiguous region", () => {
    const locale = resolveEmailLocaleFromSources({
      explicitLanguage: "ja",
      country: "Canada",
      region: "Québec",
    });
    expect(locale.language).toBe("fr");
    expect(locale.source).toBe("country-region");
  });

  it("infers supported languages from unambiguous countries", () => {
    expect(inferEmailLanguageFromCountry("Brazil")).toBe("pt-br");
    expect(inferEmailLanguageFromCountry("Czech Republic")).toBe("cs");
    expect(inferEmailLanguageFromCountry("Sweden")).toBe("sv");
    expect(inferEmailLanguageFromCountry("Portugal")).toBe("pt");
  });

  it("does not guess in multilingual countries without a clear region", () => {
    expect(inferEmailLanguageFromCountry("Belgium")).toBeNull();
    expect(inferEmailLanguageFromCountry("Canada")).toBeNull();
    expect(inferEmailLanguageFromCountry("Switzerland")).toBeNull();
    expect(inferEmailLanguageFromCountry("Belgium", "Brussels")).toBeNull();
    expect(inferEmailLanguageFromCountry("Canada", "New Brunswick")).toBeNull();
    expect(inferEmailLanguageFromCountry("Switzerland", "Bern")).toBeNull();
    expect(resolveEmailLocaleFromSources({ country: "Switzerland" }).language).toBe("en");
  });

  it("uses region data only where it identifies one supported language", () => {
    expect(inferEmailLanguageFromCountry("BE", "Flanders")).toBe("nl");
    expect(inferEmailLanguageFromCountry("Belgium", "Wallonia")).toBe("fr");
    expect(inferEmailLanguageFromCountry("BE", "BE-DE")).toBe("de");
    expect(inferEmailLanguageFromCountry("CA", "CA-QC")).toBe("fr");
    expect(inferEmailLanguageFromCountry("CH", "Ticino")).toBe("it");
    expect(inferEmailLanguageFromCountry("CH", "Vaud")).toBe("fr");
  });

  it("supports only the twelve application locales", () => {
    expect(EMAIL_LANGUAGES).toEqual([
      "en", "fr", "es", "de", "it", "pt", "pt-br", "nl", "pl", "sv", "ro", "cs",
    ]);
    expect(normalizeEmailLanguage("pt_BR")).toBe("pt-br");
    expect(normalizeEmailLanguage("pt-PT")).toBe("pt");
    expect(normalizeEmailLanguage("xx")).toBeNull();
  });

  it("resolves a recipient without an authenticated request session", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const locale = await resolveEmailLocale("external@example.test", {
      country: "Spain",
      lookupByEmail: false,
    }, query);
    expect(locale.language).toBe("es");
    expect(locale.source).toBe("country-region");
    expect(query).not.toHaveBeenCalled();
  });

  it("does not query account state in tests unless explicitly requested", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    const locale = await resolveEmailLocale("owner@example.test", {
      orgId: "00000000-0000-4000-8000-000000000001",
      country: "France",
    }, query);
    expect(locale.language).toBe("fr");
    expect(query).not.toHaveBeenCalled();
  });

  it("uses a captured locale after the account has been deleted", async () => {
    const captured = resolveEmailLocaleFromSources({ explicitLanguage: "it" });
    const locale = await resolveEmailLocale("deleted@example.test", {
      resolvedLocale: captured,
      lookupByEmail: false,
    });
    expect(locale).toEqual(captured);
  });
});
