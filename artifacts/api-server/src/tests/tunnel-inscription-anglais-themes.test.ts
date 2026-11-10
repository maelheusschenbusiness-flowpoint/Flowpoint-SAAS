/**
 * Signup funnel — full English, trial-first offer and shared light/dark theme.
 *
 * The funnel pages are served as static files from artifacts/flowpoint-export.
 * These checks read the sources directly:
 *  - no French left in what the user can see (text, titles, placeholders,
 *    aria-labels, JS string literals that end up in the DOM);
 *  - every page boots the theme before first paint and loads the shared
 *    tokens and the live system-theme listener;
 *  - funnel-theme.js: manual choice wins, otherwise the system theme is
 *    followed live.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const DIR = join(process.cwd(), "../flowpoint-export");
const PAGES = [
  "signin.html", "login.html", "login-verify.html",
  "checkout.html", "checkout-payment.html",
  "checkout-return.html", "success.html", "cancel.html",
];
const lire = (f: string) => readFileSync(join(DIR, f), "utf8");

/** French markers: accented letters used by French, or very common French words. */
const FRANCAIS = /[éèêàâçùûôîœ]|\b(?:vous|votre|vos|nous|avec|sans|pour|mois|essai|paiement|carte|jours|gratuit|abonnement|connexion|compte|erreur|réessayer)\b/i;

/** Visible text of the HTML (scripts, styles and comments removed). */
function texteVisible(html: string): string[] {
  const corps = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ");
  const textes = corps.split(/<[^>]+>/).map((t) => t.replace(/&[a-z#0-9]+;/gi, " ").trim()).filter(Boolean);
  const attrs = [...corps.matchAll(/\s(?:placeholder|title|aria-label|alt|content)="([^"]*)"/gi)].map((m) => m[1]);
  return [...textes, ...attrs];
}

/** String literals of inline scripts, comments removed (they may stay French). */
function chainesScripts(html: string): string[] {
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const out: string[] = [];
  for (const s of scripts) {
    const sansCommentaires = s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:"'\\])\/\/[^\n]*/g, "$1");
    for (const m of sansCommentaires.matchAll(/'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
      out.push(m[1] ?? m[2] ?? m[3] ?? "");
    }
  }
  return out;
}

describe("signup funnel is entirely in English", () => {
  for (const page of PAGES) {
    it(`${page}: no French in visible text or script strings, lang="en"`, () => {
      const html = lire(page);
      expect(html).toMatch(/<html[^>]*\blang="en"/);
      const francais = [...texteVisible(html), ...chainesScripts(html)].filter((t) => FRANCAIS.test(t));
      expect(francais, `French strings left in ${page}`).toEqual([]);
    });
  }
});

describe("trial-first offer and summary CTA", () => {
  const checkout = lire("checkout.html");
  it("plan cards lead with the free trial, price secondary, and state the conditions", () => {
    // Rendu partagé depuis le 10/11/2026 (funnel-offer.js), utilisé par checkout.html et signin.html.
    const offre = lire("funnel-offer.js");
    expect(offre).toMatch(/days free/);
    expect(offre).toMatch(/\/month after trial/);
    expect(checkout).toMatch(/src="\/funnel-offer\.js/);
    expect(checkout).toContain("window.FPOffer.offerHtml(");
    for (const c of ["€0 today", "Card required", "Cancel anytime"]) expect(checkout).toContain(c);
  });
  it("summary CTA starts the free trial and keeps the card requirement visible", () => {
    expect(checkout).toMatch(/Start my ['"`+\s\w.()]*-day free trial →|Start my 14-day free trial →/);
    expect(checkout).toContain("€0 today · Card required · Cancel anytime");
    expect(checkout).not.toContain("Continuer vers le paiement sécurisé");
  });
});

describe("shared light/dark theme", () => {
  for (const page of PAGES) {
    it(`${page}: boots the theme before first paint and loads the shared theme`, () => {
      const html = lire(page);
      const head = html.slice(0, html.search(/<\/head>/i));
      const boot = head.indexOf("prefers-color-scheme: light");
      const premierStyle = head.search(/<style\b|<link[^>]+stylesheet/i);
      expect(boot, "inline theme boot missing").toBeGreaterThan(-1);
      expect(boot, "theme boot must run before the first stylesheet").toBeLessThan(premierStyle);
      expect(head).toContain("fp:theme");
      expect(head).toMatch(/href="\/funnel-theme\.css/);
      expect(html).toMatch(/src="\/funnel-theme\.js/);
    });
  }

  it("funnel-theme.css defines both themes with the same tokens", () => {
    const css = lire("funnel-theme.css");
    const jetons = (bloc: string) => [...bloc.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]).sort();
    const sombre = css.slice(css.indexOf(":root"), css.indexOf("}", css.indexOf(":root")));
    const clairDebut = css.indexOf('html[data-theme="light"]');
    const clair = css.slice(clairDebut, css.indexOf("}", clairDebut));
    expect(jetons(clair)).toEqual(jetons(sombre));
  });

  function executerTheme(o: { manuel?: string; systemeClair: boolean }) {
    const listeners: Array<() => void> = [];
    const attrs: Record<string, string> = {};
    const store: Record<string, string> = o.manuel ? { "fp:theme": o.manuel } : {};
    const mq = { matches: o.systemeClair, addEventListener: (_: string, f: () => void) => listeners.push(f) };
    const ctx = {
      localStorage: { getItem: (k: string) => store[k] ?? null },
      window: { matchMedia: () => mq, addEventListener: () => {} } as Record<string, unknown>,
      document: {
        documentElement: { setAttribute: (k: string, v: string) => { attrs[k] = v; }, getAttribute: (k: string) => attrs[k], style: {} },
        getElementById: () => null, querySelector: () => null,
      },
    };
    vm.runInNewContext(lire("funnel-theme.js"), ctx);
    return { attrs, mq, listeners, store };
  }

  it("follows the system theme and updates live without reload", () => {
    const r = executerTheme({ systemeClair: false });
    expect(r.attrs["data-theme"]).toBe("dark");
    r.mq.matches = true; r.listeners.forEach((f) => f());
    expect(r.attrs["data-theme"]).toBe("light");
  });

  it("an explicit user choice wins over the system theme", () => {
    const r = executerTheme({ manuel: "dark", systemeClair: true });
    expect(r.attrs["data-theme"]).toBe("dark");
    r.listeners.forEach((f) => f());
    expect(r.attrs["data-theme"]).toBe("dark");
  });
});
