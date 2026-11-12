/**
 * utm-capture.js — la campagne UTM suit le visiteur CONSENTANT, premiere touche,
 * valeurs validees, uniquement vers les requetes de suivi. Le script reel est execute.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const SRC = readFileSync(join(process.cwd(), "../flowpoint-export/utm-capture.js"), "utf8");

function boot(opts: { consent?: boolean; search?: string; stored?: unknown }) {
  const store: Record<string, string> = opts.stored !== undefined ? { fp_funnel_campaign: JSON.stringify(opts.stored) } : {};
  const sent: Array<{ url: string; body: unknown }> = [];
  const win: Record<string, unknown> = {
    location: { search: opts.search ?? "", href: "https://app.flowpoint.pro/signin.html" },
    fetch: (url: string, init?: { body?: string }) => { sent.push({ url, body: init?.body ? JSON.parse(init.body) : undefined }); return Promise.resolve({ ok: true }); },
  };
  win["window"] = win;
  runInNewContext(SRC, {
    window: win, document: { cookie: opts.consent === false ? "" : "a=1; fp_analytics_consent=accepted" },
    localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } },
    URL, URLSearchParams, JSON, Object, Array,
  });
  return { call: (path: string, body: unknown) => (win["fetch"] as (u: string, i: unknown) => Promise<unknown>)(path, { method: "POST", body: JSON.stringify(body) }), sent, store };
}
const Q = "?utm_source=Instagram&utm_medium=social&utm_campaign=reel_oct";

describe("utm-capture.js", () => {
  it("ajoute la campagne (normalisée) aux requêtes de suivi, après consentement", async () => {
    const s = boot({ search: Q });
    await s.call("/api/auth/pre-register", { email: "x", visiteurId: "v" });
    expect(s.sent[0]!.body).toMatchObject({ visiteurId: "v", utm_source: "instagram", utm_medium: "social", utm_campaign: "reel_oct" });
  });
  it("ne fait rien sans consentement : rien lu, rien rangé, requête inchangée", async () => {
    const s = boot({ consent: false, search: Q });
    await s.call("/api/public/funnel-event", { etape: "tarifs_vus" });
    expect(s.sent[0]!.body).toEqual({ etape: "tarifs_vus" });
    expect(s.store["fp_funnel_campaign"]).toBeUndefined();
  });
  it("première touche : la campagne rangée l'emporte sur une nouvelle URL", async () => {
    const s = boot({ search: "?utm_source=google", stored: { utm_source: "instagram" } });
    await s.call("/api/public/payment-intent", { plan: "pro" });
    expect((s.sent[0]!.body as Record<string, string>)["utm_source"]).toBe("instagram");
  });
  it("ignore les valeurs hors motif, sans les tronquer", async () => {
    const s = boot({ search: "?utm_source=a%40b.c&utm_medium=%3Cscript%3E&utm_campaign=" + "x".repeat(65) });
    await s.call("/api/auth/pre-register", { email: "x" });
    expect(s.sent[0]!.body).toEqual({ email: "x" });
  });
  it("ne touche jamais une autre requête, ni un champ déjà présent", async () => {
    const s = boot({ search: Q });
    await s.call("/api/me", { a: 1 });
    await s.call("/api/auth/pre-register", { utm_source: "explicit" });
    expect(s.sent[0]!.body).toEqual({ a: 1 });
    expect((s.sent[1]!.body as Record<string, string>)["utm_source"]).toBe("explicit");
  });
  it("est chargé sur les quatre pages du tunnel", () => {
    for (const page of ["pricing.html", "signin.html", "checkout.html", "checkout-payment.html"]) {
      expect(readFileSync(join(process.cwd(), "../flowpoint-export", page), "utf8")).toContain('<script src="/utm-capture.js" defer></script>');
    }
  });
});
