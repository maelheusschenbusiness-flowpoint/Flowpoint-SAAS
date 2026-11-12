/**
 * seo-quota-failclosed.test.ts
 *
 * Politique decidee le 17/10/2026 : les appels PAYANTS DataForSEO sont
 * fail-closed. Si PostgreSQL est injoignable, le quota n'est pas verifiable,
 * donc aucun appel payant n'est autorise — reponse 503, pas 429, et sans rien
 * dire de l'etat interne de l'infrastructure.
 *
 * Le repli precedent comptait en memoire de processus. Il laissait passer des
 * appels factures sur un compteur reparti de zero a chaque redemarrage, c'est
 * a dire exactement le trou que ce plafond doit fermer.
 *
 * Ces tests montent le VRAI routeur `seo.ts` et le VRAI service DataForSEO ;
 * seuls `pool` et `fetch` sont simules. Un refus ne compte que s'il intervient
 * AVANT la sortie reseau : chaque `fetch` est donc compte, et le compteur doit
 * rester a zero.
 */
import { beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  avertissements: [] as unknown[],
}));

vi.mock("@workspace/db", () => ({
  pool: {
    query: (...args: unknown[]) => mocks.poolQuery(...args),
    connect: (...args: unknown[]) => mocks.poolConnect(...args),
  },
  getDBMode: vi.fn(() => "postgres"),
  getOrgDb: vi.fn(() => vi.fn()),
  queryWithRetry: vi.fn(),
}));

vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn(),
    warn: (...args: unknown[]) => { mocks.avertissements.push(args); },
  },
}));

vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

// Le service DataForSEO n'est PAS simule : c'est lui qu'on met a l'epreuve.
import seoRouter from "./seo.js";

const ORG = "org-failclosed";

/** Chaque sortie reseau est comptee : un appel payant evite doit etre visible. */
let appelsReseau = 0;
const fetchOriginal = globalThis.fetch;

function brancherFetch(reponse: () => unknown): void {
  globalThis.fetch = vi.fn(async (): Promise<Response> => {
    appelsReseau += 1;
    return reponse() as Response;
  }) as unknown as typeof fetch;
}

function reponseOk(corps: unknown): Response {
  return {
    ok: true, status: 200,
    json: async () => corps,
    text: async () => JSON.stringify(corps),
    headers: { get: () => null },
  } as unknown as Response;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { orgId: string }).orgId = ORG;
    next();
  });
  app.use("/api", seoRouter);
  return app;
}

/** Simule une base injoignable : `pool.connect()` rejette. */
function baseInjoignable(): void {
  mocks.poolConnect.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:5432"));
  mocks.poolQuery.mockRejectedValue(new Error("ECONNREFUSED 127.0.0.1:5432"));
}

