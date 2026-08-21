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
