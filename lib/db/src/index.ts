import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import {
  pgTable, text, integer, boolean, timestamp, real, bigint, jsonb,
} from "drizzle-orm/pg-core";

// ── Connection ────────────────────────────────────────────────────────────────

export const pool = new Pool({
  connectionString: process.env["DATABASE_URL"] ?? process.env["MONGO_URI"],
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// ── Schema ────────────────────────────────────────────────────────────────────

export const auditsTable = pgTable("audits", {
  id:         text("id").primaryKey(),
  url:        text("url").notNull(),
  score:      integer("score").notNull().default(0),
  status:     text("status").notNull().default("processing"),
  speed:      integer("speed").notNull().default(0),
  date:       text("date").notNull(),
  issues:     integer("issues").notNull().default(0),
  origin:     text("origin").default("manual"),
  orgId:      text("org_id").notNull().default("default"),
  createdAt:  timestamp("created_at").defaultNow(),
});

export const auditSchedulesTable = pgTable("audit_schedules", {
  id:         text("id").primaryKey(),
  url:        text("url").notNull(),
  frequency:  text("frequency").notNull().default("weekly"),
  nextRun:    timestamp("next_run"),
  lastRun:    timestamp("last_run"),
  enabled:    boolean("enabled").notNull().default(true),
  orgId:      text("org_id").notNull().default("default"),
  createdAt:  timestamp("created_at").defaultNow(),
});

export const monitorsTable = pgTable("monitors", {
  id:           text("id").primaryKey(),
  orgId:        text("org_id").notNull().default("default"),
  name:         text("name").notNull(),
  url:          text("url").notNull(),
  status:       text("status").notNull().default("up"),
  uptime:       real("uptime").notNull().default(100),
  latency:      integer("latency").notNull().default(0),
  frequency:    text("frequency").notNull().default("5min"),
  alertEmail:   text("alert_email").notNull().default(""),
  alertPhone:   text("alert_phone").notNull().default(""),
  isCritical:   boolean("is_critical").notNull().default(false),
  lastCheck:    text("last_check"),
  lastAlertSent: timestamp("last_alert_sent"),
  createdAt:    timestamp("created_at").defaultNow(),
});

export const monitorChecksTable = pgTable("monitor_checks", {
  id:         text("id").primaryKey(),
  monitorId:  text("monitor_id").notNull(),
  orgId:      text("org_id").notNull().default("default"),
  checkedAt:  bigint("checked_at", { mode: "number" }).notNull(),
  ok:         boolean("ok").notNull(),
  latencyMs:  integer("latency_ms").default(0),
  statusCode: integer("status_code"),
  error:      text("error"),
});

export const monitorIncidentsTable = pgTable("monitor_incidents", {
  id:         text("id").primaryKey(),
  monitorId:  text("monitor_id").notNull(),
  orgId:      text("org_id").notNull().default("default"),
  startedAt:  timestamp("started_at").defaultNow(),
  resolvedAt: timestamp("resolved_at"),
  durationS:  integer("duration_s"),
  error:      text("error"),
});

export const reportsTable = pgTable("reports", {
  id:               text("id").primaryKey(),
  orgId:            text("org_id").notNull().default("default"),
  name:             text("name").notNull(),
  type:             text("type").notNull().default("PDF"),
  date:             text("date").notNull(),
  pages:            integer("pages").notNull().default(0),
  shared:           boolean("shared").notNull().default(false),
  auditId:          text("audit_id").default(""),
  whiteLabel:       boolean("white_label").notNull().default(false),
  pdfReady:         boolean("pdf_ready").notNull().default(false),
  meetingNotesJson: text("meeting_notes_json").default("[]"),
  dateStart:        text("date_start").default(""),
  dateEnd:          text("date_end").default(""),
  createdAt:        timestamp("created_at").defaultNow(),
});

export const shareTokensTable = pgTable("share_tokens", {
  id:        text("id").primaryKey(),
  token:     text("token").notNull(),
  type:      text("type").notNull().default("report"),
  targetId:  text("target_id").notNull(),
  orgId:     text("org_id").default("default"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const competitorsTable = pgTable("competitors", {
  id:          text("id").primaryKey(),
  name:        text("name").notNull(),
  url:         text("url").notNull(),
  domainRating: integer("domain_rating").notNull().default(0),
  keywords:    integer("keywords").notNull().default(0),
  traffic:     integer("traffic").notNull().default(0),
  threatLevel: text("threat_level").notNull().default("low"),
  delta:       integer("delta").default(0),
  orgId:       text("org_id").notNull().default("default"),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const trackedKeywordsTable = pgTable("tracked_keywords", {
  id:              text("id").primaryKey(),
  orgId:           text("org_id").notNull().default("default"),
  keyword:         text("keyword").notNull(),
  targetUrl:       text("target_url"),
  location:        text("location").notNull().default("France"),
  device:          text("device").notNull().default("desktop"),
  intent:          text("intent"),
  tag:             text("tag"),
  clusterId:       text("cluster_id"),
  active:          boolean("active").notNull().default(true),
  currentPosition: integer("current_position"),
  prevPosition:    integer("prev_position"),
  positionChange:  integer("position_change").default(0),
  searchVolume:    integer("search_volume").default(0),
  difficulty:      integer("difficulty").default(0),
  createdAt:       timestamp("created_at").defaultNow(),
});

export const alertRulesTable = pgTable("alert_rules", {
  id:          text("id").primaryKey(),
  orgId:       text("org_id").notNull().default("default"),
  name:        text("name").notNull(),
  type:        text("type").notNull(),
  operator:    text("operator").notNull().default("lt"),
  threshold:   real("threshold").notNull().default(0),
  durationMin: integer("duration_min").notNull().default(0),
  channels:    text("channels").notNull().default('["email"]'),
  siteUrls:    text("site_urls").notNull().default("[]"),
  enabled:     boolean("enabled").notNull().default(true),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const teamMembersTable = pgTable("team_members", {
  id:        text("id").primaryKey(),
  orgId:     text("org_id").notNull().default("default"),
  name:      text("name").notNull(),
  email:     text("email").notNull(),
  role:      text("role").notNull().default("viewer"),
  joined:    text("joined"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const teamMessagesTable = pgTable("team_messages", {
  id:         text("id").primaryKey(),
  orgId:      text("org_id").notNull().default("default"),
  content:    text("content").notNull(),
  senderId:   text("sender_id").notNull(),
  senderName: text("sender_name").notNull(),
  type:       text("type").default("text"),
  channel:    text("channel").default("general"),
  createdAt:  timestamp("created_at").defaultNow(),
});

export const notificationsTable = pgTable("notifications", {
  id:        text("id").primaryKey(),
  orgId:     text("org_id").notNull().default("default"),
  type:      text("type").notNull().default("info"),
  title:     text("title").notNull(),
  message:   text("message").notNull(),
  read:      boolean("read").notNull().default(false),
  link:      text("link"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const connectorsTable = pgTable("connectors", {
  id:           text("id").primaryKey(),
  orgId:        text("org_id").notNull().default("default"),
  provider:     text("provider").notNull(),
  status:       text("status").notNull().default("disconnected"),
  connected:    boolean("connected").notNull().default(false),
  accessToken:  text("access_token"),
  refreshToken: text("refresh_token"),
  webhookSecret: text("webhook_secret"),
  config:       text("config").default("{}"),
  lastSync:     text("last_sync"),
  syncStatus:   text("sync_status"),
  createdAt:    timestamp("created_at").defaultNow(),
});

export const automationWorkflowsTable = pgTable("automation_workflows", {
  id:            text("id").primaryKey(),
  orgId:         text("org_id").notNull().default("default"),
  name:          text("name").notNull(),
  icon:          text("icon").default("⚡"),
  description:   text("description"),
  triggerType:   text("trigger_type").notNull(),
  triggerConfig: jsonb("trigger_config").default({}),
  actions:       jsonb("actions").default([]),
  enabled:       boolean("enabled").notNull().default(true),
  runsCount:     integer("runs_count").notNull().default(0),
  category:      text("category").default("general"),
  updatedAt:     timestamp("updated_at").defaultNow(),
  createdAt:     timestamp("created_at").defaultNow(),
});

export const workflowRunsTable = pgTable("workflow_runs", {
  id:          text("id").primaryKey(),
  orgId:       text("org_id").notNull().default("default"),
  workflowId:  text("workflow_id").notNull(),
  status:      text("status").notNull().default("pending"),
  startedAt:   timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
  error:       text("error"),
  output:      jsonb("output"),
});

export const orgAddonsTable = pgTable("org_addons", {
  id:          text("id").primaryKey(),
  orgId:       text("org_id").notNull().default("default"),
  addonKey:    text("addon_key").notNull(),
  active:      boolean("active").notNull().default(false),
  activatedAt: timestamp("activated_at"),
  metadata:    jsonb("metadata").default({}),
  updatedAt:   timestamp("updated_at").defaultNow(),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const behaviorEventsTable = pgTable("behavior_events", {
  id:          text("id").primaryKey(),
  sessionId:   text("session_id").notNull(),
  siteUrl:     text("site_url").notNull(),
  page:        text("page").notNull(),
  eventType:   text("event_type").notNull(),
  element:     text("element"),
  xPos:        integer("x_pos"),
  yPos:        integer("y_pos"),
  scrollDepth: integer("scroll_depth"),
  timeOnPage:  integer("time_on_page"),
  metadata:    jsonb("metadata"),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const behaviorSessionsTable = pgTable("behavior_sessions", {
  id:              text("id").primaryKey(),
  siteUrl:         text("site_url").notNull(),
  userAgent:       text("user_agent"),
  deviceType:      text("device_type").default("desktop"),
  country:         text("country"),
  pageViews:       integer("page_views").notNull().default(1),
  bounce:          boolean("bounce").notNull().default(true),
  engagementScore: integer("engagement_score").notNull().default(0),
  rageClicks:      integer("rage_clicks").notNull().default(0),
  createdAt:       timestamp("created_at").defaultNow(),
});

export const behaviorInsightsTable = pgTable("behavior_insights", {
  id:             text("id").primaryKey(),
  siteUrl:        text("site_url").notNull(),
  insightType:    text("insight_type").notNull(),
  severity:       text("severity").notNull().default("medium"),
  title:          text("title").notNull(),
  description:    text("description").notNull(),
  affectedPages:  jsonb("affected_pages").default([]),
  estimatedImpact: text("estimated_impact"),
  aiSuggestion:   text("ai_suggestion"),
  createdAt:      timestamp("created_at").defaultNow(),
});

export const behaviorSiteTokensTable = pgTable("behavior_site_tokens", {
  id:         text("id").primaryKey(),
  siteUrl:    text("site_url").notNull(),
  tokenHash:  text("token_hash").notNull(),
  siteSecret: text("site_secret").notNull(),
  orgId:      text("org_id").default("default"),
  active:     boolean("active").notNull().default(true),
  createdAt:  timestamp("created_at").defaultNow(),
});

export const croRecommendationsTable = pgTable("cro_recommendations", {
  id:              text("id").primaryKey(),
  siteUrl:         text("site_url").notNull(),
  page:            text("page").notNull(),
  type:            text("type").notNull(),
  priority:        text("priority").notNull().default("medium"),
  title:           text("title").notNull(),
  description:     text("description"),
  implementation:  text("implementation"),
  estimatedUplift: real("estimated_uplift").default(0),
  status:          text("status").notNull().default("pending"),
  aiGenerated:     text("ai_generated").default("false"),
  metadata:        jsonb("metadata").default({}),
  createdAt:       timestamp("created_at").defaultNow(),
});

export const croScoresTable = pgTable("cro_scores", {
  id:           text("id").primaryKey(),
  siteUrl:      text("site_url").notNull(),
  page:         text("page").notNull(),
  score:        integer("score").notNull().default(50),
  frictionScore: integer("friction_score").default(50),
  ctaScore:     integer("cta_score").default(50),
  formScore:    integer("form_score").default(50),
  mobileScore:  integer("mobile_score").default(50),
  copyScore:    integer("copy_score").default(50),
  updatedAt:    timestamp("updated_at").defaultNow(),
});

export const croExperimentsTable = pgTable("cro_experiments", {
  id:             text("id").primaryKey(),
  siteUrl:        text("site_url").notNull(),
  page:           text("page").notNull(),
  name:           text("name").notNull(),
  type:           text("type").default("a_b"),
  status:         text("status").notNull().default("draft"),
  controlVariant: jsonb("control_variant").default({}),
  testVariant:    jsonb("test_variant").default({}),
  winner:         text("winner"),
  startedAt:      timestamp("started_at"),
  endedAt:        timestamp("ended_at"),
  createdAt:      timestamp("created_at").defaultNow(),
});

export const revenueLeaksTable = pgTable("revenue_leaks", {
  id:           text("id").primaryKey(),
  siteUrl:      text("site_url"),
  type:         text("type").notNull().default("conversion"),
  title:        text("title").notNull(),
  description:  text("description"),
  severity:     text("severity").notNull().default("medium"),
  estimatedLoss: real("estimated_loss").default(0),
  status:       text("status").notNull().default("active"),
  resolvedAt:   timestamp("resolved_at"),
  createdAt:    timestamp("created_at").defaultNow(),
});

export const reportTemplatesTable = pgTable("report_templates", {
  id:                    text("id").primaryKey(),
  orgId:                 text("org_id").notNull().default("default"),
  name:                  text("name").notNull(),
  logoUrl:               text("logo_url"),
  primaryColor:          text("primary_color").default("#2563EB"),
  secondaryColor:        text("secondary_color").default("#22c55e"),
  font:                  text("font").default("Inter"),
  footerText:            text("footer_text"),
  headerText:            text("header_text"),
  hideFlowpointBranding: boolean("hide_flowpoint_branding").default(false),
  isDefault:             boolean("is_default").default(false),
  updatedAt:             timestamp("updated_at").defaultNow(),
  createdAt:             timestamp("created_at").defaultNow(),
});

export const customDomainsTable = pgTable("custom_domains", {
  id:                text("id").primaryKey(),
  orgId:             text("org_id").notNull().default("default"),
  domain:            text("domain").notNull(),
  status:            text("status").notNull().default("pending"),
  verificationToken: text("verification_token"),
  sslStatus:         text("ssl_status").default("pending"),
  verifiedAt:        timestamp("verified_at"),
  createdAt:         timestamp("created_at").defaultNow(),
});

export const reportExportsTable = pgTable("report_exports", {
  id:        text("id").primaryKey(),
  reportId:  text("report_id").notNull(),
  orgId:     text("org_id").default("default"),
  format:    text("format").notNull().default("pdf"),
  url:       text("url"),
  size:      integer("size").default(0),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiUsageLogsTable = pgTable("ai_usage_logs", {
  id:          text("id").primaryKey(),
  orgId:       text("org_id").notNull().default("default"),
  userId:      text("user_id"),
  feature:     text("feature").notNull(),
  model:       text("model").notNull().default("gpt-5-mini"),
  tokensUsed:  integer("tokens_used").notNull().default(0),
  creditsUsed: integer("credits_used").notNull().default(0),
  costEur:     real("cost_eur").notNull().default(0),
  metadata:    jsonb("metadata").default({}),
  createdAt:   timestamp("created_at").defaultNow(),
});

export const aiMonthlyUsageTable = pgTable("ai_monthly_usage", {
  id:           text("id").primaryKey(),
  orgId:        text("org_id").notNull().default("default"),
  month:        text("month").notNull(),
  creditsUsed:  integer("credits_used").notNull().default(0),
  creditsLimit: integer("credits_limit").notNull().default(100000),
  creditsExtra: integer("credits_extra").notNull().default(0),
  costEur:      real("cost_eur").notNull().default(0),
  requestCount: integer("request_count").notNull().default(0),
  tokensUsed:   integer("tokens_used").notNull().default(0),
});

export const aiAlertsTable = pgTable("ai_alerts", {
  id:        text("id").primaryKey(),
  orgId:     text("org_id").notNull().default("default"),
  type:      text("type").notNull().default("usage_warning"),
  title:     text("title").notNull(),
  message:   text("message").notNull(),
  severity:  text("severity").notNull().default("warning"),
  read:      boolean("read").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Auth tables ───────────────────────────────────────────────────────────────

export const magicLinkTokensTable = pgTable("magic_link_tokens", {
  token:     text("token").primaryKey(),
  email:     text("email").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  used:      boolean("used").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const userSessionsTable = pgTable("user_sessions", {
  token:     text("token").primaryKey(),
  userId:    text("user_id").notNull(),
  orgId:     text("org_id").notNull().default("default"),
  email:     text("email").notNull(),
  role:      text("role").notNull().default("member"),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ── Drizzle instance ──────────────────────────────────────────────────────────

const schema = {
  auditsTable, auditSchedulesTable,
  monitorsTable, monitorChecksTable, monitorIncidentsTable,
  reportsTable, shareTokensTable,
  competitorsTable, trackedKeywordsTable,
  alertRulesTable,
  teamMembersTable, teamMessagesTable,
  notificationsTable, connectorsTable,
  automationWorkflowsTable, workflowRunsTable,
  orgAddonsTable,
  behaviorEventsTable, behaviorSessionsTable, behaviorInsightsTable, behaviorSiteTokensTable,
  croRecommendationsTable, croScoresTable, croExperimentsTable,
  revenueLeaksTable,
  reportTemplatesTable, customDomainsTable, reportExportsTable,
  aiUsageLogsTable, aiMonthlyUsageTable, aiAlertsTable,
  magicLinkTokensTable, userSessionsTable,
};

export const db = drizzle(pool, { schema });

// ── Missions tables (raw SQL — déclarées ici pour référence de schéma) ────────
// Ces tables sont créées via migration dans init-missions.ts

export const missionsSchemaRef = {
  missions: "missions",
  missionHistory: "mission_history",
  missionAiLogs: "mission_ai_logs",
};

// ── RLS-scoped query helper ───────────────────────────────────────────────────
//
// Runs `callback` inside a short transaction that:
//   1. Drops to app_user role  → disables BYPASSRLS so policies are evaluated
//   2. Sets the app.current_org_id GUC  → all rls_org_isolation policies filter
//      rows to this org automatically.
//
// Usage in route handlers:
//   const result = await withOrgDb(req.orgId, client => client.query(sql, params));
//
// The postgres superuser connection (pool) is still used for background tasks
// (migrations, async PSI updates) that are not tenant-scoped reads.

import type { PoolClient } from "pg";

// Populated once at server startup by probeAppUserRole().
// When true, withOrgDb() never attempts SET LOCAL ROLE — it only sets the GUC.
let _appUserRoleUnavailable = false;

/**
 * Run ONCE at server startup (outside any transaction) to test whether the
 * database connection user has permission to SET ROLE app_user.
 *
 * Using a plain session-level SET ROLE (no BEGIN) means a failure throws a
 * normal exception with no transaction to abort — safe to catch and ignore.
 *
 * After this runs, withOrgDb() will never attempt the role switch when it
 * would fail, preventing "current transaction is aborted" errors.
 */
export async function probeAppUserRole(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SET ROLE app_user");
    await client.query("RESET ROLE");
    // Role is available — _appUserRoleUnavailable stays false.
  } catch {
    _appUserRoleUnavailable = true;
    console.warn(
      "[withOrgDb] app_user role not available — GUC-only RLS mode.",
      "Fix: GRANT app_user TO <db-connection-user>;",
    );
  } finally {
    client.release();
  }
}

export async function withOrgDb<T>(
  orgId: string,
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Drop to app_user role so BYPASSRLS is inactive and RLS policies are evaluated.
    // Skipped when probeAppUserRole() determined the role is not grantable (Supabase,
    // managed DBs). In that case tenant isolation relies solely on the GUC below.
    if (!_appUserRoleUnavailable) {
      try {
        await client.query("SET LOCAL ROLE app_user");
      } catch (roleErr) {
        _appUserRoleUnavailable = true;
        console.warn(
          "[withOrgDb] SET LOCAL ROLE app_user failed — recovering transaction, GUC-only RLS mode.",
          "Fix: GRANT app_user TO <db-connection-user>;",
          (roleErr as Error).message,
        );
        // A failed command inside a transaction puts it in aborted state.
        // ROLLBACK + fresh BEGIN so the GUC and callback queries can proceed.
        await client.query("ROLLBACK");
        await client.query("BEGIN");
      }
    }

    // SET does not accept $N parameters — escape the value as a SQL literal.
    const safeOrgId = orgId.replace(/'/g, "''");
    await client.query(`SET LOCAL "app.current_org_id" = '${safeOrgId}'`);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
