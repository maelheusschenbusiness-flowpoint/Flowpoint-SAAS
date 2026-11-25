/**
 * Dashboard CRM : le bouton « Connecter » n'existe que pour les fournisseurs que le serveur declare
 * `implemented` (GET /api/crm/providers). Les autres sont rendus desactives (« Bientôt disponible »),
 * sans aucun chemin de clic pouvant atteindre un 501.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";

const files: Record<string, string> = {
  "src/frontend/dashboard.js": readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8"),
  "artifacts/flowpoint-export/dashboard.js": readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8"),
};
const LOCALES = ["en", "es", "de", "it", "pt", "nl", "pl", "sv", "ro", "cs"];
const NEW_KEYS = [
  "Cette intégration CRM n’est pas encore disponible.",
  "La liste des CRM disponibles est momentanément indisponible.",
  "Indisponible pour le moment",
];
const BANNER = "// ═══════════════════════════════════════════════════════════════════════════════\n";

function between(src: string, a: string, b: string): string {
  const i = src.indexOf(a); const j = src.indexOf(b, i);
  expect(i, a).toBeGreaterThan(-1); expect(j, b).toBeGreaterThan(i);
  return src.slice(i, j);
}

/** Execute le vrai code de FP_CRM_API + renderCRM avec des doublures minimales. */
function loadCrm(src: string, providers: unknown) {
  const api = between(src, "window.FP_CRM_API = {", BANNER + "// FP MARKET INTEL API");
  const render = between(src, "function renderCRM() {", BANNER + "// RENDER: MARKET INTELLIGENCE");
  const calls: string[] = [];
  const win: Record<string, any> = { FP_DATA: { crm: { status: { integrations: [] }, logs: [], providers } }, location: { search: "" } };
  const ctx = vm.createContext({
    window: win, document: { readyState: "complete" },
    STATE: { me: { plan: "Pro" }, currentSection: "crm" },
    apiFetch: async (u: string) => { calls.push(u); return {}; },
    fpT: (x: string) => x, escHtml: (x: string) => String(x), getLocale: () => "fr",
    aiBlock: () => "", statCard: () => "", showToast: () => {}, render: () => {},
  });
  vm.runInContext(`${api}\n${render}\nthis.renderCRM = renderCRM;`, ctx);
  return { win, calls, render: (ctx as any).renderCRM as () => string };
}

const PROVIDERS = [
  { id: "hubspot", implemented: true, available: true },
  { id: "salesforce", implemented: false, available: false },
  { id: "pipedrive", implemented: false, available: false },
];

describe.each(Object.entries(files))("CRM Hub — %s", (_label, src) => {
  it("seul HubSpot (declare implemented par le serveur) a un bouton Connecter actif", () => {
    const html = loadCrm(src, PROVIDERS).render();
    expect(html).toContain("window._connectCrm('hubspot'");
    expect(html).not.toContain("window._connectCrm('salesforce'");
    expect(html).not.toContain("window._connectCrm('pipedrive'");
    const soon = [...html.matchAll(/<button[^>]*data-crm-soon="([a-z]+)"[^>]*>([^<]*)<\/button>/g)];
    const ids = soon.map((m) => m[1]);
    expect(ids).toContain("salesforce"); expect(ids).toContain("pipedrive"); expect(ids).not.toContain("hubspot");
    for (const m of soon) {
      expect(m[0]).toMatch(/\bdisabled\b/);
      expect(m[0]).toContain('aria-disabled="true"');
      expect(m[0]).toMatch(/title="[^"]+"/);
      expect(m[0]).not.toContain("onclick");
      expect(m[2]).toBe("Bientôt disponible");
    }
  });

  it("la liste provient du serveur : si elle est indisponible, tout est desactive (rien de code en dur)", () => {
    const html = loadCrm(src, null).render();
    expect(html).not.toContain("window._connectCrm(");
    expect(html).toContain("Indisponible pour le moment");
  });

  it("un fournisseur implemented:true est suivi sans liste codee en dur", () => {
    const html = loadCrm(src, [{ id: "zoho", implemented: true }]).render();
    expect(html).toContain("window._connectCrm('zoho'");
    expect(html).not.toContain("window._connectCrm('hubspot'");
  });

  it("l'API cliente refuse d'appeler connect/sync pour un fournisseur non implemente (aucun 501 possible)", async () => {
    const { win, calls } = loadCrm(src, PROVIDERS);
    await expect(win.FP_CRM_API.connect("salesforce", {})).rejects.toThrow("CRM_PROVIDER_NOT_IMPLEMENTED");
    await expect(win.FP_CRM_API.sync("salesforce", "contacts")).rejects.toThrow("CRM_PROVIDER_NOT_IMPLEMENTED");
    expect(calls).toEqual([]);
    await win.FP_CRM_API.connect("hubspot", {});
    expect(calls).toEqual(["/api/crm/connect/hubspot"]);
  });

  it("load() interroge /api/crm/providers", async () => {
    const { win, calls } = loadCrm(src, null);
    await win.FP_CRM_API.load();
    expect(calls).toContain("/api/crm/providers");
  });

  it("la synchronisation manuelle ne propose que les contacts (seule entite geree par le serveur)", () => {
    expect(src).toMatch(/const syncEntities = \['contacts'\];/);
  });

  it("_connectCrm ignore un fournisseur non implemente", () => {
    expect(src).toMatch(/window\._connectCrm = function\(id, name, icon\) \{\s*if \(!window\.FP_CRM_API \|\| !window\.FP_CRM_API\.isImplemented\(id\)\) return;/);
  });

  it("chaque nouvelle chaine est traduite dans les 10 locales", () => {
    for (const k of NEW_KEYS) {
      const n = src.split(`    ${JSON.stringify(k)}: `).length - 1;
      expect(n, k).toBe(LOCALES.length);
    }
  });
});
