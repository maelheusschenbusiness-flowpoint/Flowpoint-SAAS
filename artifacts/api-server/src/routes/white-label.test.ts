/**
 * white-label.test.ts — entitlement gate integration tests
 *
 * Proves that Pro/Ultra subscribers can access white-label/custom-domain
 * features based solely on their plan (PLAN_INCLUDED_ADDONS overlay in
 * loadBillingContext), without a manually populated legacy addons JSON field.
 *
 * Strategy: mount only the white-label router with a minimal Express app and
 * mock loadBillingContext so no real DB connection is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// ─── Mock billing-context before importing the router ────────────────────────
// The router dynamically imports loadBillingContext; we stub the module so it
// returns the context we choose per test.

type MockCtx = { addons: Record<string, boolean> };
let mockCtx: MockCtx = { addons: {} };

vi.mock("../services/billing-context.js", () => ({
  loadBillingContext: vi.fn().mockImplementation(async () => mockCtx),
}));

// ─── Also mock @workspace/db so the router's orgDb doesn't crash ─────────────
vi.mock("@workspace/db", () => ({
  db: {},
  pool: { connect: vi.fn(), query: vi.fn() },
  orgAddonsTable: {},
}));

// init-data-tables is dynamically imported by the router's self-heal path.
// Stub it so schema-missing tests don't touch a real DB.
const mockInitDataTables = vi.fn(async () => {});
vi.mock("../services/init-data-tables.js", () => ({
  initDataTables: () => mockInitDataTables(),
}));

// ─── Build minimal Express app with orgId + orgDb stubs ──────────────────────
// orgDbImpl lets a test control what the orgDb query does (rows / throw).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let orgDbImpl: (sql: string, vals?: unknown[]) => Promise<any> =
  async (_sql: string, _vals?: unknown[]) => ({ rows: [] as unknown[] });

async function buildApp() {
  const { default: whiteLabelRouter } = await import("./white-label.js");
  const app = express();
  app.use(express.json());

  // Inject orgId + orgDb (delegates to the test-controlled orgDbImpl)
  app.use((req, _res, next) => {
    (req as express.Request & { orgId: string; orgDb: unknown }).orgId = "test-org";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req as express.Request & { orgDb: any }).orgDb =
      (sql: string, vals?: unknown[]) => orgDbImpl(sql, vals);
    next();
  });

  app.use(whiteLabelRouter);
  return app;
}

function pgErr(code: string): Error & { code: string } {
  const e = new Error(`pg error ${code}`) as Error & { code: string };
  e.code = code;
  return e;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("POST /white-label/templates — entitlement gate", () => {
  let app: express.Express;

  beforeEach(async () => {
    app = await buildApp();
  });

  it("returns 403 for a Standard subscriber (whiteLabel not bundled)", async () => {
    // Standard plan: PLAN_INCLUDED_ADDONS.standard is empty → no whiteLabel
    mockCtx = { addons: {} };
    const res = await request(app)
      .post("/white-label/templates")
      .send({ name: "My Template" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/white.label/i);
  });

  it("returns 201 for a Pro subscriber (whiteLabel bundled — no manual addon row needed)", async () => {
    // Simulate loadBillingContext overlaying Pro plan included addons
    mockCtx = { addons: { whiteLabel: true } };
    const res = await request(app)
      .post("/white-label/templates")
      .send({ name: "Agency Template" });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.id).toMatch(/^rt_/);
  });

  it("returns 201 for an Ultra subscriber (whiteLabel bundled — no manual addon row needed)", async () => {
    mockCtx = { addons: { whiteLabel: true, customDomain: true } };
    const res = await request(app)
      .post("/white-label/templates")
      .send({ name: "Ultra Template" });
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
  });
});

describe("POST /white-label/domains — entitlement gate", () => {
  let app: express.Express;

  beforeEach(async () => {
    app = await buildApp();
  });

  it("returns 403 for a Pro subscriber (customDomain NOT bundled in Pro)", async () => {
    // Pro plan does NOT include customDomain → should be denied
    mockCtx = { addons: { whiteLabel: true } };
    const res = await request(app)
      .post("/white-label/domains")
      .send({ domain: "example.com" });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/custom domain/i);
  });

  it("returns 201 for an Ultra subscriber (customDomain bundled — no manual addon row needed)", async () => {
    mockCtx = { addons: { whiteLabel: true, customDomain: true } };
    const res = await request(app)
      .post("/white-label/domains")
      .send({ domain: "myagency.io" });
    // 201 means the gate passed; the route attempts an INSERT into custom_domains.
    // orgDb stub returns empty rows so INSERT "succeeds" (stub returns {rows:[]}).
    expect(res.status).toBe(201);
    expect(res.body.ok).toBe(true);
    expect(res.body.verificationToken).toMatch(/^fpv_/);
  });

  it("returns 403 for a Standard subscriber (customDomain not bundled)", async () => {
    mockCtx = { addons: {} };
    const res = await request(app)
      .post("/white-label/domains")
      .send({ domain: "mysite.com" });
    expect(res.status).toBe(403);
  });
});

describe("GET /white-label/templates — reliability contract", () => {
  let app: express.Express;

  beforeEach(async () => {
    // default: genuine empty org
    orgDbImpl = async () => ({ rows: [] });
    mockInitDataTables.mockClear();
    app = await buildApp();
  });

  it("returns a stable {templates:[]} for a genuinely empty org", async () => {
    const res = await request(app).get("/white-label/templates");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ templates: [] });
    expect(mockInitDataTables).not.toHaveBeenCalled();
  });

  it("returns org-scoped persisted templates on success", async () => {
    const rows = [{ id: "rt_1", org_id: "test-org", name: "Agency" }];
    orgDbImpl = async () => ({ rows });
    const res = await request(app).get("/white-label/templates");
    expect(res.status).toBe(200);
    expect(res.body.templates).toEqual(rows);
  });

  it("returns 500 (not {templates:[]}) on a real SQL failure so the client can retry", async () => {
    orgDbImpl = async () => { throw pgErr("40001"); }; // serialization_failure
    const res = await request(app).get("/white-label/templates");
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch templates/i);
    expect(res.body).not.toHaveProperty("templates");
    expect(mockInitDataTables).not.toHaveBeenCalled();
  });

  it("self-heals once and retries on missing table (42P01)", async () => {
    let calls = 0;
    orgDbImpl = async () => {
      calls += 1;
      if (calls === 1) throw pgErr("42P01");
      return { rows: [{ id: "rt_healed" }] };
    };
    const res = await request(app).get("/white-label/templates");
    expect(res.status).toBe(200);
    expect(res.body.templates).toEqual([{ id: "rt_healed" }]);
    expect(mockInitDataTables).toHaveBeenCalledTimes(1);
  });

  it("returns 500 if the query still fails after self-heal (never a silent [])", async () => {
    orgDbImpl = async () => { throw pgErr("42P01"); };
    const res = await request(app).get("/white-label/templates");
    expect(res.status).toBe(500);
    expect(res.body).not.toHaveProperty("templates");
    expect(mockInitDataTables).toHaveBeenCalledTimes(1);
  });
});
