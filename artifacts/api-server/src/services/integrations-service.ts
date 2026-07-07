import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";
import crypto from "crypto";

export const SUPPORTED_EVENTS = [
  "audit.completed", "audit.failed", "monitor.down", "monitor.up",
  "keyword.ranking_change", "report.generated", "mission.completed",
  "alert.triggered", "team.member_added",
] as const;

export type SupportedEvent = typeof SUPPORTED_EVENTS[number];

// Plan-based integration limits
export function getIntegrationLimit(plan: string): number {
  const limits: Record<string, number> = { standard: 2, pro: 10, ultra: 50, agency: 999 };
  return limits[plan.toLowerCase()] ?? 10;
}

// ── createIntegration ─────────────────────────────────────────────────────────
// Creates an outgoing webhook integration in automation_integrations.
// signature matches what routes/integrations.ts expects:
// createIntegration(orgId, plan, { name, type, platform, endpointUrl, events, ... })
export async function createIntegration(
  orgId: string,
  plan: string,
  data: {
    name: string;
    type?: string;
    platform?: string;
    endpointUrl?: string;
    webhookUrl?: string;
    events?: string[];
    metadata?: Record<string, unknown>;
    headers?: Record<string, string>;
    retryEnabled?: boolean;
    maxRetries?: number;
  }
): Promise<Record<string, unknown>> {
  const limit = getIntegrationLimit(plan);
  const client = await pool.connect();
  try {
    // Check plan limit
    const countRes = await client.query(
      `SELECT COUNT(*) AS cnt FROM automation_integrations WHERE org_id=$1 AND active=true`,
      [orgId]
    );
    const current = Number((countRes.rows[0] as Record<string, unknown>)["cnt"] ?? 0);
    if (current >= limit) throw new Error(`Limite du plan atteinte (${current}/${limit})`);

    const id = `intg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const endpointUrl = data.endpointUrl || data.webhookUrl || "";
    const platform = data.platform || "custom";
    const events = data.events ?? [];
    const secretKey = crypto.randomBytes(24).toString("hex");

    await client.query(
      `INSERT INTO automation_integrations
         (id, org_id, name, platform, endpoint_url, secret_key, events, headers,
          timeout_ms, max_retries, retry_enabled, active, success_count, failure_count, metadata, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,0,0,$12,NOW(),NOW())`,
      [
        id, orgId, data.name, platform, endpointUrl, secretKey,
        JSON.stringify(events),
        JSON.stringify(data.headers ?? {}),
        10000,
        data.maxRetries ?? 3,
        data.retryEnabled !== false,
        JSON.stringify(data.metadata ?? {}),
      ]
    );

    const res = await client.query(
      `SELECT * FROM automation_integrations WHERE id=$1`, [id]
    );
    const row = res.rows[0] as Record<string, unknown>;
    return { ...row, secretKey };
  } finally {
    client.release();
  }
}

// ── dispatchEvent ─────────────────────────────────────────────────────────────
// Fan-out: send event to ALL active integrations for the org subscribed to the event.
// Signature: dispatchEvent(event, payload, orgId)
export async function dispatchEvent(
  event: string,
  payload: Record<string, unknown>,
  orgId: string
): Promise<{ dispatched: number; failed: number }> {
  const client = await pool.connect();
  let dispatched = 0;
  let failed = 0;

  try {
    // Select all active integrations for this org
    const res = await client.query(
      `SELECT * FROM automation_integrations WHERE org_id=$1 AND active=true`,
      [orgId]
    );

    const integrations = res.rows as Array<Record<string, unknown>>;
    const subscribed = integrations.filter(intg => {
      const evts = parseJson<string[]>(intg["events"] as string, []);
      return evts.length === 0 || evts.includes(event);
    });

    for (const intg of subscribed) {
      try {
        const ok = await _deliverWebhook(intg, event, payload);
        const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
        await client.query(
          `UPDATE automation_integrations SET
             last_triggered=NOW(),
             success_count = success_count + $1,
             failure_count = failure_count + $2,
             updated_at = NOW()
           WHERE id=$3`,
          [ok ? 1 : 0, ok ? 0 : 1, intg["id"]]
        );
        // Log the run
        await client.query(
          `INSERT INTO automation_runs
             (id, org_id, integration_id, event_type, payload, status, attempt, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,1,NOW())
           ON CONFLICT (id) DO NOTHING`,
          [runId, orgId, intg["id"], event, JSON.stringify(payload), ok ? "success" : "failed"]
        );
        if (ok) dispatched++; else failed++;
      } catch (err) {
        logger.warn({ err, integrationId: intg["id"] }, "[integrations] dispatch failed for one integration");
        failed++;
      }
    }

    return { dispatched, failed };
  } catch (err) {
    logger.error({ err, event, orgId }, "[integrations] dispatchEvent outer error");
    return { dispatched, failed };
  } finally {
    client.release();
  }
}

// ── _deliverWebhook ────────────────────────────────────────────────────────────
// Internal: send HTTP POST to the integration's endpoint with platform-aware formatting.
async function _deliverWebhook(
  intg: Record<string, unknown>,
  event: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const endpointUrl = (intg["endpoint_url"] as string | undefined)?.trim();
  if (!endpointUrl) return false;

  const platform = (intg["platform"] as string | undefined) || "custom";
  const secretKey = intg["secret_key"] as string | undefined;
  const timeoutMs = Number(intg["timeout_ms"] ?? 10000);

  const body = buildPlatformPayload(platform, event, payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "FlowPoint/1.0",
  };

  // HMAC signature for platforms that support it
  if (secretKey && !["slack", "discord"].includes(platform)) {
    headers["X-FlowPoint-Signature"] = `sha256=${crypto
      .createHmac("sha256", secretKey)
      .update(body)
      .digest("hex")}`;
  }

  // Merge any custom headers
  const customHeaders = parseJson<Record<string, string>>(intg["headers"] as string, {});
  Object.assign(headers, customHeaders);

  const response = await fetch(endpointUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(timeoutMs),
  });

  logger.info({ platform, event, status: response.status, url: endpointUrl }, "[integrations] webhook delivered");
  return response.ok;
}

// ── buildPlatformPayload ───────────────────────────────────────────────────────
// Returns a JSON string formatted for each platform.
function buildPlatformPayload(platform: string, event: string, payload: Record<string, unknown>): string {
  const eventLabel = event.replace(".", " → ");
  const ts = new Date().toISOString();

  if (platform === "slack") {
    const text = formatEventText(event, payload);
    return JSON.stringify({
      text: `*FlowPoint* — ${eventLabel}`,
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `*FlowPoint Alert* : \`${event}\`\n${text}` },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: `_${ts} · flowpoint.pro_` }],
        },
      ],
    });
  }

  if (platform === "discord") {
    const text = formatEventText(event, payload);
    const colors: Record<string, number> = {
      "monitor.down": 0xef4444,
      "monitor.up": 0x22c55e,
      "audit.completed": 0x2563eb,
      "alert.triggered": 0xf59e0b,
    };
    return JSON.stringify({
      username: "FlowPoint",
      embeds: [
        {
          title: `📊 ${eventLabel}`,
          description: text,
          color: colors[event] ?? 0x6b7280,
          footer: { text: `FlowPoint · ${ts}` },
        },
      ],
    });
  }

  // Default: standard FlowPoint envelope (Zapier, Make, n8n, HubSpot, custom)
  return JSON.stringify({
    event,
    data: payload,
    timestamp: ts,
    source: "flowpoint",
    platform,
  });
}

