import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: mocks.connect, query: mocks.query },
  withOrgDb: vi.fn(),
}));
vi.mock("../services/seller-financial-ledger.js", () => ({ markCommissionPaid: vi.fn() }));

import adminRouter from "./admin.js";

const QA_ORG = "10000000-0000-4000-8000-000000000002";
const QA_USER = "10000000-0000-4000-8000-000000000001";
const ADMIN_KEY = "test-only-admin-key-that-is-long-enough";

function app() {
  const server = express();
  server.use(express.json());
  server.use("/api", adminRouter);
  return server;
}

describe("POST /api/admin/test-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ADMIN_KEY", ADMIN_KEY);
    mocks.connect.mockResolvedValue({
      query: mocks.query,
      release: vi.fn(),
    });
    mocks.query.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM organizations")) return { rows: [{ id: QA_ORG }] };
      if (sql.includes("FROM organization_members")) return { rows: [{ role: "owner" }] };
      if (sql.includes("INSERT INTO user_sessions")) return { rows: [] };
      throw new Error("Unexpected SQL in QA session test");
    });
  });

  afterEach(() => vi.unstubAllEnvs());

  it("issues a short-lived session only for the existing internal QA org and membership", async () => {
    const response = await request(app())
      .post("/api/admin/test-session")
      .set("x-admin-key", ADMIN_KEY)
      .send({ orgId: QA_ORG, ttlMinutes: 30, role: "admin" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ok: true, orgId: QA_ORG });
    expect(response.body.token).toMatch(/^fp_qa_[a-f0-9]{64}$/);
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM organizations"),
      [QA_ORG],
    );
    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining("FROM organization_members"),
      [QA_ORG, QA_USER],
    );
    const sessionInsert = mocks.query.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO user_sessions"));
    expect(sessionInsert?.[1]).toEqual([response.body.token, QA_USER, QA_ORG, "owner", expect.any(Date)]);
    expect(mocks.query.mock.calls.some(([sql]) => /INSERT\s+INTO\s+organizations/i.test(String(sql)))).toBe(false);
  });

  it("is unavailable outside Test without touching the database", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = await request(app()).post("/api/admin/test-session").set("x-admin-key", ADMIN_KEY).send({});
    expect(response.status).toBe(404);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("rejects another org and invalid session durations before database access", async () => {
    const otherOrg = await request(app()).post("/api/admin/test-session")
      .set("x-admin-key", ADMIN_KEY).send({ orgId: "10000000-0000-4000-8000-000000000099" });
    const invalidTtl = await request(app()).post("/api/admin/test-session")
      .set("x-admin-key", ADMIN_KEY).send({ orgId: QA_ORG, ttlMinutes: 61 });
    expect(otherOrg.status).toBe(403);
    expect(invalidTtl.status).toBe(400);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it("does not issue a session if the QA org or its owner membership is absent", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const missingOrg = await request(app()).post("/api/admin/test-session")
      .set("x-admin-key", ADMIN_KEY).send({ orgId: QA_ORG });
    expect(missingOrg.status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO user_sessions"), expect.anything());

    mocks.query.mockReset();
    mocks.query.mockResolvedValueOnce({ rows: [{ id: QA_ORG }] }).mockResolvedValueOnce({ rows: [] });
    const missingMembership = await request(app()).post("/api/admin/test-session")
      .set("x-admin-key", ADMIN_KEY).send({ orgId: QA_ORG });
    expect(missingMembership.status).toBe(403);
    expect(mocks.query).not.toHaveBeenCalledWith(expect.stringContaining("INSERT INTO user_sessions"), expect.anything());
  });
});
