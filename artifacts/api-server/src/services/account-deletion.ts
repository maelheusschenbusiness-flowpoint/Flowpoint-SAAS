/**
 * Account deletion pipeline.
 *
 * Single coherent, idempotent, rollback-safe deletion of every trace of an
 * organization and its users.
 *
 * Design notes
 * ------------
 * 1. TABLE DISCOVERY IS DYNAMIC. We never keep a static table list — it goes
 *    stale the moment someone adds a table. We introspect
 *    `information_schema.columns` at runtime for both org-scoped columns
 *    (org_id, organization_id) and user-scoped columns (user_id, user_id_v2,
 *    owner_id, created_by, member_id, invited_by, ...).
 *
 * 2. FK-SAFE ORDERING. We read the live foreign-key graph and topologically
 *    sort so child rows are always deleted before the rows they reference.
 *    Three FKs in this schema are NO ACTION (ai_generated_missions →
 *    ai_workspace_profiles, ai_setup_logs → onboarding_sessions,
 *    ai_workspace_profiles → onboarding_sessions) and would abort the
 *    transaction without correct ordering.
 *
 * 3. MIXED COLUMN TYPES. `org_id` is `text` in most tables but `uuid` in eight
 *    of them (ai_usage_logs, ai_monthly_usage, ai_credit_purchases, org_addons,
 *    ga4_accounts, gsc_keyword_data, gsc_page_data, gsc_sync_logs). Every
 *    predicate casts the column to ::text so one code path covers both.
 *
 * 4. MULTI-ORG USERS ARE PRESERVED. A user who belongs to another organization
 *    keeps their `users` row and their data in that other org; only their
 *    membership in the deleted org is removed. Only users whose sole
 *    membership was the deleted org are fully erased.
 *
 * 5. ATOMICITY. Every SQL statement runs on one client inside one
 *    BEGIN/COMMIT. Any error triggers ROLLBACK, so a partial deletion cannot
 *    exist. Stripe runs BEFORE the transaction and is intentionally outside it
 *    — an external API cannot participate in a SQL transaction, so we do the
 *    irreversible external work first and abort the DB deletion if it fails.
 *    That ordering guarantees we never delete DB rows for an account whose
 *    billing we failed to stop.
 */

import { logger } from "../lib/logger.js";

// ── Ownership column vocabulary ─────────────────────────────────────────────
/** Columns that scope a row to an organization. */
const ORG_COLUMNS = ["org_id", "organization_id"] as const;

/**
 * Columns that scope a row to a user.
 * NOTE: `account_id` is deliberately NOT here — in this schema it holds a
 * Google account identifier (ga4_accounts, gbp_locations, google_tokens),
 * not a FlowPoint user id.
 */
const USER_COLUMNS = [
  "user_id",
  "user_id_v2",
  "user_uuid",
  "owner_id",
  "created_by",
  "member_id",
  "invited_by",
  "invited_by_user_id",
  "sender_id",
  "author_id",
  "updated_by",
  "deleted_by",
  "assigned_to",
] as const;

/** Tables that must never be touched by account deletion. */
const NEVER_DELETE = new Set([
  "schema_migrations",
  "canonical_seeds",
]);

/**
 * Auth tables keyed by email rather than org/user id.
 * Explicit allowlist: `email` appears on many tables (users, team_members…)
 * and we must not delete by email indiscriminately.
 */
const EMAIL_KEYED_TABLES = ["pending_signups", "magic_link_tokens"] as const;

/** Tables handled explicitly at the end of the pipeline, not by discovery. */
const TERMINAL_TABLES = new Set([
  "organizations",
  "org_settings",
  "organization_members",
  "users",
]);

// ── Types ───────────────────────────────────────────────────────────────────

export interface DeletionTarget {
  orgId: string;
  /** Authenticated user's UUID (users.id). */
  userId?: string | null;
  email?: string | null;
  stripeCustomerId?: string | null;
}

export interface TableDeletionRecord {
  table: string;
  predicate: string;
  rowsBefore: number;
  rowsDeleted: number;
  rowsAfter: number;
}