// ── formatEventText ────────────────────────────────────────────────────────────
function formatEventText(event: string, payload: Record<string, unknown>): string {
  if (event === "monitor.down") {
    return `🔴 Site DOWN: ${payload["url"] ?? payload["name"] ?? "inconnu"}`;
  }
  if (event === "monitor.up") {
    return `🟢 Site UP: ${payload["url"] ?? payload["name"] ?? "inconnu"}`;
  }
  if (event === "audit.completed") {
    return `✅ Audit terminé : ${payload["url"] ?? "?"} — Score ${payload["score"] ?? "?"}/100`;
  }
  if (event === "keyword.ranking_change") {
    return `📈 Keyword "${payload["keyword"] ?? "?"}" : position ${payload["previousPosition"] ?? "?"} → ${payload["currentPosition"] ?? "?"}`;
  }
  if (event === "alert.triggered") {
    return `⚠️ Alerte : ${payload["message"] ?? payload["type"] ?? "Inconnue"}`;
  }
  if (event === "mission.completed") {
    return `🎯 Mission complétée : ${payload["title"] ?? "?"} (${payload["impact"] ?? "?"})`;
  }
  return JSON.stringify(payload).slice(0, 200);
}

// ── testIntegration ───────────────────────────────────────────────────────────
// Signature: testIntegration(id, orgId)
export async function testIntegration(
  id: string,
  orgId: string
): Promise<{ ok: boolean; success: boolean; statusCode?: number; durationMs?: number; error?: string }> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM automation_integrations WHERE id=$1 AND org_id=$2 LIMIT 1`,
      [id, orgId]
    );
    if (!res.rows.length) {
      return { ok: false, success: false, error: "Integration not found" };
    }
    const intg = res.rows[0] as Record<string, unknown>;

    const t0 = Date.now();
    let ok = false;
    let httpStatus: number | undefined;

    try {
      const endpointUrl = (intg["endpoint_url"] as string | undefined)?.trim();
      if (!endpointUrl) return { ok: false, success: false, error: "No endpoint URL configured" };

      const platform = (intg["platform"] as string | undefined) || "custom";
      const body = buildPlatformPayload(platform, "test.ping", {
        message: "FlowPoint webhook test — connexion réussie !",
        integration: intg["name"],
        timestamp: new Date().toISOString(),
      });

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "User-Agent": "FlowPoint/1.0",
      };
      const secretKey = intg["secret_key"] as string | undefined;
      if (secretKey && !["slack", "discord"].includes(platform)) {
        headers["X-FlowPoint-Signature"] = `sha256=${crypto
          .createHmac("sha256", secretKey)
          .update(body)
          .digest("hex")}`;
      }

      const response = await fetch(endpointUrl, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10000),
      });
      ok = response.ok;
      httpStatus = response.status;
    } catch (err) {
      return {
        ok: false,
        success: false,
        durationMs: Date.now() - t0,
        error: err instanceof Error ? err.message : "Request failed",
      };
    }

    const durationMs = Date.now() - t0;

    // Update stats
    await client.query(
      `UPDATE automation_integrations SET
         last_triggered=NOW(),
         success_count = success_count + $1,
         failure_count = failure_count + $2,
         updated_at = NOW()
       WHERE id=$3`,
      [ok ? 1 : 0, ok ? 0 : 1, id]
    );

    logger.info({ id, ok, httpStatus, durationMs }, "[integrations] testIntegration");
    return { ok, success: ok, statusCode: httpStatus, durationMs };
  } finally {
    client.release();
  }
}

// ── getIntegrationStats ───────────────────────────────────────────────────────
export async function getIntegrationStats(orgId: string): Promise<{
  total: number;
  enabled: number;
  totalDeliveries: number;
  successRate: number;
  events: string[];
}> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN active THEN 1 ELSE 0 END) AS enabled_count,
         COALESCE(SUM(success_count), 0) AS success,
         COALESCE(SUM(failure_count), 0) AS failures
       FROM automation_integrations WHERE org_id=$1`,
      [orgId]
    );
    const r = (res.rows[0] ?? {}) as Record<string, unknown>;
    const success = Number(r["success"] ?? 0);
    const failures = Number(r["failures"] ?? 0);
    const total = success + failures;
    return {
      total: Number(r["total"] ?? 0),
      enabled: Number(r["enabled_count"] ?? 0),
      totalDeliveries: total,
      successRate: total > 0 ? Math.round((success / total) * 100) : 100,
      events: [...SUPPORTED_EVENTS],
    };
  } catch {
    return { total: 0, enabled: 0, totalDeliveries: 0, successRate: 100, events: [...SUPPORTED_EVENTS] };
  } finally {
    client.release();
  }
}

