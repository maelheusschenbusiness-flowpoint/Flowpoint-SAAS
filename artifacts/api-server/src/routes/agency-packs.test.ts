import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { orgDbMock, poolConnectMock, streamReportPdfMock } = vi.hoisted(() => ({
  orgDbMock: vi.fn(),
  poolConnectMock: vi.fn(),
  streamReportPdfMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/db", () => ({
  pool: { connect: poolConnectMock, query: vi.fn() },
  db: {},
  eq: vi.fn(),
  desc: vi.fn(),
  and: vi.fn(),
}));
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middlewares/rateLimiter.js", () => ({
  reportRateLimit: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: any, _res: any, next: any) => next(),
  canAdmin: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../services/pdf.js", () => ({ streamReportPdf: streamReportPdfMock }));
vi.mock("../services/store.js", () => ({
  store: { logActivity: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("../services/billing-service.js", () => ({
  checkQuota: vi.fn().mockResolvedValue({ allowed: true, limit: 20, used: 0 }),
}));
vi.mock("../services/usage-events.js", () => ({
  recordUsageEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import reportsRouter from "./reports.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { orgId: "org-a", orgDb: orgDbMock });
    next();
  });
  app.use("/api", reportsRouter);
  return app;
}

describe("Agency Reporting Packs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("loads audits scoped to the requesting organization", async () => {
    const audits = [{
      id: "audit-a1",
      url: "https://client.example",
      score: 92,
      status: "completed",
      created_at: "2026-10-20T10:00:00.000Z",
    }];
    orgDbMock.mockResolvedValue({ rows: audits });

    const response = await request(makeApp()).get("/api/reports/agency-packs");

    expect(response.status).toBe(200);
    expect(response.body.audits).toEqual(audits);
    expect(response.body.packs).toHaveLength(3);
    expect(orgDbMock).toHaveBeenCalledWith(
      expect.stringContaining("WHERE org_id=$1"),
      ["org-a"],
    );
  });

  it("rejects an audit that is not owned by the requesting organization", async () => {
    orgDbMock.mockResolvedValue({ rows: [] });

    const response = await request(makeApp())
      .post("/api/reports/agency-packs/generate")
      .send({ clientName: "Client A", auditId: "audit-from-another-org" });

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("AUDIT_NOT_FOUND");
    expect(orgDbMock).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id=$1 AND org_id=$2"),
      ["audit-from-another-org", "org-a"],
    );
  });

  it("creates three reports linked to the selected audit", async () => {
    orgDbMock.mockResolvedValue({ rows: [{ id: "audit-a1" }] });
    const inserts: Array<{ id: unknown; auditId: unknown }> = [];
    const client = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.startsWith("INSERT INTO reports")) {
          inserts.push({ id: values[0], auditId: values[5] });
          return { rows: [], rowCount: 1 };
        }
        if (sql.startsWith("SELECT id, name, template_key FROM reports")) {
          return {
            rows: inserts.map((row, index) => ({
              id: row.id,
              name: `Client A — rapport ${index + 1}`,
              template_key: ["executive", "seo", "local"][index],
            })),
          };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValue(client as any);

    const response = await request(makeApp())
      .post("/api/reports/agency-packs/generate")
      .send({ clientName: "Client A", auditId: "audit-a1" });

    expect(response.status).toBe(201);
    expect(response.body.verifiedCount).toBe(3);
    expect(inserts).toHaveLength(3);
    expect(inserts.every((row) => row.auditId === "audit-a1")).toBe(true);
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("loads the linked audit from the same organization for PDF delivery", async () => {
    streamReportPdfMock.mockImplementation((res: any) => res.end());
    const report = {
      id: "report-a1",
      org_id: "org-a",
      name: "Client A — Executive mensuel",
      audit_id: "audit-a1",
      white_label: false,
      meeting_notes_json: "[]",
    };
    const audit = {
      id: "audit-a1",
      org_id: "org-a",
      url: "https://client.example",
      score: 92,
      status: "completed",
    };
    orgDbMock.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM reports WHERE id=$1 AND org_id=$2")) return { rows: [report] };
      if (sql.includes("FROM audits WHERE id=$1 AND org_id=$2")) return { rows: [audit] };
      return { rows: [] };
    });

    const response = await request(makeApp()).get("/api/reports/report-a1/download");

    expect(response.status).toBe(200);
    expect(orgDbMock).toHaveBeenCalledWith(
      expect.stringContaining("FROM audits WHERE id=$1 AND org_id=$2"),
      ["audit-a1", "org-a"],
    );
    expect(streamReportPdfMock.mock.calls[0]?.[2]).toEqual(audit);
  });
});
