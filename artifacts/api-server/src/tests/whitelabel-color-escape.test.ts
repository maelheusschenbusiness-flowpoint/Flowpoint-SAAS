/**
 * La couleur de marque White-Label ne doit pas pouvoir sortir de son attribut.
 *
 * `_wl.primaryColor` et `_wl.secondaryColor` viennent des reglages du workspace,
 * donc d'une saisie. La carte White-Label les injectait deux fois SANS
 * echappement : dans `style="…background:${f.val}…"` (attribut a guillemets
 * doubles) et dans le contenu du `<span>`. Les champs texte voisins, eux,
 * passaient deja par `escHtml`.
 *
 * La garde n'est pas nouvelle : `services/pdf.ts` applique le meme motif hex a la
 * meme valeur. Ces tests verifient que les deux consommateurs sont alignes, et
 * que les DEUX copies du tableau de bord le sont entre elles.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const EXPORT = join(root, "artifacts/flowpoint-export/dashboard.js");
const SOURCE = join(root, "src/frontend/dashboard.js");
const read = (p: string) => readFileSync(p, "utf8");
const PDF = read(join(root, "artifacts/api-server/src/services/pdf.ts"));

describe.each([["export", EXPORT], ["source", SOURCE]])("carte White-Label (%s)", (_n, path) => {
  const js = read(path);

  it("la couleur passe par une garde avant d entrer dans l attribut style", () => {
    expect(js).toContain("background:${_fpSafeColor(f.val)}");
    expect(js).not.toContain("background:${f.val}");
  });

  it("la valeur affichee est echappee", () => {
    expect(js).toContain('color:var(--fp-text-soft)">${escHtml(f.val)}</span>');
  });

  it("la garde n accepte qu un hexadecimal a six chiffres", () => {
    const m = /function _fpSafeColor\(v\) \{\s*return \(typeof v === 'string' && (\/\^#\[0-9a-fA-F\]\{6\}\$\/)\.test\(v\)\) \? v : '(#[0-9A-Fa-f]{6})';/.exec(js);
    expect(m, "la garde doit etre presente et de cette forme").not.toBeNull();
  });

  it("elle applique le MEME motif que le generateur de PDF", () => {
    // Si les deux divergent un jour, une valeur acceptee ici serait refusee la-bas.
    const motif = /\/\^#\[0-9a-fA-F\]\{6\}\$\//;
    expect(motif.test(js)).toBe(true);
    expect(motif.test(PDF)).toBe(true);
  });
});

describe("la garde se comporte comme attendu", () => {
  // On reconstruit la fonction depuis la source livree : c'est elle qu'on teste,
  // pas une copie qui pourrait diverger.
  const src = read(EXPORT);
  const body = /function _fpSafeColor\(v\) \{[\s\S]*?\n\}/.exec(src)![0];
  // eslint-disable-next-line no-new-func
  const safe = new Function(`${body}; return _fpSafeColor;`)() as (v: unknown) => string;

  it.each([
    ["#2563EB", "#2563EB"],
    ["#abcdef", "#abcdef"],
  ])("laisse passer %s", (input, expected) => expect(safe(input)).toBe(expected));

  it.each([
    ['#fff" onmouseover="alert(1)'],
    ['red;"><script>alert(1)</script>'],
    ["#fff"],
    ["javascript:alert(1)"],
    [""],
    [null],
    [undefined],
    [{}],
  ])("remplace une valeur hostile ou invalide : %s", (bad) => {
    expect(safe(bad as unknown)).toBe("#2563EB");
  });

  it("aucune valeur refusee ne peut contenir un guillemet", () => {
    for (const bad of ['#fff"', 'x"y', '"']) expect(safe(bad)).not.toContain('"');
  });
});
