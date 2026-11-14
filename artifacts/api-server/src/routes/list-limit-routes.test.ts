/**
 * Limites de liste des routes GBP Posts, Review Intelligence et Local Maps.
 *
 * Ce que le client tape dans `?limit=` finissait tel quel dans un `LIMIT $n` :
 * « -5 » ou « abc » (NaN) etaient refuses par PostgreSQL. gbp-posts et
 * review-intelligence avalaient l'erreur et repondaient 200 avec une liste
 * vide — les donnees reelles disparaissaient sans le dire — et
 * /local-maps/competitors, sans catch, repondait 500. Une limite enorme
 * n'etait pas plafonnee.
 *
 * On verifie ici la valeur reellement transmise comme dernier parametre SQL,
 * pas seulement le code de reponse.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  orgDb: vi.fn(),
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: (...args: unknown[]) => m.poolQuery(...args),
    connect: (...args: unknown[]) => m.poolConnect(...args),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

// Gardes d'abonnement en laisser-passer : la fabrique de `vi.mock` est hoistee,
// elle ne peut pas lire une variable de haut niveau du fichier.
vi.mock("../middlewares/planGate.js", () => {
  const passthrough = () => (_req: unknown, _res: unknown, next: () => void) => next();
  return {
    requireFeature: passthrough,
    requireAddon: passthrough,
    requireAddonOrFeature: passthrough,
    requireQuota: passthrough,
  };
});
vi.mock("../middlewares/requireAuth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
  canAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/gbp-posting-service.js", () => ({
  createPost: vi.fn(), generateAiPost: vi.fn(), publishPost: vi.fn(),
  getPostsDashboard: vi.fn(), deletePost: vi.fn(), getScheduledPosts: vi.fn(),
}));
vi.mock("../services/review-intel-service.js", () => ({
  analyzeReview: vi.fn(), generateReply: vi.fn(), generateReplyForReview: vi.fn(),
  getReputationDashboard: vi.fn(), syncReviewsFromGBP: vi.fn(),
}));
vi.mock("../services/local-maps-service.js", () => ({
  createHeatmap: vi.fn(), getHeatmaps: vi.fn(), getHeatmapDetail: vi.fn(),
  getMapsDashboard: vi.fn(), generateAiLocalRecommendations: vi.fn(), startHeatmapScan: vi.fn(),
}));
vi.mock("../services/dataforseo-service.js", () => ({
  isDataForSEOConfigured: vi.fn(async () => false),
  verifierEtConsommerQuota: vi.fn(async () => ({ autorise: true })),
  rembourserQuota: vi.fn(async () => undefined),
  suivreAppelsPayants: vi.fn(async (fn: () => Promise<unknown>) => ({ resultat: await fn(), appelsReussis: 1 })),
  getGoogleMapsResults: vi.fn(),
}));

import gbpPostsRouter from "./gbp-posts.js";
import reviewIntelligenceRouter from "./review-intelligence.js";
import localMapsRouter from "./local-maps.js";

const ORG_ID = "org-limites";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId: ORG_ID,
      orgDb: m.orgDb,
      orgContext: { orgId: ORG_ID, role: "owner" },
    });
    next();
  });
  app.use("/api", gbpPostsRouter);
  app.use("/api", reviewIntelligenceRouter);
  app.use("/api", localMapsRouter);
  return app;
}

/** Dernier parametre transmis a la requete SQL d'un espion `(sql, params)`. */
function dernierParamSql(spy: { mock: { calls: unknown[][] } }): unknown {
  const derniereCall = spy.mock.calls.at(-1);
  expect(derniereCall).toBeDefined();
  const params = derniereCall![1] as unknown[];
  expect(Array.isArray(params)).toBe(true);
  return params.at(-1);
}

beforeEach(() => {
  vi.clearAllMocks();
  m.orgDb.mockResolvedValue({ rows: [] });
  m.poolQuery.mockResolvedValue({ rows: [] });
  m.clientQuery.mockResolvedValue({ rows: [] });
  m.poolConnect.mockResolvedValue({ query: m.clientQuery, release: m.clientRelease });
});

/** Les six situations attendues pour une limite bornee a [1, 200]. */
const casLimite = (defaut: number): [string, string, number][] => [
  ["limite absente : valeur par defaut de la route", "", defaut],
  ["limite negative : ramenee au minimum", "?limit=-5", 1],
  ["zero : ramene au minimum", "?limit=0", 1],
  ["limite illisible : valeur par defaut de la route", "?limit=abc", defaut],
  ["limite enorme : plafonnee", "?limit=1000000", 200],
  ["limite valide : transmise telle quelle", "?limit=25", 25],
];

describe("GET /gbp-posts/list — limite bornee a [1, 200], defaut 50", () => {
  for (const [label, query, attendu] of casLimite(50)) {
    it(label, async () => {
      const response = await request(makeApp()).get(`/api/gbp-posts/list${query}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ posts: [], count: 0 });
      expect(dernierParamSql(m.orgDb)).toBe(attendu);
    });
  }

  it("une limite illisible ne masque plus les donnees reelles", async () => {
    const posts = [{ id: "post-1", status: "live" }, { id: "post-2", status: "draft" }];
    m.orgDb.mockResolvedValue({ rows: posts });

    const response = await request(makeApp()).get("/api/gbp-posts/list?limit=abc");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ posts, count: 2 });
    expect(dernierParamSql(m.orgDb)).toBe(50);
  });
});

describe("GET /review-intelligence/reviews — limite bornee a [1, 200], defaut 30", () => {
  for (const [label, query, attendu] of casLimite(30)) {
    it(label, async () => {
      const response = await request(makeApp()).get(`/api/review-intelligence/reviews${query}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ reviews: [], count: 0 });
      expect(dernierParamSql(m.orgDb)).toBe(attendu);
    });
  }
});

describe("GET /review-intelligence/alerts — limite bornee a [1, 200], defaut 20", () => {
  for (const [label, query, attendu] of casLimite(20)) {
    it(label, async () => {
      const response = await request(makeApp()).get(`/api/review-intelligence/alerts${query}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ alerts: [], count: 0 });
      expect(dernierParamSql(m.orgDb)).toBe(attendu);
    });
  }
});

describe("GET /local-maps/competitors — limite bornee a [1, 200], defaut 20", () => {
  for (const [label, query, attendu] of casLimite(20)) {
    it(label, async () => {
      const response = await request(makeApp()).get(`/api/local-maps/competitors${query}`);

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ competitors: [], count: 0 });
      expect(dernierParamSql(m.clientQuery)).toBe(attendu);
    });
  }

  it("une limite negative ne repond plus 500 et la connexion est rendue", async () => {
    const response = await request(makeApp()).get("/api/local-maps/competitors?limit=-5");

    expect(response.status).not.toBe(500);
    expect(response.status).toBe(200);
    expect(m.clientRelease).toHaveBeenCalled();
  });
});
