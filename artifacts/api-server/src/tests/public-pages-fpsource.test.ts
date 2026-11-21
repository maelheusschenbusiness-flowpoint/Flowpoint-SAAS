/**
 * Pages publiques : tout helper `_fpSource` appelé est défini (régression #476).
 *
 * #476 a remplacé `btn.textContent === '…'` par `_fpSource(btn) === '…'` dans
 * pricing.html sans définir `_fpSource` : ReferenceError au chargement de la page
 * (et de checkout-return.html, qui y redirige), la table de comparaison n'était
 * plus synchronisée et les libellés de boutons d'abonnement n'étaient plus restaurés.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const DIR = import.meta.dirname ?? __dirname;
const EXPORT = path.join(DIR, "../../../flowpoint-export");

const pages = fs.readdirSync(EXPORT).filter((f) => f.endsWith(".html"));

describe("pages publiques : _fpSource", () => {
  for (const page of pages) {
    const html = fs.readFileSync(path.join(EXPORT, page), "utf8");
    if (!/_fpSource\s*\(/.test(html)) continue;
    it(`${page} définit _fpSource avant de l'utiliser`, () => {
      const def = html.search(/function\s+_fpSource\s*\(/);
      expect(def).toBeGreaterThanOrEqual(0);
      // Définie dans un script chargé avant le premier appel.
      const firstCall = html.search(/_fpSource\s*\((?!el\))/);
      expect(def).toBeLessThan(firstCall);
    });
    it(`${page} : _fpSource lit le texte d'origine via fp-locale`, () => {
      expect(html).toMatch(/window\.fpPublicSourceText\(el\)/);
      expect(html.indexOf('src="/fp-locale.js"')).toBeLessThan(html.search(/function\s+_fpSource/));
    });
  }

  it("fp-locale.js expose fpPublicSourceText", () => {
    const js = fs.readFileSync(path.join(EXPORT, "fp-locale.js"), "utf8");
    expect(js).toMatch(/window\.fpPublicSourceText\s*=\s*function/);
  });

  it("au moins une page utilise _fpSource (sinon le test ne vérifie rien)", () => {
    expect(pages.some((p) => /_fpSource\s*\(/.test(fs.readFileSync(path.join(EXPORT, p), "utf8")))).toBe(true);
  });
});
