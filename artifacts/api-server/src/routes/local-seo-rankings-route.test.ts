import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

const mocks = vi.hoisted(() => ({
  poolQuery: vi.fn(),
  poolConnect: vi.fn(),
  clientQuery: vi.fn(),
  clientRelease: vi.fn(),
  getLocalPackRank: vi.fn(),
  isDataForSEOConfigured: vi.fn(),
  getQuotaUsage: vi.fn(),
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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));

vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../services/dataforseo-service.js", () => ({
  isDataForSEOConfigured: (...args: unknown[]) => mocks.isDataForSEOConfigured(...args),
  getQuotaUsage: (...args: unknown[]) => mocks.getQuotaUsage(...args),
  getLocalPackRank: (...args: unknown[]) => mocks.getLocalPackRank(...args),
  checkAndIncrementQuota: vi.fn(async () => true),
  getKeywordSuggestions: vi.fn(),
  getSERP: vi.fn(),
  getCompetitors: vi.fn(),
  getBacklinks: vi.fn(),
  getDomainMetrics: vi.fn(),
  getKeywordDifficulty: vi.fn(),
  getGoogleMapsResults: vi.fn(),
  getAIVisibility: vi.fn(),
  getContentOptimization: vi.fn(),
  generateSEOMissions: vi.fn(),
  refreshSEOCache: vi.fn(),
}));

import seoRouter from "./seo.js";

const ORG_ID = "org-local-seo-route";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { orgId: string }).orgId = ORG_ID;
    next();
  });
  app.use("/api", seoRouter);
  return app;
}

