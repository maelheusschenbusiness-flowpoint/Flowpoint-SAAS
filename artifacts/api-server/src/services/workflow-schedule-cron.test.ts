import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { query, executeWorkflow } = vi.hoisted(() => ({
  query: vi.fn(),
  executeWorkflow: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query } }));
vi.mock("./automation-service.js", () => ({ executeWorkflow }));

import {
  runScheduledWorkflow,
  runWorkflowSchedulerTick,
  isValidSchedule,
  scheduledWorkflowRunId,
  stopWorkflowSchedulerForTests,
} from "./workflow-schedule-cron.js";

describe("scheduled AI workflows", () => {
  beforeEach(() => {
    query.mockReset();
    executeWorkflow.mockReset().mockResolvedValue({ success: true, runId: "mock-run" });
    stopWorkflowSchedulerForTests();
  });

  afterEach(() => stopWorkflowSchedulerForTests());

  it("uses a stable per-organization, per-workflow, per-minute run key", () => {
    const slot = new Date("2026-10-20T08:30:00.000Z");
    expect(scheduledWorkflowRunId("org-a", "wf-a", slot)).toBe(scheduledWorkflowRunId("org-a", "wf-a", slot));
    expect(scheduledWorkflowRunId("org-a", "wf-a", slot)).not.toBe(scheduledWorkflowRunId("org-b", "wf-a", slot));
    expect(scheduledWorkflowRunId("org-a", "wf-a", slot)).not.toBe(
      scheduledWorkflowRunId("org-a", "wf-a", new Date(slot.getTime() + 60_000)),
    );
  });

  it("accepts valid cron/timezone pairs and rejects invalid schedules", () => {
    expect(isValidSchedule("0 9 * * 1", "Europe/Brussels")).toBe(true);
    expect(isValidSchedule("not a cron", "UTC")).toBe(false);
    expect(isValidSchedule("0 9 * * 1", "Not/AZone")).toBe(false);
  });

  it("lets only one of two instances claim the same scheduled minute", async () => {
    const claimed = new Set<string>();
    query.mockImplementation(async (sql: string, values: unknown[]) => {
      if (String(sql).includes("AS addon_active")) {
        return { rows: [{ plan: "standard", addon_active: true }], rowCount: 1 };
      }
      if (String(sql).includes("INSERT INTO workflow_runs")) {
        const id = String(values[0]);
        if (claimed.has(id)) return { rows: [], rowCount: 0 };
        claimed.add(id);
        return { rows: [{ id }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in test: ${String(sql).slice(0, 80)}`);
    });

    const at = new Date("2026-10-20T08:30:42.000Z");
    const results = await Promise.all([
      runScheduledWorkflow("wf-a", "org-a", at),
      runScheduledWorkflow("wf-a", "org-a", at),
    ]);
    expect(results.sort()).toEqual(["duplicate", "started"]);
    expect(executeWorkflow).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("workflow_runs.org_id=EXCLUDED.org_id"))).toBe(true);
  });

  it("fails closed for default or unentitled organizations", async () => {
    query.mockResolvedValue({ rows: [{ plan: "standard", addon_active: false }], rowCount: 1 });
    expect(await runScheduledWorkflow("wf-a", "default")).toBe("ineligible");
    expect(await runScheduledWorkflow("wf-a", "org-a", new Date("2026-10-20T08:30:00Z"))).toBe("ineligible");
    expect(executeWorkflow).not.toHaveBeenCalled();
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO workflow_runs"))).toBe(false);
  });

  it("reclaims an interrupted run only while its workflow remains enabled and entitled", async () => {
    const slot = "2026-10-20T08:30:00.000Z";
    query.mockImplementation(async (sql: string, values: unknown[]) => {
      const text = String(sql);
      if (text.includes("FROM automation_workflows") && text.includes("trigger_type='schedule'")) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes("FROM workflow_runs r")) {
        return { rows: [{ workflow_id: "wf-a", org_id: "org-a", slot }], rowCount: 1 };
      }
      if (text.includes("AS addon_active")) {
        return { rows: [{ plan: "pro", addon_active: true }], rowCount: 1 };
      }
      if (text.includes("INSERT INTO workflow_runs")) {
        return { rows: [{ id: String(values[0]) }], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL in test: ${text.slice(0, 80)}`);
    });

    const result = await runWorkflowSchedulerTick();
    expect(result.recovered).toBe(1);
    const recoveryQuery = query.mock.calls.find(([sql]) => String(sql).includes("FROM workflow_runs r"))?.[0];
    expect(String(recoveryQuery)).toContain("w.enabled=true AND w.trigger_type='schedule'");
    expect(String(recoveryQuery)).toContain("w.id=r.workflow_id AND w.org_id=r.org_id");
    expect(executeWorkflow).toHaveBeenCalledWith(
      "wf-a",
      "org-a",
      expect.objectContaining({ preInserted: true, scheduled: true }),
    );
  });
});
