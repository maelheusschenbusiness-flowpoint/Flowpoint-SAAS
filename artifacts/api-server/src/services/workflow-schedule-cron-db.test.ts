import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { claimScheduledWorkflowRun, scheduledWorkflowRunId } from "./workflow-schedule-cron.js";

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

describeIsolatedCi("scheduled workflow PostgreSQL claims (isolated CI database only)", () => {
  const schema = `workflow_scheduler_test_${randomUUID().replace(/-/g, "")}`;
  let testPool: Pool;
  let clientA: PoolClient;
  let clientB: PoolClient;

  beforeAll(async () => {
    testPool = new Pool({ connectionString: databaseUrl, max: 3 });
    const admin = await testPool.connect();
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      await admin.query(`
        CREATE TABLE "${schema}".workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          org_id TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at TIMESTAMP DEFAULT NOW(),
          ended_at TIMESTAMP,
          error TEXT,
          steps_completed INTEGER DEFAULT 0,
          steps_failed INTEGER DEFAULT 0,
          output JSONB
        )
      `);
    } finally {
      admin.release();
    }
    clientA = await testPool.connect();
    clientB = await testPool.connect();
    await clientA.query(`SET search_path TO "${schema}"`);
    await clientB.query(`SET search_path TO "${schema}"`);
  });

  afterAll(async () => {
    clientA?.release();
    clientB?.release();
    if (testPool) {
      await testPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await testPool.end();
    }
  });

  it("serializes two instances claiming the same workflow and minute", async () => {
    const slot = new Date("2026-10-20T08:30:00.000Z");
    const runId = scheduledWorkflowRunId("org-a", "wf-a", slot);
    const results = await Promise.all([
      claimScheduledWorkflowRun("wf-a", "org-a", runId, slot, clientA),
      claimScheduledWorkflowRun("wf-a", "org-a", runId, slot, clientB),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const rows = await clientA.query(`SELECT id, org_id, status FROM workflow_runs WHERE id=$1`, [runId]);
    expect(rows.rows).toEqual([{ id: runId, org_id: "org-a", status: "running" }]);
  });

  it("keeps identical workflow ids isolated by organization", async () => {
    const slot = new Date("2026-10-20T08:31:00.000Z");
    const idA = scheduledWorkflowRunId("org-a", "wf-shared", slot);
    const idB = scheduledWorkflowRunId("org-b", "wf-shared", slot);
    expect(idA).not.toBe(idB);
    expect(await claimScheduledWorkflowRun("wf-shared", "org-a", idA, slot, clientA)).toBe(true);
    expect(await claimScheduledWorkflowRun("wf-shared", "org-b", idB, slot, clientB)).toBe(true);
    const rows = await clientA.query(`SELECT org_id FROM workflow_runs WHERE id = ANY($1::text[]) ORDER BY org_id`, [[idA, idB]]);
    expect(rows.rows.map((row: { org_id: string }) => row.org_id)).toEqual(["org-a", "org-b"]);
  });

  it("reclaims the same run after its five-minute lease expires", async () => {
    const slot = new Date("2026-10-20T08:32:00.000Z");
    const runId = scheduledWorkflowRunId("org-a", "wf-retry", slot);
    expect(await claimScheduledWorkflowRun("wf-retry", "org-a", runId, slot, clientA)).toBe(true);
    await clientB.query(
      `UPDATE workflow_runs SET started_at=NOW()-INTERVAL '6 minutes' WHERE id=$1 AND org_id=$2`,
      [runId, "org-a"],
    );
    expect(await claimScheduledWorkflowRun("wf-retry", "org-a", runId, slot, clientA)).toBe(true);
  });
});
