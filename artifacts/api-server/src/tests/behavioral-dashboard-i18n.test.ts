/**
 * Behavioral AI / Revenue Leak / AI CRO : couverture i18n du tableau de bord et affichage
 * honnete des valeurs absentes. Toute chaine fpT('...') des vues et clients API de ces trois
 * modules doit exister dans le catalogue anglais ET dans chacune des 9 autres langues
 * (es, de, it, pt, nl, pl, sv, ro, cs), avec les memes {placeholders}. Une valeur null /
 * indisponible s'affiche « Indisponible », jamais comme un zero mesure.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const dashboards = [
  ["source", resolve(process.cwd(), "../../src/frontend/dashboard.js")],
  ["served", resolve(process.cwd(), "../flowpoint-export/dashboard.js")],
] as const;
const LOCALES = ["es", "de", "it", "pt", "nl", "pl", "sv", "ro", "cs"] as const;

function between(src: string, start: string, end: string): string {
  const a = src.indexOf(start);
  expect(a, `marqueur introuvable : ${start}`).toBeGreaterThan(-1);
  const b = src.indexOf(end, a + start.length);
  expect(b, `marqueur introuvable : ${end}`).toBeGreaterThan(a);
  return src.slice(a, b);
}

function block(lines: string[], startRe: RegExp, endRe: RegExp, from = 0): { obj: Record<string, string>; start: number } {
  const start = lines.findIndex((l, i) => i >= from && startRe.test(l));
  expect(start, `catalogue introuvable : ${startRe}`).toBeGreaterThan(-1);
  let end = start + 1;
  while (!endRe.test(lines[end]!)) end++;
  return { obj: runInNewContext("({" + lines.slice(start + 1, end).join("\n") + "})") as Record<string, string>, start };
}

function catalogs(src: string) {
  const lines = src.split("\n");
  const en = block(lines, /^\s*var FP_I18N_EN = \{/, /^  \};\s*$/).obj;
  const extra = block(lines, /^\s*var FP_I18N_EN_EXTRA = \{/, /^  \};\s*$/).obj;
  const root = lines.findIndex(l => /^\s*var FP_I18N = \{/.test(l));
  const perLocale: Record<string, Record<string, string>> = {};
  for (const l of LOCALES) perLocale[l] = block(lines, new RegExp(`^    ${l}: \\{$`), /^    \},?\s*$/, root).obj;
  return { english: { ...extra, ...en }, perLocale };
}

function fpTLiterals(region: string): string[] {
  const out = new Set<string>();
  let idx = 0;
  while ((idx = region.indexOf("fpT(", idx)) >= 0) {
    let i = idx + 4, depth = 1, q: string | null = null;
    for (; i < region.length && depth > 0; i++) {
      const c = region[i]!;
      if (q) { if (c === "\\") i++; else if (c === q) q = null; }
      else if (c === "'" || c === '"' || c === "`") q = c;
      else if (c === "(") depth++; else if (c === ")") depth--;
    }
    const inner = region.slice(idx + 4, i - 1);
    // Premier argument litteral, et litteraux des ternaires directs : fpT(a ? 'x' : 'y').
    for (const m of inner.matchAll(/(['"])((?:\\.|(?!\1)[^\n\\])+)\1/g)) {
      const lit = m[2]!.replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (/[A-Za-zÀ-ÿ]{2}/.test(lit) && !/^[a-z][A-Za-z0-9_]*$/.test(lit)) out.add(lit);
    }
    idx = i;
  }
  return [...out];
}

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");

describe.each(dashboards)("Behavioral / Revenue Leak / CRO : traductions (%s)", (_name, path) => {
  const src = readFileSync(path, "utf8");
  const { english, perLocale } = catalogs(src);
  const regions = {
    behavior: between(src, "  if (sub === 'behavior') {", "  if (sub === 'dashboards') {"),
    revenueLeak: between(src, "  if (sub === 'revenue-leak') {", "  if (sub === 'cro') {"),
    cro: between(src, "  if (sub === 'cro') {", "  if (sub === 'incidents') {"),
    apiClients: between(src, "window.FP_BEHAVIORAL_API = {", "window.FP_FORECAST_API = {"),
  };

  it("les 10 catalogues existent (anglais + 9 langues)", () => {
    expect(Object.keys(english).length).toBeGreaterThan(1000);
    for (const l of LOCALES) expect(Object.keys(perLocale[l]!).length, l).toBeGreaterThan(1000);
  });

  it.each(Object.entries(regions))("%s : chaque chaine fpT existe en anglais et dans les 9 autres langues", (_r, region) => {
    const literals = fpTLiterals(region);
    expect(literals.length).toBeGreaterThan(5);
    const missing: string[] = [];
    for (const k of literals) {
      if (english[k] === undefined) missing.push(`en <- ${k}`);
      for (const l of LOCALES) if (perLocale[l]![k] === undefined) missing.push(`${l} <- ${k}`);
    }
    expect(missing).toEqual([]);
  });

  it("les traductions conservent les memes {placeholders} que la chaine source", () => {
    const bad: string[] = [];
    for (const region of Object.values(regions)) {
      for (const k of fpTLiterals(region)) {
        if (!/\{\w+\}/.test(k)) continue;
        for (const [l, cat] of [["en", english], ...LOCALES.map(x => [x, perLocale[x]!] as const)] as const) {
          const v = cat[k];
          if (v !== undefined && placeholders(v) !== placeholders(k)) bad.push(`${l} <- ${k}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("aucune traduction ajoutee n'est vide ni identique a la source francaise (hors termes invariants)", () => {
    const invariants = new Set(["Mission", "Action", "Source :", "Erreur"]);
    const suspicious: string[] = [];
    for (const k of fpTLiterals(regions.behavior + regions.revenueLeak + regions.cro)) {
      for (const [l, cat] of [["en", english], ...LOCALES.map(x => [x, perLocale[x]!] as const)] as const) {
        const v = cat[k];
        if (v === undefined) continue;
        if (v.trim() === "" || (v === k && !invariants.has(k) && k.length > 24)) suspicious.push(`${l} <- ${k}`);
      }
    }
    expect(suspicious).toEqual([]);
  });

  it("valeur absente ou null : « Indisponible », jamais un zero mesure ni un tiret muet", () => {
    // Revenue Leak : revenu GA4, perte detectee, gain financier.
    expect(regions.revenueLeak).toContain("fpT('Indisponible')");
    expect(regions.revenueLeak).not.toContain("fpT('Revenu non mesuré')");
    expect(regions.cro).toContain('fpT("Gain financier"), fpT("Indisponible")');
    // CRO : compteurs indisponibles (jamais 0) tant que les recommandations ne sont pas chargees.
    expect(regions.cro).toContain('(Array.isArray(_croRecs) && !window.FP_DATA?.cro?.error) ? String(_croRecs.length) : fpT("Indisponible")');
    // Behavior : toutes les valeurs absentes passent par _NA = fpT('Indisponible').
    expect(regions.behavior).toContain("const _NA = fpT('Indisponible')");
    expect(regions.behavior).not.toContain("'—'");
    expect(regions.behavior).toContain("behavioralAnalysis ? behavioralAnalysis.pageViews.toLocaleString(getLocale()) : _NA");
    expect(regions.behavior).toContain("s.previousSessions==null?_NA");
    // Apercu : la perte de revenus detectee est « Indisponible » quand elle n'est pas mesuree.
    expect(src).toContain('PREVIEW_MODE ? "5 070€/mois" : null, fpT("Indisponible"))');
    expect(src).toContain("fpT('{amount}€/mois', { amount:leakTotal.toLocaleString(getLocale()) }) : fpT('Indisponible')");
  });
});
