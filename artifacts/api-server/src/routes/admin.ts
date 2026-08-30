
    for (const orgId of orgIds) {
      for (const table of orgTables) {
        if (!existingSet.has(table)) continue;
        // org_id::text handles both TEXT and UUID columns — avoids "invalid input syntax for uuid"
        // when a legacy email-shaped orgId is compared against a UUID-typed org_id column.
        const r = await client.query(`DELETE FROM ${table} WHERE org_id::text = $1`, [orgId]);
        if ((r.rowCount ?? 0) > 0) deleted[table] = (deleted[table] ?? 0) + (r.rowCount ?? 0);
      }
      // Cast UUID orgId for organizations table
      await client.query(`DELETE FROM organizations WHERE id::text = $1`, [orgId]);
      await client.query(`DELETE FROM org_settings WHERE org_id = $1`, [orgId]);
    }

    // Email-keyed tables
    await client.query(`DELETE FROM pending_signups   WHERE lower(email) = $1`, [normalizedEmail]);
    await client.query(`DELETE FROM magic_link_tokens WHERE lower(email) = $1`, [normalizedEmail]);

    // Auth tables (users + membership)
    await client.query(
      `DELETE FROM organization_members
       WHERE user_id IN (SELECT id FROM users WHERE lower(email) = $1)`,
      [normalizedEmail]
    );
    const usersResult = await client.query(`DELETE FROM users WHERE lower(email) = $1`, [normalizedEmail]);

    await client.query("COMMIT");

    res.json({
      ok: true,
      email: normalizedEmail,
      orgIdsPurged: orgIds,
      usersDeleted: usersResult.rowCount ?? 0,
      tableDeleted: deleted,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});

