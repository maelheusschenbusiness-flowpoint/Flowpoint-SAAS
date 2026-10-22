import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateAndPersistWorkflowReport } from "./automation-service.js";

const databaseUrl = process.env["DATABASE_URL"] ?? "";
const isolatedCiDatabase = (() => {
  if (process.env["NODE_ENV"] !== "test" || !databaseUrl) return false;
  try {
    const parsed = new URL(databaseUrl);
    return parsed.hostname === "127.0.0.1" && parsed.pathname === "/flowpoint_ci";
  } catch {
    return false;
  }
})();
const describeIsolatedCi = isolatedCiDatabase ? describe : describe.skip;

describeIsolatedCi("AWL report generation PostgreSQL isolation (isolated CI DB only)", () => {
  const schema = `awl_report_test_${randomUUID().replace(/-/g, "")}`;
  const orgId = randomUUID();
  let admin: Pool;
  let testDb: Pool;

  beforeAll(async () => {
    admin = new Pool({ connectionString: databaseUrl, max: 2 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.query(`
      CREATE TABLE "${schema}".audits (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, url TEXT NOT NULL,
        score INTEGER NOT NULL, speed INTEGER NOT NULL, issues INTEGER NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      CREATE TABLE "${schema}".reports (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL,
        type TEXT NOT NULL, template_key TEXT, date TEXT, pages INTEGER DEFAULT 0,
        shared BOOLEAN DEFAULT false, audit_id TEXT, white_label BOOLEAN DEFAULT false,
        pdf_ready BOOLEAN DEFAULT false, meeting_notes_json TEXT,
        generation_metadata_json TEXT NOT NULL DEFAULT '{}',
        date_start TEXT, date_end TEXT, created_by TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
      INSERT INTO "${schema}".audits (id, org_id, url, score, speed, issues)
      VALUES ('audit-fixture', '${orgId}', 'https://fixture.invalid', 82, 71, 3)
    `);
    testDb = new Pool({
      connectionString: databaseUrl,
      max: 3,
      options: `-c search_path=${schema}`,
    });
  });

  afterAll(async () => {
    await testDb?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  });

  const baseDependencies = (overrides: Record<string, unknown> = {}) => ({
    database: testDb,
    authorizeAWL: async () => true,
    checkReportsQuota: async () => true,
    checkAIQuota: async () => true,
    generate: async () => ({
      text: "Synthèse test fondée sur les données mesurées.",
      _ai: { provider: "openai" as const, model: "gpt-4o-mini" },
      usage: { promptTokens: 100, completionTokens: 80 },
    }),
    recordUsage: vi.fn(async () => {}),
    ...overrides,
  });

  it("denies access before generating or writing a report", async () => {
    const deps = baseDependencies({ authorizeAWL: async () => false });
    await expect(generateAndPersistWorkflowReport(
      orgId, "denied-run", { source: "ai_workspace_launch" }, deps,
    )).rejects.toThrow("AI_WORKSPACE_LAUNCH_ENTITLEMENT_REQUIRED");
    const reports = await testDb.query(`SELECT id FROM reports WHERE org_id=$1`, [orgId]);
    expect(reports.rows).toHaveLength(0);
  });

  it("fails closed when the report quota is exhausted", async () => {
    const generate = vi.fn(async () => ({ text: "must not run" }));
    const deps = baseDependencies({ checkReportsQuota: async () => false, generate });
    await expect(generateAndPersistWorkflowReport(
      orgId, "quota-run", { source: "ai_workspace_launch" }, deps,
    )).rejects.toThrow("REPORT_QUOTA_EXCEEDED");
    expect(generate).not.toHaveBeenCalled();
    const reports = await testDb.query(`SELECT id FROM reports WHERE org_id=$1`, [orgId]);
    expect(reports.rows).toHaveLength(0);
  });

  it("does not persist a report when generation fails", async () => {
    const deps = baseDependencies({
      generate: async () => { throw new Error("provider unavailable"); },
    });
    await expect(generateAndPersistWorkflowReport(
      orgId, "generation-failure", { source: "ai_workspace_launch" }, deps,
    )).rejects.toThrow("provider unavailable");
    const reports = await testDb.query(`SELECT id FROM reports WHERE org_id=$1`, [orgId]);
    expect(reports.rows).toHaveLength(0);
  });

  it("persists once and reuses the saved report and usage receipt on retry", async () => {
    const generate = vi.fn(baseDependencies().generate);
    const recordUsage = vi.fn(async () => {});
    const deps = baseDependencies({ generate, recordUsage });
    await generateAndPersistWorkflowReport(
      orgId, "same-run", { source: "ai_workspace_launch", sessionId: "session-a" }, deps,
    );
    await generateAndPersistWorkflowReport(
      orgId, "same-run", { source: "ai_workspace_launch", sessionId: "session-a" }, deps,
    );
    const reports = await testDb.query(
      `SELECT id, meeting_notes_json, generation_metadata_json FROM reports WHERE org_id=$1`,
      [orgId],
    );
    expect(reports.rows).toHaveLength(1);
    expect(reports.rows[0].meeting_notes_json).toContain("Synthèse test");
    expect(JSON.parse(reports.rows[0].generation_metadata_json).requestId).toBe("same-run");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(recordUsage).toHaveBeenCalledTimes(2);
  });
});
