/**
 * Continuite de langue site vitrine -> application : `?lang=` amorce la langue,
 * sans jamais ecraser une preference existante ni forcer le francais.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const SRC = readFileSync(join(process.cwd(), "../flowpoint-export/fp-locale.js"), "utf8");
const start = SRC.indexOf("(function seedLanguageFromUrl()");
const end = SRC.indexOf("})();", start) + "})();".length;
const block = SRC.slice(start, end);
const LOCALES = { "pt-br": 1, fr: 1, en: 1, es: 1, de: 1, it: 1, pt: 1, nl: 1, pl: 1, sv: 1, ro: 1, cs: 1 };

function run(search: string, stored?: string) {
  const store: Record<string, string> = stored === undefined ? {} : { "fp:language": stored };
  runInNewContext(block, {
    URLSearchParams, String, RegExp, Object,
    LOCALE_BY_LANGUAGE: LOCALES,
    window: { location: { search } },
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
  });
  return store["fp:language"];
}

describe("seedLanguageFromUrl", () => {
  it("retient la langue du lien quand rien n'est enregistré", () => {
    expect(run("?lang=fr")).toBe("fr");
    expect(run("?lang=DE")).toBe("de");
    expect(run("?lang=pt_BR")).toBe("pt-br");
    expect(run("?lang=es-MX&plan=pro")).toBe("es"); // variante régionale -> langue de base
  });
  it("ne remplace JAMAIS une préférence existante", () => {
    expect(run("?lang=fr", "en")).toBe("en");
    expect(run("?lang=de", "fr")).toBe("fr");
  });
  it("ignore tout ce qui n'est pas une langue supportée : rien n'est écrit, l'anglais reste le repli", () => {
    for (const bad of ["?lang=xx", "?lang=klingon", "?lang=", "?lang=fr<script>", "?lang=../..", "?lang=__proto__", "?lang=f", "?plan=pro", ""]) {
      expect(run(bad)).toBeUndefined();
    }
  });
  it("le français n'est jamais un repli : un lien sans langue n'écrit pas 'fr'", () => {
    expect(run("?plan=pro&utm_source=x")).toBeUndefined();
  });
  it("l'amorçage est placé avant la traduction du document, dans l'exemplaire servi", () => {
    expect(SRC.indexOf("seedLanguageFromUrl")).toBeLessThan(SRC.indexOf("function translatePublicDocument()"));
  });
});