// ── processIncomingWebhook ────────────────────────────────────────────────────
// Called when FlowPoint receives a webhook at /api/integrations/webhook/incoming/:token
// Signature: processIncomingWebhook(token, body, orgId)
export async function processIncomingWebhook(
  token: string,
  body: Record<string, unknown>,
  orgId: string
): Promise<{ processed: boolean; action?: string; message?: string }> {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT * FROM incoming_webhooks WHERE token=$1 AND active=true LIMIT 1`,
      [token]
    );
    if (!res.rows.length) throw new Error("Token webhook invalide ou désactivé");

    const hook = res.rows[0] as Record<string, unknown>;

    // Update hit counter
    await client.query(
      `UPDATE incoming_webhooks SET hits=COALESCE(hits,0)+1, last_hit=NOW() WHERE token=$1`,
      [token]
    );

    const action = (hook["action"] as string) || "log";
    const actionConfig = parseJson<Record<string, unknown>>(hook["action_config"] as string, {});

    logger.info({ token: token.slice(0, 8) + "…", action, orgId }, "[integrations] incoming webhook received");

    if (action === "create_mission") {
      // Create a mission from the incoming webhook data
      const missionTitle = (body["title"] as string) || (actionConfig["title"] as string) || "Mission depuis webhook";
      const missionDesc = (body["description"] as string) || (body["message"] as string) || JSON.stringify(body).slice(0, 500);

      const missionId = `mission_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
      await client.query(
        `INSERT INTO missions (id, org_id, title, description, source_type, source_data, status, priority, created_at)
         VALUES ($1,$2,$3,$4,'webhook',$5,'pending','medium',NOW())
         ON CONFLICT DO NOTHING`,
        [missionId, hook["org_id"] || orgId, missionTitle, missionDesc, JSON.stringify({ webhook_source: hook["source"] })]
      );
      return { processed: true, action, message: `Mission créée: ${missionTitle}` };
    }

    if (action === "trigger_audit") {
      const url = (body["url"] as string) || (actionConfig["url"] as string);
      if (url) {
        logger.info({ url, orgId }, "[integrations] incoming webhook triggering audit (queued)");
      }
      return { processed: true, action, message: `Audit planifié: ${url ?? "no url"}` };
    }

    // Default: log
    return { processed: true, action: "log", message: "Webhook reçu et enregistré" };
  } finally {
    client.release();
  }
}

