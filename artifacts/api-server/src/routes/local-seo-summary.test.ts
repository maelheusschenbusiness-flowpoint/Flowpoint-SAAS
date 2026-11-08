/**
 * D-08 — GET /api/local-seo (+ /local-seo/status) : agregat reel (note, avis, zones) avec etat
 * explicite ; plus de 0 trompeur dans les blocs Local / Growth du dashboard.
 */
import express from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { orgDbMock } = vi.hoisted(() => ({ orgDbMock: vi.fn() }));

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() }, getDBMode: vi.fn(() => "postgres"), getOrgDb: vi.fn(() => vi.fn()), queryWithRetry: vi.fn(),
}));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() } }));
vi.mock("../middlewares/requireRole.js", () => ({ canWrite: (_q: any, _s: any, n: any) => n() }));
vi.mock("../services/dataforseo-service.js", () => ({
  isDataForSEOConfigured: vi.fn(), getQuotaUsage: vi.fn(), getLocalPackRank: vi.fn(), checkAndIncrementQuota: vi.fn(),
  verifierEtConsommerQuota: vi.fn(), rembourserQuota: vi.fn(), suivreAppelsPayants: vi.fn(), getKeywordSuggestions: vi.fn(),
  getSERP: vi.fn(), getCompetitors: vi.fn(), getBacklinks: vi.fn(), getDomainMetrics: vi.fn(), getKeywordDifficulty: vi.fn(),
  getGoogleMapsResults: vi.fn(), getAIVisibility: vi.fn(), getContentOptimization: vi.fn(), generateSEOMissions: vi.fn(), refreshSEOCache: vi.fn(),
}));

import seoRouter from "./seo.js";

function makeApp() {
  const app = express();
  app.use((req, _res, next) => { Object.assign(req, { orgId: "org-a", orgDb: orgDbMock }); next(); });
  app.use("/api", seoRouter);
  return app;
}

type Script = { org?: Record<string, unknown>; tokens?: number; agg?: Record<string, unknown> | null; reviews?: Record<string, unknown>; heatmaps?: Record<string, unknown>[]; failAll?: boolean };
function script(sc: Script) {
  orgDbMock.mockImplementation(async (sql: string) => {
    if (sc.failAll) throw new Error("db down");
    if (/FROM organizations/.test(sql)) return { rows: sc.org ? [sc.org] : [] };
    if (/FROM google_tokens/.test(sql)) return { rows: [{ cnt: sc.tokens ?? 0 }] };
    if (/FROM google_locations/.test(sql)) return { rows: sc.agg ? [sc.agg] : [{ locations: 0 }] };
    if (/FROM google_reviews/.test(sql)) return { rows: [sc.reviews ?? { cnt: 0, avg: null }] };
    if (/FROM local_heatmaps/.test(sql)) return { rows: sc.heatmaps ?? [] };
    return { rows: [] };
  });
}

