/**
 * Non-regression : les pages publiques de l'application s'affichent en ANGLAIS pour tout visiteur
 * sans préférence de langue enregistrée, même avec un navigateur configuré en français.
 *
 * Cause du signalement du 17/11 (voir docs/PUBLIC-PAGES-LANGUE-PAR-DEFAUT.md) : la production sert la
 * branche `Flowpoint`, dont les pages publiques sont rédigées en français et n'ont pas la couche
 * `fp-locale.js`. Ici on fige le comportement attendu de `Test-Replit` :
 *   - aucune préférence : anglais, quelle que soit la langue du navigateur ;
 *   - préférence explicite et prise en charge : respectée (le français reste possible, volontairement) ;
 *   - langue inconnue stockée : anglais ;
 *   - titres, métadonnées, placeholders, aria-label et attributs `title` sans français en mode anglais.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { JSDOM } from "jsdom";

const DIR = join(process.cwd(), "../flowpoint-export");
const LOCALE_SRC = readFileSync(join(DIR, "fp-locale.js"), "utf8");
// `pricing` et `checkout-return` (copie de la page tarifs) se traduisent en partie par des scripts de
// page (catalogue d'add-ons, tableau comparatif) que jsdom n'exécute pas : elles sont couvertes en
// navigateur réel par e2e/parcours/public-pages-default-english.spec.mjs.
const PAGES = [
  "signin", "login", "login-verify", "checkout", "checkout-payment",
  "success", "cancel", "accept-invitation", "report-view",
] as const;
const ALL_PAGES = [...PAGES, "pricing", "checkout-return"] as const;

type Options = { navigatorLanguage: string; stored?: string; search?: string };

async function render(page: string, { navigatorLanguage, stored, search = "" }: Options) {
  const html = readFileSync(join(DIR, `${page}.html`), "utf8").replace(/<script[\s\S]*?<\/script>/gi, "");
  const dom = new JSDOM(html, { url: `https://app.flowpoint.pro/${page}.html${search}`, runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  Object.defineProperty(window.navigator, "language", { value: navigatorLanguage, configurable: true });
  Object.defineProperty(window.navigator, "languages", { value: [navigatorLanguage, "en"], configurable: true });
  if (stored !== undefined) window.localStorage.setItem("fp:language", stored);
  await new Promise((resolve) => setTimeout(resolve, 5));
  window.eval(LOCALE_SRC);
  return window;
}

const FRENCH = /\b(votre|vos|vous|nous|pour|avec|mois|essai|gratuit|gratuits|créer|compte|tarifs?|choisissez|connecter|connexion|déjà|prénom|entreprise|adresse e-mail|se connecter|annul[ée]|paiement|rejoindre|équipe|rapport|vérification)\b|[éèêàçùôîû]/i;

function visibleStrings(window: Awaited<ReturnType<typeof render>>): string[] {
  const doc = window.document;
  const out: string[] = [doc.title];
  const walker = doc.createTreeWalker(doc.body, window.NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const parent = n.parentElement;
    // `#fp-addons-grid` : gabarit statique masqué, remplacé par le catalogue de l'API (traduit à l'affichage).
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(parent.tagName) || parent.closest("[data-fp-user-content],#fp-addons-grid")) continue;
    const t = (n.nodeValue ?? "").trim();
    if (t) out.push(t);
  }
  doc.querySelectorAll("[placeholder],[aria-label],[title],input[type=submit],input[type=button]").forEach((el) => {
    if (el.closest("#fp-addons-grid")) return;
    for (const a of ["placeholder", "aria-label", "title", "value"]) {
      const v = el.getAttribute(a);
      if (v && (a !== "value" || /^(submit|button)$/i.test((el as HTMLInputElement).type))) out.push(v);
    }
  });
  doc.querySelectorAll('meta[name="description"],meta[property^="og:"],meta[name^="twitter:"]').forEach((m) => {
    const c = m.getAttribute("content");
    if (c && !/^https?:\/\//.test(c)) out.push(c);
  });
  return out;
}

describe("pages publiques : anglais par défaut", () => {
  for (const page of PAGES) {
    it(`${page}.html : navigateur français sans préférence enregistrée -> anglais, aucun texte français`, async () => {
      const w = await render(page, { navigatorLanguage: "fr-FR" });
      expect(w.document.documentElement.lang).toBe("en");
      expect(w.localStorage.getItem("fp:language")).toBeNull();
      expect(visibleStrings(w).filter((s) => FRENCH.test(s))).toEqual([]);
    });
  }

  it("la langue du navigateur n'est jamais lue (ni navigator.language, ni Accept-Language)", () => {
    expect(LOCALE_SRC).not.toMatch(/navigator\.(language|languages|userLanguage)/);
    for (const page of ALL_PAGES) {
      expect(readFileSync(join(DIR, `${page}.html`), "utf8")).not.toMatch(/navigator\.(language|languages|userLanguage)/);
    }
  });

  it("une langue inconnue ou invalide enregistrée retombe sur l'anglais", async () => {
    for (const stored of ["xx", "klingon", "", "fr<script>"]) {
      const w = await render("signin", { navigatorLanguage: "fr-FR", stored });
      expect(w.document.documentElement.lang, `stored=${JSON.stringify(stored)}`).toBe("en");
      expect(visibleStrings(w).filter((s) => FRENCH.test(s))).toEqual([]);
    }
  });
});

describe("pages publiques : une langue choisie volontairement est respectée", () => {
  it("français enregistré : les pages s'affichent en français", async () => {
    for (const page of ["signin", "login"] as const) {
      const w = await render(page, { navigatorLanguage: "en-US", stored: "fr" });
      expect(w.document.documentElement.lang, page).toBe("fr");
      expect(visibleStrings(w).some((s) => FRENCH.test(s)), page).toBe(true);
    }
  });

  it("français demandé par le lien (?lang=fr) sans préférence : retenu et mémorisé ; une préférence existante gagne", async () => {
    const seeded = await render("login", { navigatorLanguage: "en-US", search: "?lang=fr" });
    expect(seeded.document.documentElement.lang).toBe("fr");
    expect(seeded.localStorage.getItem("fp:language")).toBe("fr");
    const kept = await render("login", { navigatorLanguage: "fr-FR", stored: "en", search: "?lang=fr" });
    expect(kept.document.documentElement.lang).toBe("en");
    expect(visibleStrings(kept).filter((s) => FRENCH.test(s))).toEqual([]);
  });

  it("espagnol enregistré (pris en charge) : le document n'affiche pas de français", async () => {
    const w = await render("signin", { navigatorLanguage: "fr-FR", stored: "es" });
    expect(visibleStrings(w).filter((s) => FRENCH.test(s))).toEqual([]);
  });
});

describe("textes qui s'affichent après une interaction (relevés en navigateur réel le 17/11)", () => {
  it("« Bientôt disponible » (cellules du tableau comparatif et infobulles) est traduit en anglais", async () => {
    const w = await render("pricing", { navigatorLanguage: "fr-FR" });
    const translate = (w as unknown as { fpTranslatePublicSubtree: (n: Element) => Element }).fpTranslatePublicSubtree;
    const probe = w.document.createElement("div");
    probe.innerHTML = '<span>Bientôt disponible</span><button title="Bientôt disponible" disabled>x</button>';
    w.document.body.appendChild(probe);
    translate(probe);
    expect(probe.querySelector("span")?.textContent).toBe("Coming soon");
    expect(probe.querySelector("button")?.getAttribute("title")).toBe("Coming soon");
  });

  it("accept-invitation : le message d'une invitation déjà acceptée est traduit en entier", async () => {
    const w = await render("accept-invitation", { navigatorLanguage: "fr-FR" });
    const translate = (w as unknown as { fpTranslatePublicSubtree: (n: Element) => Element }).fpTranslatePublicSubtree;
    const probe = w.document.createElement("p");
    probe.textContent = "Cette invitation a déjà été acceptée. Connectez-vous directement.";
    w.document.body.appendChild(probe);
    translate(probe);
    expect(probe.textContent).toBe("This invitation has already been accepted. Sign in directly.");
  });

  it("toute phrase française passée à showError() d'accept-invitation a une traduction anglaise exacte", () => {
    const html = readFileSync(join(DIR, "accept-invitation.html"), "utf8");
    const catalogue = LOCALE_SRC.slice(LOCALE_SRC.indexOf("var PUBLIC_ENGLISH = {"), LOCALE_SRC.indexOf("\n  };", LOCALE_SRC.indexOf("var PUBLIC_ENGLISH = {")));
    const calls = [...html.matchAll(/showError\('((?:[^'\\]|\\.)*)',\s*'((?:[^'\\]|\\.)*)'/g)];
    expect(calls.length).toBeGreaterThanOrEqual(4);
    for (const [, title, body] of calls) {
      for (const text of [title, body]) {
        const french = text!.replace(/\\'/g, "'");
        expect(catalogue.includes(JSON.stringify(french).slice(0, -1)), `non traduit : ${french}`).toBe(true);
      }
    }
  });
});
