/**
 * Lecture des entiers de chaine de requete sur les routes GSC.
 *
 * `?days=abc` donnait NaN : /gsc/analytics levait une RangeError sur
 * `new Date(NaN).toISOString()` (500) et /gsc/keywords, /gsc/pages,
 * /gsc/impressions transmettaient NaN au service, d'ou une erreur SQL. Une
 * limite negative ou illisible partait telle quelle dans un `LIMIT`. On
 * verifie ici la valeur reellement transmise au service, pas seulement le
 * code de reponse.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const ORG = "11111111-1111-1111-1111-111111111111";
const SITE = "sc-domain:example.com";

const { getTopKeywordsMock, getTopPagesMock, getImpressionsOverTimeMock, getSyncLogsMock } = vi.hoisted(() => ({
  getTopKeywordsMock: vi.fn(),
  getTopPagesMock: vi.fn(),
  getImpressionsOverTimeMock: vi.fn(),
  getSyncLogsMock: vi.fn(),
}));

// Site resolu sans base : la ligne gsc_sites porte une provenance verifiee.
vi.mock("@workspace/db", () => ({
  pool: {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT permission_level FROM gsc_sites")) {
        return { rows: [{ permission_level: "siteOwner" }] };
      }
      return { rows: [] };
    }),
    connect: vi.fn(),
  },
}));

vi.mock("../services/gsc-service.js", () => ({
  getGSCStatus: vi.fn(async () => ({ connected: true, siteUrl: SITE, sitesCount: 1 })),
  listGSCSites: vi.fn(async () => []),
  getActiveSite: vi.fn(async () => SITE),
  setActiveSite: vi.fn(async () => {}),
  verifySiteOwnership: vi.fn(async () => true),
  syncGSCData: vi.fn(async () => ({ synced: 0 })),
  getTopKeywords: getTopKeywordsMock,
  getTopPages: getTopPagesMock,
  getImpressionsOverTime: getImpressionsOverTimeMock,
  querySearchAnalytics: vi.fn(async () => []),
  getIndexingStatus: vi.fn(async () => ({ inspected: true })),
  getSitemaps: vi.fn(async () => []),
  getSyncLogs: getSyncLogsMock,
}));
vi.mock("../services/google-service.js", () => ({
  hasGoogleConnection: vi.fn(async () => true),
}));
vi.mock("../lib/resolve-org-id.js", () => ({
  resolveOrgId: vi.fn(() => ORG),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { default: gscRouter } = await import("./gsc.js");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", gscRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  getTopKeywordsMock.mockResolvedValue([]);
  getTopPagesMock.mockResolvedValue([]);
  getImpressionsOverTimeMock.mockResolvedValue([]);
  getSyncLogsMock.mockResolvedValue([]);
});

describe("GET /gsc/keywords — fenetre en jours bornee a [1, 365]", () => {
  const cases: [string, string, number][] = [
    ["jours absents : valeur par defaut", "", 30],
    ["jours illisibles : valeur par defaut", "?days=abc", 30],
    ["jours negatifs : valeur par defaut", "?days=-5", 30],
    ["au-dela du maximum : valeur par defaut", "?days=400", 30],
    ["prefixe numerique : valeur par defaut", "?days=30abc", 30],
    ["valeur valide : transmise telle quelle", "?days=7", 7],
  ];

  for (const [label, query, expected] of cases) {
    it(label, async () => {
      const res = await request(makeApp()).get(`/api/gsc/keywords${query}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, siteUrl: SITE, days: expected, keywords: [] });
      expect(getTopKeywordsMock).toHaveBeenCalledWith(ORG, SITE, expected, 100);
    });
  }
});

describe("GET /gsc/keywords — limite bornee a [1, 1000]", () => {
  const cases: [string, string, number][] = [
    ["limite absente : valeur par defaut", "", 100],
    ["limite negative : ramenee au minimum", "?limit=-5", 1],
    ["limite illisible : valeur par defaut", "?limit=abc", 100],
    ["limite enorme : plafonnee", "?limit=5000", 1000],
    ["limite valide : transmise telle quelle", "?limit=25", 25],
  ];

  for (const [label, query, expected] of cases) {
    it(label, async () => {
      const res = await request(makeApp()).get(`/api/gsc/keywords${query}`);

      expect(res.status).toBe(200);
      expect(getTopKeywordsMock).toHaveBeenCalledWith(ORG, SITE, 30, expected);
    });
  }
});

describe("GET /gsc/pages — jours et limite", () => {
  it("jours illisibles et limite negative : defaut 30 et minimum 1", async () => {
    const res = await request(makeApp()).get("/api/gsc/pages?days=abc&limit=-5");

    expect(res.status).toBe(200);
    expect(getTopPagesMock).toHaveBeenCalledWith(ORG, SITE, 30, 1);
  });

  it("valeurs valides transmises telles quelles", async () => {
    const res = await request(makeApp()).get("/api/gsc/pages?days=7&limit=25");

    expect(res.status).toBe(200);
    expect(getTopPagesMock).toHaveBeenCalledWith(ORG, SITE, 7, 25);
  });
});

describe("GET /gsc/impressions — fenetre de 90 jours par defaut", () => {
  const cases: [string, string, number][] = [
    ["jours absents : valeur par defaut", "", 90],
    ["jours illisibles : valeur par defaut", "?days=abc", 90],
    ["au-dela du maximum : valeur par defaut", "?days=400", 90],
    ["valeur valide : transmise telle quelle", "?days=7", 7],
  ];

  for (const [label, query, expected] of cases) {
    it(label, async () => {
      const res = await request(makeApp()).get(`/api/gsc/impressions${query}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, siteUrl: SITE, days: expected, timeSeries: [] });
      expect(getImpressionsOverTimeMock).toHaveBeenCalledWith(ORG, SITE, expected);
    });
  }
});

describe("GET /gsc/logs — limite bornee a [1, 100]", () => {
  const cases: [string, string, number][] = [
    ["limite absente : valeur par defaut", "", 20],
    ["limite negative : ramenee au minimum", "?limit=-5", 1],
    ["limite illisible : valeur par defaut", "?limit=abc", 20],
    ["limite enorme : plafonnee", "?limit=500", 100],
    ["limite valide : transmise telle quelle", "?limit=50", 50],
  ];

  for (const [label, query, expected] of cases) {
    it(label, async () => {
      const res = await request(makeApp()).get(`/api/gsc/logs${query}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ ok: true, logs: [] });
      expect(getSyncLogsMock).toHaveBeenCalledWith(ORG, expected);
    });
  }
});

describe("GET /gsc/analytics — plus de 500 sur une fenetre illisible", () => {
  it("repond 200 pour ?days=abc, avec la fenetre par defaut", async () => {
    const res = await request(makeApp()).get("/api/gsc/analytics?days=abc");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, siteUrl: SITE, days: 30 });
  });

  it("repond 200 pour ?days=-5 et ?days=0", async () => {
    for (const query of ["?days=-5", "?days=0"]) {
      const res = await request(makeApp()).get(`/api/gsc/analytics${query}`);
      expect(res.status).toBe(200);
      expect(res.body.days).toBe(30);
    }
  });
});
