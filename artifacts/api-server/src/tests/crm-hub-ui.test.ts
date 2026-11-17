/**
 * CRM Hub (module #7) : etats affiches par l'interface. Le rendu reel de dashboard.js est execute dans un
 * bac a sable (aucun navigateur, aucun appel reseau) avec des reponses d'API simulees. Verifie qu'aucun
 * etat n'est « invente » : non implemente => « bientot », non configure, reauth requise, indisponible,
 * add-on absent, role en lecture seule, et que les actions existent reellement (pas de <script> inerte).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8");
const sourceDashboard = readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8");

const BAR = "// " + "═".repeat(79) + "\n";
function slice(from: string, to: string): string {
  const a = dashboard.indexOf(from);
  const b = dashboard.indexOf(to, a);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return dashboard.slice(a, b);
}
const renderSource = slice("function renderCRM()", "// RENDER: MARKET INTELLIGENCE");
const helpersSource = slice("function fpCrmErrorMessage(", BAR + "// FP MARKET INTEL API");

interface Ctx { STATE: Record<string, unknown>; window: Record<string, unknown>; renderCRM: () => string; fpCrmErrorMessage: (e: unknown) => string; fpCrmClassifyLoadError: (e: unknown) => string }
const escHtml = (v: unknown) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

function sandbox(state: Record<string, unknown>, crm: Record<string, unknown>): Ctx {
  const window: Record<string, unknown> = { FP_DATA: { crm } };
  const context = {
    window, STATE: state, escHtml, getLocale: () => "en", navigateSub: () => undefined, console,
    fpT: (s: string, v?: Record<string, unknown>) => (v ? s.replace(/\{(\w+)\}/g, (_m, k) => String(v[k] ?? `{${k}}`)) : s),
    statCard: (label: string, value: string, delta: string) => `<stat>${label}|${value}|${delta}</stat>`,
  };
  runInNewContext(`${renderSource}\n${helpersSource.slice(0, helpersSource.indexOf(BAR + "// FP CRM API"))}\nthis.renderCRM = renderCRM; this.fpCrmErrorMessage = fpCrmErrorMessage; this.fpCrmClassifyLoadError = fpCrmClassifyLoadError;`, context);
  return context as unknown as Ctx;
}

const allProviders = ["hubspot", "salesforce", "pipedrive", "zoho", "monday", "airtable", "notion", "close"];
const providersApi = (over: Record<string, Record<string, unknown>> = {}) =>
  allProviders.map((id) => ({ id, implemented: id === "hubspot", configured: id === "hubspot", available: id === "hubspot", ...(over[id] ?? {}) }));
const statusOf = (integrations: unknown[], extra: Record<string, unknown> = {}) =>
  ({ integrations, connected: (integrations as { status: string }[]).filter((i) => i.status === "connected").length, stats: { totalSyncs: 2, avgDurationMs: 120 }, limit: 3, plan: "pro", ...extra });
const render = (role: string, crm: Record<string, unknown>, subRoute: string | null = null) =>
  sandbox({ me: { role, plan: "Pro" }, subRoute }, { loadedAt: 1, providers: providersApi(), logs: [], ...crm }).renderCRM();
const cardOf = (html: string, id: string): string => {
  const a = html.indexOf(`data-crm-provider="${id}"`);
  return html.slice(a, html.indexOf("data-crm-provider=", a + 10) > 0 ? html.indexOf("data-crm-provider=", a + 10) : undefined);
};

describe("CRM Hub : fournisseurs non implementes presentes honnetement", () => {
  const html = render("owner", { status: statusOf([]) });

  it("les sept fournisseurs sans adaptateur affichent « Bientot disponible », un bouton inactif, jamais « Connecte »", () => {
    for (const id of allProviders.filter((p) => p !== "hubspot")) {
      const card = cardOf(html, id);
      expect(card, id).toContain('data-crm-state="soon"');
      expect(card, id).toContain("Bientôt disponible");
      expect(card, id).toContain("disabled");
      expect(card, id).not.toContain("openConnect");
      expect(card, id).not.toContain("Connecté");
    }
  });

  it("une ligne « connected » heritee d'un fournisseur sans adaptateur (statut unavailable) n'est pas affichee connectee", () => {
    const legacy = render("owner", { status: statusOf([{ provider: "salesforce", name: "salesforce", status: "unavailable", synced_contacts: 12 }]) });
    const card = cardOf(legacy, "salesforce");
    expect(card).toContain('data-crm-state="legacy"');
    expect(card).toContain("Ancienne connexion non vérifiable");
    expect(card).not.toContain("● Connecté");
    // Le compteur d'en-tete ne compte que les connexions verifiees.
    expect(legacy).toContain("<stat>CRM connectés|0|");
  });

  it("aucune promesse trompeuse : pas de sync automatique « toutes les 60 min », pas de bidirectionnel annonce actif, pas de leads/deals", () => {
    const sync = render("owner", { status: statusOf([{ provider: "hubspot", name: "hubspot", status: "connected", synced_contacts: 5 }]) }, "sync");
    expect(sync).not.toContain("60 min");
    expect(sync).not.toContain("fp-toggle");
    for (const forbidden of ["deals'", "companies'", "leads'"]) expect(sync).not.toContain(forbidden);
    expect(sync.match(/data-crm-capability="available"/g)).toHaveLength(2);
    expect(sync.match(/data-crm-capability="unavailable"/g)).toHaveLength(4);
  });
});

describe("CRM Hub : etats HubSpot distincts", () => {
  it("non connecte + configure : bouton Connecter pour owner/admin, absent pour member/viewer", () => {
    const crm = { status: statusOf([]) };
    for (const role of ["owner", "admin"]) expect(cardOf(render(role, crm), "hubspot")).toContain("openConnect('hubspot'");
    for (const role of ["member", "viewer"]) {
      const card = cardOf(render(role, crm), "hubspot");
      expect(card).toContain('data-crm-state="idle"');
      expect(card).not.toContain("openConnect");
    }
  });

  it("non configure sur le serveur : etat distinct, bouton inactif, message explicite (pas « non connecte »)", () => {
    const card = cardOf(render("owner", { status: statusOf([]), providers: providersApi({ hubspot: { configured: false, available: false } }) }), "hubspot");
    expect(card).toContain('data-crm-state="not_configured"');
    expect(card).toContain("Non configuré sur ce serveur");
    expect(card).toContain("disabled");
    expect(card).not.toContain("openConnect");
  });

  it("reconnexion requise : etat distinct avec bouton Reconnecter, non compte comme connecte", () => {
    const html = render("owner", { status: statusOf([{ provider: "hubspot", name: "hubspot", status: "reauth_required", synced_contacts: 7 }]) });
    const card = cardOf(html, "hubspot");
    expect(card).toContain('data-crm-state="reauth"');
    expect(card).toContain("Reconnexion requise");
    expect(card).toContain("Reconnecter");
    expect(card).not.toContain("● Connecté");
    expect(html).toContain("<stat>CRM connectés|0|");
    const sync = render("owner", { status: statusOf([{ provider: "hubspot", name: "hubspot", status: "reauth_required" }]) }, "sync");
    expect(sync).toContain('data-crm-reauth="hubspot"');
    expect(sync).not.toContain("Synchroniser les contacts");
  });

  it("connecte : contacts reels affiches, Synchroniser pour member, aucune action pour viewer, Deconnecter reserve aux admins", () => {
    const crm = { status: statusOf([{ provider: "hubspot", name: "hubspot", status: "connected", synced_contacts: 42 }]) };
    const owner = cardOf(render("owner", crm), "hubspot");
    expect(owner).toContain("● Connecté · 42 contacts");
    expect(owner).toContain("FP_CRM_UI.disconnect('hubspot'");
    const member = cardOf(render("member", crm), "hubspot");
    expect(member).toContain("navigateSub('sync')");
    expect(member).not.toContain("FP_CRM_UI.disconnect");
    const viewer = cardOf(render("viewer", crm), "hubspot");
    expect(viewer).not.toContain("navigateSub('sync')");
    expect(viewer).not.toContain("FP_CRM_UI.disconnect");
    // Onglet synchronisation : une seule action de sync (contacts) + test, absentes pour le lecteur.
    const syncMember = render("member", crm, "sync");
    expect(syncMember.match(/FP_CRM_UI\.sync\('hubspot'\)/g)).toHaveLength(1);
    expect(syncMember).toContain("FP_CRM_UI.test('hubspot')");
    const syncViewer = render("viewer", crm, "sync");
    expect(syncViewer).not.toContain("FP_CRM_UI.sync(");
    expect(syncViewer).not.toContain("FP_CRM_UI.test(");
  });

  it("quota affiche = limite du plan renvoyee par l'API (et non une valeur codee en dur)", () => {
    const html = render("owner", { status: statusOf([], { limit: 10, plan: "ultra" }) });
    expect(html).toContain("<stat>CRM connectés|0|sur 10 max (ultra)</stat>");
  });
});

describe("CRM Hub : pannes et acces", () => {
  it("API indisponible : banniere « indisponible » avec Reessayer, aucun fournisseur presente « Non connecte »", () => {
    const html = render("owner", { status: null, statusError: "unavailable" });
    expect(html).toContain('data-crm-banner="unavailable"');
    expect(html).toContain("Réessayer");
    expect(html).not.toContain("Non connecté");
    expect(html).not.toContain("openConnect");
    expect(html).not.toContain("<stat>");
  });

  it("add-on absent (402) : banniere dediee, aucune action", () => {
    const html = render("owner", { status: null, statusError: "addon_required" });
    expect(html).toContain('data-crm-banner="addon_required"');
    expect(html).toContain("n’est pas activé");
    expect(html).not.toContain("openConnect");
  });

  it("chargement en cours : message de chargement, pas d'etat invente", () => {
    const html = sandbox({ me: { role: "owner" }, subRoute: null }, {}).renderCRM();
    expect(html).toContain('data-crm-banner="loading"');
    expect(html).not.toContain("Non connecté");
  });

  it("logs indisponibles : message d'erreur et non « aucune synchronisation »", () => {
    const html = render("owner", { status: statusOf([]), logsError: "unavailable" }, "logs");
    expect(html).toContain("momentanément indisponibles");
    expect(html).not.toContain("Aucune synchronisation encore");
    expect(render("owner", { status: statusOf([]) }, "logs")).toContain("Aucune synchronisation encore");
  });

  it("onglet mapping : indique honnetement que le mapping personnalise n'est pas disponible", () => {
    expect(render("owner", { status: statusOf([]) }, "field-mapping")).toContain('data-crm-mapping="unavailable"');
  });

  it("classification et messages d'erreur par code (jamais « Non connecte » pour une reauth)", () => {
    const c = sandbox({ me: {} }, {});
    expect(c.fpCrmClassifyLoadError({ status: 402, code: "ADDON_REQUIRED" })).toBe("addon_required");
    expect(c.fpCrmClassifyLoadError({ status: 403 })).toBe("forbidden");
    expect(c.fpCrmClassifyLoadError({ status: 503, code: "CRM_STATUS_UNAVAILABLE" })).toBe("unavailable");
    expect(c.fpCrmErrorMessage({ code: "CRM_REAUTH_REQUIRED", status: 409 })).toContain("Reconnexion requise");
    expect(c.fpCrmErrorMessage({ code: "CRM_NOT_CONNECTED", status: 409 })).toContain("n’est pas connecté");
    expect(c.fpCrmErrorMessage({ code: "CRM_PROVIDER_NOT_CONFIGURED", status: 503 })).toContain("n’est pas configuré");
    expect(c.fpCrmErrorMessage({ code: "CRM_LIMIT_REACHED", status: 403 })).toContain("Limite du plan");
    expect(c.fpCrmErrorMessage({ status: 402 })).toContain("n’est pas activé");
    expect(c.fpCrmErrorMessage({ status: 500 })).toContain("momentanément indisponible");
  });
});

describe("CRM Hub : actions reellement branchees", () => {
  it("le gabarit ne contient aucun <script> (inerte via innerHTML) et les actions sont definies sur window.FP_CRM_UI", () => {
    expect(renderSource).not.toMatch(/<script/i);
    expect(dashboard).toContain("window.FP_CRM_UI = {");
    expect(dashboard).not.toContain("window._connectCrm");
    // Toutes les actions invoquees par le gabarit existent.
    const used = new Set([...renderSource.matchAll(/FP_CRM_UI\.(\w+)\(/g)].map((m) => m[1]));
    for (const name of used) expect(dashboard, name).toMatch(new RegExp(`\\n  (async )?${name}\\(`));
  });

  it("chaque libelle affiche existe en anglais ET en espagnol dans les catalogues du tableau de bord", () => {
    const enStart = dashboard.indexOf("  var FP_I18N_EN = {");
    const esStart = dashboard.indexOf("    es: {\n", dashboard.indexOf("  var FP_I18N = {"));
    const en = dashboard.slice(enStart, esStart);
    const es = dashboard.slice(esStart, dashboard.indexOf("\n    de: {\n", esStart));
    const has = (catalog: string, key: string) => catalog.includes(JSON.stringify(key) + ":") || catalog.includes("'" + key.replace(/'/g, "\\'") + "':");
    const region = renderSource + helpersSource;
    const keys = new Set<string>();
    for (const m of region.matchAll(/fpT\('((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]!.replace(/\\'/g, "'"));
    // Valeurs des tables code -> message (fpCrmErrorMessage, retour OAuth) et libelles statiques.
    for (const m of region.matchAll(/(?:CRM_[A-Z_]+|ADDON_REQUIRED|consent_denied|oauth_failed):\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]!);
    for (const m of region.matchAll(/(?:text|label|desc):\s*'((?:[^'\\]|\\.)*)'/g)) keys.add(m[1]!);
    expect(keys.size).toBeGreaterThan(40);
    const missing = [...keys].filter((k) => /[A-Za-zÀ-ÿ]/.test(k) && (!has(en, k) || !has(es, k)));
    expect(missing).toEqual([]);
  });

  it("le tableau de bord servi et la source frontend restent identiques", () => {
    expect(sourceDashboard).toBe(dashboard);
  });
});