describe("Local SEO ranking route — durable history and quota", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getQuotaUsage.mockReturnValue({ used: 0, limit: 3, remaining: 3 });
    mocks.isDataForSEOConfigured.mockResolvedValue(true);
    mocks.getLocalPackRank.mockResolvedValue([{ title: "A" }, { title: "B" }]);
    mocks.poolQuery.mockResolvedValue({ rows: [{ n: "0" }], rowCount: 1 });
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes("COUNT(*)")) return { rows: [{ n: "0" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    mocks.poolConnect.mockResolvedValue({
      query: (...args: unknown[]) => mocks.clientQuery(...args),
      release: mocks.clientRelease,
    });
  });

  it("persists a successful provider result transactionally and returns durable usage", async () => {
    const res = await request(makeApp())
      .post("/api/local-seo/rankings")
      .send({ keyword: "restaurant", location: "Bruxelles" });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      count: 2,
      usage: { used: 1, limit: 3 },
    });
    expect(mocks.clientQuery.mock.calls.map((call) => String(call[0]))).toEqual(
      expect.arrayContaining([
        "BEGIN",
        expect.stringContaining("pg_advisory_xact_lock"),
        expect.stringContaining("INSERT INTO local_seo_ranking_history"),
        "COMMIT",
      ]),
    );
    const insertIndex = mocks.clientQuery.mock.calls.findIndex((call) =>
      String(call[0]).includes("INSERT INTO local_seo_ranking_history"),
    );
    expect(insertIndex).toBeGreaterThanOrEqual(0);
    expect(mocks.clientQuery.mock.invocationCallOrder[insertIndex]).toBeLessThan(
      mocks.getLocalPackRank.mock.invocationCallOrder[0]!,
    );
    expect(mocks.poolQuery.mock.calls.some((call) =>
      String(call[0]).includes("UPDATE local_seo_ranking_history"),
    )).toBe(true);
    expect(mocks.clientRelease).toHaveBeenCalledOnce();
  });

  it("returns persist_error without calling the provider when reservation insert fails", async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes("COUNT(*)")) return { rows: [{ n: "0" }], rowCount: 1 };
      if (text.includes("INSERT INTO local_seo_ranking_history")) throw new Error("write failed");
      return { rows: [], rowCount: 1 };
    });

    const res = await request(makeApp())
      .post("/api/local-seo/rankings")
      .send({ keyword: "restaurant", location: "Bruxelles" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ ok: false, reason: "persist_error" });
    expect(mocks.clientQuery).toHaveBeenCalledWith("ROLLBACK");
    expect(mocks.getLocalPackRank).not.toHaveBeenCalled();
  });

  it("keeps the durable reservation counted when provider data cannot be finalized", async () => {
    mocks.poolQuery.mockRejectedValue(new Error("finalize failed"));

    const res = await request(makeApp())
      .post("/api/local-seo/rankings")
      .send({ keyword: "restaurant", location: "Bruxelles" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ ok: false, reason: "persist_error" });
    expect(mocks.getLocalPackRank).toHaveBeenCalledOnce();
    expect(mocks.clientQuery.mock.calls.some((call) =>
      String(call[0]).includes("INSERT INTO local_seo_ranking_history"),
    )).toBe(true);
  });

  it("releases the invisible reservation when the provider call fails", async () => {
    mocks.getLocalPackRank.mockRejectedValueOnce(new Error("provider unavailable"));

    const res = await request(makeApp())
      .post("/api/local-seo/rankings")
      .send({ keyword: "restaurant", location: "Bruxelles" });

    expect(res.status).toBe(502);
    expect(res.body).toMatchObject({ ok: false, reason: "provider_error" });
    const cleanupCall = mocks.poolQuery.mock.calls.find((call) =>
      String(call[0]).includes("DELETE FROM local_seo_ranking_history"),
    );
    expect(cleanupCall).toBeDefined();
    expect(cleanupCall?.[1]).toEqual([expect.stringMatching(/^rh_/), ORG_ID]);
  });

  it("does not call the provider when persisted usage has reached the quota", async () => {
    mocks.clientQuery.mockImplementation(async (sql: unknown) => {
      const text = String(sql);
      if (text.includes("COUNT(*)")) return { rows: [{ n: "3" }], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });

    const res = await request(makeApp())
      .post("/api/local-seo/rankings")
      .send({ keyword: "restaurant", location: "Bruxelles" });

    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({
      ok: false,
      reason: "quota_exceeded",
      usage: { used: 3, limit: 3 },
    });
    expect(mocks.getLocalPackRank).not.toHaveBeenCalled();
    expect(mocks.poolConnect).toHaveBeenCalledOnce();
  });

  it("serializes concurrent reservations so provider calls cannot exceed the durable limit", async () => {
    mocks.getQuotaUsage.mockReturnValue({ used: 0, limit: 1, remaining: 1 });
    let persistedReservations = 0;
    let lockTail = Promise.resolve();

    mocks.poolConnect.mockImplementation(async () => {
      let releaseLock: (() => void) | null = null;
      return {
        query: async (sql: unknown) => {
          const text = String(sql);
          if (text.includes("pg_advisory_xact_lock")) {
            const previous = lockTail;
            lockTail = new Promise<void>((resolve) => { releaseLock = resolve; });
            await previous;
            return { rows: [], rowCount: 1 };
          }
          if (text.includes("COUNT(*)")) {
            return { rows: [{ n: String(persistedReservations) }], rowCount: 1 };
          }
          if (text.includes("INSERT INTO local_seo_ranking_history")) {
            persistedReservations += 1;
            return { rows: [], rowCount: 1 };
          }
          if (text === "COMMIT" || text === "ROLLBACK") {
            releaseLock?.();
            return { rows: [], rowCount: 1 };
          }
          return { rows: [], rowCount: 1 };
        },
        release: vi.fn(),
      };
    });

    const [first, second] = await Promise.all([
      request(makeApp()).post("/api/local-seo/rankings").send({ keyword: "restaurant", location: "Bruxelles" }),
      request(makeApp()).post("/api/local-seo/rankings").send({ keyword: "hotel", location: "Bruxelles" }),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 429]);
    expect(mocks.getLocalPackRank).toHaveBeenCalledOnce();
    expect(persistedReservations).toBe(1);
  });

  it("returns history_unavailable instead of a false empty history on DB failure", async () => {
    mocks.poolQuery.mockRejectedValue(new Error("read failed"));

    const res = await request(makeApp()).get("/api/local-seo/rankings/history");

    expect(res.status).toBe(500);
    expect(res.body).toMatchObject({ ok: false, reason: "history_unavailable" });
    expect(res.body.history).toBeUndefined();
    expect(res.body.usage).toBeUndefined();
  });
});