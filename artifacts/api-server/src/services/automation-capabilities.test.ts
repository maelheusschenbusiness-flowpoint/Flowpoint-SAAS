/**
 * D-07 — le dashboard n'annonce comme activable que ce que le backend fait reellement.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EMITTED_EVENTS, EVENT_ALIASES, EXECUTABLE_WORKFLOW_ACTIONS, WEBHOOK_TEMPLATE_PLATFORMS,
  classifyIntegrationTemplate, describeWorkflowCapability, findUnsupportedEvents,
  isExecutableWorkflowAction, normalizeAutomationEvent,
} from "./automation-capabilities.js";

const root = resolve(process.cwd(), "../..");
const dashboard = readFileSync(resolve(root, "src/frontend/dashboard.js"), "utf8");
const exported = readFileSync(resolve(root, "artifacts/flowpoint-export/dashboard.js"), "utf8");
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

function frontCaps() {
  const block = dashboard.match(/const FP_AUTOMATION_CAPS = \{[\s\S]*?\n\};/)?.[0];
  expect(block).toBeTruthy();
  return new Function(`${block}; return FP_AUTOMATION_CAPS;`)() as {
    events: string[]; aliases: Record<string, string>; platforms: string[]; actions: string[];
  };
}

function frontTemplates() {
  const re = /^\s+T\('([a-z0-9]+)','((?:[^'\\]|\\.)*)','([a-z0-9_]+)','[^']*','([a-z-]+)','(\w+)','([a-z_.]+)'/gm;
  const out: Array<{ id: string; platform: string; trigger_event: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(dashboard))) out.push({ id: m[1], platform: m[3], trigger_event: m[6] });
  return out;
}

describe("automation-capabilities", () => {
  it("normalise les synonymes d'evenements", () => {
    expect(normalizeAutomationEvent("monitor.recovered")).toBe("monitor.up");
    expect(normalizeAutomationEvent("monitor_down")).toBe("monitor.down");
    expect(normalizeAutomationEvent("audit.completed")).toBe("audit.completed");
  });

  it("classe un modele : evenement emis ET cible livrable, sinon non disponible", () => {
    expect(classifyIntegrationTemplate({ trigger_event: "monitor.down", platform: "slack" })).toEqual({ available: true });
    expect(classifyIntegrationTemplate({ trigger_event: "monitor.recovered", platform: "discord" })).toEqual({ available: true });
    expect(classifyIntegrationTemplate({ trigger_event: "review.received", platform: "slack" }))
      .toEqual({ available: false, reason: "event_not_emitted" });
    expect(classifyIntegrationTemplate({ trigger_event: "monitor.down", platform: "hubspot" }))
      .toEqual({ available: false, reason: "platform_not_supported" });
  });

  it("valide les evenements d'une nouvelle connexion", () => {
    expect(findUnsupportedEvents([])).toEqual([]);
    expect(findUnsupportedEvents(["*", "monitor.down", "monitor.recovered"])).toEqual([]);
    expect(findUnsupportedEvents(["monitor.down", "review.received", "payment.failed"])).toEqual(["review.received", "payment.failed"]);
  });

  it("evalue la capacite d'un workflow stocke", () => {
    const ok = describeWorkflowCapability({ trigger_type: "event", trigger_config: { event: "monitor.down" }, actions: [{ type: "send_alert" }] });
    expect(ok).toMatchObject({ supported: true, reason: "ok" });
    const sched = describeWorkflowCapability({ triggerType: "schedule", triggerConfig: { cron: "0 9 * * 1" }, actions: JSON.stringify([{ type: "generate_report" }, { type: "send_email", params: { template: "client_weekly" } }]) });
    expect(sched.supported).toBe(true);
    expect(describeWorkflowCapability({ trigger_type: "condition", trigger_config: { metric: "uptime" }, actions: [{ type: "send_alert" }] }).reason).toBe("trigger_not_supported");
    expect(describeWorkflowCapability({ trigger_type: "event", trigger_config: { event: "client.created" }, actions: [{ type: "run_audit" }] }).reason).toBe("trigger_not_supported");
    const noop = describeWorkflowCapability({ trigger_type: "schedule", trigger_config: { cron: "0 8 * * 3" }, actions: [{ type: "analyze_competitors" }, { type: "generate_market_insight" }, { type: "notify_if_change" }] });
    expect(noop).toMatchObject({ supported: false, reason: "actions_not_supported", unsupportedActions: ["generate_market_insight", "notify_if_change"] });
    expect(describeWorkflowCapability({ trigger_type: "event", trigger_config: { event: "monitor.down" }, actions: [] }).supported).toBe(false);
    expect(isExecutableWorkflowAction("send_email", { template: "other" })).toBe(false);
  });

  it("chaque evenement annonce a un emetteur reel dans le code", () => {
    const monitors = read("src/routes/monitors.ts");
    const audit = read("src/services/audit-runner.ts");
    expect(monitors).toContain('isDown ? "monitor.down" : "monitor.up"');
    expect(audit).toContain('emitAutomationEvent(orgId, "audit.completed"');
    expect(EMITTED_EVENTS).toEqual(["monitor.down", "monitor.up", "audit.completed"]);
  });

  it("le dashboard n'annonce que les capacites du backend (copie identique)", () => {
    const caps = frontCaps();
    expect(caps.events).toEqual([...EMITTED_EVENTS]);
    expect(caps.aliases).toEqual({ ...EVENT_ALIASES });
    expect(caps.platforms).toEqual([...WEBHOOK_TEMPLATE_PLATFORMS]);
    expect(caps.actions).toEqual([...EXECUTABLE_WORKFLOW_ACTIONS]);
    expect(exported).toBe(dashboard);
  });

  it("le dashboard et le backend classent les 284 modeles de la meme facon", () => {
    const templates = frontTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(280);
    const caps = frontCaps();
    const front = new Function(
      "caps",
      `const FP_AUTOMATION_CAPS = caps;
       ${dashboard.match(/function fpNormalizeAutomationEvent[\s\S]*?\n\}\nfunction fpTemplateAvailability[\s\S]*?\n\}/)![0]}
       return fpTemplateAvailability;`,
    )(caps) as (t: unknown) => { available: boolean };
    let activable = 0;
    for (const t of templates) {
      const a = front(t).available;
      expect(a, t.id).toBe(classifyIntegrationTemplate(t).available);
      if (a) activable++;
    }
    // La grande majorite de la bibliotheque n'est pas (encore) activable : elle doit etre marquee ainsi.
    expect(activable).toBeGreaterThan(0);
    expect(activable).toBeLessThan(templates.length / 4);
  });

  it("l'interface marque et desactive les modeles non disponibles", () => {
    expect(dashboard).toContain("fpTemplateAvailability(t).available");
    expect(dashboard).toMatch(/disabled style="flex:1;font-size:10px;opacity:\.55;cursor:not-allowed"[^>]*>\$\{fpT\('Bientôt disponible'\)\}/);
    expect(dashboard).not.toContain("'+99'");
    expect(dashboard).toMatch(/window\._useTemplate = async function\(tplId, platform, name, triggerEvent\) \{\s*\/\/ D-07/);
  });
});
