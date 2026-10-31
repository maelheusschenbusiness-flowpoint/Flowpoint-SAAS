import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  orgDbMock, poolConnectMock, streamReportPdfMock, aiChatMock, loadOrgAIPrefsMock,
  resolveAIModelMock, checkAIQuotaMock, checkQuotaMock, recordCompletedUsageDeferredMock,
} = vi.hoisted(() => ({
  orgDbMock: vi.fn(),
  poolConnectMock: vi.fn(),
  streamReportPdfMock: vi.fn().mockResolvedValue(undefined),
  aiChatMock: vi.fn(),
  loadOrgAIPrefsMock: vi.fn(),
  resolveAIModelMock: vi.fn(),
  checkAIQuotaMock: vi.fn(),
  checkQuotaMock: vi.fn(),
  recordCompletedUsageDeferredMock: vi.fn(),
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
  checkQuota: checkQuotaMock,
}));
vi.mock("../services/ai-provider.js", () => ({ aiChat: aiChatMock }));
vi.mock("../services/ai-prefs.js", () => ({
  loadOrgAIPrefs: loadOrgAIPrefsMock,
  resolveAIModel: resolveAIModelMock,
}));
vi.mock("../services/ai-engine.js", () => ({
  checkAIQuota: checkAIQuotaMock,
  recordCompletedUsageDeferred: recordCompletedUsageDeferredMock,
}));
vi.mock("../services/ai-quota.js", () => ({
  buildQuotaGuidance: vi.fn(),
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
    Object.assign(req, { orgId: "org-a", orgDb: orgDbMock, orgContext: { userId: "user-a", email: "owner@example.test" } });
    next();
  });
  app.use("/api", reportsRouter);
  return app;
}

describe("Agency Reporting Packs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    checkQuotaMock.mockResolvedValue({ allowed: true, limit: 20, used: 0 });
  });

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

  it("returns a retryable error instead of an empty report list when storage fails", async () => {
    orgDbMock.mockRejectedValue(new Error("reports table unavailable"));

    const response = await request(makeApp()).get("/api/reports");

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("REPORTS_UNAVAILABLE");
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
    expect(client.release).toHaveBeenCalled();
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

describe("AI Executive Reporting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadOrgAIPrefsMock.mockResolvedValue({});
    resolveAIModelMock.mockReturnValue({ provider: "openai", model: "gpt-4o-mini", maxTokens: 900 });
    checkAIQuotaMock.mockResolvedValue({ allowed: true });
    aiChatMock.mockResolvedValue({
      text: JSON.stringify({ headline: "Priorité SEO", summary: "Corriger les pages critiques.", priorities: ["Auditer les pages lentes"] }),
      usage: { promptTokens: 120, completionTokens: 60 },
    });
  });

  it("persists an organization-scoped AI report and makes it visible in the Reports list", async () => {
    const saved: Array<Record<string, unknown>> = [];
    orgDbMock.mockImplementation(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("FROM audits")) return { rows: [{ url: "https://client.example", score: 42, status: "completed", created_at: "2026-10-20T10:00:00.000Z" }] };
      if (sql.includes("FROM monitors")) return { rows: [{ name: "Main site", url: "https://client.example", status: "up", uptime: 99.9, response_time: 180 }] };
      if (sql.includes("SELECT name, template_key, date FROM reports")) return { rows: [] };
      if (sql.includes("SELECT * FROM reports WHERE org_id=$1")) return { rows: saved.filter(row => row.org_id === values[0]) };
      return { rows: [] };
    });
    const client = {
      query: vi.fn(async (sql: string, values: unknown[] = []) => {
        if (sql.startsWith("INSERT INTO reports")) {
          saved.push({
            id: values[0], org_id: values[1], name: values[2], type: "PDF",
            template_key: "executive", date: values[3], meeting_notes_json: values[4],
          });
        }
        return { rows: [], rowCount: 1 };
      }),
      release: vi.fn(),
    };
    poolConnectMock.mockResolvedValue(client as any);

    const generated = await request(makeApp()).post("/api/reports/ai-executive-summary").send({});
    expect(generated.status).toBe(201);
    expect(generated.body.ok).toBe(true);
    expect(generated.body.measured.latestAuditScore).toBe(42);
    expect(generated.body.measured.averageUptime).toBe(99.9);
    expect(orgDbMock).toHaveBeenCalledWith(expect.stringContaining("FROM audits WHERE org_id=$1"), ["org-a"]);
    expect(orgDbMock).toHaveBeenCalledWith(expect.stringContaining("FROM monitors WHERE org_id=$1"), ["org-a"]);
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO reports"),
      expect.arrayContaining([generated.body.reportId, "org-a", expect.stringContaining("Synthèse exécutive IA")]),
    );
    expect(client.release).toHaveBeenCalled();

    const listed = await request(makeApp()).get("/api/reports");
    expect(listed.status).toBe(200);
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0]).toMatchObject({ id: generated.body.reportId, org_id: "org-a", template_key: "executive" });
  });

  it("does not generate or persist an executive report when the organization has no measured data", async () => {
    orgDbMock.mockResolvedValue({ rows: [] });

    const response = await request(makeApp()).post("/api/reports/ai-executive-summary").send({});

    expect(response.status).toBe(422);
    expect(response.body.code).toBe("NO_REAL_DATA");
    expect(aiChatMock).not.toHaveBeenCalled();
    expect(poolConnectMock).not.toHaveBeenCalled();
  });
});
