/**
 * D-05 — le front ne fabrique jamais de lien de partage : le lien n'est affiche
 * que si POST /api/reports/:id/share a renvoye un jeton, sinon erreur explicite.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8");
const exported = readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8");
const reportView = readFileSync(resolve(process.cwd(), "../flowpoint-export/report-view.html"), "utf8");

function extractHelpers(): string {
  const start = source.indexOf("async function fpCreateReportShareLink(");
  const end = source.indexOf("function fullscreenPresent()");
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function build(opts: { apiAction: (...a: any[]) => Promise<any>; clipboardOk?: boolean; reports?: any[] }) {
  const toasts: Array<[string, string]> = [];
  const store = new Map<string, string>();
  const STATE = { reports: opts.reports ?? [{ id: "r_1", date: "2026-11-01", name: "R" }] };
  const factory = new Function(
    "apiAction", "STATE", "showToast", "fpT", "navigator", "location", "window", "localStorage",
    `${extractHelpers()}; return { fpShareReportAndCopy, createShareLink };`,
  );
  const api = factory(
    opts.apiAction, STATE,
    (kind: string, msg: string) => toasts.push([kind, msg]),
    (s: string) => s,
    { clipboard: { writeText: vi.fn(async (t: string) => { if (opts.clipboardOk === false) throw new Error("denied"); store.set("clip", t); }) } },
    { origin: "https://app.example.test" },
    { prompt: vi.fn() },
    { setItem: (k: string, v: string) => store.set(k, v) },
  );
  return { api, toasts, store, STATE };
}

describe("partage de rapport — front", () => {
  it("les deux copies de dashboard.js sont identiques", () => {
    expect(exported).toBe(source);
  });

  it("aucun jeton de partage n'est fabrique localement", () => {
    expect(source).not.toMatch(/'fp:share-'/);
    expect(source).not.toMatch(/'fp-'\s*\+\s*Math\.random\(\)/);
    expect(source).not.toMatch(/'fp-'\s*\+\s*Math\.random/);
  });

  it("succes : copie l'URL construite depuis le chemin renvoye par l'API", async () => {
    const apiAction = vi.fn(async () => ({ token: "abc", path: "/report/abc", expiresAt: "2026-12-01T00:00:00Z" }));
    const { api, toasts, store, STATE } = build({ apiAction });
    const link = await api.fpShareReportAndCopy("r_1", {});
    expect(apiAction).toHaveBeenCalledWith("POST", "/api/reports/r_1/share", {});
    expect(link.url).toBe("https://app.example.test/report/abc");
    expect(store.get("clip")).toBe("https://app.example.test/report/abc");
    expect(toasts).toEqual([["success", "Lien copié ! Valable 30 jours."]]);
    expect((STATE.reports[0] as any).shared).toBe(true);
    expect([...store.keys()].some(k => k.startsWith("fp:share-"))).toBe(false);
  });

  it("echec API : erreur explicite, aucun lien, aucun stockage local, aucun toast de succes", async () => {
    const apiAction = vi.fn(async () => { throw new Error("HTTP 500"); });
    const { api, toasts, store, STATE } = build({ apiAction });
    const link = await api.fpShareReportAndCopy("r_1", {});
    expect(link).toBeNull();
    expect(toasts).toHaveLength(1);
    expect(toasts[0][0]).toBe("error");
    expect(toasts[0][1]).toMatch(/Aucun lien/);
    expect(store.size).toBe(0);
    expect((STATE.reports[0] as any).shared).toBeUndefined();
  });

  it("reponse sans jeton (mode apercu / null) : erreur, jamais de succes", async () => {
    const { api, toasts } = build({ apiAction: vi.fn(async () => null) });
    await api.fpShareReportAndCopy("r_1", {});
    expect(toasts.map(t => t[0])).toEqual(["error"]);
  });

  it("presse-papiers refuse : lien affiche via prompt, toast info (pas 'copie')", async () => {
    const apiAction = vi.fn(async () => ({ token: "abc", path: "/report/abc" }));
    const { api, toasts } = build({ apiAction, clipboardOk: false });
    await api.fpShareReportAndCopy("r_1", {});
    expect(toasts[0][0]).toBe("info");
  });

  it("createShareLink sans rapport : refuse sans appeler l'API", async () => {
    const apiAction = vi.fn();
    const { api, toasts } = build({ apiAction, reports: [] });
    await api.createShareLink();
    expect(apiAction).not.toHaveBeenCalled();
    expect(toasts[0][0]).toBe("error");
  });

  it("report-view.html lit la route publique existante et accepte /report/:token comme ?token=", () => {
    expect(reportView).toContain("/api/reports/share/");
    expect(reportView).toMatch(/token === 'report-view\.html'\) token = new URLSearchParams/);
  });
});
