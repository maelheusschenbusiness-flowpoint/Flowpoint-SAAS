import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Tableau de bord sur un appareil neuf : la langue du compte (/api/me.language) s'applique quand aucun choix
// explicite (fp:language) n'est memorise sur l'appareil, et la visite guidee d'accueil suit la langue active.
// Le miroir src/frontend/dashboard.js doit rester identique a la source servie.

const source = readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8");
const miroir = readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8");

describe("dashboard.js : langue du compte et visite guidee", () => {
  it("le miroir src/frontend/dashboard.js est identique", () => {
    expect(miroir === source).toBe(true);
  });

  it("la langue du compte s'applique seulement sans choix local, sans detection du navigateur", () => {
    const i = source.indexOf("Langue du compte sur un appareil neuf");
    expect(i).toBeGreaterThan(0);
    const bloc = source.slice(source.indexOf("try {", i), i + 1200);
    expect(bloc).toContain("STATE.me.language");
    expect(bloc).toContain("!localStorage.getItem('fp:language')");
    expect(bloc).not.toMatch(/navigator\.language|Accept-Language/);
  });

  it("chaque titre et description de la visite guidee a une traduction anglaise et passe par fpT", () => {
    const debut = source.indexOf("const FP_ONBOARDING_STEPS = [");
    const fin = source.indexOf("];", debut);
    const bloc = source.slice(debut, fin);
    const textes = [...bloc.matchAll(/(?:title|desc):\s*'((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]!.replace(/\\'/g, "'"));
    expect(textes.length).toBe(12);
    const catalogue = source.slice(source.indexOf("var FP_I18N_EN = {"));
    for (const t of textes) expect(catalogue, t).toContain(`"${t}": "`);
    expect(source).toContain("escHtml(fpT(step.title))");
    expect(source).toContain("escHtml(fpT(step.desc))");
  });
});
