/**
 * activity-pagination.test.ts — GET /api/activity real-total pagination contract.
 *
 * Task #628 (backend, real aggregates only). Validates that GET /api/activity:
 *   1. Legacy default: returns a bare array (backward compatible) AND exposes
 *      the TRUE total (distinct from page size) via X-Total-Count header.
 *   2. ?meta=1: returns the rich envelope { events, pageSize, total, hasMore,
 *      limit, offset, page } where total ≠ pageSize when more rows exist.
 *   3. A genuine query error (store signals error:true) is surfaced as HTTP 500
 *      — NOT served as a false-empty page.
 *   4. A genuine empty feed (error:false, total:0) is a normal 200 empty array.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

const getFilteredActivityPage = vi.fn();
vi.mock("../services/store.js", () => ({
  store: {
    getFilteredActivityPage: (...a: unknown[]) => getFilteredActivityPage(...a),
    logActivity: vi.fn(async () => {}),
    addSseClient: vi.fn(),
    removeSseClient: vi.fn(),
  },
}));

import activityRouter from "../routes/activity.js";

const ORG_ID = "org-uuid-act";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { orgId: string }).orgId = ORG_ID;
    next();
  });
  app.use("/api", activityRouter);
  return app;
}

describe("GET /api/activity — real-total pagination contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("1. legacy default returns a bare array + X-Total-Count reflects the true total", async () => {
    getFilteredActivityPage.mockResolvedValue({
      events: [{ id: "a1", type: "audit", label: "x" }],
      total: 137,
      hasMore: true,
      limit: 50,
      offset: 0,
      error: false,
    });

    const res = await request(makeApp()).get("/api/activity");
    expect(res.status).toBe(200);
    // backward-compatible bare array
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    // true total (137) is distinct from the page size (1)
    expect(res.headers["x-total-count"]).toBe("137");
    expect(res.headers["x-page-size"]).toBe("1");
    expect(res.headers["x-has-more"]).toBe("1");
  });

  it("2. ?meta=1 returns the rich envelope distinguishing pageSize from total", async () => {
    getFilteredActivityPage.mockResolvedValue({
      events: [{ id: "a1" }, { id: "a2" }],
      total: 200,
      hasMore: true,
      limit: 2,
      offset: 2,
      error: false,
    });

    const res = await request(makeApp()).get("/api/activity?meta=1&limit=2&page=1");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(false);
    expect(res.body.events).toHaveLength(2);
    expect(res.body.pageSize).toBe(2);
    expect(res.body.total).toBe(200);   // true total, NOT the page size
    expect(res.body.hasMore).toBe(true);
    expect(res.body.limit).toBe(2);
    expect(res.body.offset).toBe(2);
    expect(res.body.page).toBe(1);
    // page*limit offset propagated to the store
    expect(getFilteredActivityPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 2, offset: 2, orgId: ORG_ID })
    );
  });

  it("3. genuine query error is surfaced as HTTP 500, not a false-empty page", async () => {
    getFilteredActivityPage.mockResolvedValue({
      events: [],
      total: 0,
      hasMore: false,
      limit: 50,
      offset: 0,
      error: true,
    });

    const res = await request(makeApp()).get("/api/activity");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("activity_fetch_failed");
  });

  it("4. genuine empty feed (error:false, total:0) is a normal 200 empty array", async () => {
    getFilteredActivityPage.mockResolvedValue({
      events: [],
      total: 0,
      hasMore: false,
      limit: 50,
      offset: 0,
      error: false,
    });

    const res = await request(makeApp()).get("/api/activity");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
    expect(res.headers["x-total-count"]).toBe("0");
    expect(res.headers["x-has-more"]).toBe("0");
  });
});

/**
 * `limit` and `page` come from the query string: whatever the caller typed.
 * `parseInt` accepted prefixes ("50abc" → 50, "2.7" → 2) and `page` had no
 * upper bound, so `?page=99999999999999999999` produced an offset that is not
 * a representable integer and PostgreSQL rejected the query (HTTP 500).
 */
describe("GET /api/activity — limit/page are read, not guessed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFilteredActivityPage.mockResolvedValue({
      events: [],
      total: 0,
      hasMore: false,
      limit: 50,
      offset: 0,
      error: false,
    });
  });

  /** The { limit, offset } actually handed to the store for a given query. */
  async function pageArgs(query: string) {
    const res = await request(makeApp()).get(`/api/activity${query}`);
    expect(res.status).toBe(200);
    const [args] = getFilteredActivityPage.mock.calls[0] as [{ limit: number; offset: number }];
    return args;
  }

  it("bounds an enormous page instead of answering 500", async () => {
    const res = await request(makeApp()).get("/api/activity?meta=1&page=99999999999999999999");
    expect(res.status).not.toBe(500);
    expect(res.status).toBe(200);
    // Past 2^53 the value cannot be read faithfully, so it counts as "not
    // provided" and the default page applies. Either way the page stays inside
    // [0, 10000] and the offset handed to PostgreSQL is a real integer.
    expect(res.body.page).toBeGreaterThanOrEqual(0);
    expect(res.body.page).toBeLessThanOrEqual(10000);
    const [args] = getFilteredActivityPage.mock.calls[0] as [{ limit: number; offset: number }];
    expect(args.limit).toBe(50);
    expect(Number.isSafeInteger(args.offset)).toBe(true);
    expect(args.offset).toBe(res.body.page * 50);
  });

  it("clamps a page above the maximum down to 10000", async () => {
    const res = await request(makeApp()).get("/api/activity?meta=1&page=999999");
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(10000);
    expect(getFilteredActivityPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 10000 * 50 })
    );
  });

  it("brings a negative page back to 0", async () => {
    const res = await request(makeApp()).get("/api/activity?meta=1&page=-3");
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(0);
    expect(getFilteredActivityPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 0 })
    );
  });

  it("falls back to limit 50 on a partially numeric value", async () => {
    expect(await pageArgs("?limit=50abc")).toMatchObject({ limit: 50, offset: 0 });
  });

  it("falls back to limit 50 on a decimal value", async () => {
    expect(await pageArgs("?limit=2.7")).toMatchObject({ limit: 50, offset: 0 });
  });

  it("clamps limit 0 up to 1", async () => {
    expect(await pageArgs("?limit=0")).toMatchObject({ limit: 1, offset: 0 });
  });

  it("clamps a negative limit up to 1", async () => {
    expect(await pageArgs("?limit=-5")).toMatchObject({ limit: 1, offset: 0 });
  });

  it("clamps limit 1000 down to 200", async () => {
    expect(await pageArgs("?limit=1000")).toMatchObject({ limit: 200, offset: 0 });
  });

  it("passes a valid page and limit through unchanged (offset = page * limit)", async () => {
    expect(await pageArgs("?limit=25&page=4")).toMatchObject({ limit: 25, offset: 100 });
  });

  it("uses limit 50 / page 0 when no parameter is given", async () => {
    const res = await request(makeApp()).get("/api/activity?meta=1");
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(0);
    expect(getFilteredActivityPage).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 50, offset: 0 })
    );
  });
});