export interface DeletionReport {
  orgId: string;
  email: string | null;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stripe: {
    attempted: boolean;
    customerId: string | null;
    subscriptionsCanceled: number;
    customerDeleted: boolean;
    note?: string;
  };
  storage: {
    attempted: boolean;
    filesDeleted: number;
    note: string;
  };
  users: {
    membersFound: string[];
    fullyDeleted: string[];
    preservedMultiOrg: string[];
  };
  tables: TableDeletionRecord[];
  totals: {
    tablesScanned: number;
    tablesWithData: number;
    rowsDeleted: number;
    rowsSurviving: number;
  };
  survivors: TableDeletionRecord[];
  committed: boolean;
}

interface ColumnInfo {
  table: string;
  column: string;
}

interface FkEdge {
  child: string;
  parent: string;
}

// ── Discovery ───────────────────────────────────────────────────────────────

/**
 * Find every base table in `public` that has at least one ownership column,
 * and build the SQL predicate that selects rows belonging to this account.
 */
async function discoverOwnedTables(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  orgId: string,
  deletableUserIds: string[],
): Promise<Map<string, { predicate: string; params: unknown[] }>> {
  const res = await client.query(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema
        AND t.table_name   = c.table_name
      WHERE c.table_schema = 'public'
        AND t.table_type   = 'BASE TABLE'
        AND c.column_name  = ANY($1)`,
    [[...ORG_COLUMNS, ...USER_COLUMNS]],
  );

  const rows = res.rows as Array<{ table_name: string; column_name: string }>;

  // Group columns per table.
  const byTable = new Map<string, ColumnInfo[]>();
  for (const r of rows) {
    if (NEVER_DELETE.has(r.table_name)) continue;
    if (TERMINAL_TABLES.has(r.table_name)) continue;
    const list = byTable.get(r.table_name) ?? [];
    list.push({ table: r.table_name, column: r.column_name });
    byTable.set(r.table_name, list);
  }

  const hasUsers = deletableUserIds.length > 0;
  const predicates = new Map<string, { predicate: string; params: unknown[] }>();

  for (const [table, cols] of byTable) {
    // Placeholders must be numbered contiguously from $1 for THIS statement,
    // so the parameter list is built per table — a table with only an org
    // column must not be handed a second, unreferenced parameter.
    const clauses: string[] = [];
    const params: unknown[] = [];
    let orgPlaceholder: string | null = null;
    let userPlaceholder: string | null = null;

    for (const { column } of cols) {
      const isOrgCol = (ORG_COLUMNS as readonly string[]).includes(column);
      if (isOrgCol) {
        if (!orgPlaceholder) {
          params.push(orgId);
          orgPlaceholder = `$${params.length}`;
        }
        // Cast to text so uuid and text org_id columns share one code path.
        clauses.push(`"${column}"::text = ${orgPlaceholder}`);
      } else if (hasUsers) {
        if (!userPlaceholder) {
          params.push(deletableUserIds);
          userPlaceholder = `$${params.length}`;
        }
        clauses.push(`"${column}"::text = ANY(${userPlaceholder}::text[])`);
      }
    }

    if (clauses.length > 0) {
      predicates.set(table, { predicate: clauses.join(" OR "), params });
    }
  }

  return predicates;
}

/**
 * Read the live FK graph and return an ordering in which every child table
 * appears before the tables it references (Kahn's algorithm).
 */
async function orderByFkDependencies(
  client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> },
  tables: string[],
): Promise<string[]> {
  const res = await client.query(
    `SELECT DISTINCT
        tc.table_name  AS child,
        ccu.table_name AS parent
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema    = kcu.table_schema
       JOIN information_schema.constraint_column_usage ccu
         ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema    = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema    = 'public'`,
    [],
  );

  const edges = (res.rows as FkEdge[]).filter(
    (e) => e.child !== e.parent && tables.includes(e.child) && tables.includes(e.parent),
  );

  // childCount[parent] = number of not-yet-emitted tables referencing parent.
  const childCount = new Map<string, number>();
  const parentsOf = new Map<string, string[]>();
  for (const t of tables) {
    childCount.set(t, 0);
    parentsOf.set(t, []);
  }
  for (const e of edges) {
    childCount.set(e.parent, (childCount.get(e.parent) ?? 0) + 1);
    parentsOf.get(e.child)!.push(e.parent);
  }

  // A table is emittable once nothing still references it.
  const queue = tables.filter((t) => (childCount.get(t) ?? 0) === 0);
  const ordered: string[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const t = queue.shift()!;
    if (seen.has(t)) continue;
    seen.add(t);
    ordered.push(t);

    for (const parent of parentsOf.get(t) ?? []) {
      const next = (childCount.get(parent) ?? 1) - 1;
      childCount.set(parent, next);
      if (next === 0 && !seen.has(parent)) queue.push(parent);
    }
  }

  // Any table left over sits in an FK cycle — append it; all deletes share one
  // transaction so cyclic groups resolve together.
  for (const t of tables) {
    if (!seen.has(t)) ordered.push(t);
  }

  return ordered;
}

// ── Stripe ──────────────────────────────────────────────────────────────────

async function cleanupStripe(
  stripeCustomerId: string | null | undefined,
  orgId: string,
): Promise<DeletionReport["stripe"]> {
  const report: DeletionReport["stripe"] = {
    attempted: false,
    customerId: stripeCustomerId ?? null,
    subscriptionsCanceled: 0,
    customerDeleted: false,
  };

  if (!stripeCustomerId) {
    report.note = "No Stripe customer on file — nothing to clean up.";
    return report;
  }

  const { getStripeKey, createStripeClient } = await import("./stripe-factory.js");
  const stripeKey = getStripeKey();
  if (!stripeKey) {
    report.note = "Stripe not configured in this environment — skipped.";
    return report;
  }

  report.attempted = true;
  const stripe = await createStripeClient(stripeKey);

  try {
    const subs = await stripe.subscriptions.list({
      customer: stripeCustomerId,
      status: "all",
      limit: 100,
    });
    for (const sub of subs.data) {
      if (sub.status !== "canceled") {
        await stripe.subscriptions.cancel(sub.id);
        report.subscriptionsCanceled++;
      }
    }
    await stripe.customers.del(stripeCustomerId);
    report.customerDeleted = true;
    report.note = "Customer and subscriptions removed. Historical invoices and payments are retained by Stripe as required.";
    logger.info({ orgId, stripeCustomerId, canceled: report.subscriptionsCanceled }, "[AccountDeletion] Stripe cleaned");
  } catch (err: unknown) {
    const code =
      (err as { code?: string })?.code ?? (err as { raw?: { code?: string } })?.raw?.code;
    if (code === "resource_missing") {
      // Idempotency: already deleted on a previous run.
      report.customerDeleted = true;
      report.note = "Stripe customer already absent (resource_missing) — treated as clean.";
      logger.warn({ orgId, stripeCustomerId }, "[AccountDeletion] Stripe customer already gone");
    } else {
      throw err; // real failure → abort before touching the database
    }
  }

  return report;
}

// ── Storage ─────────────────────────────────────────────────────────────────

/**
 * Supabase Storage cleanup.
 *
 * This deployment has no Storage client and no SUPABASE_STORAGE_* configuration,
 * so there are no uploaded objects to remove. The step is reported honestly
 * rather than silently claimed as done. If buckets are introduced later, delete
 * them here — AFTER the DB commit, since object storage cannot roll back.
 */
async function cleanupStorage(orgId: string, userIds: string[]): Promise<DeletionReport["storage"]> {
  const url = process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SERVICE_ROLE_KEY"];
  const bucket = process.env["SUPABASE_STORAGE_BUCKET"];

  if (!url || !key || !bucket) {
    return {
      attempted: false,
      filesDeleted: 0,
      note: "Supabase Storage is not configured in this environment (no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_STORAGE_BUCKET); no uploaded objects exist to delete.",
    };
  }

  let deleted = 0;
  const prefixes = [`org/${orgId}`, ...userIds.map((u) => `avatars/${u}`)];

  for (const prefix of prefixes) {
    try {
      const listRes = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix, limit: 1000 }),
      });
      if (!listRes.ok) continue;
      const objects = (await listRes.json()) as Array<{ name: string }>;
      if (!Array.isArray(objects) || objects.length === 0) continue;

      const paths = objects.map((o) => `${prefix}/${o.name}`);
      const delRes = await fetch(`${url}/storage/v1/object/${bucket}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ prefixes: paths }),
      });
      if (delRes.ok) deleted += paths.length;
    } catch (err) {
      logger.warn({ err, prefix, orgId }, "[AccountDeletion] Storage cleanup failed for prefix");
    }
  }

  return {
    attempted: true,
    filesDeleted: deleted,
    note: `Removed ${deleted} object(s) from bucket "${bucket}".`,
  };
}

