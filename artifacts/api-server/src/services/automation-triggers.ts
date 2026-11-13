/**
 * D-07 — Declencheurs automatiques reels.
 *
 * emitAutomationEvent() est appele par les emetteurs backend (transition de
 * monitor, fin d'audit). Il (1) livre les webhooks sortants abonnes a l'evenement
 * et (2) execute les workflows ACTIVES de l'organisation dont le declencheur
 * correspond. Jamais bloquant : toute erreur est journalisee, jamais propagee.
 *
 * Evenements supportes : voir EMITTED_EVENTS (automation-capabilities.ts).
 */
import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import { isEmittedEvent, normalizeAutomationEvent } from "./automation-capabilities.js";

/** Un meme workflow ne se redeclenche pas plus d'une fois par fenetre (anti-boucle / anti-rafale). */
export const WORKFLOW_EVENT_COOLDOWN_MS = 5 * 60 * 1000;
const MAX_WORKFLOWS_PER_EVENT = 5;
const lastTriggered = new Map<string, number>();

type WorkflowRow = { id: string; trigger_config: unknown; last_run_at: Date | string | null };

function configEvent(value: unknown): string {
  let cfg: unknown = value;
  if (typeof value === "string") { try { cfg = JSON.parse(value); } catch { return ""; } }
  if (!cfg || typeof cfg !== "object") return "";
  return normalizeAutomationEvent((cfg as Record<string, unknown>)["event"]);
}

export async function emitAutomationEvent(
  orgId: string,
  event: string,
  payload: Record<string, unknown> = {},
): Promise<{ webhooks: { dispatched: number; failed: number } | null; workflowsTriggered: string[] }> {
  const result: { webhooks: { dispatched: number; failed: number } | null; workflowsTriggered: string[] } =
    { webhooks: null, workflowsTriggered: [] };
  const normalized = normalizeAutomationEvent(event);
  if (!orgId || orgId === "default" || !isEmittedEvent(normalized)) return result;

  // 1. Webhooks sortants abonnes (Slack, Discord, Zapier, Make, n8n, ...).
  try {
    const { dispatchEvent } = await import("./integrations-service.js");
    result.webhooks = await dispatchEvent(normalized, payload, orgId);
  } catch (err) {
    logger.warn({ err, orgId, event: normalized }, "[automation-triggers] webhook dispatch failed (non-fatal)");
  }

  // 2. Workflows actives dont le declencheur correspond.
  try {
    const { hasAddonEntitlementForOrg } = await import("./addon-entitlement.js");
    if (!(await hasAddonEntitlementForOrg(orgId, "aiWorkflows"))) return result;

    const rows = await pool.query<WorkflowRow>(
      `SELECT id, trigger_config, last_run_at FROM automation_workflows
        WHERE org_id=$1 AND enabled=true AND trigger_type='event'
        ORDER BY created_at ASC LIMIT 200`,
      [orgId],
    );
    const now = Date.now();
    const matching = rows.rows
      .filter(r => configEvent(r.trigger_config) === normalized)
      .filter(r => {
        const key = `${orgId}:${r.id}`;
        const last = Math.max(lastTriggered.get(key) ?? 0, r.last_run_at ? new Date(r.last_run_at).getTime() : 0);
        return now - last >= WORKFLOW_EVENT_COOLDOWN_MS;
      })
      .slice(0, MAX_WORKFLOWS_PER_EVENT);
    if (!matching.length) return result;

    const { executeWorkflow } = await import("./automation-service.js");
    for (const wf of matching) {
      lastTriggered.set(`${orgId}:${wf.id}`, now);
      result.workflowsTriggered.push(wf.id);
      // Fire-and-forget : l'emetteur (monitor, audit) ne doit jamais attendre un workflow.
      void executeWorkflow(wf.id, orgId).catch(err =>
        logger.warn({ err, orgId, workflowId: wf.id }, "[automation-triggers] workflow execution failed (non-fatal)"));
    }
  } catch (err) {
    logger.warn({ err, orgId, event: normalized }, "[automation-triggers] workflow lookup failed (non-fatal)");
  }
  return result;
}

/** Pour les tests : remet a zero l'anti-rafale en memoire. */
export function _resetAutomationTriggerCooldown(): void { lastTriggered.clear(); }
