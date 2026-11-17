import express from "express";
import type { NextFunction, Request, Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { orgDbMock } = vi.hoisted(() => ({ orgDbMock: vi.fn() }));

vi.mock("@workspace/db", () => ({
  pool: { connect: vi.fn(), query: vi.fn() },
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: Request, _res: Response, next: NextFunction) => next(),
  canAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../middlewares/rateLimiter.js", () => ({
  reportRateLimit: (_req: Request, _res: Response, next: NextFunction) => next(),
}));
vi.mock("../services/schedule-utils.js", () => ({
  computeNextRun: vi.fn(() => new Date("2026-12-01T00:00:00.000Z")),
  isValidFrequency: vi.fn(() => true),
}));
vi.mock("../services/audit-runner.js", () => ({
  launchAudit: vi.fn(),
  normalizeAuditUrl: vi.fn((url: string) => url),
}));
vi.mock("../services/audit-schedule-cron.js", () => ({
  toScheduleRunValue: vi.fn(async (d: Date) => d.toISOString()),
  scheduleCreatedAtNowSql: vi.fn(async () => "NOW()"),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import auditsRouter from "./audits.js";

const ORG_ID = "org-a";

const SCHEDULE_ROW = {
  id:         "sched-1",
  url:        "https://example.test",
  frequency:  "weekly",
  next_run:   "2026-12-01T00:00:00.000Z",
  last_run:   null,
  enabled:    true,
  org_id:     ORG_ID,
  created_at: "2026-11-01T00:00:00.000Z",
};

const SCHEDULE_PUBLIC = {
  id:        "sched-1",
  url:       "https://example.test",
  frequency: "weekly",
  nextRun:   "2026-12-01T00:00:00.000Z",
  lastRun:   null,
  enabled:   true,
  orgId:     ORG_ID,
};

const AUDIT_ROW = {
  id:         "audit-1",
  name:       "Homepage",
  notes:      "",
  url:        "https://example.test",
  score:      88,
  status:     "completed",
  speed:      1.2,
  date:       "2026-11-10T00:00:00.000Z",
  issues:     3,
  origin:     "manual",
  created_at: "2026-11-10T00:00:00.000Z",
};

/** SQL seen by the fake org-scoped DB, in call order. */
const seenSql: string[] = [];

function isScheduleRead(sql: string) { return /FROM audit_schedules/.test(sql); }
function isAuditRead(sql: string)    { return /FROM audits\b/.test(sql); }

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgDb: orgDbMock,
      orgContext: { orgId: ORG_ID, userId: "user-a", email: "owner@example.test", role: "owner" },
    });
    next();
  });
  app.use("/api", auditsRouter);
  return app;
}

type RouterLayer = { route?: { path: string; methods: Record<string, boolean> } };

/** Paths of the GET routes, in registration order. */
function registeredGetPaths(): string[] {
  const stack = (auditsRouter as unknown as { stack: RouterLayer[] }).stack;
  const paths: string[] = [];
  for (const layer of stack) {
    if (layer.route?.methods["get"]) paths.push(layer.route.path);
  }
  return paths;
}

describe("GET /audits/schedules is matched before /audits/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seenSql.length = 0;
    orgDbMock.mockImplementation(async (sql: string, params?: unknown[]) => {
      seenSql.push(sql);
      if (isScheduleRead(sql)) return { rows: [SCHEDULE_ROW], rowCount: 1 };
      if (isAuditRead(sql)) {
        return params?.[0] === AUDIT_ROW.id
          ? { rows: [AUDIT_ROW], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    });
  });

  it("returns the schedule list, without ever reading the audits table", async () => {
    const res = await request(makeApp()).get("/api/audits/schedules");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([SCHEDULE_PUBLIC]);
    expect(seenSql.some(isScheduleRead)).toBe(true);
    expect(seenSql.filter(isAuditRead)).toEqual([]);
  });

  it("serves the same list on the /audits/schedule alias", async () => {
    const res = await request(makeApp()).get("/api/audits/schedule");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([SCHEDULE_PUBLIC]);
    expect(seenSql.filter(isAuditRead)).toEqual([]);
  });

  it("still serves an audit by id", async () => {
    const res = await request(makeApp()).get(`/api/audits/${AUDIT_ROW.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: AUDIT_ROW.id, url: AUDIT_ROW.url, score: 88 });
    expect(seenSql.some(isAuditRead)).toBe(true);
  });

  it("still answers 404 for an unknown audit id", async () => {
    const res = await request(makeApp()).get("/api/audits/does-not-exist");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: "Audit not found" });
  });

  it("registers GET /audits/schedules before GET /audits/:id", () => {
    const paths = registeredGetPaths();
    const schedulesIndex = paths.indexOf("/audits/schedules");
    const idIndex = paths.indexOf("/audits/:id");

    expect(schedulesIndex).toBeGreaterThanOrEqual(0);
    expect(idIndex).toBeGreaterThanOrEqual(0);
    expect(schedulesIndex).toBeLessThan(idIndex);
    // and only once: the late duplicate registration is gone
    expect(paths.filter((p) => p === "/audits/schedules")).toHaveLength(1);
  });
});
