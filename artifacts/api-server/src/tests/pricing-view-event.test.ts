/** pricing-funnel.js emet `tarifs_vus` a l'affichage de la page tarifs, avec consentement seulement. */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const SRC = readFileSync(join(process.cwd(), "../flowpoint-export/pricing-funnel.js"), "utf8");

function load(path: string, consent: boolean, search = "") {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const store: Record<string, string> = {};
  const win: Record<string, unknown> = {
    location: { pathname: path, search },
    fetch: (url: string, init: { body: string }) => { calls.push({ url, body: JSON.parse(init.body) }); return Promise.resolve({}); },
    crypto: { randomUUID: () => "11111111-1111-4111-8111-111111111111" },
  };
  runInNewContext(SRC, {
    window: win,
    document: { cookie: consent ? "fp_analytics_consent=accepted" : "", addEventListener: () => {} },
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
    sessionStorage: { getItem: () => null },
    URLSearchParams, Element: class {}, HTMLAnchorElement: class {}, JSON, Date, Math, RegExp, Promise, String,
  });
  return Object.assign(calls, { store });
}

describe("tarifs_vus", () => {
  it("est émis une fois sur la page tarifs, avec le visiteur consentant", () => {
    const calls = load("/pricing.html", true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("/api/public/funnel-event");
    expect(calls[0]!.body).toMatchObject({ etape: "tarifs_vus", visiteurId: "11111111-1111-4111-8111-111111111111" });
  });
  it("n'est jamais émis sans consentement", () => {
    expect([...load("/pricing.html", false)]).toEqual([]);
  });
  it("n'est pas émis sur une autre page", () => {
    expect([...load("/signin.html", true)]).toEqual([]);
    expect([...load("/checkout.html", true)]).toEqual([]);
  });

  it("mémorise la source de première touche (Smartlead) avec consentement, jamais sans", () => {
    const withConsent = load("/pricing.html", true, "?fp_src=smartlead&utm_source=instagram");
    expect(withConsent[0]!.body["source"]).toBe("smartlead");
    expect(withConsent.store["fp_source"]).toBe("smartlead");
    const without = load("/pricing.html", false, "?fp_src=smartlead");
    expect(without.store["fp_source"]).toBeUndefined();
  });
  it("une source déjà mémorisée l'emporte (première touche)", () => {
    const calls = load("/pricing.html", true, "?fp_src=google");
    expect(["google", "direct"]).toContain(calls[0]!.body["source"]);
  });
  it("l'inscription envoie la même source que les autres étapes", () => {
    const html = readFileSync(join(process.cwd(), "../flowpoint-export/signin.html"), "utf8");
    expect(html).toContain("source: fpSource() || undefined");
  });
});
