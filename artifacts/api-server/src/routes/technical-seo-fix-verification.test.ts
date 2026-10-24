import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dbCalls: Array<{ orgId: string; sql: string; values: unknown[] }> = [];
vi.mock("../middlewares/planGate.js", () => ({
  requireAddon: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../middlewares/requireRole.js", () => ({
  canWrite: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import router from "./technical-seo-fix-verification.js";

function appFor(orgId: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId,
      orgDb: async (sql: string, values: unknown[] = []) => {
        dbCalls.push({ orgId, sql, values });
        if (sql.includes("technical_seo_fix_verifications")) {
          return { rows: [{ id: "saved", status: "improved" }] };
        }
        if (sql.includes("id = ANY")) {
          return { rows: [
            { id: "before", url: "https://example.com", issues: 12, created_at: "2026-10-01T00:00:00Z" },
            { id: "after", url: "https://example.com", issues: 5, created_at: "2026-10-20T00:00:00Z" },
          ] };
        }
        return { rows: [
          { id: "after", url: "https://example.com", issues: 5, created_at: "2026-10-20T00:00:00Z" },
          { id: "before", url: "https://example.com", issues: 12, created_at: "2026-10-01T00:00:00Z" },
        ] };
      },
    });
    next();
  });
  app.use(router);
  return app;
}

describe("technical-seo-fix-verification routes", () => {
  beforeEach(() => dbCalls.splice(0));

  it("returns tenant-scoped audit options and persisted verifications", async () => {
    const response = await request(appFor("org-a")).get("/technical-seo-fix-verification").expect(200);
    expect(response.body.metric).toBe("aggregate_audit_issue_count");
    expect(response.body.audits).toHaveLength(2);
    expect(response.body.verifications).toHaveLength(1);
    expect(dbCalls.every(call => call.values[0] === "org-a" && call.sql.includes("org_id=$1"))).toBe(true);
  });

  it("compares same-URL audits in order and persists the measured result for the tenant", async () => {
    const response = await request(appFor("org-b"))
      .post("/technical-seo-fix-verification/verify")
      .send({ beforeAuditId: "before", afterAuditId: "after" })
      .expect(200);
    expect(response.body.result).toMatchObject({
      status: "improved",
      beforeIssueCount: 12,
      afterIssueCount: 5,
      evidence: "two_distinct_audits",
    });
    const save = dbCalls.find(call => call.sql.includes("INSERT INTO technical_seo_fix_verifications"));
    expect(save?.values[1]).toBe("org-b");
    expect(save?.sql).toContain("ON CONFLICT");
    expect(dbCalls[0]?.sql).toContain("org_id=$1");
  });

  it("rejects identical audit selections before querying data", async () => {
    const response = await request(appFor("org-c"))
      .post("/technical-seo-fix-verification/verify")
      .send({ beforeAuditId: "same", afterAuditId: "same" })
      .expect(400);
    expect(response.body.code).toBe("INVALID_AUDIT_PAIR");
    expect(dbCalls).toHaveLength(0);
  });
});
