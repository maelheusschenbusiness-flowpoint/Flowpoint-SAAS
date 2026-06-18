import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

export const SUPPORTED_EVENTS = [
  "audit.completed", "audit.failed", "monitor.down", "monitor.up",
  "keyword.ranking_change", "report.generated", "mission.completed",
  "alert.triggered", "team.member_added",
] as const;

export type SupportedEvent = typeof SUPPORTED_EVENTS[number];

export interface Integration {
  id: string; orgId: string; name: string; type: string;
  endpoint: string; secret: string | null; events: string[];
  enabled: boolean; lastTriggered: string | null; successCount: number; failureCount: number;
}

export async function getIntegrationLimit(plan: string): Promise<number> {
  const limits: Record<string, number> = { standard: 2, pro: 10, ultra: 50, agency: 999 };
  return limits[plan.toLowerCase()] ?? 10;
}

export async function createIntegration(orgId: string, data: {
  name: string; type: string; endpoint: string; secret?: string; events: string[];
}): Promise<Integration> {
  const client = await pool.connect();
  try {
    const id = `int_${orgId}_${Date.now()}`;
    await client.query(
      `INSERT INTO webhook_integrations (id, org_id, name, type, endpoint, secret, events, enabled, success_count, failure_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,0,0,NOW())`,
      [id, orgId, data.name, data.type, data.endpoint, data.secret ?? null, JSON.stringify(data.events)]
    );
    const res = await client.query(`SELECT * FROM webhook_integrations WHERE id=$1`, [id]);
    return res.rows[0];
  } finally { client.release(); }
}

export async function dispatchEvent(integrationId: string, event: string, payload: unknown): Promise<boolean> {
  const client = await pool.connect();
  try {
    const res = await client.query(`SELECT * FROM webhook_integrations WHERE id=$1 AND enabled=true LIMIT 1`, [integrationId]);
    const integration: Integration = res.rows[0];
    if (!integration) return false;

    const body = JSON.stringify({ event, data: payload, timestamp: new Date().toISOString(), source: "flowpoint" });
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (integration.secret) {
      const { createHmac } = await import("crypto");
      headers["X-FlowPoint-Signature"] = `sha256=${createHmac("sha256", integration.secret).update(body).digest("hex")}`;
    }

    const response = await fetch(integration.endpoint, { method: "POST", headers, body, signal: AbortSignal.timeout(8000) });
    const ok = response.ok;
    await client.query(
      `UPDATE webhook_integrations SET last_triggered=NOW(), ${ok ? "success_count=success_count+1" : "failure_count=failure_count+1"} WHERE id=$1`,
      [integrationId]
    );
    return ok;
  } catch (err) {
    logger.warn({ err, integrationId }, "[integrations] dispatchEvent failed");
    return false;
  } finally { client.release(); }
}

export async function testIntegration(integrationId: string): Promise<{ ok: boolean; statusCode?: number; latencyMs?: number }> {
  const start = Date.now();
  const ok = await dispatchEvent(integrationId, "test.ping", { message: "FlowPoint webhook test" });
  return { ok, latencyMs: Date.now() - start };
}

export async function getIntegrationStats(orgId: string): Promise<{
  total: number; enabled: number; totalDeliveries: number; successRate: number; events: string[];
}> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT COUNT(*) as total, SUM(CASE WHEN enabled THEN 1 ELSE 0 END) as enabled_count,
              COALESCE(SUM(success_count),0) as success, COALESCE(SUM(failure_count),0) as failures
       FROM webhook_integrations WHERE org_id=$1`,
      [orgId]
    );
    const r = res.rows[0] ?? {};
    const success = Number(r.success ?? 0);
    const failures = Number(r.failures ?? 0);
    const total = success + failures;
    return {
      total: Number(r.total ?? 0),
      enabled: Number(r.enabled_count ?? 0),
      totalDeliveries: total,
      successRate: total > 0 ? Math.round((success / total) * 100) : 100,
      events: [...SUPPORTED_EVENTS],
    };
  } catch { return { total:0, enabled:0, totalDeliveries:0, successRate:100, events:[...SUPPORTED_EVENTS] }; }
  finally { client.release(); }
}

export async function processIncomingWebhook(type: string, payload: unknown): Promise<void> {
  logger.info({ type }, "[integrations] processIncomingWebhook");
}

export async function logEvent(opts: { orgId: string; event: string; payload: unknown; status: string }): Promise<void> {
  logger.debug({ ...opts }, "[integrations] logEvent");
}
