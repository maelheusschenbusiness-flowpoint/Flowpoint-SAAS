import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(resolve(process.cwd(), "../../src/frontend/dashboard.js"), "utf8");
const servedDashboard = readFileSync(resolve(process.cwd(), "../flowpoint-export/dashboard.js"), "utf8");
const start = dashboard.indexOf("async function _awlAnimate()");
const end = dashboard.indexOf("window.openAIWorkspaceLaunch", start);
const flow = dashboard.slice(start, end);
const persistenceStart = dashboard.indexOf("async function loadAIWorkspaceLast()");
const persistence = dashboard.slice(persistenceStart, end);

describe("AI Workspace Launch frontend", () => {
  it("renders only the API result and surfaces failed requests instead of demo metrics", () => {
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    expect(flow).toContain("await response.json()");
    expect(flow).toContain("if (!response.ok || !result?.ok)");
    expect(flow).toContain("_awlResults({ ...result");
    expect(flow).toContain("STATE.customDashboards = [result.dashboard");
    expect(flow).toContain("Aucune donnée de démonstration");
    expect(dashboard).toContain("window.loadAIWorkspaceLast()");
    expect(persistence).toContain("fpTenantRead('fp:ai-workspace-launch:last-session')");
    expect(persistence).toContain("/api/ai-workspace-launch/' + encodeURIComponent(sessionId)");
    expect(persistence).toContain("Number(session.dashboards_created ?? 0)");
    expect(persistence).toContain("Number(session.alerts_configured ?? 0)");
    expect(flow).not.toContain("+340€");
    expect(flow).not.toContain("64/100");
    expect(flow).not.toContain("Uptime < 99%");
  });

  it("escapes generated strategy, roadmap and mission content before inserting HTML", () => {
    const resultsStart = dashboard.indexOf("function _awlResults(result)");
    const resultsEnd = dashboard.indexOf("window.openAIWorkspaceLaunch", resultsStart);
    const results = dashboard.slice(resultsStart, resultsEnd);

    expect(results).toContain("escHtml(result.strategy)");
    expect(results).toContain("escHtml(r.label)");
    expect(results).toContain("escHtml(m.title)");
    expect(results).toContain("result.dashboardsCreated ?? 0");
    expect(results).toContain("result.alertsConfigured ?? 0");
  });

  it("serves the real AI response instead of the former demo metrics", () => {
    const start = servedDashboard.indexOf("async function _awlAnimate()");
    const end = servedDashboard.indexOf("window.openAIWorkspaceLaunch", start);
    const servedFlow = servedDashboard.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(servedFlow).toContain("await fetch('/api/ai-workspace-launch'");
    expect(servedFlow).toContain("if (!response.ok || !result?.ok)");
    expect(servedFlow).toContain("result.roadmap");
    expect(servedFlow).toContain("result.missions");
    expect(servedFlow).not.toContain("val:'64/100'");
    expect(servedFlow).not.toContain("+340€");
    expect(servedFlow).not.toContain("Uptime < 99%");
  });

  it("renders persisted dashboard widgets from the tenant-scoped Data Explorer API", () => {
    const dashboards = dashboard.slice(
      dashboard.indexOf("if (sub === 'dashboards')"),
      dashboard.indexOf("// SUB: AI INSIGHTS CENTER"),
    );
    expect(dashboards).toContain("/api/data-explorer/query?");
    expect(dashboards).toContain("source, days: '90', limit: '200'");
    expect(dashboards).toContain("`${orgKey}:${dashboard.id}:${source}`");
    expect(dashboards).toContain("row.score");
    expect(dashboards).toContain("row.title");
    expect(dashboards).toContain("Aucun audit mesuré");
    expect(dashboards).toContain("Aucune mission enregistrée");
    expect(dashboards).toContain("p.widgets.map(widget => renderDashboardWidget(p, widget))");
  });

  it("confirms Agency Reporting Pack reports are persisted and visible after generation", () => {
    const packsStart = dashboard.indexOf("async loadAgencyPacks()");
    const packsEnd = dashboard.indexOf("\n  },\n};", packsStart);
    const panel = dashboard.slice(packsStart, packsEnd);
    expect(panel).toContain("reports/agency-packs/generate");
    expect(panel).toContain("bundle?.verifiedCount !== 3");
    expect(panel).toContain("window._fpReportsAPI.load({ force: true })");
    expect(panel).toContain("createdIds.some(id => !visibleIds.has(id))");
    expect(panel).toContain("window._fpReportsAPI.create");
  });
});
