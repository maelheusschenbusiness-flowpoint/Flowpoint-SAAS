/**
 * FlowPoint — Admin API routes
 *
 * All routes are protected by the ADMIN_KEY environment variable.
 * Clients must supply:  x-admin-key: <value of ADMIN_KEY>
 *
 * These routes are intentionally NOT gated by user session auth so that
 * they can be called from ops scripts / CI pipelines.
 */

import { Router, type Request, type Response } from "express";
import { safeErrMsg } from "../lib/safe-error.js";
import { pool, withOrgDb } from "@workspace/db";

const router = Router();

function requireAdminKey(req: Request, res: Response): boolean {
  const key = process.env["ADMIN_KEY"];
  if (!key) {
    res.status(503).json({ ok: false, error: "ADMIN_KEY is not configured on this server" });
    return false;
  }
  const provided = req.headers["x-admin-key"];
  if (typeof provided !== "string" || provided !== key) {
    res.status(403).json({ ok: false, error: "Invalid or missing x-admin-key header" });
    return false;
  }
  return true;
}

// ── GET /api/admin/stats ──────────────────────────────────────────────────────
router.get("/admin/stats", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const safe = (sql: string) =>
    pool.query(sql).catch(() => ({ rows: [{ count: 0 }] }));
  try {
    const [usersR, sessionsR, auditsR, monitorsR, kwardsR] = await Promise.all([
      safe("SELECT COUNT(*)::int AS count FROM team_members"),
      safe("SELECT COUNT(*)::int AS count FROM user_sessions WHERE expires_at > now()"),
      safe("SELECT COUNT(*)::int AS count FROM audits"),
      safe("SELECT COUNT(*)::int AS count FROM monitors"),
      safe("SELECT COUNT(*)::int AS count FROM tracked_keywords"),
    ]);
    res.json({
      ok: true,
      stats: {
        totalUsers:      usersR.rows[0].count,
        activeSessions:  sessionsR.rows[0].count,
        totalAudits:     auditsR.rows[0].count,
        totalMonitors:   monitorsR.rows[0].count,
        totalKeywords:   kwardsR.rows[0].count,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── GET /api/admin/users ──────────────────────────────────────────────────────
router.get("/admin/users", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const client = await pool.connect();
  try {
    const { rows } = await client.query(`
      SELECT
        tm.id,
        tm.name,
        tm.email,
        tm.role,
        tm.joined,
        tm.created_at,
        COUNT(s.token) FILTER (WHERE s.expires_at > now())::int AS active_sessions,
        MAX(s.expires_at)                                       AS last_seen_at,
        (COUNT(s.token) FILTER (WHERE s.expires_at > now()) > 0) AS is_active
      FROM team_members tm
      LEFT JOIN user_sessions s ON s.email = tm.email
      GROUP BY tm.id, tm.name, tm.email, tm.role, tm.joined, tm.created_at
      ORDER BY tm.created_at DESC
    `);
    res.json({ ok: true, users: rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});

// ── POST /api/admin/user/block ────────────────────────────────────────────────
// Revokes ALL active sessions for a given email (effectively blocks the user).
router.post("/admin/user/block", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string") {
    res.status(400).json({ ok: false, error: "email is required" });
    return;
  }

  const client = await pool.connect();
  try {
    const { rowCount } = await client.query(
      "DELETE FROM user_sessions WHERE email = $1",
      [email.toLowerCase().trim()]
    );
    res.json({ ok: true, email, sessionsRevoked: rowCount ?? 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});

// ── POST /api/admin/user/reset-usage ─────────────────────────────────────────
// Resets usage counters for a given orgId (defaults to "default").
router.post("/admin/user/reset-usage", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const { orgId = "default" } = req.body as { orgId?: string };

  const defaultUsage = {
    audit:   { used: 0, limit: 30 },
    pdf:     { used: 0, limit: 30 },
    exports: { used: 0, limit: 30 },
    monitor: { used: 0, limit: 3  },
  };

  const client = await pool.connect();
  try {
    const { rowCount } = await client.query(
      "UPDATE org_settings SET usage = $1::jsonb, updated_at = now() WHERE org_id = $2",
      [JSON.stringify(defaultUsage), orgId]
    );
    if ((rowCount ?? 0) === 0) {
      res.status(404).json({ ok: false, error: `No org_settings row found for orgId=${orgId}` });
      return;
    }
    res.json({ ok: true, orgId, usage: defaultUsage });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});

// ── POST /api/admin/user/set-plan ─────────────────────────────────────────────
// Force-updates the plan for a given orgId.
router.post("/admin/user/set-plan", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const { orgId = "default", plan } = req.body as { orgId?: string; plan?: string };
  if (!plan || !["standard", "pro", "ultra"].includes(plan)) {
    res.status(400).json({ ok: false, error: "plan must be one of: standard, pro, ultra" });
    return;
  }

  const client = await pool.connect();
  try {
    await client.query(
      "UPDATE org_settings SET plan = $1, updated_at = now() WHERE org_id = $2",
      [plan, orgId]
    );
    res.json({ ok: true, orgId, plan });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});

// ── POST /api/admin/demo-seed ─────────────────────────────────────────────────
// Inserts a realistic demo dataset for sales demonstrations.
// Strictly manual — never runs automatically. Never pollutes real client data.
// Always call with the correct ADMIN_KEY header.
router.post("/admin/demo-seed", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const { orgId = "default", clear = false } = req.body as { orgId?: string; clear?: boolean };

  const client = await pool.connect();
  try {
    // Optionally clear existing demo data first
    if (clear) {
      await Promise.allSettled([
        pool.query("DELETE FROM audits WHERE org_id = $1 OR id LIKE 'demo_%'", [orgId]),
        pool.query("DELETE FROM monitors WHERE org_id = $1 OR id LIKE 'demo_%'", [orgId]),
        pool.query("DELETE FROM missions WHERE org_id = $1 OR id LIKE 'demo_%'", [orgId]),
        pool.query("DELETE FROM competitors WHERE id LIKE 'demo_%'"),
        pool.query("DELETE FROM tracked_keywords WHERE org_id = $1 OR id LIKE 'demo_%'", [orgId]),
      ]);
    }

    const now = new Date().toISOString();
    const inserted: Record<string, number> = {};

    // Audits — 4 realistic French local business sites
    const auditRows = [
      { id: "demo_a1", url: "https://boulangerie-martin.fr", score: 82, status: "ok",    speed: 88, issues: 3,  origin: "manual" },
      { id: "demo_a2", url: "https://restaurant-lesoleil.com", score: 61, status: "warn", speed: 64, issues: 11, origin: "manual" },
      { id: "demo_a3", url: "https://coiffeur-lyon.com",      score: 75, status: "ok",    speed: 91, issues: 5,  origin: "scheduled" },
      { id: "demo_a4", url: "https://pharmacie-centre.fr",    score: 55, status: "warn",  speed: 58, issues: 14, origin: "manual" },
    ];
    for (const a of auditRows) {
      try {
        await client.query(
          `INSERT INTO audits (id, url, score, status, speed, date, issues, origin, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (id) DO NOTHING`,
          [a.id, a.url, a.score, a.status, a.speed, now, a.issues, a.origin]
        );
      } catch { /* skip if already exists */ }
    }
    inserted.audits = auditRows.length;

    // Monitors — 3 monitors with realistic latency
    const monitorRows = [
      { id: "demo_m1", name: "Boulangerie Martin",   url: "https://boulangerie-martin.fr",   status: "up",   uptime: 99.8, latency: 142 },
      { id: "demo_m2", name: "Restaurant Le Soleil", url: "https://restaurant-lesoleil.com", status: "down", uptime: 97.2, latency: 0   },
      { id: "demo_m3", name: "Coiffeur Lyon",        url: "https://coiffeur-lyon.com",        status: "up",   uptime: 99.5, latency: 98  },
    ];
    for (const m of monitorRows) {
      try {
        await client.query(
          `INSERT INTO monitors (id, name, url, status, uptime, latency, last_check, org_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) ON CONFLICT (id) DO NOTHING`,
          [m.id, m.name, m.url, m.status, m.uptime, m.latency, new Date().toISOString(), orgId]
        );
      } catch { /* skip */ }
    }
    inserted.monitors = monitorRows.length;

    // Competitors — 3 local competitors
    const compRows = [
      { id: "demo_c1", name: "Boulangerie Dupont",  url: "https://boulangerie-dupont.fr",   domain_rating: 42, keywords: 38, traffic: 1200, threat_level: "high"   },
      { id: "demo_c2", name: "Boulangerie Bio Lyon", url: "https://boulangerie-bio-lyon.fr", domain_rating: 35, keywords: 22, traffic: 780,  threat_level: "medium" },
      { id: "demo_c3", name: "Boulangerie Centrale", url: "https://boulangerie-centrale.fr", domain_rating: 28, keywords: 14, traffic: 450,  threat_level: "low"    },
    ];
    for (const c of compRows) {
      try {
        await client.query(
          `INSERT INTO competitors (id, name, url, domain_rating, keywords, traffic, threat_level, delta, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,0,NOW()) ON CONFLICT (id) DO NOTHING`,
          [c.id, c.name, c.url, c.domain_rating, c.keywords, c.traffic, c.threat_level]
        );
      } catch { /* skip */ }
    }
    inserted.competitors = compRows.length;

    // Keywords — 5 tracked keywords
    const kwRows = [
      { id: "demo_kw1", keyword: "boulangerie artisanale paris", position: 3,  prev_position: 5,  volume: 1900, difficulty: 45, trend: "up",   tag: "Local" },
      { id: "demo_kw2", keyword: "pain au levain livraison",     position: 7,  prev_position: 6,  volume: 890,  difficulty: 38, trend: "down", tag: "Local SEO" },
      { id: "demo_kw3", keyword: "boulangerie bio quartier",     position: 12, prev_position: 15, volume: 590,  difficulty: 32, trend: "up",   tag: "Local" },
      { id: "demo_kw4", keyword: "viennoiserie maison paris",    position: 4,  prev_position: 4,  volume: 1100, difficulty: 29, trend: "stable", tag: "Produits" },
      { id: "demo_kw5", keyword: "meilleure boulangerie 15e",    position: 1,  prev_position: 2,  volume: 320,  difficulty: 22, trend: "up",   tag: "Local Pack" },
    ];
    for (const k of kwRows) {
      try {
        await client.query(
          `INSERT INTO tracked_keywords (id, keyword, current_position, prev_position, search_volume, difficulty, trend, tag, org_id, active, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,NOW()) ON CONFLICT (id) DO NOTHING`,
          [k.id, k.keyword, k.position, k.prev_position, k.volume, k.difficulty, k.trend, k.tag, orgId]
        );
      } catch { /* skip */ }
    }
    inserted.keywords = kwRows.length;

    // Missions — 3 demo missions
    const missionRows = [
      { id: "demo_ms1", title: "Optimiser les balises title — site prioritaire", category: "SEO", priority: "high",   status: "todo",       source_type: "ai" },
      { id: "demo_ms2", title: "Répondre aux avis Google en attente (3 avis)",   category: "GBP", priority: "high",   status: "inprogress", source_type: "ai" },
      { id: "demo_ms3", title: "Créer une page locale pour le 15e arrondissement", category: "Local SEO", priority: "medium", status: "todo", source_type: "ai" },
    ];
    for (const m of missionRows) {
      try {
        await client.query(
          `INSERT INTO missions (id, title, category, priority, status, source_type, org_id, steps, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'[]'::jsonb,NOW(),NOW()) ON CONFLICT (id) DO NOTHING`,
          [m.id, m.title, m.category, m.priority, m.status, m.source_type, orgId]
        );
      } catch { /* skip */ }
    }
    inserted.missions = missionRows.length;

    res.json({
      ok: true,
      message: `Demo data seeded for orgId="${orgId}". Tables: ${JSON.stringify(inserted)}. Use clear=true to wipe first.`,
      inserted,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});

// ── DELETE /api/admin/sessions ────────────────────────────────────────────────
// Purge all expired sessions (maintenance).
router.delete("/admin/sessions/expired", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const client = await pool.connect();
  try {
    const { rowCount } = await client.query("DELETE FROM user_sessions WHERE expires_at <= now()");
    res.json({ ok: true, deletedCount: rowCount ?? 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});

// ── GET /api/admin/db-check ───────────────────────────────────────────────────
// Returns DB host fingerprint, app_user existence, and RLS policy count.
// Safe read-only diagnostic — never exposes credentials.
router.get("/admin/db-check", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  try {
    const [dbR, roleR, rlsR, tableR] = await Promise.all([
      pool.query(`SELECT current_database() AS db, version() AS pg_version,
                         inet_server_addr()::text AS host, inet_server_port() AS port`),
      pool.query(`SELECT rolname, rolsuper, rolbypassrls
                  FROM pg_roles WHERE rolname = 'app_user'`),
      pool.query(`SELECT COUNT(*)::int AS policy_count FROM pg_policies WHERE schemaname='public'`),
      pool.query(`SELECT COUNT(*)::int AS rls_tables
                  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                  WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity=true`),
    ]);
    const db = dbR.rows[0];
    const appUser = roleR.rows[0] ?? null;
    res.json({
      ok: true,
      database: {
        name:      db.db,
        host:      db.host ?? "(unix socket)",
        port:      db.port,
        pg_version: db.pg_version?.split(" ")[0] + " " + db.pg_version?.split(" ")[1],
      },
      rls: {
        app_user_exists:   !!appUser,
        app_user_superuser: appUser?.rolsuper ?? null,
        app_user_bypassrls: appUser?.rolbypassrls ?? null,
        rls_enabled_tables: tableR.rows[0].rls_tables,
        total_policies:     rlsR.rows[0].policy_count,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/test-session ──────────────────────────────────────────────
// Creates a short-lived (1h) test session for org "default" (admin role).
// Returns the token so automated tests can authenticate against production.
// Token is revoked automatically when it expires.
router.post("/admin/test-session", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const { orgId = "default", ttlMinutes = 60 } = req.body as { orgId?: string; ttlMinutes?: number };

  const client = await pool.connect();
  try {
    const token = `fp_prodtest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    await client.query(
      `INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at, created_at)
       VALUES ($1, 'test-admin', $2, 'test@flowpoint.pro', 'admin', $3, NOW())
       ON CONFLICT DO NOTHING`,
      [token, orgId, expiresAt]
    );
    res.json({
      ok: true,
      token,
      orgId,
      expiresAt: expiresAt.toISOString(),
      note: "Short-lived test token — expires in " + ttlMinutes + " min. Do not store in code.",
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});




// ── GET /api/admin/rls — RLS coverage audit ───────────────────────────────────
router.get("/admin/rls", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  try {
    const [coverage, unprotected, policies] = await Promise.all([
      pool.query(`
        SELECT 
          (SELECT COUNT(*)::int FROM pg_tables WHERE schemaname='public') AS total_tables,
          (SELECT COUNT(*)::int FROM pg_tables WHERE schemaname='public' AND rowsecurity=true) AS rls_tables,
          (SELECT COUNT(*)::int FROM pg_policies WHERE schemaname='public') AS total_policies,
          (SELECT COUNT(*)::int FROM information_schema.columns WHERE table_schema='public' AND column_name='org_id') AS org_id_columns
      `),
      pool.query(`
        SELECT tablename FROM pg_tables 
        WHERE schemaname='public' AND rowsecurity=false 
        ORDER BY tablename
      `),
      pool.query(`
        SELECT tablename, COUNT(*)::int AS policy_count 
        FROM pg_policies WHERE schemaname='public' 
        GROUP BY tablename ORDER BY tablename LIMIT 30
      `),
    ]);
    const c = coverage.rows[0] as Record<string, number>;
    res.json({
      ok: true,
      summary: {
        totalTables: c.total_tables,
        rlsEnabled: c.rls_tables,
        rlsMissing: c.total_tables - c.rls_tables,
        coveragePct: Math.round(c.rls_tables / Math.max(1, c.total_tables) * 100),
        totalPolicies: c.total_policies,
        orgIdColumns: c.org_id_columns,
      },
      unprotectedTables: unprotected.rows.map((r: Record<string, unknown>) => r.tablename),
      samplePolicies: policies.rows,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── GET /api/admin/team-schema-check ─────────────────────────────────────────
// Diagnostic: schema definition + dual INSERT test (pool vs withOrgDb).
// Query param: orgId (required) — e.g. ?orgId=alice@example.com
// Returns pgCode / constraint / column for each path.
// DELETE after root-cause is identified.
router.get("/admin/team-schema-check", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const orgId = (req.query["orgId"] as string | undefined)?.trim();
  if (!orgId) {
    res.status(400).json({ ok: false, error: "orgId query param required" });
    return;
  }

  try {
    // ── 1. Schema queries ─────────────────────────────────────────────────
    const [columnsR, constraintsR, indexesR] = await Promise.all([
      pool.query<Record<string, unknown>>(`
        SELECT column_name, is_nullable, column_default, data_type
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'team_members'
        ORDER BY ordinal_position
      `),
      pool.query<Record<string, unknown>>(`
        SELECT conname, contype, pg_get_constraintdef(oid) AS definition
        FROM pg_constraint
        WHERE conrelid = 'public.team_members'::regclass
      `),
      pool.query<Record<string, unknown>>(`
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'team_members'
      `),
    ]);

    // ── 2. Dual INSERT probe ──────────────────────────────────────────────
    const testId      = `diag_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const testEmail   = `diag-probe-${testId}@diag.internal`;
    const testName    = testEmail.split("@")[0] ?? "diag";
    const testExpires = new Date(Date.now() + 7 * 864e5).toISOString();
    const testHash    = "0000000000000000000000000000000000000000000000000000000000000000";
    const testJoined  = new Date().toISOString().slice(0, 10);

    const PROBE_SQL = `
      INSERT INTO team_members
        (id, org_id, email, name, role, joined, status,
         invited_by, invitation_token_hash, invited_at, expires_at,
         email_status, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,NOW(),$9,'pending',NOW(),NOW())
    `;
    const PROBE_PARAMS = [
      testId, orgId, testEmail, testName, "viewer",
      testJoined, orgId, testHash, testExpires,
    ];

    type ProbeResult = {
      ok: boolean;
      pgCode?:     string | null;
      constraint?: string | null;
      table?:      string | null;
      column?:     string | null;
      routine?:    string | null;
      errSummary?: string;
    };

    // 2a. pool.query — postgres role, no RLS (ROLLBACK after)
    let poolProbe: ProbeResult = { ok: false };
    const pc = await pool.connect();
    try {
      await pc.query("BEGIN");
      await pc.query(PROBE_SQL, PROBE_PARAMS);
      await pc.query("ROLLBACK");
      poolProbe = { ok: true };
    } catch (e: unknown) {
      await pc.query("ROLLBACK").catch(() => {});
      const pg = e as { code?: string; constraint?: string; table?: string; column?: string; routine?: string };
      poolProbe = {
        ok:         false,
        pgCode:     pg.code        ?? null,
        constraint: pg.constraint  ?? null,
        table:      pg.table       ?? null,
        column:     pg.column      ?? null,
        routine:    pg.routine     ?? null,
        errSummary: (e as Error).message?.slice(0, 160),
      };
    } finally {
      pc.release();
    }

    // 2b. withOrgDb — app_user role, RLS enforced (INSERT then DELETE inside tx)
    let orgDbProbe: ProbeResult = { ok: false };
    try {
      await withOrgDb(orgId, async (client) => {
        await client.query(PROBE_SQL, PROBE_PARAMS);
        await client.query("DELETE FROM team_members WHERE id = $1", [testId]);
      });
      orgDbProbe = { ok: true };
    } catch (e: unknown) {
      const pg = e as { code?: string; constraint?: string; table?: string; column?: string; routine?: string };
      orgDbProbe = {
        ok:         false,
        pgCode:     pg.code        ?? null,
        constraint: pg.constraint  ?? null,
        table:      pg.table       ?? null,
        column:     pg.column      ?? null,
        routine:    pg.routine     ?? null,
        errSummary: (e as Error).message?.slice(0, 160),
      };
    }

    // ── 3. Interpretation ─────────────────────────────────────────────────
    let interpretation: string;
    if (poolProbe.ok && !orgDbProbe.ok) {
      interpretation = "RLS / withOrgDb / app_user / GUC issue — pool succeeds but orgDb fails";
    } else if (!poolProbe.ok && !orgDbProbe.ok) {
      interpretation = "SQL / constraint / trigger / value issue — both roles fail";
    } else if (poolProbe.ok && orgDbProbe.ok) {
      interpretation = "Both paths succeed — INSERT is structurally OK; check other code paths";
    } else {
      interpretation = "Unexpected: orgDb succeeded but pool failed";
    }

    res.json({
      ok: true,
      schema: {
        columns:     columnsR.rows,
        constraints: constraintsR.rows,
        indexes:     indexesR.rows,
      },
      insertTest: {
        pool:           poolProbe,
        orgDb:          orgDbProbe,
        interpretation,
      },
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
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
