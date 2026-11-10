import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Les 8 pages du tunnel d'inscription sont rédigées en anglais (langue par
// défaut). fp-locale.js doit les traduire EN -> FR pour un visiteur dont la
// préférence est le français, sans toucher au comportement anglais ni aux
// autres pages publiques (source française traduite en anglais).

// jsdom n'a pas de déclarations de types installées : chargement non typé.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: any };

const exportDir = resolve(process.cwd(), "../flowpoint-export");
const localeSource = readFileSync(resolve(exportDir, "fp-locale.js"), "utf8");

const FUNNEL_PAGES = [
  "signin.html",
  "login.html",
  "login-verify.html",
  "checkout.html",
  "checkout-payment.html",
  "checkout-return.html",
  "success.html",
  "cancel.html",
];

// Textes qui restent identiques en français (marques, fragments du logo,
// unités, noms de plans).
const ALLOWED_UNTRANSLATED = new Set([
  "FlowPoint", "Flow", "Point", "Google", "Stripe", "GitHub",
  "Standard", "Pro", "Ultra", "Plans", "s",
]);

function loadPage(page: string, language: string | null, html?: string): any {
  const source = html ?? readFileSync(resolve(exportDir, page), "utf8");
  const dom = new JSDOM(source, { url: `http://localhost/${page}`, runScripts: "outside-only" });
  if (language !== null) dom.window.localStorage.setItem("fp:language", language);
  dom.window.eval(localeSource);
  if (dom.window.document.readyState === "loading") {
    dom.window.document.dispatchEvent(new dom.window.Event("DOMContentLoaded"));
  }
  return dom;
}

function visibleTexts(doc: Document): string[] {
  const out: string[] = [];
  const walker = doc.createTreeWalker(doc.body, 4);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const parent = (node as Text).parentElement;
    if (!parent || /^(SCRIPT|STYLE|NOSCRIPT|CODE|PRE|OPTION)$/.test(parent.tagName)) continue;
    const text = (node.nodeValue ?? "").trim();
    if (/\p{L}/u.test(text)) out.push(text);
  }
  doc.querySelectorAll("[placeholder], [aria-label], [title]").forEach((el) => {
    for (const attr of ["placeholder", "aria-label", "title"]) {
      const value = el.getAttribute(attr)?.trim();
      if (value && /\p{L}/u.test(value)) out.push(value);
    }
  });
  return out;
}

describe("fp-locale.js — tunnel d'inscription anglais, français sur préférence", () => {
  it("sans préférence : l'anglais reste intact et lang=\"en\"", () => {
    const raw = readFileSync(resolve(exportDir, "checkout.html"), "utf8");
    const before = new JSDOM(raw).window.document.body.textContent;
    const dom = loadPage("checkout.html", null);
    expect(dom.window.document.documentElement.lang).toBe("en");
    expect(dom.window.document.body.textContent).toBe(before);
    expect(dom.window.document.title).toBe("Summary — FlowPoint");
  });

  it("préférence 'en' ou autre langue : anglais conservé, lang=\"en\"", () => {
    for (const language of ["en", "de"]) {
      const dom = loadPage("signin.html", language);
      expect(dom.window.document.documentElement.lang).toBe("en");
      expect(dom.window.document.body.textContent).toContain("Create your account");
    }
  });

  it("préférence 'fr' : pages statiques en français et lang=\"fr\"", () => {
    const dom = loadPage("signin.html", "fr");
    const doc = dom.window.document;
    expect(doc.documentElement.lang).toBe("fr");
    expect(doc.title).toBe("FlowPoint — Créer votre compte");
    expect(doc.body.textContent).toContain("Créer votre compte");
    expect(doc.body.textContent).toContain(
      "14 jours d'essai gratuit · Carte requise · Annulation à tout moment",
    );
    expect(doc.body.textContent).not.toContain("Create your account");
  });

  it("préférence 'fr' : contenu dynamique (prix, essai) traduit via l'observateur", async () => {
    const dom = loadPage("checkout.html", "fr");
    const doc = dom.window.document;
    const box = doc.createElement("div");
    box.innerHTML =
      '<button><span>Start my 14-day free trial →</span></button>' +
      "<p>€0 today · Card required · Cancel anytime</p>" +
      '<div class="fp-trial-free">14 days free</div>' +
      '<div class="fp-trial-after">€29/month after trial</div>' +
      "<p>Then €29.50/month after your 14-day trial. Cancel anytime before to avoid being charged.</p>" +
      "<p>Pay €12.50 and subscribe</p>";
    doc.body.appendChild(box);
    await new Promise((r) => setTimeout(r, 0));
    const text = box.textContent ?? "";
    expect(text).toContain("Commencer mon essai gratuit de 14 jours →");
    expect(text).toContain("0 € aujourd'hui · Carte bancaire requise · Annulable à tout moment");
    expect(text).toContain("14 jours gratuits");
    expect(text.replace(/ /g, " ")).toContain("puis 29 €/mois après l'essai");
    expect(text.replace(/ /g, " ")).toContain(
      "Puis 29,50 €/mois après votre essai de 14 jours. Annulez avant la fin pour ne pas être débité.",
    );
    expect(text.replace(/ /g, " ")).toContain("Payer 12,50 € et s'abonner");
  });

  it("couverture : chaque texte visible des 8 pages a une traduction française", () => {
    const missing: string[] = [];
    let total = 0;
    for (const page of FUNNEL_PAGES) {
      const english = visibleTexts(loadPage(page, "en").window.document);
      const french = visibleTexts(loadPage(page, "fr").window.document);
      expect(french.length).toBe(english.length);
      english.forEach((text, i) => {
        if (ALLOWED_UNTRANSLATED.has(text)) return;
        total += 1;
        if (french[i] === text) missing.push(`${page}: ${text}`);
      });
    }
    console.log(`fr coverage: ${total - missing.length}/${total}`);
    expect(total).toBeGreaterThan(80);
    expect(missing).toEqual([]);
  });

  it("page hors tunnel en 'en' : la source française est toujours traduite en anglais", () => {
    const html =
      '<!doctype html><html lang="fr"><head><title>FlowPoint — Créer votre compte</title></head>' +
      "<body><h1>Continuer avec Google</h1><input placeholder=\"Marie\"></body></html>";
    const dom = loadPage("pricing.html", "en", html);
    const doc = dom.window.document;
    expect(doc.documentElement.lang).toBe("en");
    expect(doc.title).toBe("FlowPoint — Create your account");
    expect(doc.querySelector("h1")?.textContent).toBe("Continue with Google");
    expect(doc.querySelector("input")?.getAttribute("placeholder")).toBe("Jane");

    const fr = loadPage("pricing.html", "fr", html).window.document;
    expect(fr.documentElement.lang).toBe("fr");
    expect(fr.querySelector("h1")?.textContent).toBe("Continuer avec Google");
  });

  it("fpPublicText / fpPublicTranslateText inchangés hors tunnel", () => {
    const en = loadPage("pricing.html", "en", "<html><body></body></html>").window as any;
    expect(en.fpPublicText("Continuer avec Google", "x")).toBe("Continue with Google");
    expect(en.fpPublicTranslateText("Continuer avec Google")).toBe("Continue with Google");
    const fr = loadPage("pricing.html", "fr", "<html><body></body></html>").window as any;
    expect(fr.fpPublicText("Continuer avec Google", "Continue with Google")).toBe("Continuer avec Google");
    expect(fr.fpPublicTranslateText("Continuer avec Google")).toBe("Continuer avec Google");
  });
});
