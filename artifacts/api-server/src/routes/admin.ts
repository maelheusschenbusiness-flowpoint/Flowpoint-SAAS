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

// Minimum key length: a short key (e.g. a dev placeholder like "secret" or "admin")
// is rejected to prevent accidental use of development keys in production.
const ADMIN_KEY_MIN_LEN = 32;

function requireAdminKey(req: Request, res: Response): boolean {
  const key = process.env["ADMIN_KEY"];
  if (!key) {
    res.status(503).json({ ok: false, error: "ADMIN_KEY is not configured on this server" });
    return false;
  }
  if (key.length < ADMIN_KEY_MIN_LEN) {
    res.status(503).json({
      ok: false,
      error: `ADMIN_KEY is too short (${key.length} chars) — minimum ${ADMIN_KEY_MIN_LEN} required. ` +
             `A short key is rejected to prevent accidental use of development keys in production.`,
    });
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

  const { orgId = "default", ttlMinutes = 60, role: rawRole = "admin" } = req.body as { orgId?: string; ttlMinutes?: number; role?: string };
  const VALID_ROLES = ["owner", "admin", "member", "viewer"];
  const role = VALID_ROLES.includes(rawRole) ? rawRole : "admin";

  const client = await pool.connect();
  try {
    // Test convenience: when the orgId is a UUID, ensure a matching organizations
    // row exists — AI usage tables (ai_usage_logs / ai_monthly_usage) have an FK
    // to organizations(id), so a session on a non-existent org could never track usage.
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
      await client.query(
        `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan)
         VALUES ($1::uuid, 'Test Org', 'test-org-' || left($1::text, 8), 'test-admin', 'active', 'pro')
         ON CONFLICT (id) DO NOTHING`,
        [orgId]
      );
    }
    const token = `fp_prodtest_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);
    await client.query(
      `INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at, created_at)
       VALUES ($1, 'test-admin', $2, 'test@flowpoint.pro', $4, $3, NOW())
       ON CONFLICT DO NOTHING`,
      [token, orgId, expiresAt, role]
    );
    res.json({
      ok: true,
      token,
      orgId,
      expiresAt: expiresAt.toISOString(),
      note: "Short-lived test token — expires in " + ttlMinutes + " min. Do not store in code.",
    });
  } catch (err) {
    console.error("[Admin] test-session failed:", err);
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});




// ── POST /api/admin/provision-qa-account ─────────────────────────────────────
//
// Creates (or refreshes) the single permanent QA account used by Browser Use
// and automated test pipelines.
//
// Security constraints (see user story 2026-08-26):
//   • Protected by ADMIN_KEY (min 32 chars) — rejected with 503 if key absent.
//   • Rate-limited: max 5 calls per IP per hour in-process (no external dep).
//   • Session TTL: 8 h (not 365 d) — short enough to limit blast radius.
//   • Token never logged; only returned once in the immediate HTTP response.
//   • Audit line emitted on every call: timestamp, IP, UA — no token.
//   • No parameters accepted — email, org UUID, plan are all hardcoded constants.
//     The endpoint cannot create any account other than qa@flowpoint.pro.
//   • Premium access comes from organizations.is_internal_qa=true + a fixed UUID
//     guard in billing-context.ts — NOT from trialing/trial_ends_at tricks.
//   • qa@flowpoint.pro is hardcoded in PURGE_SYSTEM_EMAILS; the org is purge-proof.
//
// How Browser Use reconnects after environment recycling:
//   1. POST /api/admin/provision-qa-account  (x-admin-key header).
//   2. sessionStorage.setItem('fp_session_token', data.sessionToken)
//   3. location.href = '/dashboard.html'

/** Fixed UUIDs — stable across re-provisions; referenced in FK indexes. */
const QA_USER_UUID = "10000000-0000-4000-8000-000000000001";
const QA_ORG_UUID  = "10000000-0000-4000-8000-000000000002";
const QA_EMAIL     = "qa@flowpoint.pro";

/** QA session TTL: 8 hours — short to limit blast radius on token leak. */
const QA_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Rate-limit state: maps IP → { count, windowStartMs } — in-process, no persistence. */
const _qaProvisionRateLimit = new Map<string, { count: number; windowStart: number }>();
const QA_RATE_MAX   = 5;     // maximum calls per window per IP
const QA_RATE_WIN   = 60 * 60 * 1000; // 1-hour window

function checkQaRateLimit(ip: string): { allowed: boolean; retryAfterSec: number } {
  const now   = Date.now();
  const entry = _qaProvisionRateLimit.get(ip);
  if (!entry || now - entry.windowStart > QA_RATE_WIN) {
    _qaProvisionRateLimit.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSec: 0 };
  }
  if (entry.count >= QA_RATE_MAX) {
    const retryAfterSec = Math.ceil((QA_RATE_WIN - (now - entry.windowStart)) / 1000);
    return { allowed: false, retryAfterSec };
  }
  entry.count++;
  return { allowed: true, retryAfterSec: 0 };
}

router.post("/admin/provision-qa-account", async (req: Request, res: Response): Promise<void> => {
  // ── 0. ADMIN_KEY gate (returns 503 when key absent, 403 when wrong) ───────
  if (!requireAdminKey(req, res)) return;

  // ── 1. Rate limit (5 / hour / IP) ────────────────────────────────────────
  const callerIp = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? "unknown";
  const rl = checkQaRateLimit(callerIp);
  if (!rl.allowed) {
    res.setHeader("Retry-After", String(rl.retryAfterSec));
    res.status(429).json({
      ok: false,
      error: `Rate limit exceeded — max ${QA_RATE_MAX} calls/hour per IP. Retry in ${rl.retryAfterSec}s.`,
    });
    return;
  }

  const callerUa = (req.headers["user-agent"] as string | undefined) ?? "unknown";

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // ── 2. users row (idempotent) ─────────────────────────────────────────────
    await client.query(
      `INSERT INTO users (id, email, status, email_verified, auth_provider)
       VALUES ($1::uuid, $2, 'active', true, 'magic_link')
       ON CONFLICT (id) DO UPDATE
         SET status = 'active', email_verified = true`,
      [QA_USER_UUID, QA_EMAIL],
    );

    // ── 3. organizations row (idempotent) ─────────────────────────────────────
    // Premium access is granted via is_internal_qa=true + the QA_ORG_UUID guard
    // in billing-context.ts — NOT via trialing/trial_ends_at hacks.
    // subscription_status stays 'none'; the billing-context short-circuit fires
    // only when orgId === QA_ORG_UUID AND is_internal_qa=true simultaneously.
    await client.query(
      `INSERT INTO organizations
         (id, name, slug, owner_user_id, owner_email, status, plan,
          subscription_status, is_internal_qa)
       VALUES ($1::uuid, 'QA Organisation', 'qa-organisation', $2, $3,
               'active', 'ultra', 'none', true)
       ON CONFLICT (id) DO UPDATE
         SET status          = 'active',
             plan            = 'ultra',
             is_internal_qa  = true,
             owner_user_id   = $2,
             owner_email     = $3,
             -- Clear the legacy trialing/trial_ends_at debt from the initial provision
             subscription_status = 'none',
             trial_ends_at       = NULL,
             trial_consumed_at   = NULL`,
      [QA_ORG_UUID, QA_USER_UUID, QA_EMAIL],
    );

    // ── 4. organization_members row (idempotent) ──────────────────────────────
    await client.query(
      `INSERT INTO organization_members
         (id, organization_id, user_id, role, status, joined_at)
       VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'owner', 'active', NOW())
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET role = 'owner', status = 'active'`,
      [QA_ORG_UUID, QA_USER_UUID],
    );

    // ── 5. Fresh 8-hour session token ─────────────────────────────────────────
    // New token issued on every call — Browser Use stores it after each provision.
    // getSession() is a plain DB lookup (no HMAC on the token string itself).
    // $2 = TEXT (user_id), $6 = separate UUID param for user_id_v2 to avoid
    // pg type-inference conflict ("inconsistent types deduced for parameter").
    const { randomBytes } = await import("crypto");
    const sessionToken = `fp_qa_${randomBytes(32).toString("hex")}`;
    const expiresAt    = new Date(Date.now() + QA_SESSION_TTL_MS);

    await client.query(
      `INSERT INTO user_sessions
         (token, user_id, org_id, email, role, expires_at, created_at, user_id_v2)
       VALUES ($1, $2, $3, $4, 'owner', $5, NOW(), $6::uuid)
       ON CONFLICT DO NOTHING`,
      [sessionToken, QA_USER_UUID, QA_ORG_UUID, QA_EMAIL, expiresAt, QA_USER_UUID],
    );

    await client.query("COMMIT");

    // ── 6. Audit log — timestamp, IP, UA; token is intentionally absent ───────
    console.log(JSON.stringify({
      event:      "QA_PROVISION",
      ts:         new Date().toISOString(),
      ip:         callerIp,
      ua:         callerUa,
      orgId:      QA_ORG_UUID,
      expiresAt:  expiresAt.toISOString(),
      // sessionToken is deliberately NOT logged — it is equivalent to a credential.
    }));

    // ── 7. Response — token returned once, never cached server-side ───────────
    res.json({
      ok:          true,
      email:       QA_EMAIL,
      orgId:       QA_ORG_UUID,
      userId:      QA_USER_UUID,
      plan:        "ultra",
      sessionToken,                          // only appearance of the token
      expiresAt:   expiresAt.toISOString(),  // 8 h from now
      purgeExempt: true,
      reconnect: [
        "sessionStorage.setItem('fp_session_token', data.sessionToken)",
        "location.href = '/dashboard.html'",
      ],
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Log error without leaking the token (token is in local scope but not in err)
    console.error("[Admin] provision-qa-account failed:", safeErrMsg(err));
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  } finally {
    client.release();
  }
});

// ── POST /api/admin/ai-usage-seed ─────────────────────────────────────────────
// Forces an org's ai_monthly_usage row to a specific credits_used value.
// Intended for automated tests only — lets tests ensure EXHAUSTED state before running.
router.post("/admin/ai-usage-seed", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const { orgId, creditsUsed } = req.body as { orgId?: string; creditsUsed?: number };
  if (!orgId || creditsUsed == null || typeof creditsUsed !== "number") {
    res.status(400).json({ ok: false, error: "orgId (string) and creditsUsed (number) required" });
    return;
  }

  const month = new Date().toISOString().slice(0, 7); // "YYYY-MM"
  const resetAt = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString();
  const id = `amu_${orgId}_${month}`;

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orgId)) {
    res.status(400).json({ ok: false, error: "orgId must be a UUID (ai_monthly_usage.org_id is UUID with FK to organizations)" });
    return;
  }

  try {
    await pool.query(
      `INSERT INTO organizations (id, name, slug, owner_user_id, status, plan)
       VALUES ($1::uuid, 'Test Org', 'test-org-' || left($1::text, 8), 'test-admin', 'active', 'pro')
       ON CONFLICT (id) DO NOTHING`,
      [orgId]
    );
    await pool.query(
      `INSERT INTO ai_monthly_usage (id, org_id, month, credits_used, cost_eur, request_count, tokens_used, reset_at, updated_at)
       VALUES ($1, $2, $3, $4, 0, 0, 0, $5, NOW())
       ON CONFLICT (org_id, month) DO UPDATE SET credits_used = EXCLUDED.credits_used, updated_at = NOW()`,
      [id, orgId, month, creditsUsed, resetAt]
    );
    res.json({ ok: true, orgId, month, creditsUsed });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
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

// ── DELETE /api/admin/purge-account ──────────────────────────────────────────
// Emergency ops endpoint — force-deletes ALL data for an account identified by
// email when the normal DELETE /billing/account is blocked (e.g. Stripe customer
// already deleted externally so subscriptions.list() throws resource_missing).
// Auth: x-admin-key header required.
router.delete("/admin/purge-account", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;

  const { email } = req.body as { email?: string };
  if (!email || typeof email !== "string" || !email.includes("@")) {
    res.status(400).json({ ok: false, error: "email (string) required in body" });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();

  const client = await pool.connect();
  try {
    // ── Resolve all org IDs for this email ────────────────────────────────────
    // 1. Legacy: org_settings keyed by email directly
    const legacyOrg = await client.query<{ org_id: string }>(
      `SELECT org_id FROM org_settings WHERE lower(org_id) = $1`, [normalizedEmail]
    );
    // 2. New: organizations keyed by owner_email, or via users+organization_members
    const uuidOrgs = await client.query<{ id: string }>(
      `SELECT DISTINCT o.id::text
       FROM organizations o
       LEFT JOIN users u ON lower(u.email) = $1
       LEFT JOIN organization_members om ON om.user_id = u.id
       WHERE lower(o.owner_email) = $1
          OR o.id::text = om.organization_id`,
      [normalizedEmail]
    );

    const orgIds: string[] = [
      ...legacyOrg.rows.map(r => r.org_id),
      ...uuidOrgs.rows.map(r => r.id),
    ].filter(Boolean);

    const orgTables = [
      "audits","audit_schedules","reports","report_exports",
      "monitors","monitor_checks","monitor_incidents",
      "alert_rules","alert_events","tracked_keywords","calendar_events",
      "team_members","team_invitations","team_messages","team_files",
      "user_sessions","google_oauth_states",
      "automation_integrations","automation_workflows","automation_runs",
      "automation_logs","workflow_runs","incoming_webhooks",
      "missions","mission_history","mission_ai_logs",
      "psi_cache","seo_forecasts","funnels","funnel_steps",
      "ga4_accounts","gsc_keyword_data","gsc_page_data","gsc_sync_logs",
      "google_tokens","github_connections",
      "behavior_events","behavior_sessions",
      "traffic_sources","traffic_losses","cro_scores","cro_experiments","revenue_leaks",
      "local_pack_history",
      "org_addons","org_checklist","org_monitor_quota","org_secrets",
      "org_quota_usage","checkout_post_tokens",
      "overview_insights_cache","overview_insights_rl",
      "activity_log","share_tokens","growth_objectives",
      "ai_usage_logs","ai_monthly_usage","ai_credit_purchases",
      "ai_recommendations","onboarding_sessions","ai_workspace_profiles",
      "ai_generated_missions","ai_setup_logs",
    ];

    // Verify which tables actually exist (avoids aborting tx on missing tables)
    const existCheck = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename = ANY($1)`,
      [orgTables]
    );
    const existingSet = new Set(existCheck.rows.map(r => r.tablename));

    await client.query("BEGIN");

    const deleted: Record<string, number> = {};

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
  const { orgId } = req.body as { orgId?: string };
  if (!orgId) { res.status(400).json({ ok: false, error: "orgId required" }); return; }
  try {
    const { createStripeClient } = await import("../services/stripe-client.js");
    const { activateAddon } = await import("../services/addons-service.js");
    const { getAddonForPriceId } = await import("../lib/plans.js");
    const stripe = createStripeClient();

    // Resolve stripe customer id for this org — UNION ALL with LIMIT applied
    // to the whole result set (not just the second branch).
    const custRes = await pool.query(
      `SELECT stripe_customer_id
         FROM (
           SELECT stripe_customer_id FROM org_settings
            WHERE org_id = $1
              AND stripe_customer_id IS NOT NULL AND stripe_customer_id <> ''
           UNION ALL
           SELECT stripe_customer_id FROM organizations
            WHERE id::text = $1
              AND stripe_customer_id IS NOT NULL AND stripe_customer_id <> ''
         ) _t
        LIMIT 1`,
      [orgId]
    );
    const customerId = String(custRes.rows[0]?.stripe_customer_id ?? "").trim();
    if (!customerId) { res.status(404).json({ ok: false, error: "No Stripe customer for this org" }); return; }

    // Build a merged priceId → addonKey map covering both live and test prices
    // so reconciliation works regardless of the Stripe mode used at checkout.
    const { ADDON_PRICE_IDS, ADDON_PRICE_IDS_TEST } = await import("../lib/plans.js");
    const combinedPriceMap: Record<string, string> = {};
    for (const [addon, id] of Object.entries(ADDON_PRICE_IDS as Record<string, string>)) {
      if (id) combinedPriceMap[id] = addon;
    }
    for (const [addon, id] of Object.entries((ADDON_PRICE_IDS_TEST ?? {}) as Record<string, string>)) {
      if (id) combinedPriceMap[id] = addon;
    }
    const lookupAddon = (priceId: string): string | null => combinedPriceMap[priceId] ?? null;

    // Fetch all subscriptions (will filter by status below)
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
      expand: ["data.items.data.price"],
    });

    const activated: string[] = [];
    const skipped: string[] = [];
    const errors: string[] = [];

    for (const sub of subs.data) {
      if (!["active","trialing","past_due"].includes(sub.status)) continue;
      for (const item of sub.items.data) {
        const priceId = item.price?.id ?? "";
        const qty     = item.quantity ?? 1;
        // Try price → addon mapping (live + test prices) first
        const addonKey = lookupAddon(priceId);
        // Also check subscription metadata for addonKey (direct addon-checkout path)
        const metaKey  = String(sub.metadata?.["addonKey"] ?? "").trim();
        const metaQty  = Math.max(1, parseInt(String(sub.metadata?.["quantity"] ?? "1"), 10));
        const key      = addonKey || metaKey;
        if (!key) { skipped.push(`price:${priceId}`); continue; }
        const effectiveQty = addonKey ? qty : metaQty;
        try {
          const ok = await activateAddon(key, orgId, effectiveQty);
          if (ok) activated.push(`${key}×${effectiveQty}`);
          else skipped.push(`${key} (already active or unknown key)`);
        } catch (e) {
          errors.push(`${key}: ${safeErrMsg(e)}`);
        }
      }
    }

    res.json({ ok: true, customerId, activated, skipped, errors });
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