/** Base saine : identifiants DataForSEO presents, quota a la valeur donnee. */
function baseSaine(utilise: number): void {
  mocks.clientRelease.mockReturnValue(undefined);
  mocks.clientQuery.mockImplementation(async (sql: unknown, params?: unknown[]) => {
    const texte = String(sql);
    if (texte.includes("INSERT INTO dataforseo_quota")) {
      const unites = Number((params as unknown[])?.[2] ?? 1);
      return { rows: [{ requests_used: utilise + unites }], rowCount: 1 };
    }
    if (texte.includes("UPDATE dataforseo_quota")) {
      return { rows: [{ requests_used: Math.max(0, utilise) }], rowCount: 1 };
    }
    // Identifiants DataForSEO par organisation
    if (texte.includes("org_settings") || texte.includes("dataforseo")) {
      return { rows: [{ value: JSON.stringify({ login: "l", password: "p" }) }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
  mocks.poolConnect.mockResolvedValue({
    query: (...a: unknown[]) => mocks.clientQuery(...a),
    release: () => mocks.clientRelease(),
  });
  mocks.poolQuery.mockImplementation((...a: unknown[]) => mocks.clientQuery(...a));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.avertissements.length = 0;
  appelsReseau = 0;
  process.env["DATAFORSEO_LOGIN"] = "login-de-test";
  process.env["DATAFORSEO_PASSWORD"] = "mot-de-passe-de-test";
  brancherFetch(() => reponseOk({ tasks: [{ result: [] }] }));
});

afterAll(() => { globalThis.fetch = fetchOriginal; });

describe("PostgreSQL indisponible — aucun appel payant n'est autorise", () => {
  it("repond 503 et code QUOTA_CHECK_UNAVAILABLE, sans aucune sortie reseau", async () => {
    baseInjoignable();
    const r = await request(makeApp()).get("/api/seo/keywords?keyword=plombier");
    expect(r.status).toBe(503);
    expect(r.body.code).toBe("QUOTA_CHECK_UNAVAILABLE");
    expect(appelsReseau).toBe(0);
  });

  it("ne renvoie jamais 429 quand la cause est l'indisponibilite de la base", async () => {
    baseInjoignable();
    const r = await request(makeApp()).get("/api/seo/serp?keyword=plombier");
    expect(r.status).not.toBe(429);
    expect(r.status).toBe(503);
  });

  it("le corps de la reponse 503 n'expose aucun detail interne", async () => {
    baseInjoignable();
    const r = await request(makeApp()).get("/api/seo/keywords?keyword=plombier");
    const texte = JSON.stringify(r.body);
    for (const fuite of ["ECONNREFUSED", "5432", "127.0.0.1", "postgres", "dataforseo_quota", "stack"]) {
      expect(texte).not.toContain(fuite);
    }
    expect(Object.keys(r.body).sort()).toEqual(["code", "error"]);
  });

  it("les onze endpoints payants refusent tous, aucun ne passe", async () => {
    const payants = [
      "/api/seo/keywords?keyword=a", "/api/seo/serp?keyword=a",
      "/api/seo/competitors?domain=a.fr", "/api/seo/backlinks?domain=a.fr",
      "/api/seo/domain-metrics?domain=a.fr", "/api/seo/keyword-difficulty?keyword=a",
    ];
    for (const chemin of payants) {
      baseInjoignable();
      const r = await request(makeApp()).get(chemin);
      expect([503, 404], `${chemin} => ${r.status}`).toContain(r.status);
      if (r.status === 503) expect(r.body.code).toBe("QUOTA_CHECK_UNAVAILABLE");
    }
    expect(appelsReseau).toBe(0);
  });

  it("l'echec est journalise sans exposer de secret DataForSEO", async () => {
    baseInjoignable();
    await request(makeApp()).get("/api/seo/keywords?keyword=plombier");
    const trace = JSON.stringify(mocks.avertissements);
    expect(trace).toContain("quota");
    expect(trace).not.toContain("mot-de-passe-de-test");
    expect(trace).not.toContain("login-de-test");
  });
});

describe("les chemins gratuits restent accessibles", () => {
  it("/api/seo/status repond 200 meme avec PostgreSQL injoignable", async () => {
    baseInjoignable();
    const r = await request(makeApp()).get("/api/seo/status");
    expect(r.status).toBe(200);
    expect(r.body.quota).toBeDefined();
    expect(appelsReseau).toBe(0);
  });
});

describe("plafond atteint — 429, distinct du 503", () => {
  it("renvoie 429 avec le compte et la limite quand la base repond", async () => {
    baseSaine(1000);
    const r = await request(makeApp()).get("/api/seo/keywords?keyword=plombier");
    expect(r.status).toBe(429);
    expect(r.body.limit).toBe(1000);
    expect(appelsReseau).toBe(0);
  });
});

describe("une erreur du fournisseur ne consomme pas de quota", () => {
  it("un 500 DataForSEO declenche un remboursement de l'unite reservee", async () => {
    baseSaine(10);
    brancherFetch(() => ({
      ok: false, status: 500,
      text: async () => "upstream exploded",
      json: async () => ({}),
      headers: { get: () => null },
    }));
    const r = await request(makeApp()).get("/api/seo/keywords?keyword=plombier");
    expect(r.status).toBe(200); // le service degrade proprement
    expect(appelsReseau).toBe(1);
    const sqls = mocks.clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("UPDATE dataforseo_quota"))).toBe(true);
  });

  it("une organisation SANS identifiants DataForSEO ne consomme pas de quota", async () => {
    delete process.env["DATAFORSEO_LOGIN"];
    delete process.env["DATAFORSEO_PASSWORD"];
    mocks.clientRelease.mockReturnValue(undefined);
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const texte = String(sql);
      if (texte.includes("INSERT INTO dataforseo_quota")) return { rows: [{ requests_used: 11 }], rowCount: 1 };
      if (texte.includes("UPDATE dataforseo_quota")) return { rows: [{ requests_used: 10 }], rowCount: 1 };
      return { rows: [], rowCount: 0 }; // aucun identifiant stocke
    });
    mocks.poolConnect.mockResolvedValue({
      query: (...a: unknown[]) => mocks.clientQuery(...a),
      release: () => mocks.clientRelease(),
    });
    mocks.poolQuery.mockImplementation((...a: unknown[]) => mocks.clientQuery(...a));

    const r = await request(makeApp()).get("/api/seo/keywords?keyword=plombier");
    expect(r.status).toBe(200);
    expect(appelsReseau).toBe(0); // aucun appel payant
    const sqls = mocks.clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("UPDATE dataforseo_quota"))).toBe(true); // rendu
  });

  it("un appel payant ABOUTI ne declenche aucun remboursement", async () => {
    baseSaine(10);
    brancherFetch(() => reponseOk({ tasks: [{ result: [{ keyword: "plombier", search_volume: 10, keyword_difficulty: 1, cpc: 1 }] }] }));
    const r = await request(makeApp()).get("/api/seo/keywords?keyword=plombier");
    expect(r.status).toBe(200);
    expect(appelsReseau).toBe(1);
    const sqls = mocks.clientQuery.mock.calls.map((c) => String(c[0]));
    expect(sqls.some((s) => s.includes("UPDATE dataforseo_quota"))).toBe(false);
  });
});
