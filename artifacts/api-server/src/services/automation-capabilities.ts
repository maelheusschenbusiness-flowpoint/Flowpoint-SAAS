/**
 * D-07 — Ce que le backend FAIT REELLEMENT en matiere d'automatisation.
 *
 * Source de verite unique (le dashboard en garde une copie, verifiee par test) :
 *  - EMITTED_EVENTS : evenements reellement emis par le backend vers
 *    emitAutomationEvent (services/automation-triggers.ts).
 *  - EXECUTABLE_WORKFLOW_ACTIONS : actions de workflow qui font un travail reel
 *    dans executeAction (automation-service.ts). Les autres (generate_market_insight,
 *    notify_if_change, create_dashboard, store_cloud, ...) sont des no-op journalises.
 *  - WEBHOOK_TEMPLATE_PLATFORMS : cibles auxquelles une livraison de webhook sortant
 *    correspond reellement a l'action annoncee par un modele (message Slack/Discord
 *    formate, ou enveloppe JSON generique pour Zapier / Make / n8n).
 */

/** Evenements emis automatiquement. N'en ajouter un qu'avec son emetteur ET un test. */
export const EMITTED_EVENTS = ["monitor.down", "monitor.up", "audit.completed"] as const;
export type EmittedEvent = typeof EMITTED_EVENTS[number];

/** Anciennes ecritures / synonymes rencontres dans les modeles et l'interface. */
export const EVENT_ALIASES: Readonly<Record<string, EmittedEvent>> = {
  "monitor.recovered": "monitor.up",
  "monitor_down": "monitor.down",
  "monitor_up": "monitor.up",
  "audit_done": "audit.completed",
};

export function normalizeAutomationEvent(event: unknown): string {
  const raw = typeof event === "string" ? event.trim() : "";
  return EVENT_ALIASES[raw] ?? raw;
}

export function isEmittedEvent(event: unknown): event is EmittedEvent {
  return (EMITTED_EVENTS as readonly string[]).includes(normalizeAutomationEvent(event));
}

export const EXECUTABLE_WORKFLOW_ACTIONS = [
  "run_audit", "generate_recommendations", "generate_report", "analyze_competitors", "send_alert",
] as const;

export function isExecutableWorkflowAction(type: unknown, params?: unknown): boolean {
  if (typeof type !== "string") return false;
  if ((EXECUTABLE_WORKFLOW_ACTIONS as readonly string[]).includes(type)) return true;
  // send_email n'envoie qu'un seul modele approuve : le rapport client hebdomadaire.
  const template = params && typeof params === "object" ? (params as Record<string, unknown>)["template"] : undefined;
  return type === "send_email" && template === "client_weekly";
}

function asObject(value: unknown): Record<string, unknown> {
  let v: unknown = value;
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return {}; } }
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
}

export type WorkflowCapability = {
  /** true = le declencheur existe reellement ET toutes les actions font un travail reel. */
  supported: boolean;
  triggerSupported: boolean;
  unsupportedActions: string[];
  reason: "ok" | "trigger_not_supported" | "actions_not_supported";
};

/** Evalue un workflow stocke (colonnes snake_case ou camelCase) sans rien executer. */
export function describeWorkflowCapability(wf: Record<string, unknown>): WorkflowCapability {
  const triggerType = String(wf["trigger_type"] ?? wf["triggerType"] ?? "");
  const cfg = asObject(wf["trigger_config"] ?? wf["triggerConfig"]);
  const triggerSupported =
    (triggerType === "event" && isEmittedEvent(cfg["event"])) ||
    (triggerType === "schedule" && typeof cfg["cron"] === "string" && cfg["cron"].trim() !== "");
  let rawActions: unknown = wf["actions"];
  if (typeof rawActions === "string") { try { rawActions = JSON.parse(rawActions); } catch { rawActions = []; } }
  const actions = Array.isArray(rawActions) ? rawActions as Array<Record<string, unknown>> : [];
  const unsupportedActions = actions
    .filter(a => !isExecutableWorkflowAction(a?.["type"], a?.["params"]))
    .map(a => String(a?.["type"] ?? "?"));
  const noActions = actions.length === 0;
  const supported = triggerSupported && !noActions && unsupportedActions.length === 0;
  return {
    supported, triggerSupported, unsupportedActions,
    reason: supported ? "ok" : !triggerSupported ? "trigger_not_supported" : "actions_not_supported",
  };
}

export const WEBHOOK_TEMPLATE_PLATFORMS = ["slack", "discord", "zapier", "make", "n8n", "custom"] as const;

export type TemplateAvailability =
  | { available: true }
  | { available: false; reason: "event_not_emitted" | "platform_not_supported" };

/** Un modele n'est activable que si son evenement est emis ET sa cible est livrable. */
export function classifyIntegrationTemplate(t: { trigger_event?: unknown; platform?: unknown }): TemplateAvailability {
  if (!isEmittedEvent(t.trigger_event)) return { available: false, reason: "event_not_emitted" };
  if (!(WEBHOOK_TEMPLATE_PLATFORMS as readonly string[]).includes(String(t.platform ?? ""))) {
    return { available: false, reason: "platform_not_supported" };
  }
  return { available: true };
}

/** Valide les evenements demandes pour une NOUVELLE connexion ("*" et liste vide = tous). */
export function findUnsupportedEvents(events: unknown): string[] {
  if (!Array.isArray(events)) return [];
  return events.map(String).filter(e => e !== "*" && !isEmittedEvent(e));
}
