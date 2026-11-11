/**
 * Non-regression — defects A, B, C measured on Render TEST (231e5601, 10/11/2026).
 *  A. signin.html plan screen showed « 29 €/month » first, without « 14 days free ».
 *  B. The Stripe Payment Element followed the BROWSER language (French labels on
 *     an English page).
 *  C. /billing/quote answered « Add-on inconnu : "x" » in English mode.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: any };
const EXPORT = resolve(process.cwd(), "../flowpoint-export");
const lire = (f: string) => readFileSync(resolve(EXPORT, f), "utf8");

function avecOffre(fetchImpl: (url: string, init?: any) => any) {
  const dom = new JSDOM(
    `<div id="plan-screen">
       <div data-fp-offer="standard">€29<span>/month</span></div>
       <div data-fp-offer="pro">€79<span>/month</span></div>
       <div data-fp-offer="ultra">€149<span>/month</span></div>
     </div>`,
    { url: "http://localhost/signin.html", runScripts: "outside-only" });
  dom.window.fetch = async (url: string, init?: any) => fetchImpl(String(url), init);
  dom.window.eval(lire("funnel-offer.js"));
  return dom.window;
}
const json = (o: unknown, status = 200) => ({ ok: status < 300, status, json: async () => o });
const CATALOGUE = { plans: [
  { id: "standard", name: "Standard", priceMinor: 2900 },
  { id: "pro", name: "Pro", priceMinor: 7900 },
  { id: "ultra", name: "Ultra", priceMinor: 14900 },
] };

describe("A — signin.html plan screen: trial first, server prices", () => {
  const signin = lire("signin.html");

  it("the three cards are filled by the shared offer renderer, no French price format", () => {
    for (const plan of ["standard", "pro", "ultra"]) expect(signin).toContain(`data-fp-offer="${plan}"`);
    expect(signin).not.toMatch(/\d+ €<span>\/month/);
    expect(signin).toMatch(/src="\/funnel-offer\.js/);
    expect(signin).toMatch(/FPOffer\.fillPlanOffers\(document\.getElementById\('plan-screen'\), _preRegisterToken\)/);
  });

  it("checkout.html uses the same renderer (no duplicated offer logic)", () => {
    const checkout = lire("checkout.html");
    expect(checkout).toMatch(/src="\/funnel-offer\.js/);
    expect(checkout).toContain("function offerHtml(priceMinor, trialDays) { return window.FPOffer.offerHtml(priceMinor, trialDays); }");
    expect(checkout).not.toContain("days free</div>");
  });

  it("trial-eligible: « 14 days free » first, then « €29/month after trial » (server values)", async () => {
    const w = avecOffre((url) => url.includes("catalog") ? json(CATALOGUE)
      : json({ quote: { trialEligible: true, trialDays: 14 } }));
    const r = await w.FPOffer.fillPlanOffers(w.document.getElementById("plan-screen"), "tok");
    expect(r.trialDays).toBe(14);
    const txt = (p: string) => w.document.querySelector(`[data-fp-offer="${p}"]`).textContent.replace(/\s+/g, " ").trim();
    expect(txt("standard")).toBe("14 days free€29/month after trial");
    expect(txt("pro")).toBe("14 days free€79/month after trial");
    expect(txt("ultra")).toBe("14 days free€149/month after trial");
    const premier = w.document.querySelector('[data-fp-offer="pro"] .fp-trial-offer').firstElementChild;
    expect(premier.className).toBe("fp-trial-free");
  });

  it("trial length and prices come from the server, not from the page", async () => {
    const w = avecOffre((url) => url.includes("catalog")
      ? json({ plans: [{ id: "standard", priceMinor: 3150 }, { id: "pro", priceMinor: 7900 }, { id: "ultra", priceMinor: 14900 }] })
      : json({ quote: { trialEligible: true, trialDays: 7 } }));
    await w.FPOffer.fillPlanOffers(w.document.getElementById("plan-screen"), "tok");
    expect(w.document.querySelector('[data-fp-offer="standard"]').textContent).toBe("7 days free€31.50/month after trial");
  });

  it("not trial-eligible or quote unavailable: plain monthly price, no free-trial claim", async () => {
    for (const quote of [json({ quote: { trialEligible: false, trialDays: 14 } }), json({ error: "x" }, 400)]) {
      const w = avecOffre((url) => url.includes("catalog") ? json(CATALOGUE) : quote);
      await w.FPOffer.fillPlanOffers(w.document.getElementById("plan-screen"), "tok");
      const t = w.document.querySelector('[data-fp-offer="pro"]').textContent;
      expect(t).toBe("€79/month");
      expect(t).not.toMatch(/free/);
    }
  });

  it("catalog unavailable: the static fallback stays in place", async () => {
    const w = avecOffre(() => json({}, 503));
    expect(await w.FPOffer.fillPlanOffers(w.document.getElementById("plan-screen"), "tok")).toBeNull();
    expect(w.document.querySelector('[data-fp-offer="pro"]').textContent).toBe("€79/month");
  });
});

describe("B — Stripe Element language follows FlowPoint, never the browser", () => {
  const page = lire("checkout-payment.html");

  it("stripe.elements() receives an explicit locale", () => {
    expect(page).toMatch(/stripe\.elements\(\{ clientSecret: data\.clientSecret, appearance: appearance, locale: stripeLocale \}\)/);
    expect(page).not.toMatch(/locale:\s*['"]auto['"]/);
  });

  it("locale is 'en' by default and for any non-French language, 'fr' only when French is chosen", () => {
    const corps = page.match(/function stripeLocaleFor\(\) \{[\s\S]*?\n  \}/)![0];
    const dom = new JSDOM("", { runScripts: "outside-only" });
    const w = dom.window;
    w.eval(corps);
    for (const [langue, attendu] of [[undefined, "en"], ["en", "en"], ["de", "en"], ["fr", "fr"]] as const) {
      w.fpResolveLanguage = langue === undefined ? undefined : () => langue;
      expect(w.stripeLocaleFor(), String(langue)).toBe(attendu);
    }
  });
});

describe("C — unknown add-on message: English by default, French via fp-locale", () => {
  it("both validation routes answer in English, same status and same check", () => {
    for (const f of ["src/routes/public-billing.ts", "src/routes/billing.ts"]) {
      const src = readFileSync(resolve(process.cwd(), f), "utf8");
      expect(src).toContain('res.status(400).json({ error: `Unknown add-on: "${key}"` });');
      expect(src).not.toContain("Add-on inconnu : ");
    }
  });

  it("a French-speaking visitor still reads it in French on the funnel", () => {
    const dom = new JSDOM("<!doctype html><html><head><title>x</title></head><body></body></html>",
      { url: "http://localhost/checkout.html", runScripts: "outside-only" });
    dom.window.localStorage.setItem("fp:language", "fr");
    dom.window.eval(lire("fp-locale.js"));
    expect(dom.window.fpPublicFunnelTranslateToFrench('Unknown add-on: "monitors10"')).toBe('Add-on inconnu : "monitors10"');
  });
});