// ── POST /api/admin/purge-ghost-accounts ─────────────────────────────────────
// Finds and permanently removes every "ghost" account that survived a failed
// deletion (the bug: email=null caused org_settings + magic_link_tokens cleanup
// to be skipped, leaving rows that allow re-login via the S3-legacy path).
//
// Categories purged:
//   1. Email-keyed org_settings (org_id looks like an email) with no matching
//      active user or organization.
//   2. magic_link_tokens for emails with no matching users row.
//   3. pending_signups for emails with no matching users row.
//
// Usage (dry-run — default, safe to call any time):
//   POST /api/admin/purge-ghost-accounts
//   x-admin-key: <ADMIN_KEY>
//   Content-Type: application/json
//   {}
//
// Usage (execute — actually deletes):
//   POST /api/admin/purge-ghost-accounts
//   { "dry_run": false }
//
// Returns a full report of what was (or would be) deleted.
router.post("/admin/purge-ghost-accounts", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const dry_run = (req.body as { dry_run?: boolean })?.dry_run !== false; // default true
  const client = await pool.connect();

  try {
    // ── 1. Discover ghost email-keyed org_settings ───────────────────────────
    // These are rows where org_id contains '@' (legacy email key) but no
    // matching users.email or organizations.owner_email exists.
    const ghostOrgSettings = await client.query<{ ghost_email: string; os_created: string }>(`
      SELECT os.org_id::text AS ghost_email, os.created_at::date::text AS os_created
      FROM org_settings os
      WHERE os.org_id::text LIKE '%@%'
        AND NOT EXISTS (
          SELECT 1 FROM users u WHERE lower(u.email) = lower(os.org_id::text)
        )
        AND NOT EXISTS (
          SELECT 1 FROM organizations o WHERE lower(o.owner_email) = lower(os.org_id::text)
        )
      ORDER BY os.created_at
    `);

    // ── 2. Orphaned magic_link_tokens ────────────────────────────────────────
    const ghostTokens = await client.query<{ email: string; expires_at: string; used: boolean }>(`
      SELECT mlt.email, mlt.expires_at::text, mlt.used
      FROM magic_link_tokens mlt
      WHERE mlt.email IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(mlt.email))
      ORDER BY mlt.expires_at DESC
    `);

    // ── 3. Orphaned pending_signups ──────────────────────────────────────────
    const ghostPending = await client.query<{ email: string; created_at: string }>(`
      SELECT ps.email, ps.created_at::date::text
      FROM pending_signups ps
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(ps.email))
      ORDER BY ps.created_at
    `);

    const report = {
      dry_run,
      ghost_org_settings:  ghostOrgSettings.rows,
      ghost_tokens:        ghostTokens.rows,
      ghost_pending_signups: ghostPending.rows,
      summary: {
        org_settings_to_delete:    ghostOrgSettings.rowCount ?? 0,
        magic_link_tokens_to_delete: ghostTokens.rowCount ?? 0,
        pending_signups_to_delete: ghostPending.rowCount ?? 0,
      },
    };

    if (dry_run) {
      res.json({ ok: true, ...report, message: "Dry-run — nothing deleted. Pass dry_run:false to execute." });
      return;
    }

    // ── Execute deletions ────────────────────────────────────────────────────
    await client.query("BEGIN");

    // 1. Ghost org_settings (email-keyed)
    const delOrgSettings = await client.query(`
      DELETE FROM org_settings
      WHERE org_id::text LIKE '%@%'
        AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(org_settings.org_id::text))
        AND NOT EXISTS (SELECT 1 FROM organizations o WHERE lower(o.owner_email) = lower(org_settings.org_id::text))
    `) as unknown as { rowCount: number };

    // 2. Orphaned magic_link_tokens
    const delTokens = await client.query(`
      DELETE FROM magic_link_tokens
      WHERE email IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(magic_link_tokens.email))
    `) as unknown as { rowCount: number };

    // 3. Orphaned pending_signups
    const delPending = await client.query(`
      DELETE FROM pending_signups
      WHERE NOT EXISTS (SELECT 1 FROM users u WHERE lower(u.email) = lower(pending_signups.email))
    `) as unknown as { rowCount: number };

    await client.query("COMMIT");

    res.json({
      ok: true,
      dry_run: false,
      deleted: {
        org_settings:    delOrgSettings.rowCount ?? 0,
        magic_link_tokens: delTokens.rowCount ?? 0,
        pending_signups: delPending.rowCount ?? 0,
      },
      ghost_org_settings:    report.ghost_org_settings,
      ghost_tokens:          report.ghost_tokens,
      ghost_pending_signups: report.ghost_pending_signups,
      message: "Ghost accounts permanently deleted.",
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});

// ── POST /api/admin/purge-all-clients ────────────────────────────────────────
// ⚠️  TEMPORARY ROUTE — delete this entire endpoint once the initial purge
//     has been verified in production. Do not leave it deployed permanently.
//
// Permanently deletes ALL client accounts except the listed exempt emails.
// MUST be called with dry_run:true (or omitted) first to preview impact.
// Auth: x-admin-key header required; ADMIN_KEY must be ≥ 32 chars.
//
// Rate limits: 1 dry-run/min · 1 real purge/4h.
// ⚠️  Rate limiter is IN-PROCESS ONLY — not effective across multiple instances.
//     Treat as a last-resort filet de sécurité, not a distributed guard.
// All calls (including dry-runs) are logged to stdout as structured JSON.

// In-process rate limiter (per-bucket, separate for dry vs real).
const _purgeRateBucket = new Map<string, { count: number; firstAt: number }>();

function checkPurgeRate(isDryRun: boolean): { allowed: boolean; retryAfterSec: number } {
  const windowMs = isDryRun ? 60_000 : 4 * 3_600_000; // 1 min / 4 h
  const key      = isDryRun ? "purge:dry" : "purge:real";
  const now      = Date.now();
  const existing = _purgeRateBucket.get(key);
  if (!existing || now - existing.firstAt >= windowMs) {
    _purgeRateBucket.set(key, { count: 1, firstAt: now });
    return { allowed: true, retryAfterSec: 0 };
  }
  existing.count++;
  return {
    allowed: existing.count <= 1,
    retryAfterSec: Math.ceil((windowMs - (now - existing.firstAt)) / 1000),
  };
}

// System emails ALWAYS exempt — caller cannot override this list.
// qa@flowpoint.pro is the permanent Browser Use / automated-test account.
// It MUST survive every purge; never remove it from this list.
const PURGE_SYSTEM_EMAILS = ["support@flowpoint.pro", "qa@flowpoint.pro"];

type StripeCustomerPurgePlan = {
  configured: boolean;
  customerIds: string[];
  customersFound: number;
  customersExempted: number;
  liveSubscriptionsFound: number;
  note?: string;
};

type StripeCustomerPurgeResult = StripeCustomerPurgePlan & {
  subscriptionsCanceled: number;
  customersDeleted: number;
};

function stripeErrorCode(err: unknown): string | undefined {
  return (err as { code?: string })?.code ?? (err as { raw?: { code?: string } })?.raw?.code;
}

/**
 * Stripe is an independent account layer: DB deletion alone never removes
 * customers or future billing. This plan is intentionally read-only and is
 * returned by the mandatory dry-run before a global purge can execute.
 */
export async function planStripeCustomerPurge(
  exemptEmails: string[],
  injectedStripe?: any,
): Promise<StripeCustomerPurgePlan> {
  const { getStripeKey, createStripeClient } = await import("../services/stripe-factory.js");
  const key = getStripeKey();
  if (!injectedStripe && !key) {
    return {
      configured: false, customerIds: [], customersFound: 0, customersExempted: 0,
      liveSubscriptionsFound: 0, note: "Stripe is not configured in this environment.",
    };
  }
  const stripe = injectedStripe ?? await createStripeClient(key);
  const exempt = new Set(exemptEmails.map((email) => email.trim().toLowerCase()));
  const customerIds: string[] = [];
  let customersFound = 0;
  let customersExempted = 0;
  let cursor: string | undefined;

  do {
    const page = await stripe.customers.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    for (const customer of page.data as Array<{ id: string; email?: string | null }>) {
      customersFound++;
      if (customer.email && exempt.has(customer.email.trim().toLowerCase())) {
        customersExempted++;
      } else {
        customerIds.push(customer.id);
      }
    }
    cursor = page.has_more ? page.data.at(-1)?.id : undefined;
  } while (cursor);

  let liveSubscriptionsFound = 0;
  for (const customerId of customerIds) {
    let subscriptionCursor: string | undefined;
    do {
      const page = await stripe.subscriptions.list({
        customer: customerId, status: "all", limit: 100,
        ...(subscriptionCursor ? { starting_after: subscriptionCursor } : {}),
      });
      liveSubscriptionsFound += page.data.filter((sub: { status: string }) => sub.status !== "canceled").length;
      subscriptionCursor = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (subscriptionCursor);
  }

  return {
    configured: true, customerIds, customersFound, customersExempted, liveSubscriptionsFound,
  };
}

/**
 * Runs before the database transaction. If any Stripe request other than an
 * idempotent resource_missing error fails, the caller must not remove DB data.
 */
export async function executeStripeCustomerPurge(
  plan: StripeCustomerPurgePlan,
  injectedStripe?: any,
): Promise<StripeCustomerPurgeResult> {
  if (!plan.configured) {
    throw new Error(plan.note ?? "Stripe is not configured.");
  }
  const { getStripeKey, createStripeClient } = await import("../services/stripe-factory.js");
  const stripe = injectedStripe ?? await createStripeClient(getStripeKey());
  let subscriptionsCanceled = 0;
  let customersDeleted = 0;

  for (const customerId of plan.customerIds) {
    let cursor: string | undefined;
    do {
      const page = await stripe.subscriptions.list({
        customer: customerId, status: "all", limit: 100,
        ...(cursor ? { starting_after: cursor } : {}),
      });
      for (const subscription of page.data as Array<{ id: string; status: string }>) {
        if (subscription.status !== "canceled") {
          await stripe.subscriptions.cancel(subscription.id);
          subscriptionsCanceled++;
        }
      }
      cursor = page.has_more ? page.data.at(-1)?.id : undefined;
    } while (cursor);

    try {
      await stripe.customers.del(customerId);
      customersDeleted++;
    } catch (err) {
      if (stripeErrorCode(err) !== "resource_missing") throw err;
      // Idempotent retry: an already-removed customer is clean.
      customersDeleted++;
    }
  }

  return { ...plan, subscriptionsCanceled, customersDeleted };
}

// In-process concurrent purge guard.
// ⚠️  IN-PROCESS ONLY — in a multi-instance deployment a second pod can still
//    start a concurrent purge. Use a DB advisory lock for stronger isolation.
let _purgeInFlight = false;

router.post("/admin/purge-all-clients", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const { dry_run, exempt_emails = [] } = req.body as { dry_run?: unknown; exempt_emails?: string[] };

  // Explicit boolean `false` is the ONLY value that triggers a real purge.
  // Strings like "false", null, undefined, omitted field → treated as dry_run:true.
  const isDryRun = dry_run !== false;

  // Concurrent-execution guard (real purge only).
  if (!isDryRun && _purgeInFlight) {
    res.status(409).json({
      ok: false,
      error: "A real purge is already in progress on this instance — retry after it completes.",
    });
    return;
  }

  // Per-bucket rate limit.
  const rateCheck = checkPurgeRate(isDryRun);
  if (!rateCheck.allowed) {
    res.status(429).json({ ok: false, error: `Rate limited — retry after ${rateCheck.retryAfterSec}s` });
    return;
  }

  // Mandatory structured audit log — every call, including dry-runs.
  const callerIp =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim() ||
    req.socket.remoteAddress ||
    "unknown";
  const callId = `purge_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  console.warn(JSON.stringify({
    event: "ADMIN_PURGE_CALLED",
    callId,
    dry_run: isDryRun,
    ip: callerIp,
    ts: new Date().toISOString(),
    pid: process.pid,
    caller_exempt_count: Array.isArray(exempt_emails) ? exempt_emails.length : 0,
  }));

  // System emails merged unconditionally — caller cannot remove them.
  const userExempt = Array.isArray(exempt_emails)
    ? exempt_emails.map((e: string) => e.trim().toLowerCase()).filter(Boolean)
    : [];
  const normalizedExempt = [...new Set([...PURGE_SYSTEM_EMAILS, ...userExempt])];

  const client = await pool.connect();
  try {
    // ── Discover accounts to delete ───────────────────────────────────────────
    const usersToDelete = await client.query<{ email: string }>(
      `SELECT DISTINCT email FROM users
       WHERE email IS NOT NULL
         AND lower(email) <> ALL($1::text[])
       UNION
       SELECT DISTINCT lower(o.owner_email) AS email
       FROM organizations o
       WHERE o.owner_email IS NOT NULL
         AND lower(o.owner_email) <> ALL($1::text[])
       ORDER BY email`,
      [normalizedExempt]
    );
    const emailsToDelete = usersToDelete.rows.map(r => r.email);

    const orgsToDelete = await client.query<{ id: string }>(
      `SELECT DISTINCT o.id FROM organizations o
       WHERE lower(o.owner_email) <> ALL($1::text[])
          OR o.owner_email IS NULL`,
      [normalizedExempt]
    );
    const orgIdsToDelete = orgsToDelete.rows.map(r => r.id);
    const stripePlan = await planStripeCustomerPurge(normalizedExempt);

    // ── DRY-RUN: full impact report, zero deletions ───────────────────────────
    if (isDryRun) {
      const safeCount = async (sql: string, params: unknown[]): Promise<number> => {
        try {
          const r = await client.query<{ n: string }>(sql, params);
          return parseInt(r.rows[0]?.n ?? "0", 10);
        } catch { return -1; /* table may not exist */ }
      };

      // Auth-level rows (keyed by email)
      const [sessCount, tokenCount, pendingCount, inviteCount, legacyOsCount] =
        await Promise.all([
          emailsToDelete.length > 0
            ? safeCount(`SELECT COUNT(*)::text AS n FROM user_sessions      WHERE lower(email) = ANY($1)`, [emailsToDelete])
            : 0,
          emailsToDelete.length > 0
            ? safeCount(`SELECT COUNT(*)::text AS n FROM magic_link_tokens  WHERE lower(email) = ANY($1)`, [emailsToDelete])
            : 0,
          emailsToDelete.length > 0
            ? safeCount(`SELECT COUNT(*)::text AS n FROM pending_signups    WHERE lower(email) = ANY($1)`, [emailsToDelete])
            : 0,
          // team_invitations is the correct table name (invitations does not exist)
          emailsToDelete.length > 0
            ? safeCount(`SELECT COUNT(*)::text AS n FROM team_invitations   WHERE lower(email) = ANY($1)`, [emailsToDelete])
            : 0,
          safeCount(
            `SELECT COUNT(*)::text AS n FROM org_settings
             WHERE org_id::text = ANY($1)`,
            [[...emailsToDelete, ...orgIdsToDelete]]
          ),
        ]);

      // Business data counts per org-scoped table (parallel).
      // List is verified against information_schema + Supabase REST API.
      // Tables confirmed absent from production are excluded (no 404 noise).
      const BUSINESS_TABLES = [
        // Core audits / performance
        "audits","audit_schedules","audit_trail",
        "pagespeed_history","pagespeed_results",
        // Monitors / uptime
        "monitors","monitor_checks","monitor_incidents","monitor_logs",
        // Alerts
        "alert_rules","alert_events","ranking_alerts",
        // Keywords / SEO
        "tracked_keywords","keyword_clusters","keyword_history","keyword_opportunities",
        "seo_forecasts","gsc_sites","ga4_properties",
        // Missions
        "missions","mission_history","mission_ai_logs",
        "ai_generated_missions","ai_setup_logs","ai_recommendations",
        "mission_impact_scores","mission_priorities","mission_templates",
        // Reports
        "reports","report_exports","report_templates",
        // Calendar
        "calendar_events",
        // Team
        "team_members","team_invitations","team_messages","team_files","team_channels",
        // Automation
        "automation_integrations","automation_workflows","automation_runs",
        "automation_logs","automation_templates","workflow_runs","incoming_webhooks",
        // Google / OAuth
        "google_tokens","google_oauth_states","google_accounts",
        "google_locations","google_reviews","google_product_connections",
        // GitHub
        "github_connections",
        // Competitors
        "competitors","competitor_map_results","competitor_movements","competitor_rankings",
        // Funnels / growth
        "funnels","funnel_steps","growth_objectives","seo_forecasts","share_tokens",
        // Org config & billing
        "org_addons","org_checklist","org_secrets","org_auth_config","subscriptions",
        "org_member_permissions","sso_providers",
        // Checkout & tokens
        "checkout_post_tokens","overview_insights_cache","overview_insights_rl",
        // AI
        "ai_usage_logs","ai_monthly_usage","ai_credit_purchases",
        "ai_chat_history","ai_action_logs","ai_action_proposals",
        "ai_autopilot_grants","ai_usage_pending_writes","ai_workspace_profiles",
        "ai_market_reports","ai_review_replies",
        // User activity & notifications
        "activity_logs","notifications","user_prefs","user_activity_days",
        "login_audits","permission_logs","access_audits",
        // Onboarding
        "onboarding_sessions",
        // Other business data
        "local_pack_history","local_heatmaps","industry_signals",
        "connectors","dataforseo_quota","reviews","roles",
        "market_opportunities","market_trends","usage_events",
        "gbp_locations","gbp_posts",
      ] as const;

      const businessCounts: Record<string, number> = {};
      if (orgIdsToDelete.length > 0) {
        await Promise.all(
          BUSINESS_TABLES.map(async (tbl) => {
            businessCounts[tbl] = await safeCount(
              `SELECT COUNT(*)::text AS n FROM ${tbl} WHERE org_id::text = ANY($1)`,
              [orgIdsToDelete]
            );
          })
        );
      }

      // What will survive after the purge
      const survivingUsers = await client.query<{ email: string }>(
        `SELECT email FROM users WHERE lower(email) = ANY($1) ORDER BY email`,
        [normalizedExempt]
      );

      res.json({
        ok: true,
        dry_run: true,
        callId,
        would_delete: {
          users:         { count: emailsToDelete.length, emails: emailsToDelete },
          organizations: { count: orgIdsToDelete.length, ids: orgIdsToDelete },
          auth: {
            user_sessions:     sessCount,
            magic_link_tokens: tokenCount,
            pending_signups:   pendingCount,
            invitations:       inviteCount,
          },
          org_settings_legacy: legacyOsCount,
          stripe: {
            configured: stripePlan.configured,
            customers: stripePlan.customerIds.length,
            customers_exempted: stripePlan.customersExempted,
            live_subscriptions: stripePlan.liveSubscriptionsFound,
            note: stripePlan.note ?? null,
          },
          // business_data shows only non-zero tables for readability
          business_data: Object.fromEntries(
            Object.entries(businessCounts).filter(([, v]) => v > 0)
          ),
          // full table list including zeros (for verification)
          business_data_full: businessCounts,
        },
        would_survive: {
          user_count: survivingUsers.rowCount ?? 0,
          emails: survivingUsers.rows.map(r => r.email),
        },
        exempt: normalizedExempt,
        message: "Dry-run — nothing deleted. POST with dry_run:false (boolean) to execute.",
      });
      return;
    }

    // ── REAL PURGE ────────────────────────────────────────────────────────────
    _purgeInFlight = true;
    try {
      if (emailsToDelete.length === 0 && orgIdsToDelete.length === 0 && stripePlan.customerIds.length === 0) {
        res.json({ ok: true, deleted: {}, callId, message: "Nothing to delete — all accounts and Stripe customers are exempt." });
        return;
      }
      if (!stripePlan.configured) {
        res.status(503).json({
          ok: false,
          error: "Stripe is not configured; refusing to purge database accounts while billing records may remain.",
        });
        return;
      }

      console.warn(JSON.stringify({
        event: "ADMIN_PURGE_EXECUTING",
        callId,
        email_count: emailsToDelete.length,
        org_count:   orgIdsToDelete.length,
        stripe_customers_to_delete: stripePlan.customerIds.length,
        stripe_live_subscriptions_to_cancel: stripePlan.liveSubscriptionsFound,
        ts: new Date().toISOString(),
      }));

      // Stripe is an independent system and must be cleaned before the DB
      // transaction. A Stripe failure aborts here, leaving all FlowPoint rows
      // intact and allowing an idempotent retry.
      const stripeDeleted = await executeStripeCustomerPurge(stripePlan);

      await client.query("BEGIN");

      const deleted: Record<string, number> = {};
      const safeDelete = async (table: string, col: string, vals: string[]) => {
        if (!vals.length) { deleted[table] = 0; return; }
        const r = await client.query(`DELETE FROM ${table} WHERE ${col} = ANY($1)`, [vals]);
        deleted[table] = r.rowCount ?? 0;
      };
      const safeDeleteUUID = async (table: string, col: string, vals: string[]) => {
        if (!vals.length) { deleted[table] = 0; return; }
        const r = await client.query(`DELETE FROM ${table} WHERE ${col}::text = ANY($1)`, [vals]);
        deleted[table] = r.rowCount ?? 0;
      };

      // Sessions & tokens (by email)
      // Sessions & tokens (by email)
      await safeDelete("user_sessions",     "lower(email)", emailsToDelete);
      await safeDelete("magic_link_tokens", "lower(email)", emailsToDelete);
      await safeDelete("pending_signups",   "lower(email)", emailsToDelete);
      // team_invitations is the correct table name — `invitations` does not exist
      await safeDelete("team_invitations",  "lower(email)", emailsToDelete);

      // Org-scoped business data (by org_id UUID).
      // Verified against information_schema + Supabase REST API.
      // Absent tables (psi_cache, tracked_keywords_history, etc.) are excluded;
      // .catch() swallows errors for any that were provisioned after this list was built.
      for (const tbl of [
        // Core audits / performance
        "audits","audit_schedules","audit_trail","pagespeed_history","pagespeed_results",
        // Monitors
        "monitors","monitor_checks","monitor_incidents","monitor_logs",
        // Alerts & keywords
        "alert_rules","alert_events","ranking_alerts",
        "tracked_keywords","keyword_clusters","keyword_history","keyword_opportunities",
        // Missions
        "missions","mission_history","mission_ai_logs",
        "ai_generated_missions","ai_setup_logs","ai_recommendations",
        "mission_impact_scores","mission_priorities","mission_templates",
        // Reports
        "reports","report_exports","report_templates",
        // Calendar
        "calendar_events",
        // Team
        "team_members","team_messages","team_files","team_channels",
        // Automation
        "automation_integrations","automation_workflows","automation_runs",
        "automation_logs","automation_templates","workflow_runs","incoming_webhooks",
        // Google / OAuth
        "google_tokens","google_oauth_states","google_accounts",
        "google_locations","google_reviews","google_product_connections",
        // GitHub
        "github_connections",
        // Competitors
        "competitors","competitor_map_results","competitor_movements","competitor_rankings",
        // Funnels / growth
        "funnels","funnel_steps","growth_objectives","seo_forecasts","share_tokens",
        // Org config & billing
        "org_addons","org_checklist","org_secrets","org_auth_config",
        "subscriptions","org_member_permissions","sso_providers",
        // Checkout & overview cache
        "checkout_post_tokens","overview_insights_cache","overview_insights_rl",
        // AI
        "ai_usage_logs","ai_monthly_usage","ai_credit_purchases",
        "ai_chat_history","ai_action_logs","ai_action_proposals",
        "ai_autopilot_grants","ai_usage_pending_writes","ai_workspace_profiles",
        "ai_market_reports","ai_review_replies",
        // Activity / notifications
        "activity_logs","notifications","user_prefs","user_activity_days",
        "login_audits","permission_logs","access_audits",
        // Onboarding
        "onboarding_sessions",
        // Other business data
        "local_pack_history","local_heatmaps","industry_signals",
        "connectors","dataforseo_quota","reviews","roles",
        "market_opportunities","market_trends","usage_events",
        "gbp_locations","gbp_posts",
        // Legacy org settings
        "org_settings",
      ] as const) {
        await safeDeleteUUID(tbl, "org_id", orgIdsToDelete).catch(() => {});
      }

      // organization_members uses `organization_id` (not `org_id`) — handle separately
      if (orgIdsToDelete.length > 0) {
        const omR = await client.query(
          `DELETE FROM organization_members WHERE organization_id::text = ANY($1)`,
          [orgIdsToDelete]
        ).catch(() => ({ rowCount: 0 }));
        deleted["organization_members"] = omR.rowCount ?? 0;
      }

      // Core identity tables
      await safeDeleteUUID("organizations", "id", orgIdsToDelete);
      await safeDelete    ("users", "lower(email)", emailsToDelete);

      await client.query("COMMIT");

      console.warn(JSON.stringify({
        event: "ADMIN_PURGE_COMPLETE",
        callId,
        email_count: emailsToDelete.length,
        ts: new Date().toISOString(),
      }));

      res.json({
        ok: true,
        dry_run: false,
        callId,
        deleted,
        stripe: {
          customers_deleted: stripeDeleted.customersDeleted,
          subscriptions_canceled: stripeDeleted.subscriptionsCanceled,
          customers_exempted: stripeDeleted.customersExempted,
        },
        emails_purged: emailsToDelete,
        org_ids_purged: orgIdsToDelete,
        message: "All non-exempt client accounts and their Stripe customers were permanently deleted. Historical Stripe invoices and payments are retained.",
      });
    } finally {
      _purgeInFlight = false;
    }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(JSON.stringify({
      event: "ADMIN_PURGE_ERROR",
      callId,
      error: safeErrMsg(err),
      ts: new Date().toISOString(),
    }));
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});

// ── POST /api/admin/reconcile-org-addons ─────────────────────────────────────
// Idempotent: replays a past Stripe subscription → org_addons for an org.
// Use after a checkout.session.completed webhook fired before the addonKey fix.
// Body: { orgId: string }
// Returns: { ok, activated: string[], skipped: string[], errors: string[] }
router.post("/admin/reconcile-org-addons", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId: rawOrgId, stripeCustomerId: customerIdOverride } = req.body as { orgId?: string; stripeCustomerId?: string };
  if (!rawOrgId) { res.status(400).json({ ok: false, error: "orgId required" }); return; }

  // ── Step 0: resolve orgId (email → UUID or keep as-is) ──────────────────────
  let resolvedOrgId = rawOrgId.trim();
  const steps: string[] = [];
  try {
    if (resolvedOrgId.includes("@")) {
      // Try organizations.owner_email → id (UUID)
      const uuidRes = await pool.query(
        `SELECT id::text AS org_uuid FROM organizations WHERE lower(owner_email) = lower($1) LIMIT 1`,
        [resolvedOrgId]
      ).catch(() => ({ rows: [] as { org_uuid: string }[] }));
      if (uuidRes.rows[0]?.org_uuid) {
        resolvedOrgId = uuidRes.rows[0].org_uuid;
        steps.push(`email→uuid:${resolvedOrgId}`);
      } else {
        steps.push("email→uuid:not_found(using_email_as_key)");
      }
    }

    // ── Step 1: resolve Stripe customer id ────────────────────────────────────
    // Query each source separately (avoids UNION column-type conflicts).
    // An explicit stripeCustomerId override in the body skips DB lookup entirely.
    let customerId = String(customerIdOverride ?? "").trim();
    if (customerId) {
      steps.push(`customer_id_override:${customerId}`);
    }

    // 1a. organizations table (UUID key)
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(resolvedOrgId);
    if (!customerId && isUuid) {
      const r = await pool.query(
        `SELECT COALESCE(stripe_customer_id, '') AS cid FROM organizations WHERE id = $1::uuid LIMIT 1`,
        [resolvedOrgId]
      ).catch((e: Error) => { steps.push(`orgs_query_err:${e.message}`); return { rows: [] as {cid:string}[] }; });
      customerId = String(r.rows[0]?.cid ?? "").trim();
      steps.push(`orgs_lookup:${customerId || "empty"}`);
    }

    // 1b. org_settings table (text org_id key — try both UUID and raw/email)
    if (!customerId) {
      const r = await pool.query(
        `SELECT COALESCE(stripe_customer_id, '') AS cid FROM org_settings
          WHERE (org_id = $1 OR lower(org_id::text) = lower($2))
            AND stripe_customer_id IS NOT NULL AND stripe_customer_id::text <> ''
          LIMIT 1`,
        [resolvedOrgId, rawOrgId]
      ).catch((e: Error) => { steps.push(`oss_query_err:${e.message}`); return { rows: [] as {cid:string}[] }; });
      customerId = String(r.rows[0]?.cid ?? "").trim();
      steps.push(`org_settings_lookup:${customerId || "empty"}`);
    }

    if (!customerId) {
      res.status(404).json({
        ok: false,
        error: "No Stripe customer found for this org. Tip: pass stripeCustomerId in the request body to override.",
        hint: "Find the customer ID in the Stripe Dashboard and re-call with: { orgId, stripeCustomerId: 'cus_xxx' }",
        resolvedOrgId, rawOrgId, steps,
      });
      return;
    }

    // ── Step 2: build live+test price→addon map ──────────────────────────────
    const { ADDON_PRICE_IDS, ADDON_PRICE_IDS_TEST } = await import("../lib/plans.js");
    const { activateAddon } = await import("../services/addons-service.js");
    steps.push("imports_ok");
    const combinedPriceMap: Record<string, string> = {};
    for (const [addon, id] of Object.entries(ADDON_PRICE_IDS as Record<string, string>)) {
      if (id) combinedPriceMap[id] = addon;
    }
    for (const [addon, id] of Object.entries((ADDON_PRICE_IDS_TEST ?? {}) as Record<string, string>)) {
      if (id) combinedPriceMap[id] = addon;
    }
    steps.push(`price_map:${Object.keys(combinedPriceMap).length}`);

    // ── Step 4: fetch Stripe subscriptions ───────────────────────────────────
    const { getStripeKey, createStripeClient: mkStripe } = await import("../services/stripe-factory.js");
    const stripeKey = getStripeKey();
    const stripe = await mkStripe(stripeKey);
    let subs: { data: Array<{
      status: string;
      metadata: Record<string, string | null | undefined>;
      items: { data: Array<{ price?: { id?: string } | null; quantity?: number | null }> };
    }> };
    try {
      subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 20,
        expand: ["data.items.data.price"],
      }) as typeof subs;
      steps.push(`stripe_subs:${subs.data.length}`);
    } catch (stripeErr: unknown) {
      const code = (stripeErr as { code?: string })?.code ?? "";
      const msg  = (stripeErr as Error)?.message ?? String(stripeErr);
      if (code === "resource_missing") {
        res.status(404).json({
          ok: false,
          error: `Stripe customer ${customerId} not found in current mode (${msg}). Purchase was likely in test mode but server runs in live mode.`,
          resolvedOrgId, customerId, steps,
        });
        return;
      }
      res.status(500).json({ ok: false, error: `Stripe error: ${msg}`, resolvedOrgId, customerId, steps });
      return;
    }

    // ── Step 5: activate matching addons ─────────────────────────────────────
    const activated: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const sub of subs.data) {
      if (!["active","trialing","past_due"].includes(sub.status)) continue;
      for (const item of sub.items.data) {
        const priceId = item.price?.id ?? "";
        const qty     = item.quantity ?? 1;
        const addonKey = combinedPriceMap[priceId] ?? null;
        const metaKey  = String(sub.metadata?.["addonKey"] ?? "").trim();
        const metaQty  = Math.max(1, parseInt(String(sub.metadata?.["quantity"] ?? "1"), 10));
        const key      = addonKey || metaKey;
        if (!key) { skipped.push(`price:${priceId}`); continue; }
        const effectiveQty = addonKey ? qty : metaQty;
        try {
          const ok = await activateAddon(key, resolvedOrgId, effectiveQty);
          if (ok) activated.push(`${key}×${effectiveQty}`);
          else skipped.push(`${key}(already_active_or_unknown)`);
        } catch (e) {
          errors.push(`${key}:${(e as Error)?.message ?? String(e)}`);
        }
      }
    }

    res.json({ ok: true, customerId, resolvedOrgId, rawOrgId, activated, skipped, errors, steps });
  } catch (err: unknown) {
    const msg = (err as Error)?.message ?? String(err ?? "unknown");
    console.error("[Admin] reconcile-org-addons error:", msg, err);
    res.status(500).json({ ok: false, error: msg || "Internal server error", resolvedOrgId, rawOrgId, steps });
  }
});

// ── POST /api/admin/activate-addon-direct ─────────────────────────────────────
// Direct DB-only addon activation — NO Stripe billing. Use only to reconcile a
// payment that was already collected (e.g. via PaymentIntent) but never persisted.
// Body: { orgId: string, addonKey: string, quantity?: number, piId?: string }
router.post("/admin/activate-addon-direct", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId: rawOrgId, addonKey, quantity = 1, piId = "" } = req.body as {
    orgId?: string; addonKey?: string; quantity?: number; piId?: string;
  };
  if (!rawOrgId || !addonKey) {
    res.status(400).json({ ok: false, error: "orgId and addonKey required" });
    return;
  }
  const qty = Math.max(1, Math.floor(Number(quantity) || 1));
  try {
    // Verify canonical org exists
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOrgId);
    let canonicalOrgId = rawOrgId;
    if (isUuid) {
      const r = await pool.query(`SELECT id::text FROM organizations WHERE id = $1::uuid LIMIT 1`, [rawOrgId]);
      if (!r.rows[0]) {
        res.status(404).json({ ok: false, error: `Org ${rawOrgId} not found in organizations` });
        return;
      }
      canonicalOrgId = r.rows[0].id;
    }
    const { activateAddon } = await import("../services/addons-service.js");
    await activateAddon(addonKey, canonicalOrgId, qty);
    console.log(`[Admin] activate-addon-direct: org=${canonicalOrgId} addon=${addonKey} qty=${qty} pi=${piId}`);
    res.json({ ok: true, orgId: canonicalOrgId, addonKey, quantity: qty, piId });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err ?? "unknown");
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── POST /api/admin/run-trial-cron — trigger trial-ending check immediately ──
router.post("/admin/run-trial-cron", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  try {
    const { checkTrialEndingReminders } = await import("../services/monitor-cron.js");
    await checkTrialEndingReminders();
    res.json({ ok: true, msg: "Trial-ending cron executed — check server logs for details" });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

export default router;