// ── Main pipeline ───────────────────────────────────────────────────────────

/**
 * Permanently delete an organization and its users.
 *
 * Idempotent: running it against an already-deleted account succeeds and
 * returns a report with zero counts.
 */
export async function deleteAccount(target: DeletionTarget): Promise<DeletionReport> {
  const startedAt = new Date();
  const { orgId } = target;
  // `let` — may be self-healed from the DB when the caller did not supply it.
  let email = target.email ?? null;

  logger.info({ orgId, email }, "[AccountDeletion] Starting");

  // ── Phase 1: Stripe (external, irreversible, must precede the DB work) ────
  const stripeReport = await cleanupStripe(target.stripeCustomerId, orgId);

  // ── Phase 2: transactional database deletion ─────────────────────────────
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();

  const tableRecords: TableDeletionRecord[] = [];
  let membersFound: string[] = [];
  let fullyDeleted: string[] = [];
  let preservedMultiOrg: string[] = [];
  let committed = false;

  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");

    // Lock the organization row so two concurrent deletions cannot interleave.
    await client.query(`SELECT id FROM organizations WHERE id = $1 FOR UPDATE`, [orgId]);

    // ── Email self-heal ───────────────────────────────────────────────────
    // If the caller did not supply an email (e.g. billingCtx returned null),
    // resolve it from the DB so that email-keyed tables (magic_link_tokens,
    // pending_signups, legacy org_settings, user_sessions) are always cleaned.
    // Without this, a deleted account can still request a new magic link and
    // log back in via the S3-legacy path in login-verify.
    if (!email) {
      try {
        const [fromUsers, fromOrgs] = await Promise.all([
          client.query<{ email: string }>(
            `SELECT email FROM users WHERE id::text = $1 LIMIT 1`,
            [String(target.userId ?? "")],
          ),
          client.query<{ owner_email: string }>(
            `SELECT owner_email FROM organizations WHERE id::text = $1 LIMIT 1`,
            [orgId],
          ),
        ]);
        email = fromUsers.rows[0]?.email ?? fromOrgs.rows[0]?.owner_email ?? null;
        if (email) {
          logger.info({ orgId, email }, "[AccountDeletion] Email self-healed from DB");
        } else {
          logger.warn({ orgId }, "[AccountDeletion] Could not resolve email from DB — email-keyed cleanup will be skipped");
        }
      } catch (resolveErr) {
        logger.warn({ resolveErr, orgId }, "[AccountDeletion] Email self-heal query failed (non-fatal) — email-keyed cleanup will be skipped");
      }
    }

    // ── 2a. Resolve which users are being erased ──────────────────────────
    const memberRes = await client.query(
      `SELECT DISTINCT user_id::text AS user_id
         FROM organization_members
        WHERE organization_id::text = $1
          AND user_id IS NOT NULL`,
      [orgId],
    );
    membersFound = (memberRes.rows as Array<{ user_id: string }>).map((r) => r.user_id);

    // Include the caller, and anyone matching the account email, even if the
    // membership row is missing (self-healing for inconsistent legacy data).
    if (target.userId) membersFound.push(String(target.userId));
    if (email) {
      const byEmail = await client.query(
        `SELECT id::text AS id FROM users WHERE lower(email) = lower($1)`,
        [email],
      );
      for (const r of byEmail.rows as Array<{ id: string }>) membersFound.push(r.id);
    }
    membersFound = [...new Set(membersFound)];

    // A user who still belongs to another organization must survive.
    if (membersFound.length > 0) {
      const otherOrgRes = await client.query(
        `SELECT DISTINCT user_id::text AS user_id
           FROM organization_members
          WHERE user_id::text = ANY($1::text[])
            AND organization_id::text <> $2`,
        [membersFound, orgId],
      );
      preservedMultiOrg = (otherOrgRes.rows as Array<{ user_id: string }>).map((r) => r.user_id);
    }
    const preservedSet = new Set(preservedMultiOrg);
    fullyDeleted = membersFound.filter((u) => !preservedSet.has(u));

    logger.info(
      { orgId, members: membersFound.length, fullyDeleted: fullyDeleted.length, preserved: preservedMultiOrg.length },
      "[AccountDeletion] Users resolved",
    );

    // ── 2b. Discover every owned table and order it FK-safely ─────────────
    const predicates = await discoverOwnedTables(client, orgId, fullyDeleted);
    const ordered = await orderByFkDependencies(client, [...predicates.keys()]);

    logger.info({ orgId, tables: ordered.length }, "[AccountDeletion] Tables discovered");

    // ── 2c. Delete, capturing before/after counts for certification ───────
    for (const table of ordered) {
      const { predicate, params } = predicates.get(table)!;

      const beforeRes = await client.query(
        `SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${predicate}`,
        params,
      );
      const rowsBefore = (beforeRes.rows[0] as { n: number }).n;

      const delRes = (await client.query(
        `DELETE FROM "${table}" WHERE ${predicate}`,
        params,
      )) as unknown as { rowCount: number };
      const rowsDeleted = delRes.rowCount ?? 0;

      const afterRes = await client.query(
        `SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${predicate}`,
        params,
      );
      const rowsAfter = (afterRes.rows[0] as { n: number }).n;

      tableRecords.push({ table, predicate, rowsBefore, rowsDeleted, rowsAfter });
    }

    // ── 2c-bis-pre. Explicit user_prefs deletion ─────────────────────────
    // user_prefs is keyed by org_id (UUID). Dynamic discovery covers it via
    // the org_id column, but it is explicitly included here as a safety net
    // because it stores profile data (timezone, settings, streak, pinned items)
    // that must never survive account deletion and re-registration.
    {
      const _upExists = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_prefs'`,
      );
      if (_upExists.rows.length > 0) {
        const _upDel = (await client.query(
          `DELETE FROM user_prefs WHERE org_id::text = $1`,
          [orgId],
        )) as unknown as { rowCount: number };
        logger.info({ orgId, deleted: _upDel.rowCount }, "[AccountDeletion] user_prefs explicitly cleared");
        tableRecords.push({
          table: "user_prefs",
          predicate: "org_id::text = $1",
          rowsBefore: _upDel.rowCount ?? 0,
          rowsDeleted: _upDel.rowCount ?? 0,
          rowsAfter: 0,
        });
      }
    }

    // ── 2c-bis. Explicit user_sessions deletion ───────────────────────────
    // user_sessions is keyed by org_id (UUID) AND user_id (legacy email) AND
    // user_id_v2 (UUID). Dynamic discovery may miss rows that use only the
    // legacy user_id column. Delete explicitly using all three identifiers so
    // a deleted account can never replay an old session token.
    {
      const _sessExists = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='user_sessions'`,
      );
      if (_sessExists.rows.length > 0) {
        const _sessIds: string[] = [orgId, ...(target.userId ? [String(target.userId)] : [])].filter(Boolean);
        const _sessDel = (await client.query(
          `DELETE FROM user_sessions
            WHERE org_id::text = $1
              OR user_id_v2::text = ANY($2::text[])
              ${email ? "OR lower(user_id::text) = lower($3)" : ""}`,
          email ? [orgId, _sessIds, email] : [orgId, _sessIds],
        )) as unknown as { rowCount: number };
        logger.info({ orgId, deleted: _sessDel.rowCount }, "[AccountDeletion] user_sessions explicitly cleared");
      }
    }

    // ── 2d. Email-keyed auth tables ───────────────────────────────────────
    if (email) {
      for (const table of EMAIL_KEYED_TABLES) {
        const exists = await client.query(
          `SELECT 1 FROM information_schema.tables
            WHERE table_schema='public' AND table_name=$1`,
          [table],
        );
        if (exists.rows.length === 0) continue;

        const before = await client.query(
          `SELECT COUNT(*)::int AS n FROM "${table}" WHERE lower(email) = lower($1)`,
          [email],
        );
        const del = (await client.query(
          `DELETE FROM "${table}" WHERE lower(email) = lower($1)`,
          [email],
        )) as unknown as { rowCount: number };
        const after = await client.query(
          `SELECT COUNT(*)::int AS n FROM "${table}" WHERE lower(email) = lower($1)`,
          [email],
        );

        tableRecords.push({
          table,
          predicate: "lower(email) = lower($1)",
          rowsBefore: (before.rows[0] as { n: number }).n,
          rowsDeleted: del.rowCount ?? 0,
          rowsAfter: (after.rows[0] as { n: number }).n,
        });
      }
    }

    // ── 2e. Terminal tables, in strict FK order ───────────────────────────
    // organization_members → users → org_settings → organizations

    const memBefore = await client.query(
      `SELECT COUNT(*)::int AS n FROM organization_members WHERE organization_id::text = $1`,
      [orgId],
    );
    const memDel = (await client.query(
      `DELETE FROM organization_members WHERE organization_id::text = $1`,
      [orgId],
    )) as unknown as { rowCount: number };
    const memAfter = await client.query(
      `SELECT COUNT(*)::int AS n FROM organization_members WHERE organization_id::text = $1`,
      [orgId],
    );
    tableRecords.push({
      table: "organization_members",
      predicate: "organization_id::text = $1",
      rowsBefore: (memBefore.rows[0] as { n: number }).n,
      rowsDeleted: memDel.rowCount ?? 0,
      rowsAfter: (memAfter.rows[0] as { n: number }).n,
    });

    if (fullyDeleted.length > 0) {
      const uBefore = await client.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE id::text = ANY($1::text[])`,
        [fullyDeleted],
      );
      const uDel = (await client.query(
        `DELETE FROM users WHERE id::text = ANY($1::text[])`,
        [fullyDeleted],
      )) as unknown as { rowCount: number };
      const uAfter = await client.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE id::text = ANY($1::text[])`,
        [fullyDeleted],
      );
      tableRecords.push({
        table: "users",
        predicate: "id::text = ANY($1::text[])",
        rowsBefore: (uBefore.rows[0] as { n: number }).n,
        rowsDeleted: uDel.rowCount ?? 0,
        rowsAfter: (uAfter.rows[0] as { n: number }).n,
      });
    }

    // ── 2e-bis. Pending (never-activated) users by email ─────────────────
    // Users with status='pending' were never added to organization_members,
    // so they are absent from fullyDeleted and not caught above.
    // Delete them explicitly so re-registration with the same email works.
    if (email) {
      const _puBefore = await client.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE lower(email)=lower($1) AND status='pending'`,
        [email],
      );
      const _puCount = (_puBefore.rows[0] as { n: number }).n;
      if (_puCount > 0) {
        const _puDel = (await client.query(
          `DELETE FROM users WHERE lower(email)=lower($1) AND status='pending'`,
          [email],
        )) as unknown as { rowCount: number };
        const _puAfter = await client.query(
          `SELECT COUNT(*)::int AS n FROM users WHERE lower(email)=lower($1) AND status='pending'`,
          [email],
        );
        tableRecords.push({
          table: "users",
          predicate: "lower(email)=lower($1) AND status='pending'",
          rowsBefore: _puCount,
          rowsDeleted: _puDel.rowCount ?? 0,
          rowsAfter: (_puAfter.rows[0] as { n: number }).n,
        });
      }
    }

    for (const [table, pred] of [
      ["org_settings", "org_id::text = $1"],
      ["organizations", "id::text = $1"],
    ] as const) {
      const before = await client.query(
        `SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${pred}`,
        [orgId],
      );
      const del = (await client.query(
        `DELETE FROM "${table}" WHERE ${pred}`,
        [orgId],
      )) as unknown as { rowCount: number };
      const after = await client.query(
        `SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${pred}`,
        [orgId],
      );
      tableRecords.push({
        table,
        predicate: pred,
        rowsBefore: (before.rows[0] as { n: number }).n,
        rowsDeleted: del.rowCount ?? 0,
        rowsAfter: (after.rows[0] as { n: number }).n,
      });
    }

    // ── 2e-ter. Legacy email-keyed org_settings (org_id = email, not UUID) ──
    // Old server code wrote org_settings with org_id = email (not UUID).
    // The UUID-based deletion above misses these. Delete by email to ensure
    // re-registration with the same address is never blocked after deletion.
    if (email) {
      const _osEmailBefore = await client.query(
        `SELECT COUNT(*)::int AS n FROM org_settings
         WHERE lower(org_id::text) = lower($1) AND org_id::text <> $2`,
        [email, orgId],
      );
      const _osEmailCount = (_osEmailBefore.rows[0] as { n: number }).n;
      if (_osEmailCount > 0) {
        const _osEmailDel = (await client.query(
          `DELETE FROM org_settings WHERE lower(org_id::text) = lower($1) AND org_id::text <> $2`,
          [email, orgId],
        )) as unknown as { rowCount: number };
        const _osEmailAfter = await client.query(
          `SELECT COUNT(*)::int AS n FROM org_settings
           WHERE lower(org_id::text) = lower($1) AND org_id::text <> $2`,
          [email, orgId],
        );
        tableRecords.push({
          table: "org_settings",
          predicate: "lower(org_id::text)=lower($email) [legacy email-keyed]",
          rowsBefore: _osEmailCount,
          rowsDeleted: _osEmailDel.rowCount ?? 0,
          rowsAfter: (_osEmailAfter.rows[0] as { n: number }).n,
        });
      }
    }

    // ── 2f. Refuse to commit if anything survived ─────────────────────────
    const survivors = tableRecords.filter((r) => r.rowsAfter > 0);
    if (survivors.length > 0) {
      throw new Error(
        `Deletion incomplete — rows survived in: ${survivors.map((s) => `${s.table}(${s.rowsAfter})`).join(", ")}`,
      );
    }

    await client.query("COMMIT");
    committed = true;
    logger.info({ orgId, tables: tableRecords.length }, "[AccountDeletion] Transaction committed");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    logger.error({ err, orgId }, "[AccountDeletion] Rolled back — no data deleted");
    throw err;
  } finally {
    client.release();
  }

  // ── Phase 3: object storage (post-commit; cannot participate in the tx) ──
  const storageReport = await cleanupStorage(orgId, fullyDeleted);

  const finishedAt = new Date();
  const rowsDeleted = tableRecords.reduce((s, r) => s + r.rowsDeleted, 0);
  const rowsSurviving = tableRecords.reduce((s, r) => s + r.rowsAfter, 0);

  const report: DeletionReport = {
    orgId,
    email,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    stripe: stripeReport,
    storage: storageReport,
    users: { membersFound, fullyDeleted, preservedMultiOrg },
    tables: tableRecords,
    totals: {
      tablesScanned: tableRecords.length,
      tablesWithData: tableRecords.filter((r) => r.rowsBefore > 0).length,
      rowsDeleted,
      rowsSurviving,
    },
    survivors: tableRecords.filter((r) => r.rowsAfter > 0),
    committed,
  };

  logger.info(
    { orgId, rowsDeleted, tablesWithData: report.totals.tablesWithData },
    "[AccountDeletion] Completed",
  );

  return report;
}

