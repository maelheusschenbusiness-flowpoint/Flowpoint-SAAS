/**
 * Un monitor natif tout juste cree n'a encore subi aucune verification : sa
 * disponibilite est INCONNUE (NULL), jamais « 100 % ». La requete d'insertion
 * reellement emise est inspectee.
 */
import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  orgDb: vi.fn(),
  clientQuery: vi.fn(),
  checkQuota: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: vi.fn(), connect: vi.fn(async () => ({ query: m.clientQuery, release: vi.fn() })) },
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
  validateMonitorUrl: vi.fn(async () => null),
  isPrivateHost: vi.fn(),
  checkDnsResolution: vi.fn(),
}));
vi.mock("../services/billing-service.js", () => ({ checkQuota: (...a: unknown[]) => m.checkQuota(...a) }));
vi.mock("../services/billing-context.js", () => ({ loadBillingContext: vi.fn() }));
vi.mock("./qa-fixtures.js", () => ({ isQaFixturesEnabled: vi.fn(() => false) }));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), fatal: vi.fn() },
}));
vi.mock("../services/store.js", () => ({
  store: { logActivity: vi.fn(async () => undefined), broadcast: vi.fn() },
}));
vi.mock("../services/usage-events.js", () => ({ recordUsageEvent: vi.fn(async () => undefined) }));

import monitorRouter from "./monitors.js";

const ORG_ID = "org-monitor-create";

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

describe("POST /monitors : aucune disponibilite fabriquee", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.checkQuota.mockResolvedValue({ allowed: true, used: 0, limit: 5, plan: "standard" });
    m.clientQuery.mockImplementation(async (sql: string) => (
      /SELECT COUNT/.test(sql) ? { rows: [{ n: 0 }] } : { rows: [] }
    ));
    m.orgDb.mockImplementation(async () => ({
      rows: [{ id: "m1", name: "Site", url: "https://example.com", status: "up", uptime: null, latency: null, last_check: null, enabled: true, org_id: ORG_ID }],
    }));
  });

  it("insere uptime NULL (pas 100) et expose uptime/lastCheck nuls tant qu'aucune verification n'a eu lieu", async () => {
    const res = await request(makeApp()).post("/api/monitors").send({ url: "https://example.com", name: "Site" });
    expect(res.status).toBe(201);
    const insert = m.clientQuery.mock.calls.find(c => /INSERT INTO monitors/.test(String(c[0])));
    expect(insert).toBeDefined();
    const sql = String(insert![0]);
    expect(sql).toContain("'up',NULL,NULL");
    expect(sql).not.toMatch(/'up',\s*100/);
    expect(res.body.uptime).toBeNull();
    expect(res.body.lastCheck).toBeNull();
  });
});
