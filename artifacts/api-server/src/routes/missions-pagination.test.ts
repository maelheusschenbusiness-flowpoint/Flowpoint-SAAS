/**
 * Pagination de GET /missions.
 *
 * `limit` et `offset` etaient lus par `parseInt(...) || defaut` : « -5 » et
 * « -3 » partaient tels quels dans le LIMIT/OFFSET, PostgreSQL les refusait,
 * l'erreur etait avalee et la route repondait 200 avec une liste vide — les
 * missions reelles de l'organisation disparaissaient. « 100000 » n'etait pas
 * plafonne, « 20abc » passait pour 20.
 *
 * On verifie ici les valeurs reellement transmises a la base (les deux
 * derniers parametres de la requete), et que le filtre par organisation reste
 * le premier parametre.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { poolQueryMock } = vi.hoisted(() => ({ poolQueryMock: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: poolQueryMock, connect: vi.fn() } }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/store.js", () => ({
  store: { logActivity: vi.fn(async () => undefined) },
}));
vi.mock("../services/mission-engine.js", () => ({
  runMissionEngine: vi.fn(),
  getMissionsStats: vi.fn(),
}));
vi.mock("../services/ai-engine.js", () => ({
  consumeAICredits: vi.fn(async () => ({ allowed: true })),
}));
vi.mock("../services/ai-prefs.js", () => ({
  loadOrgAIPrefs: vi.fn(async () => ({})),
}));
vi.mock("../services/ai-quota.js", () => ({
  buildQuotaGuidance: vi.fn(() => ({})),
}));

import missionsRouter from "./missions.js";

/** App de test : l'organisation est injectee par un middleware, pas par la base. */
function makeApp(org: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: org, orgContext: { orgId: org, role: "owner" } });
    next();
  });
  app.use("/api", missionsRouter);
  return app;
}

/** Parametres de la derniere lecture simulee : [org, ..., limit, offset]. */
function derniersParams(): unknown[] {
  const call = poolQueryMock.mock.calls.at(-1);
  return (call?.[1] ?? []) as unknown[];
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [] });
});

describe("GET /missions — limite bornee a [1, 200], defaut 100", () => {
  const cases: [string, string, number][] = [
    ["aucun parametre : valeur par defaut", "", 100],
    ["limite negative : ramenee au minimum", "?limit=-5", 1],
    ["zero : ramene au minimum", "?limit=0", 1],
    ["limite illisible : valeur par defaut", "?limit=abc", 100],
    ["limite enorme : plafonnee", "?limit=100000", 200],
    ["limite valide : transmise telle quelle", "?limit=25", 25],
    ["prefixe numerique : valeur par defaut", "?limit=20abc", 100],
  ];

  for (const [label, query, expected] of cases) {
    it(label, async () => {
      const response = await request(makeApp("org-a")).get(`/api/missions${query}`);

      expect(response.status).toBe(200);
      const params = derniersParams();
      expect(params.at(-2)).toBe(expected);
    });
  }
});

describe("GET /missions — offset borne a [0, 100000], defaut 0", () => {
  const cases: [string, string, number][] = [
    ["aucun parametre : valeur par defaut", "", 0],
    ["offset negatif : valeur par defaut", "?offset=-3", 0],
    ["offset illisible : valeur par defaut", "?offset=abc", 0],
    ["offset valide : transmis tel quel", "?offset=40", 40],
  ];

  for (const [label, query, expected] of cases) {
    it(label, async () => {
      const response = await request(makeApp("org-a")).get(`/api/missions${query}`);

      expect(response.status).toBe(200);
      const params = derniersParams();
      expect(params.at(-1)).toBe(expected);
    });
  }
});

describe("GET /missions — isolation entre organisations", () => {
  it("transmet a la base l'organisation de la requete, et aucune autre", async () => {
    for (const org of ["org-a", "org-b"]) {
      const response = await request(makeApp(org)).get("/api/missions");

      expect(response.status).toBe(200);
      const call = poolQueryMock.mock.calls.at(-1);
      expect(call?.[1]).toEqual([org, 100, 0]);
      expect(poolQueryMock.mock.calls.at(-1)?.[1][0]).toBe(org);
    }
  });

  it("garde l'organisation en premier parametre avec une pagination corrigee", async () => {
    for (const org of ["org-a", "org-b"]) {
      await request(makeApp(org)).get("/api/missions?limit=-5&offset=-3");

      expect(poolQueryMock).toHaveBeenLastCalledWith(expect.any(String), [org, 1, 0]);
    }
  });
});

describe("GET /missions — les lignes de la base ne sont plus masquees", () => {
  it("restitue la ligne lue avec ?limit=-5", async () => {
    poolQueryMock.mockResolvedValue({
      rows: [{ id: "m_1", title: "Corriger les redirections", status: "todo", priority: "high" }],
    });

    const response = await request(makeApp("org-a")).get("/api/missions?limit=-5");

    expect(response.status).toBe(200);
    expect(response.body).toHaveLength(1);
    expect(response.body[0]).toMatchObject({
      id: "m_1",
      title: "Corriger les redirections",
      status: "todo",
      priority: "high",
    });
    expect(derniersParams()).toEqual(["org-a", 1, 0]);
  });
});
