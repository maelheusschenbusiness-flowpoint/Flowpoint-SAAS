/**
 * dashboard.js — affichage d'un 402 TRIAL_EXPIRED (essai sans carte expire).
 *
 * Playwright est installe mais aucun navigateur n'est telechargeable dans cet
 * environnement (cdn.playwright.dev bloque) : test DOM. La fonction reelle est
 * extraite de dashboard.js (entre ses marqueurs) et executee contre un DOM
 * minimal ; le branchement dans apiFetch est verifie par contrat de source.
 *
 * Teste en simulation : bandeau unique, message, lien de paiement, filtrage du
 * lien, absence d'innerHTML. Validation reelle restante : rendu visuel dans un
 * navigateur sur le vrai dashboard.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const src = readFileSync(resolve(__dirname, "../../../flowpoint-export/dashboard.js"), "utf8");
const fnSrc = src.slice(src.indexOf("// ── FP_TRIAL_EXPIRED_BANNER:start"), src.indexOf("// ── FP_TRIAL_EXPIRED_BANNER:end"));

type El = { tagName: string; id: string; className: string; textContent: string; style: { cssText: string };
  attrs: Record<string, string>; children: El[]; firstChild: El | null; innerHTMLSet: boolean;
  setAttribute(k: string, v: string): void; appendChild(c: El): El; insertBefore(c: El, ref: El | null): El;
  querySelector(sel: string): El | null; };
function makeEl(tag: string): El {
  const el: El = {
    tagName: tag.toUpperCase(), id: "", className: "", textContent: "", style: { cssText: "" }, attrs: {}, children: [],
    get firstChild() { return this.children[0] ?? null; }, innerHTMLSet: false,
    setAttribute(k, v) { this.attrs[k] = v; },
    appendChild(c) { this.children.push(c); return c; },
    insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
    querySelector(sel) {
      const cls = sel.replace(/^\./, "");
      const walk = (n: El): El | null => { for (const ch of n.children) { if (ch.className === cls) return ch; const f = walk(ch); if (f) return f; } return null; };
      return walk(this);
    },
  } as El;
  Object.defineProperty(el, "innerHTML", { set() { el.innerHTMLSet = true; } });
  return el;
}
function makeDoc() {
  const body = makeEl("body");
  body.appendChild(makeEl("main"));
  const all = (n: El): El[] => [n, ...n.children.flatMap(all)];
  return { body, createElement: makeEl, getElementById: (id: string) => all(body).find(e => e.id === id) ?? null };
}
function load() {
  const ctx: Record<string, unknown> = {};
  vm.createContext(ctx);
  vm.runInContext(fnSrc + "\nthis.fn = fpShowTrialExpiredBanner;", ctx);
  return ctx["fn"] as (d: unknown, doc: unknown) => El | null;
}

describe("dashboard : 402 TRIAL_EXPIRED", () => {
  it("le bloc existe et apiFetch l'appelle sur 402 + code TRIAL_EXPIRED", () => {
    expect(fnSrc.length).toBeGreaterThan(200);
    expect(src).toMatch(/if \(res\.status === 402 && err\.code === 'TRIAL_EXPIRED'\) \{\s*try \{ fpShowTrialExpiredBanner\(detail\); \} catch \(_\) \{\}/);
  });
  it("affiche un bandeau en tete de page : message serveur + lien de paiement", () => {
    const doc = makeDoc();
    const bar = load()({ code: "TRIAL_EXPIRED", error: "Votre essai gratuit est terminé.", redirectTo: "/dashboard.html#billing/plans" }, doc)!;
    expect(doc.body.children[0]).toBe(bar);
    expect(bar.attrs["role"]).toBe("alert");
    expect(bar.querySelector(".fp-trial-expired-text")!.textContent).toBe("Votre essai gratuit est terminé.");
    const cta = bar.querySelector(".fp-trial-expired-cta")!;
    expect(cta.attrs["href"]).toBe("/dashboard.html#billing/plans");
    expect(cta.textContent).toMatch(/Activer mon abonnement/);
  });
  it("idempotent : plusieurs 402 → un seul bandeau", () => {
    const doc = makeDoc(); const fn = load();
    fn({ code: "TRIAL_EXPIRED" }, doc); fn({ code: "TRIAL_EXPIRED" }, doc); fn({ code: "TRIAL_EXPIRED" }, doc);
    expect(doc.body.children.filter(c => c.id === "fp-trial-expired-banner")).toHaveLength(1);
  });
  it("lien externe ou protocole-relatif refuse → page Facturation ; message par defaut ; jamais d'innerHTML", () => {
    const doc = makeDoc(); const fn = load();
    for (const bad of ["https://evil.example/pay", "//evil.example", "javascript:alert(1)"]) {
      const bar = fn({ code: "TRIAL_EXPIRED", redirectTo: bad, error: "<img src=x onerror=alert(1)>" }, doc)!;
      expect(bar.querySelector(".fp-trial-expired-cta")!.attrs["href"]).toBe("/dashboard.html#billing/plans");
      expect(bar.querySelector(".fp-trial-expired-text")!.textContent).toBe("<img src=x onerror=alert(1)>"); // texte brut
      expect(bar.innerHTMLSet).toBe(false);
    }
    const bar2 = fn({ code: "TRIAL_EXPIRED" }, makeDoc())!;
    expect(bar2.querySelector(".fp-trial-expired-text")!.textContent).toMatch(/essai gratuit est terminé/);
  });
});
