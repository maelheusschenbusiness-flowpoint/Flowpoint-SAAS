/**
 * Fenetre `?days=` de GET /monitors/:id/checks.
 *
 * Ce que le client tape finissait dans la borne `since` comparee a
 * `checked_at` (BIGINT, millisecondes) : « abc » et « 20abc » donnaient NaN,
 * « 1.5 » une borne decimale — PostgreSQL refusait la requete, l'erreur etait
 * avalee et la route repondait une liste vide — tandis que « -5 » ou « 0 »
 * placaient la borne dans le futur, liste vide alors que des verifications
 * existent.
 *
 * On verifie ici la borne `since` reellement transmise a la lecture de
 * l'historique, pas seulement le code de reponse.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  orgDb: vi.fn(),
  loadBillingContext: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
  withOrgDb: vi.fn(),
}));

vi.mock("../middlewares/requireRole.js", () => ({
  canAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../middlewares/rateLimiter.js", () => ({
  createRateLimit: vi.fn(() => (_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../middlewares/validateMonitorUrl.js", () => ({
  validateMonitorUrl: vi.fn(),
  isPrivateHost: vi.fn(),
  checkDnsResolution: vi.fn(),
}));

vi.mock("../services/billing-service.js", () => ({
  checkQuota: vi.fn(),
}));

vi.mock("../services/billing-context.js", () => ({
  loadBillingContext: (...args: unknown[]) => m.loadBillingContext(...args),
}));

vi.mock("./qa-fixtures.js", () => ({
  isQaFixturesEnabled: vi.fn(() => false),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock("../services/store.js", () => ({
  store: { logActivity: vi.fn(), broadcast: vi.fn() },
}));

import monitorRouter from "./monitors.js";

const ORG_ID = "org-monitor-checks";
const MONITOR_ID = "monitor-checks-1";
const AUTRE_MONITOR_ID = "monitor-autre-org";

/** Date figee : la borne attendue est alors un nombre litteral. */
const NOW = "2026-03-15T12:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const JOUR_MS = 24 * 60 * 60 * 1000;

/** Une ligne d'historique telle que la base la rend. */
const LIGNE_BRUTE = {
  id:          "check-1",
  monitor_id:  MONITOR_ID,
  ok:          true,
  latency:     123,
  status_code: 200,
  error:       null,
  checked_at:  NOW_MS - 3600_000,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId: ORG_ID,
      orgDb: m.orgDb,
      orgContext: { orgId: ORG_ID, userId: "user-1", email: "owner@example.com", role: "owner" },
    });
    next();
  });
  app.use("/api", monitorRouter);
  return app;
}

/** Borne `since` transmise comme second parametre de la derniere requete. */
function sinceTransmis(): unknown {
  const derniereCall = m.orgDb.mock.calls.at(-1);
  expect(derniereCall).toBeDefined();
  const params = derniereCall![1] as unknown[];
  expect(Array.isArray(params)).toBe(true);
  return params[1];
}

/** Borne attendue pour une fenetre de `days` jours finissant maintenant. */
function attendreFenetre(days: number) {
  const since = sinceTransmis();
  expect(Number.isInteger(since)).toBe(true);
  expect(since).toBe(NOW_MS - days * JOUR_MS);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  m.loadBillingContext.mockResolvedValue({ addons: {} });
  m.orgDb.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql.includes("FROM monitors")) {
      return values[0] === MONITOR_ID && values[1] === ORG_ID
        ? { rows: [{ id: MONITOR_ID }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    return { rows: [LIGNE_BRUTE], rowCount: 1 };
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /monitors/:id/checks — fenetre bornee a [1, 90]", () => {
  const cas: [string, string, number][] = [
    ["jours absents : valeur par defaut", "", 30],
    ["valeur valide : transmise telle quelle", "?days=7", 7],
    ["valeur illisible : valeur par defaut", "?days=abc", 30],
    ["decimal : valeur par defaut", "?days=1.5", 30],
    ["prefixe numerique : valeur par defaut", "?days=20abc", 30],
    ["valeur negative : ramenee au minimum", "?days=-5", 1],
    ["zero : ramene au minimum", "?days=0", 1],
    ["au-dela du maximum : plafonnee", "?days=400", 90],
  ];

  for (const [label, query, attendu] of cas) {
    it(label, async () => {
      const response = await request(makeApp()).get(`/api/monitors/${MONITOR_ID}/checks${query}`);

      expect(response.status).toBe(200);
      expect(m.orgDb).toHaveBeenCalledWith(
        expect.stringContaining("FROM monitor_checks"),
        [MONITOR_ID, NOW_MS - attendu * JOUR_MS],
      );
      attendreFenetre(attendu);
    });
  }

  it("avec l'option de retention, la fenetre est plafonnee a 365 jours", async () => {
    m.loadBillingContext.mockResolvedValue({ addons: { retention365d: true } });

    const response = await request(makeApp()).get(`/api/monitors/${MONITOR_ID}/checks?days=400`);

    expect(response.status).toBe(200);
    attendreFenetre(365);
  });

  it("une fenetre illisible ne masque plus les verifications reelles", async () => {
    const response = await request(makeApp()).get(`/api/monitors/${MONITOR_ID}/checks?days=abc`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{
      id:         LIGNE_BRUTE.id,
      monitorId:  LIGNE_BRUTE.monitor_id,
      ok:         LIGNE_BRUTE.ok,
      latency:    LIGNE_BRUTE.latency,
      statusCode: LIGNE_BRUTE.status_code,
      error:      LIGNE_BRUTE.error,
      checkedAt:  LIGNE_BRUTE.checked_at,
    }]);
    attendreFenetre(30);
  });

  it("un moniteur d'une autre organisation repond 404 sans lire l'historique", async () => {
    const response = await request(makeApp()).get(`/api/monitors/${AUTRE_MONITOR_ID}/checks?days=7`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Monitor not found" });
    expect(m.orgDb).not.toHaveBeenCalledWith(
      expect.stringContaining("FROM monitor_checks"),
      expect.anything(),
    );
  });

  it("un moniteur d'une autre organisation repond 404 meme avec une fenetre illisible", async () => {
    const response = await request(makeApp()).get(`/api/monitors/${AUTRE_MONITOR_ID}/checks?days=abc`);

    expect(response.status).toBe(404);
    expect(response.body).toEqual({ error: "Monitor not found" });
  });
});
