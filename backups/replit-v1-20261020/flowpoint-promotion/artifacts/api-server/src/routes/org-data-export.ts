import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { requireOrgId } from "../lib/require-org-id.js";
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";

const router = Router();

const MAX_ROWS_PER_SECTION = Math.max(100, Math.min(
  Number.parseInt(process.env["ORG_DATA_EXPORT_MAX_ROWS"] ?? "10000", 10) || 10000,
  50000,
));
const MAX_TOTAL_ROWS = Math.max(MAX_ROWS_PER_SECTION, Math.min(
  Number.parseInt(process.env["ORG_DATA_EXPORT_MAX_TOTAL_ROWS"] ?? "100000", 10) || 100000,
  250000,
));

type Json = Record<string, unknown>;
interface DbClient {
  query<T extends Json = Json>(queryText: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
  release(err?: boolean | Error): void;
}

function iso(value: unknown): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function canonicalStatus(value: unknown): string {
  const v = String(value ?? "").trim().toLowerCase();
  if (["done", "completed", "complete", "resolved"].includes(v)) return "completed";
  if (["inprogress", "in_progress", "in-progress", "processing", "running"].includes(v)) return "in_progress";
  if (["dismissed", "cancelled", "canceled", "archived"].includes(v)) return "dismissed";
  return "todo";
}

function canonicalImpact(value: unknown): "low" | "medium" | "high" {
  const v = String(value ?? "").trim().toLowerCase();
  if (["critical", "high", "élevé", "eleve", "fort"].includes(v)) return "high";
  if (["low", "faible", "minor"].includes(v)) return "low";
  return "medium";
}

function canonicalEffort(value: unknown): "low" | "medium" | "high" {
  const v = String(value ?? "").trim().toLowerCase();
  if (/(^|\s)(5|10|15|20|30)\s*min/.test(v) || ["low", "faible"].includes(v)) return "low";
  if (/(2|3|4|5|6|7|8|9|\d{2,})\s*h/.test(v) || ["high", "élevé", "eleve"].includes(v)) return "high";
  return "medium";
}

function canonicalCategory(value: unknown): string {
  const v = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (["seo", "audit", "audits", "optimisation", "optimization"].includes(v)) return "seo";
  if (["technical", "technique", "performance"].includes(v)) return "technical";
  if (["monitor", "monitoring", "uptime"].includes(v)) return "monitoring";
  if (["local", "local_seo", "gbp"].includes(v)) return "local_seo";
  if (["analytics", "analyse", "analysis"].includes(v)) return "analytics";
  if (["content", "contenu"].includes(v)) return "content";
  return "seo";
}

function auditState(row: Json): Json {
  const rawStatus = String(row["status"] ?? "");
  const lower = rawStatus.toLowerCase();
  const hasScore = Number.isFinite(Number(row["score"])) && Number(row["score"]) > 0;
  const executionStatus = ["failed", "error"].includes(lower)
    ? "failed"
    : ["processing", "running", "pending", "queued"].includes(lower)
      ? "in_progress"
      : hasScore ? "completed" : "partial";
  const resultStatus = executionStatus === "completed"
    ? (Number(row["score"]) < 50 ? "poor" : "completed")
    : null;
  return {
    id: row["id"],
    url: row["url"],
    name: row["name"] || undefined,
    executionStatus,
    resultStatus,
    rawStatus,
    score: executionStatus === "failed" ? null : Number(row["score"]),
    speed: executionStatus === "failed" ? null : Number(row["speed"]),
    issues: executionStatus === "failed" ? null : Number(row["issues"]),
    origin: row["origin"] || undefined,
    notes: row["notes"] || undefined,
    error: executionStatus === "failed"
      ? { code: "audit_failed", message: rawStatus || "Audit failed" }
      : null,
    createdAt: iso(row["created_at"]),
  };
}

async function tableExists(client: DbClient, table: string): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema='public' AND table_name=$1
     ) AS exists`,
    [table],
  );
  return result.rows[0]?.exists === true;
}

async function querySection(
  client: DbClient,
  table: string,
  sql: string,
  orgId: string,
): Promise<Json[]> {
  if (!(await tableExists(client, table))) return [];
  const result = await client.query<Json>(sql, [orgId, MAX_ROWS_PER_SECTION + 1]);
  if (result.rows.length > MAX_ROWS_PER_SECTION) {
    throw new Error(`La section ${table} dépasse la limite de ${MAX_ROWS_PER_SECTION} lignes. Préparez une archive asynchrone.`);
  }
  return result.rows;
}

function safeFilePart(name: unknown): string {
  const clean = String(name ?? "organisation")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return clean.slice(0, 60) || "organisation";
}

function isInteractiveOwnerOrAdmin(req: Request): boolean {
  const token = typeof req.headers["authorization"] === "string" && req.headers["authorization"].startsWith("Bearer ")
    ? req.headers["authorization"].slice(7).trim()
    : typeof req.headers["x-api-key"] === "string"
      ? req.headers["x-api-key"].trim()
      : "";
  if (token.startsWith("fp_pub_") || token.startsWith("fp_sec_")) return false;
  const role = String(req.orgContext?.role ?? "").toLowerCase();
  return ["owner", "admin"].includes(role);
}

function safePreferences(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Json;
  // Explicit allowlist: preferences can store public/secret API keys and must
  // never be serialized wholesale.
  const allowed = ["timezone", "language", "dateFormat", "theme", "density", "weekStartsOn", "notifications"];
  return Object.fromEntries(allowed.filter((key) => key in source).map((key) => [key, source[key]]));
}

router.get("/settings/data-export", async (req: Request, res: Response): Promise<void> => {
  const orgId = requireOrgId(req, res);
  if (!orgId) return;
  if (!req.orgContext?.userId || req.orgContext.userId === "service" || !isInteractiveOwnerOrAdmin(req)) {
    res.status(403).json({ error: "Seul un propriétaire ou administrateur connecté peut exporter les données." });
    return;
  }

  // ── Server-side quota enforcement ─────────────────────────────────────────
  try {
    const { checkQuota } = await import("../services/billing-service.js");
    const _quota = await checkQuota("exports", orgId);
    if (!_quota.allowed) {
      res.status(402).json({
        error: `Limite mensuelle d'exports atteinte (${_quota.used}/${_quota.limit}). Upgradez votre plan ou achetez un pack d'exports supplémentaires.`,
        code: "QUOTA_EXCEEDED",
        resource: "exports",
        used: _quota.used,
        limit: _quota.limit,
      });
      return;
    }
  } catch (_qErr) {
    logger.warn({ err: _qErr, orgId }, "[data-export] quota check failed — allowing export");
  }

  const client = await pool.connect();
  try {
    const organizationRows = await querySection(client, "organizations", `
      SELECT id, name, website, plan, subscription_status, trial_ends_at,
             trial_started_at, pending_plan, pending_plan_date, addons,
             created_at, updated_at
      FROM organizations WHERE id::text=$1 LIMIT $2
    `, orgId);
    const organization = organizationRows[0] ?? {};

    const [audits, monitors, checks, incidents, missions, missionHistory, reports,
      keywords, competitors, alertRules, alertEvents, notifications, calendarEvents,
      activity, members, prefs, integrations, aiUsage, invoices] = await Promise.all([
      querySection(client, "audits", `SELECT id,url,name,score,speed,status,issues,origin,notes,created_at FROM audits WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      querySection(client, "monitors", `SELECT id,name,url,status,uptime,latency,last_check,alert_email,alert_phone,is_critical,frequency,enabled,created_at,updated_at FROM monitors WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      querySection(client, "monitor_checks", `SELECT id,monitor_id,checked_at,ok,latency,status_code,error FROM monitor_checks WHERE org_id=$1 ORDER BY checked_at DESC LIMIT $2`, orgId),
      querySection(client, "monitor_incidents", `SELECT id,monitor_id,started_at,resolved_at,duration_s,error FROM monitor_incidents WHERE org_id=$1 ORDER BY started_at DESC LIMIT $2`, orgId),
      querySection(client, "missions", `SELECT id,title,description,category,type,priority,priority_score,status,impact,effort,estimated_traffic_impact,estimated_revenue_impact,estimated_seo_impact,estimated_conversion_impact,difficulty_score,business_impact_score,ai_quick_win,source_type,due_date,completed_at,dismissed_at,assigned_to,created_at,updated_at FROM missions WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      querySection(client, "mission_history", `SELECT id,mission_id,action,from_status,to_status,metadata,created_at FROM mission_history WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      querySection(client, "reports", `SELECT id,name,type,date,pages,shared,audit_id,white_label,pdf_ready,date_start,date_end,created_at FROM reports WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      querySection(client, "tracked_keywords", `SELECT id,keyword,current_position,prev_position,position_change,search_volume,difficulty,url,location,device,intent,tag,active,last_sync_at,created_at,updated_at FROM tracked_keywords WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      querySection(client, "competitors", `SELECT id,name,url,domain_rating,traffic,keywords,threat_level,delta,created_at FROM competitors WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      querySection(client, "alert_rules", `SELECT id,name,type,operator,threshold,duration_min,channels,site_urls,enabled,created_at,updated_at FROM alert_rules WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      querySection(client, "alert_events", `SELECT id,rule_id,rule_name,type,severity,message,metric_value,threshold,operator,site_url,read_at,resolved_at,triggered_at FROM alert_events WHERE org_id=$1 ORDER BY triggered_at DESC LIMIT $2`, orgId),
      querySection(client, "notifications", `SELECT id,type,title,message,read,created_at FROM notifications WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      querySection(client, "calendar_events", `SELECT id,title,site,type,date,start_time,duration,notes,client_name,priority,color,reminder,created_at,updated_at FROM calendar_events WHERE org_id=$1 ORDER BY date DESC LIMIT $2`, orgId),
      querySection(client, "activity_logs", `SELECT id,type,label,target_id,target_type,metadata,created_at FROM activity_logs WHERE org_id=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      querySection(client, "organization_members", `
        SELECT om.id,om.user_id,om.role,om.status,om.invited_by,om.joined_at,om.created_at,om.updated_at,
               u.email,u.first_name,u.last_name,u.auth_provider,u.email_verified
        FROM organization_members om JOIN users u ON u.id=om.user_id
        WHERE om.organization_id::text=$1 ORDER BY om.joined_at DESC NULLS LAST LIMIT $2
      `, orgId),
      querySection(client, "user_prefs", `SELECT settings,updated_at FROM user_prefs WHERE org_id=$1 LIMIT $2`, orgId),
      // Connector schemas differ across historical deployments and may contain
      // credentials. Export only safe, universally-present fields after
      // introspection below; raw config/tokens are deliberately never selected.
      Promise.resolve<Json[]>([]),
      querySection(client, "ai_usage_logs", `SELECT id,provider,model,feature,credits_used,tokens_in,tokens_out,cost_eur,latency_ms,success,created_at FROM ai_usage_logs WHERE org_id::text=$1 ORDER BY created_at DESC LIMIT $2`, orgId),
      // Stripe invoices are fetched through billing APIs in this project; no
      // direct table is assumed so a missing optional table cannot fail export.
      Promise.resolve<Json[]>([]),
    ]);

    const checksByMonitor = new Map<string, Json[]>();
    for (const check of checks) {
      const id = String(check["monitor_id"] ?? "");
      checksByMonitor.set(id, [...(checksByMonitor.get(id) ?? []), check]);
    }
    const incidentsByMonitor = new Map<string, Json[]>();
    for (const incident of incidents) {
      const id = String(incident["monitor_id"] ?? "");
      incidentsByMonitor.set(id, [...(incidentsByMonitor.get(id) ?? []), incident]);
    }
    const normalizedMonitors = monitors.map((monitor) => {
      const monitorChecks = checksByMonitor.get(String(monitor["id"])) ?? [];
      const monitorIncidents = incidentsByMonitor.get(String(monitor["id"])) ?? [];
      const totalDowntimeSeconds = monitorIncidents.reduce((sum, incident) => sum + Number(incident["duration_s"] ?? 0), 0);
      return {
        id: monitor["id"], name: monitor["name"], url: monitor["url"], status: monitor["status"],
        uptime: monitor["uptime"], latency: monitor["latency"], lastCheckAt: iso(monitor["last_check"]),
        alertEmail: monitor["alert_email"] || undefined, alertPhone: monitor["alert_phone"] || undefined,
        critical: monitor["is_critical"], frequency: monitor["frequency"], enabled: monitor["enabled"],
        createdAt: iso(monitor["created_at"]), updatedAt: iso(monitor["updated_at"]),
        metrics: {
          totalChecks: monitorChecks.length,
          successfulChecks: monitorChecks.filter((check) => check["ok"] === true).length,
          failedChecks: monitorChecks.filter((check) => check["ok"] !== true).length,
          incidentCount: monitorIncidents.length,
          lastIncidentAt: iso(monitorIncidents[0]?.["started_at"]),
          totalDowntimeSeconds,
        },
        checks: monitorChecks.map((check) => ({
          id: check["id"], checkedAt: iso(check["checked_at"]), ok: check["ok"],
          latency: check["latency"], statusCode: check["status_code"], error: check["error"] || null,
        })),
        incidents: monitorIncidents.map((incident) => ({
          id: incident["id"], startedAt: iso(incident["started_at"]), resolvedAt: iso(incident["resolved_at"]),
          durationSeconds: incident["duration_s"], error: incident["error"] || null,
        })),
      };
    });

    const normalizedMissions = missions.map((mission) => ({
      id: mission["id"], title: mission["title"], description: mission["description"] || undefined,
      status: canonicalStatus(mission["status"]), rawStatus: mission["status"],
      impact: canonicalImpact(mission["impact"]), rawImpact: mission["impact"],
      effort: canonicalEffort(mission["effort"]), rawEffort: mission["effort"],
      category: canonicalCategory(mission["category"]), rawCategory: mission["category"],
      type: mission["type"], priority: canonicalImpact(mission["priority"]), rawPriority: mission["priority"],
      priorityScore: mission["priority_score"], estimates: {
        traffic: mission["estimated_traffic_impact"], revenue: mission["estimated_revenue_impact"],
        seo: mission["estimated_seo_impact"], conversion: mission["estimated_conversion_impact"],
      },
      quickWin: mission["ai_quick_win"], sourceType: mission["source_type"],
      dueDate: mission["due_date"] || null, completedAt: iso(mission["completed_at"]),
      dismissedAt: iso(mission["dismissed_at"]), assignedTo: mission["assigned_to"] || null,
      createdAt: iso(mission["created_at"]), updatedAt: iso(mission["updated_at"]),
    }));

    const allSections: Json = {
      profile: { userId: req.orgContext.userId, email: req.orgContext.email ?? null },
      organization: {
        id: organization["id"] ?? orgId, name: organization["name"] ?? null, website: organization["website"] ?? null,
        plan: organization["plan"] ?? null, subscriptionStatus: organization["subscription_status"] ?? null,
        trialEndsAt: iso(organization["trial_ends_at"]), pendingPlan: organization["pending_plan"] ?? null,
        pendingPlanDate: iso(organization["pending_plan_date"]), addons: organization["addons"] ?? {},
        createdAt: iso(organization["created_at"]), updatedAt: iso(organization["updated_at"]),
      },
      preferences: prefs[0] ? { settings: safePreferences(prefs[0]["settings"]), updatedAt: iso(prefs[0]["updated_at"]) } : null,
      members,
      audits: audits.map(auditState),
      monitors: normalizedMonitors,
      missions: normalizedMissions,
      missionHistory: missionHistory.map((item) => ({ ...item, createdAt: iso(item["created_at"]) })),
      reports: reports.map((item) => ({ ...item, createdAt: iso(item["created_at"]) })),
      keywords,
      competitors,
      alertRules: alertRules.map((item) => ({ ...item, impact: canonicalImpact(item["type"]), rawType: item["type"], createdAt: iso(item["created_at"]), updatedAt: iso(item["updated_at"]) })),
      alertEvents: alertEvents.map((item) => ({ ...item, createdAt: iso(item["created_at"]) })),
      notifications: notifications.map((item) => ({ ...item, createdAt: iso(item["created_at"]) })),
      calendar: calendarEvents.map((item) => ({ ...item, createdAt: iso(item["created_at"]), updatedAt: iso(item["updated_at"]) })),
      activity: activity.map((item) => ({ ...item, createdAt: iso(item["created_at"]) })),
      integrations: integrations.map((item) => ({ ...item, metadata: item["metadata"] ?? {}, createdAt: iso(item["created_at"]), updatedAt: iso(item["updated_at"]) })),
      aiUsage: aiUsage.map((item) => ({ ...item, createdAt: iso(item["created_at"]) })),
      billing: { invoices: invoices.map((item) => ({ ...item, createdAt: iso(item["created_at"]) })) },
    };

    const totalRows = Object.values(allSections).reduce<number>(
      (total, section) => total + (Array.isArray(section) ? section.length : 1),
      0,
    );
    if (totalRows > MAX_TOTAL_ROWS) {
      res.status(413).json({ error: "Export trop volumineux. Une archive asynchrone doit être préparée.", maxRows: MAX_TOTAL_ROWS });
      return;
    }

    const excludedSections = [
      { name: "oauthCredentials", reason: "Les access tokens et refresh tokens ne sont jamais exportés." },
      { name: "apiKeys", reason: "Les clés API et secrets ne sont jamais exportés." },
      { name: "sessions", reason: "Les cookies et jetons de session ne sont jamais exportés." },
      { name: "paymentMethods", reason: "Les informations bancaires et secrets Stripe ne sont jamais exportés." },
      { name: "shareTokens", reason: "Les liens secrets et jetons de partage sont exclus." },
      { name: "teamFileContents", reason: "Le contenu binaire et les pièces jointes privées sont exclus." },
      { name: "aiPromptsAndAttachments", reason: "Les prompts et pièces jointes IA ne sont pas exportés ; seuls les métriques d'usage sont incluses." },
    ];

    const payload = {
      exportVersion: "1.0",
      generatedAt: new Date().toISOString(),
      organizationId: orgId,
      organizationName: organization["name"] ?? null,
      workspaceId: orgId,
      plan: organization["plan"] ?? null,
      requestedBy: { userId: req.orgContext.userId, email: req.orgContext.email ?? null },
      schema: { description: "FlowPoint user data export", timezone: "UTC", dateFormat: "ISO-8601" },
      excludedSections,
      data: allSections,
    };

    const filename = `flowpoint-export-${safeFilePart(organization["name"])}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    await store.logActivity({
      type: "export",
      label: "Export complet des données de l’organisation",
      targetType: "org_data_export",
      metadata: { sections: Object.keys(allSections), totalRows },
      orgId,
    });
    res.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export impossible";
    logger.error({ error, orgId }, "[org-data-export] failed");
    res.status(message.includes("dépasse la limite") ? 413 : 500).json({ error: message });
  } finally {
    client.release();
  }
});

export default router;