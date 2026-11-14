/**
 * Lecture des entiers de chaine de requete sur les routes qui en dependent.
 *
 * Ce que le client tape finit dans un `LIMIT` ou dans une fenetre de dates :
 * une limite negative ou illisible faisait repondre 503 a /crm/logs, et un
 * « 30abc » passait pour 30 jours. On verifie ici la valeur reellement
 * transmise au service, pas seulement le code de reponse.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { crmStubs, getSyncLogsMock, getAudienceDataMock, getConversionOverviewMock } = vi.hoisted(() => ({
  getSyncLogsMock: vi.fn(),
  getAudienceDataMock: vi.fn(),
  getConversionOverviewMock: vi.fn(),
  crmStubs: {
    getCrmStatus: vi.fn(),
    disconnectCrm: vi.fn(),
    getFieldMappings: vi.fn(),
    upsertFieldMapping: vi.fn(),
    getCrmLimit: vi.fn(() => 1),
  },
}));

vi.mock("@workspace/db", () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  resolvePlanFromDB: async () => "pro",
}));
vi.mock("../middlewares/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/crm-service.js", () => ({
  CRM_PROVIDERS: [{ id: "hubspot", name: "HubSpot", color: "#ff7a59", icon: "crm", scopes: [] }],
  getSyncLogs: getSyncLogsMock,
  ...crmStubs,
}));
vi.mock("../services/audience-service.js", () => ({
  getAudienceStatus: vi.fn(),
  getAudienceData: getAudienceDataMock,
}));
vi.mock("../services/conversion-service.js", () => ({
  getConversionStatus: vi.fn(),
  getConversionOverview: getConversionOverviewMock,
  getConversionEvents: vi.fn(),
  getConversionLandingPages: vi.fn(),
  getConversionSources: vi.fn(),
  getConversionDevices: vi.fn(),
  getConversionGeo: vi.fn(),
}));

import crmRouter from "./crm.js";
import audienceRouter from "./audience.js";
import conversionRouter from "./conversion.js";

/** Date figee : les bornes de periode attendues sont alors des chaines litterales. */
const NOW = "2026-03-15T12:00:00.000Z";
const TODAY = "2026-03-15";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgContext: { orgId: "org-a", role: "owner" } });
    next();
  });
  app.use("/api", crmRouter);
  app.use("/api/audience", audienceRouter);
  app.use("/api/conversion", conversionRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  getSyncLogsMock.mockResolvedValue([]);
  getAudienceDataMock.mockResolvedValue({});
  getConversionOverviewMock.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /crm/logs — limite bornee a [1, 200]", () => {
  const cases: [string, string, number][] = [
    ["limite absente : valeur par defaut", "", 50],
    ["limite negative : ramenee au minimum", "?limit=-5", 1],
    ["zero : ramene au minimum", "?limit=0", 1],
    ["limite illisible : valeur par defaut", "?limit=abc", 50],
    ["limite enorme : plafonnee", "?limit=1000000", 200],
    ["limite valide : transmise telle quelle", "?limit=25", 25],
  ];

  for (const [label, query, expected] of cases) {
    it(label, async () => {
      const response = await request(makeApp()).get(`/api/crm/logs${query}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ logs: [], count: 0 });
      expect(getSyncLogsMock).toHaveBeenCalledWith("org-a", expected);
    });
  }

  it("ne repond plus 503 pour une limite refusee par la base", async () => {
    const response = await request(makeApp()).get("/api/crm/logs?limit=-5");

    expect(response.status).not.toBe(503);
    expect(getSyncLogsMock.mock.calls[0]?.[1]).toBeGreaterThanOrEqual(1);
  });
});

/** Bornes attendues pour une fenetre de `days` jours finissant aujourd'hui. */
const PERIODES: Record<number, string> = { 30: "2026-02-13", 7: "2026-03-08" };

describe("GET /audience/overview — fenetre en jours", () => {
  const cases: [string, string, number][] = [
    ["jours absents : valeur par defaut", "", 30],
    ["au-dela du maximum : valeur par defaut", "?days=400", 30],
    ["prefixe numerique : valeur par defaut", "?days=30abc", 30],
    ["decimal : valeur par defaut", "?days=7.9", 30],
    ["valeur valide : transmise telle quelle", "?days=7", 7],
  ];

  for (const [label, query, expected] of cases) {
    it(label, async () => {
      const response = await request(makeApp()).get(`/api/audience/overview${query}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ ok: true, source: "ga4", days: expected });
      expect(getAudienceDataMock).toHaveBeenCalledWith("org-a", PERIODES[expected], TODAY);
    });
  }
});

describe("GET /conversion/overview — fenetre en jours", () => {
  const cases: [string, string, number][] = [
    ["jours absents : valeur par defaut", "", 30],
    ["au-dela du maximum : valeur par defaut", "?days=400", 30],
    ["prefixe numerique : valeur par defaut", "?days=30abc", 30],
    ["decimal : valeur par defaut", "?days=7.9", 30],
    ["valeur valide : transmise telle quelle", "?days=7", 7],
  ];

  for (const [label, query, expected] of cases) {
    it(label, async () => {
      const response = await request(makeApp()).get(`/api/conversion/overview${query}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ ok: true, days: expected });
      expect(getConversionOverviewMock).toHaveBeenCalledWith("org-a", PERIODES[expected], TODAY);
    });
  }
});