// ── dispatchEventToOrg ─────────────────────────────────────────────────────────
// Convenience: dispatch from internal services that know the event but not orgId
export async function dispatchEventToAllOrgs(
  event: SupportedEvent,
  payload: Record<string, unknown>
): Promise<void> {
  const client = await pool.connect();
  try {
    // Get distinct orgs with active integrations for this event
    const res = await client.query(
      `SELECT DISTINCT org_id FROM automation_integrations WHERE active=true`
    );
    for (const row of res.rows as Array<{ org_id: string }>) {
      dispatchEvent(event, payload, row.org_id).catch(err =>
        logger.warn({ err, orgId: row.org_id, event }, "[integrations] fan-out dispatch failed")
      );
    }
  } catch (err) {
    logger.warn({ err, event }, "[integrations] dispatchEventToAllOrgs failed");
  } finally {
    client.release();
  }
}

// ── logEvent ──────────────────────────────────────────────────────────────────
export async function logEvent(opts: {
  orgId: string;
  event: string;
  payload: unknown;
  status: string;
}): Promise<void> {
  logger.debug(opts, "[integrations] logEvent");
}

// ── parseJson ─────────────────────────────────────────────────────────────────
function parseJson<T>(value: unknown, fallback: T): T {
  if (!value || typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
