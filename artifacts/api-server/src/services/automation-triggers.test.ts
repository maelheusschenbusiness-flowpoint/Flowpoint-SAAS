/**
 * D-07 — emitAutomationEvent : webhooks abonnes + workflows actives, sans jamais bloquer l'emetteur.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { queryMock, dispatchMock, executeMock, entitlementMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  dispatchMock: vi.fn(),
  executeMock: vi.fn(),
  entitlementMock: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: queryMock } }));
vi.mock("./integrations-service.js", () => ({ dispatchEvent: dispatchMock }));
vi.mock("./automation-service.js", () => ({ executeWorkflow: executeMock }));
vi.mock("./addon-entitlement.js", () => ({ hasAddonEntitlementForOrg: entitlementMock }));
vi.mock("../lib/logger.js", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { _resetAutomationTriggerCooldown, emitAutomationEvent } from "./automation-triggers.js";

const wf = (id: string, event: string, lastRunAt: string | null = null) =>
  ({ id, trigger_config: { event }, last_run_at: lastRunAt });

describe("emitAutomationEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetAutomationTriggerCooldown();
    dispatchMock.mockResolvedValue({ dispatched: 1, failed: 0 });
    executeMock.mockResolvedValue({ success: true, runId: "wr_1" });
    entitlementMock.mockResolvedValue(true);
  });

  it("ignore un evenement que le backend n'emet pas", async () => {
    const r = await emitAutomationEvent("org-a", "review.received", {});
    expect(r.workflowsTriggered).toEqual([]);
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("ignore l'organisation partagee « default » ou vide", async () => {
    await emitAutomationEvent("default", "monitor.down", {});
    await emitAutomationEvent("", "monitor.down", {});
    expect(dispatchMock).not.toHaveBeenCalled();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("monitor.down : livre les webhooks et execute UNIQUEMENT les workflows actives de cet evenement", async () => {
    queryMock.mockResolvedValue({ rows: [wf("wf_down", "monitor.down"), wf("wf_up", "monitor.up"), wf("wf_audit", "audit.completed"), wf("wf_syn", "monitor_down")] });
    const r = await emitAutomationEvent("org-a", "monitor.down", { url: "https://x.test" });
    expect(dispatchMock).toHaveBeenCalledWith("monitor.down", { url: "https://x.test" }, "org-a");
    expect(r.workflowsTriggered).toEqual(["wf_down", "wf_syn"]);
    expect(executeMock).toHaveBeenCalledTimes(2);
    expect(executeMock).toHaveBeenCalledWith("wf_down", "org-a");
    // La requete est bornee a l'organisation et aux workflows actives.
    expect(queryMock.mock.calls[0][0]).toMatch(/org_id=\$1 AND enabled=true AND trigger_type='event'/);
    expect(queryMock.mock.calls[0][1]).toEqual(["org-a"]);
  });

  it("accepte le synonyme monitor.recovered comme monitor.up", async () => {
    queryMock.mockResolvedValue({ rows: [wf("wf_up", "monitor.recovered")] });
    const r = await emitAutomationEvent("org-a", "monitor.up", {});
    expect(r.workflowsTriggered).toEqual(["wf_up"]);
  });

  it("anti-rafale : un workflow ne se redeclenche pas dans la fenetre de 5 minutes", async () => {
    queryMock.mockResolvedValue({ rows: [wf("wf_1", "audit.completed")] });
    expect((await emitAutomationEvent("org-a", "audit.completed", {})).workflowsTriggered).toEqual(["wf_1"]);
    expect((await emitAutomationEvent("org-a", "audit.completed", {})).workflowsTriggered).toEqual([]);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });

  it("anti-rafale persistant : last_run_at recent bloque le declenchement", async () => {
    queryMock.mockResolvedValue({ rows: [wf("wf_1", "audit.completed", new Date().toISOString())] });
    expect((await emitAutomationEvent("org-a", "audit.completed", {})).workflowsTriggered).toEqual([]);
  });

  it("n'execute aucun workflow sans le module AI Workflows (mais livre les webhooks)", async () => {
    entitlementMock.mockResolvedValue(false);
    queryMock.mockResolvedValue({ rows: [wf("wf_1", "monitor.down")] });
    const r = await emitAutomationEvent("org-a", "monitor.down", {});
    expect(r.workflowsTriggered).toEqual([]);
    expect(executeMock).not.toHaveBeenCalled();
    expect(dispatchMock).toHaveBeenCalled();
  });

  it("n'echoue jamais cote emetteur : webhook, requete et workflow en erreur sont absorbes", async () => {
    dispatchMock.mockRejectedValue(new Error("boom"));
    queryMock.mockResolvedValue({ rows: [wf("wf_1", "monitor.down")] });
    executeMock.mockRejectedValue(new Error("run failed"));
    await expect(emitAutomationEvent("org-a", "monitor.down", {})).resolves.toBeTruthy();
    queryMock.mockRejectedValue(new Error("db down"));
    _resetAutomationTriggerCooldown();
    await expect(emitAutomationEvent("org-a", "monitor.down", {})).resolves.toBeTruthy();
  });
});