describe("GET /local-seo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("non connecte : etat explicite, aucune note ni zone inventee", async () => {
    script({ tokens: 0 });
    for (const path of ["/api/local-seo", "/api/local-seo/status"]) {
      const res = await request(makeApp()).get(path);
      expect(res.status, path).toBe(200);
      expect(res.body).toMatchObject({ state: "not_connected", gbpConnected: false, avgRating: null, reviewCount: null, zones: [] });
    }
  });

  it("GBP connecte avec fiches : note ponderee par le nombre d'avis, total d'avis, nombre de fiches", async () => {
    script({ tokens: 1, agg: { locations: 2, review_count: 150, weighted: 4.0 * 100 + 5.0 * 50, weight: 150, plain_avg: 4.5 } });
    const res = await request(makeApp()).get("/api/local-seo");
    expect(res.body).toMatchObject({ state: "ok", gbpConnected: true, avgRating: 4.3, reviewCount: 150, gbpCount: 2 });
  });

  it("repli sur google_reviews quand aucune fiche n'est synchronisee", async () => {
    script({ tokens: 1, agg: { locations: 0 }, reviews: { cnt: 4, avg: "4.25" } });
    const res = await request(makeApp()).get("/api/local-seo");
    expect(res.body).toMatchObject({ state: "ok", avgRating: 4.3, reviewCount: 4 });
  });

  it("GBP connecte mais sans donnee : no_data (pas de 0)", async () => {
    script({ tokens: 1, agg: { locations: 0 }, reviews: { cnt: 0, avg: null } });
    const res = await request(makeApp()).get("/api/local-seo");
    expect(res.body).toMatchObject({ state: "no_data", gbpConnected: true, avgRating: null, reviewCount: null });
  });

  it("zones = scans de carte de chaleur reellement mesures ; les scans sans mesure sont ignores", async () => {
    script({
      tokens: 1, agg: { locations: 0 },
      heatmaps: [
        { id: "h1", name: "Plombier Liège", keyword: "plombier", results: { summary: { dominanceScore: 80, averageRank: 2.1, measuredPoints: 25, totalPoints: 25 } } },
        { id: "h2", name: "Vide", keyword: "x", results: JSON.stringify({ summary: { dominanceScore: null, measuredPoints: 0, totalPoints: 25 } }) },
        { id: "h3", name: "", keyword: "chauffage", results: JSON.stringify({ summary: { dominanceScore: 40, averageRank: 6, measuredPoints: 20, totalPoints: 25 } }) },
      ],
    });
    const res = await request(makeApp()).get("/api/local-seo");
    expect(res.body.state).toBe("ok");
    expect(res.body.zones).toHaveLength(2);
    expect(res.body.zones[0]).toMatchObject({ id: "h1", name: "Plombier Liège", vis: 80, dominated: true, prev: null, trend: null });
    expect(res.body.zones[1]).toMatchObject({ name: "chauffage", vis: 40, dominated: false });
  });

  it("toutes les requetes sont bornees a l'organisation", async () => {
    script({ tokens: 1, agg: { locations: 0 } });
    await request(makeApp()).get("/api/local-seo");
    for (const call of orgDbMock.mock.calls) expect(call[1]).toEqual(["org-a"]);
  });
});

describe("dashboard — rendu sans donnee Local / Growth", () => {
  const src = readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8");
  const exported = readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8");

  it("les deux copies de dashboard.js sont identiques", () => { expect(exported).toBe(src); });

  it("growthRing affiche « — » (et non 0 %) quand la donnee est absente", () => {
    const fn = src.match(/function growthRing\(val, color, sz, sw, label, sub\) \{[\s\S]*?\n\}/)![0];
    const growthRing = new Function(`${fn}; return growthRing;`)() as (...a: unknown[]) => string;
    const empty = growthRing(null, "#fff", 84, 7, "Perf", "Connectez PSI");
    expect(empty).toContain(">—</span>");
    expect(empty).not.toContain("data-count-to");
    expect(empty).not.toContain("data-ring-target");
    const full = growthRing(72, "#fff", 84, 7, "Perf", "");
    expect(full).toContain('data-count-to="72"');
  });

  it("les anneaux Growth ne forcent plus 0 pour une donnee absente", () => {
    expect(src).not.toContain("growthRing(_mySpeed||0");
    expect(src).not.toContain("growthRing(_c1Score||0");
    expect(src).toContain("growthRing(_mySpeed,");
    expect(src).toContain("(_lseo.state === 'not_connected' ? fpT('Non connecté')");
  });

  it("le bloc Local n'affiche ni « 0 zone » ni « données exemple » hors apercu et gere les valeurs de zone absentes", () => {
    expect(src).toContain("(zones.length > 0 || PREVIEW_MODE) ? String(zones.length) : '—'");
    expect(src).not.toContain("fpT(PREVIEW_MODE ? '1 dominée, 3 en progression' : 'données exemple')");
    expect(src).toContain("z.prev != null ? z.prev + '%' : '—'");
    expect(src).toContain("typeof _lseo.avgRating === 'number' ? _lseo.avgRating.toFixed(1)");
  });

  it("la revocation de session cible la liste affichee et exige canRevoke", () => {
    expect(src).toContain("!sess.current && sess.id && sess.canRevoke");
    expect(src).toContain("STATE.loginHistory=(STATE.loginHistory||[]).filter(s=>String(s.id)!==b.dataset.sessId)");
    expect(src).toContain("id: l.id || '', canRevoke: l.canRevoke === true");
  });
});

describe("GET /local-seo — indisponibilite", () => {
  it("la route de repli renvoie 503 + etat explicite (pas de 0)", async () => {
    // Une base indisponible ne doit jamais passer pour « non connecté » ni produire un nombre.
    script({ failAll: true });
    const res = await request(makeApp()).get("/api/local-seo");
    expect(res.status).toBe(503);
    expect(res.body.state).toBe("unavailable");
    expect(res.body.avgRating).toBeNull();
    expect(res.body.reviewCount).toBeNull();
    expect(res.body.zones).toEqual([]);
  });
});