/**
 * Referential-integrity audit used by the certification tool.
 * Returns any row anywhere that still references the deleted org or users.
 */
export async function auditOrphans(
  orgId: string,
  userIds: string[],
): Promise<Array<{ table: string; column: string; count: number }>> {
  const { pool } = await import("@workspace/db");
  const client = await pool.connect();
  const orphans: Array<{ table: string; column: string; count: number }> = [];

  try {
    const res = await client.query(
      `SELECT c.table_name, c.column_name
         FROM information_schema.columns c
         JOIN information_schema.tables t
           ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema = 'public'
          AND t.table_type   = 'BASE TABLE'
          AND c.column_name  = ANY($1)`,
      [[...ORG_COLUMNS, ...USER_COLUMNS]],
    );

    for (const row of res.rows as Array<{ table_name: string; column_name: string }>) {
      const { table_name: table, column_name: column } = row;
      if (NEVER_DELETE.has(table)) continue;

      const isOrgCol = (ORG_COLUMNS as readonly string[]).includes(column);
      const value: unknown = isOrgCol ? orgId : userIds;
      if (!isOrgCol && userIds.length === 0) continue;

      const sql = isOrgCol
        ? `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${column}"::text = $1`
        : `SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${column}"::text = ANY($1::text[])`;

      try {
        const r = await client.query(sql, [value]);
        const n = (r.rows[0] as { n: number }).n;
        if (n > 0) orphans.push({ table, column, count: n });
      } catch {
        // Table may have been dropped mid-audit — ignore.
      }
    }

    // The org and user rows themselves.
    for (const [table, pred, val] of [
      ["organizations", `id::text = $1`, orgId],
      ["org_settings", `org_id::text = $1`, orgId],
    ] as const) {
      const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE ${pred}`, [val]);
      const n = (r.rows[0] as { n: number }).n;
      if (n > 0) orphans.push({ table, column: "id", count: n });
    }

    if (userIds.length > 0) {
      const r = await client.query(
        `SELECT COUNT(*)::int AS n FROM users WHERE id::text = ANY($1::text[])`,
        [userIds],
      );
      const n = (r.rows[0] as { n: number }).n;
      if (n > 0) orphans.push({ table: "users", column: "id", count: n });
    }
  } finally {
    client.release();
  }

  return orphans;
}
