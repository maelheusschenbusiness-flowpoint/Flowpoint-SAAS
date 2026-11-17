import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Modules 10 (Global Monitoring), 11 (SLA Monitoring Avancé) et 16 (Agency
 * Reporting Packs) — tableau de bord. Les deux copies du fichier (source et
 * servie) doivent rester identiques ; aucune mesure absente ne doit devenir
 * « 0 % » ou « 100 % », et chaque texte doit exister en anglais et en espagnol.
 */
const served = readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8");
const source = readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8");

function slice(from: string, to: string, text = served): string {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + from.length);
  expect(a, from).toBeGreaterThanOrEqual(0);
  expect(b, to).toBeGreaterThan(a);
  return text.slice(a, b);
}

describe("copie source et copie servie du tableau de bord", () => {
  it("sont identiques (la copie source est resynchronisée)", () => {
    expect(source === served).toBe(true);
  });
});

describe("SLA Better Stack : une disponibilité absente n'est pas 0 %", () => {
  const loadSla = slice("async loadSla() {", "renderSlaCompliance(container");

  it("n'applique plus Number() directement (Number(null) vaut 0)", () => {
    expect(loadSla).not.toContain("Number(metrics?.availability)");
    expect(loadSla).toContain("rawAvailability === null || rawAvailability === undefined || rawAvailability === ''");
  });

  it("évalue le garde sur des charges utiles réelles : absent, null, vide, hors bornes, valide", () => {
    const guard = loadSla.slice(
      loadSla.indexOf("const rawAvailability"),
      loadSla.indexOf("if (!metrics ||"),
    );
    const parse = new Function("metrics", `${guard}; return availability;`) as (m: unknown) => number;
    expect(Number.isNaN(parse({}))).toBe(true);
    expect(Number.isNaN(parse({ availability: null }))).toBe(true);
    expect(Number.isNaN(parse({ availability: "" }))).toBe(true);
    expect(parse({ availability: 0 })).toBe(0); // 0 % mesuré reste une mesure
    expect(parse({ availability: "99.95" })).toBe(99.95);
  });
});

describe("états d'erreur distincts (add-on, rôle, introuvable, non configuré, indisponible)", () => {
  const body = slice("monitoringErrorText(err, fallback) {", "renderSlaCompliance(container");
  const fn = new Function("fpT", `return function ${body.trim().replace(/,$/, "").replace("monitoringErrorText", "text")}`)((s: string) => s) as
    (err: unknown, fallback: string) => string;

  it("classe chaque cas sans le confondre avec un état vide", () => {
    expect(fn({ status: 402, code: "ADDON_REQUIRED" }, "x")).toContain("add-on");
    expect(fn({ status: 403 }, "x")).toContain("rôle");
    expect(fn({ status: 404 }, "x")).toContain("introuvable");
    expect(fn({ status: 503, message: "Not configured" }, "x")).toContain("n’est pas configuré");
    expect(fn({ status: 503, message: "Subscription status unavailable" }, "x")).toContain("indisponible");
    expect(fn({ status: 500 }, "repli")).toBe("repli");
  });

  it("Global Monitoring et Agency Packs l'utilisent au lieu d'un message unique", () => {
    expect(slice("async loadGlobal() {", "async loadAgencyPacks() {")).toContain("monitoringErrorText(err");
    expect(slice("async loadAgencyPacks() {", "updateAgencyPackDraft(field")).toContain("monitoringErrorText(err");
  });
});

describe("liste des monitors : jamais de disponibilité moyenne inventée", () => {
  const monitorsView = slice("const _measuredUptimes = monitors", "const _tlNow = new Date();");

  it("exclut les monitors jamais vérifiés ou sans mesure et n'utilise plus 100 par défaut", () => {
    expect(served).not.toContain("parseFloat(String(m.uptime)) : 100), 0)");
    expect(monitorsView).toContain("m.lastCheck != null && m.uptime != null");
    expect(monitorsView).toContain("avgUptime == null ? '—'");
  });
});

describe("Agency Packs : audits terminés et quota explicites", () => {
  const panel = slice("function renderAgencyPacksPanel()", "window._fpAgencyPacksState = window._fpAgencyPacksState");

  it("ne propose que des audits terminés et désactive les actions sinon", () => {
    expect(panel).toContain("audit.status === 'completed'");
    expect(panel).not.toContain("${audits.map(audit => {\n          const id");
    expect(panel).not.toContain("!audits.length || panelState.submitting");
  });

  it("distingue quota (402) et audit incomplet (422) à la création du pack", () => {
    const create = slice("async createAgencyPack() {", "async createAgencySinglePack(index)");
    expect(create).toContain("error?.status === 402");
    expect(create).toContain("error?.status === 422");
  });
});

describe("textes : chaque libellé des trois modules existe en anglais et en espagnol", () => {
  const catalogs = {
    en: served.slice(0, served.indexOf("\n    es: {\n")),
    es: served.slice(served.indexOf("\n    es: {\n"), served.indexOf("\n    de: {\n")),
  };
  const segments = [
    slice("function renderBetterStackSlaPanel()", "function renderMonitorsSLA", served).slice(0, 2600),
    slice("function renderGlobalMonitoringPanel()", "// FP KEYWORDS API"),
  ];
  const literals = new Set<string>();
  for (const segment of segments) {
    for (const match of segment.matchAll(/fpT\('((?:[^'\\]|\\.)*)'/g)) {
      literals.add(match[1]!.replace(/\\'/g, "'").replace(/\\u2019/g, "’"));
    }
  }

  it("a bien extrait les libellés", () => {
    expect(literals.size).toBeGreaterThan(60);
  });

  it.each(["en", "es"] as const)("catalogue %s complet", (locale) => {
    const missing = [...literals].filter(text => !catalogs[locale].includes(`${JSON.stringify(text)}:`));
    expect(missing).toEqual([]);
  });
});
