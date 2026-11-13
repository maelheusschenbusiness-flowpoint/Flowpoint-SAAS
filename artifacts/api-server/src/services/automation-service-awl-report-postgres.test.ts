import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateAndPersistWorkflowReport } from "./automation-service.js";
import {
  disableAWLWeeklyReportWorkflow,
  hasActiveAWLWeeklyReportWorkflow,
  upsertAWLWeeklyReportWorkflow,
} from "./awl-weekly-report.js";

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
  const otherOrgId = randomUUID();
  const sessionId = randomUUID();
  const profileId = randomUUID();
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
      CREATE TABLE "${schema}".onboarding_sessions (id TEXT, org_id TEXT);
      CREATE TABLE "${schema}".ai_workspace_profiles (id TEXT, session_id TEXT, org_id TEXT);
      CREATE TABLE "${schema}".automation_workflows (
        id TEXT PRIMARY KEY, org_id TEXT NOT NULL, name TEXT NOT NULL,
        icon TEXT, description TEXT, trigger_type TEXT NOT NULL,
        trigger_config JSONB, actions JSONB, enabled BOOLEAN NOT NULL DEFAULT true,
        runs_count INTEGER NOT NULL DEFAULT 0, category TEXT,
        updated_at TIMESTAMP DEFAULT NOW(), created_at TIMESTAMP DEFAULT NOW()
      );
      INSERT INTO "${schema}".audits (id, org_id, url, score, speed, issues)
      VALUES ('audit-fixture', '${orgId}', 'https://fixture.invalid', 82, 71, 3);
      INSERT INTO "${schema}".onboarding_sessions (id, org_id) VALUES ('${sessionId}', '${orgId}');
      INSERT INTO "${schema}".ai_workspace_profiles (id, session_id, org_id)
      VALUES ('${profileId}', '${sessionId}', '${orgId}')
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
    hasEntitlement: async () => true,
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

  it.each(["aiWorkspaceLaunch", "aiWorkflows"])("denies generation when %s is missing", async missingAddon => {
    const generate = vi.fn(async () => ({ text: "must not run" }));
    const deps = baseDependencies({
      hasEntitlement: async (_tenantId: string, addonKey: string) => addonKey !== missingAddon,
      generate,
    });
    await expect(generateAndPersistWorkflowReport(
      orgId, `denied-${missingAddon}`, { source: "ai_workspace_launch" }, deps,
    )).rejects.toThrow("AI_WORKSPACE_LAUNCH_ENTITLEMENT_REQUIRED");
    expect(generate).not.toHaveBeenCalled();
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

  it("does not call the generator when the AI quota is exhausted", async () => {
    const generate = vi.fn(async () => ({ text: "must not run" }));
    const deps = baseDependencies({ checkAIQuota: async () => false, generate });
    await expect(generateAndPersistWorkflowReport(
      orgId, "ai-quota-run", { source: "ai_workspace_launch" }, deps,
    )).rejects.toThrow("AI_REPORT_QUOTA_EXCEEDED");
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
    const listResponse = await testDb.query(
      `SELECT * FROM reports WHERE org_id=$1 ORDER BY date DESC LIMIT 500`,
      [orgId],
    );
    expect(listResponse.rows).toHaveLength(1);
    expect(listResponse.rows[0].id).toBe(reports.rows[0].id);
    const foreignList = await testDb.query(
      `SELECT id FROM reports WHERE org_id=$1 ORDER BY date DESC LIMIT 500`,
      [otherOrgId],
    );
    expect(foreignList.rows).toHaveLength(0);
  });

  it("creates/updates a single weekly schedule and can disable it without affecting another tenant", async () => {
    const first = await upsertAWLWeeklyReportWorkflow(orgId, sessionId, profileId, "Europe/Brussels", testDb);
    const updated = await upsertAWLWeeklyReportWorkflow(orgId, sessionId, profileId, "UTC", testDb);
    expect(updated.id).toBe(first.id);
    expect(await hasActiveAWLWeeklyReportWorkflow(orgId, sessionId, testDb)).toBe(true);
    const rows = await testDb.query(
      `SELECT id, trigger_config->>'timezone' AS timezone, enabled
         FROM automation_workflows WHERE org_id=$1`,
      [orgId],
    );
    expect(rows.rows).toEqual([{ id: first.id, timezone: "UTC", enabled: true }]);
    expect(await disableAWLWeeklyReportWorkflow(otherOrgId, sessionId, testDb)).toBe(false);
    expect(await hasActiveAWLWeeklyReportWorkflow(orgId, sessionId, testDb)).toBe(true);
    expect(await disableAWLWeeklyReportWorkflow(orgId, sessionId, testDb)).toBe(true);
    expect(await hasActiveAWLWeeklyReportWorkflow(orgId, sessionId, testDb)).toBe(false);
  });
});
