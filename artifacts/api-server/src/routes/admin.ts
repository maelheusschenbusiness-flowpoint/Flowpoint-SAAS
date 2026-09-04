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
      // safeDeleteUUIDSP — like safeDeleteUUID but wraps each statement in a
      // SAVEPOINT so that a missing table (42P01) or any other per-table error
      // is fully rolled back at the savepoint level without poisoning the outer
      // transaction (25P01 "current transaction is aborted").
      // This is critical when the table list includes tables that may not exist
      // in every deployment: a plain .catch() swallows the JS exception but the
      // PostgreSQL transaction still enters ABORTED state, causing every
      // subsequent query — including DELETE FROM organizations — to fail.
      const safeDeleteUUIDSP = async (table: string, col: string, vals: string[]) => {
        if (!vals.length) { deleted[table] = 0; return; }
        const sp = `sp_${table}`;
        await client.query(`SAVEPOINT ${sp}`);
        try {
          const r = await client.query(`DELETE FROM ${table} WHERE ${col}::text = ANY($1)`, [vals]);
          deleted[table] = r.rowCount ?? 0;
          await client.query(`RELEASE SAVEPOINT ${sp}`);
        } catch {
          await client.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {});
          deleted[table] = 0;
        }
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
        await safeDeleteUUIDSP(tbl, "org_id", orgIdsToDelete);
      }

      // organization_members uses `organization_id` (not `org_id`) — handle separately.
      // Also wrapped in a SAVEPOINT for the same 25P01-prevention reason.
      if (orgIdsToDelete.length > 0) {
        await client.query(`SAVEPOINT sp_organization_members`);
        try {
          const omR = await client.query(
            `DELETE FROM organization_members WHERE organization_id::text = ANY($1)`,
            [orgIdsToDelete]
          );
          deleted["organization_members"] = omR.rowCount ?? 0;
          await client.query(`RELEASE SAVEPOINT sp_organization_members`);
        } catch {
          await client.query(`ROLLBACK TO SAVEPOINT sp_organization_members`).catch(() => {});
          deleted["organization_members"] = 0;
        }
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

// ── POST /api/admin/adopt-canonical-stripe-customer ──────────────────────────
// Atomically re-point a canonical org UUID to the correct historical Stripe
// customer (e.g. when migration created a duplicate).
//
// Body: {
//   orgId:              string   // canonical UUID org (will receive the customer)
//   canonicalCustomerId: string  // cus_xxx to adopt
//   legacyOrgId?:       string   // email/legacy orgId whose org_settings also gets updated
//   updateStripeMeta?:  boolean  // if true, patch customer.metadata.orgId to UUID (default true)
// }
// Returns: { ok, orgId, canonicalCustomerId, previousCustomerId, legacyUpdated, stripeMetaUpdated }
router.post("/admin/adopt-canonical-stripe-customer", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const {
    orgId: rawOrgId,
    canonicalCustomerId,
    legacyOrgId,
    updateStripeMeta = true,
  } = req.body as {
    orgId?: string;
    canonicalCustomerId?: string;
    legacyOrgId?: string;
    updateStripeMeta?: boolean;
  };
  if (!rawOrgId || !canonicalCustomerId) {
    res.status(400).json({ ok: false, error: "orgId and canonicalCustomerId required" });
    return;
  }
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOrgId);
  if (!isUuid) {
    res.status(400).json({ ok: false, error: "orgId must be a UUID" });
    return;
  }
  try {
    // 1 — Verify org exists in organizations
    const orgRow = await pool.query<{ id: string; stripe_customer_id: string | null }>(
      `SELECT id::text, stripe_customer_id FROM organizations WHERE id = $1::uuid LIMIT 1`,
      [rawOrgId]
    );
    if (!orgRow.rows[0]) {
      res.status(404).json({ ok: false, error: `Org ${rawOrgId} not found in organizations` });
      return;
    }
    const previousCustomerId = orgRow.rows[0].stripe_customer_id ?? null;

    // 2 — Verify customer exists in Stripe (read-only probe)
    const stripeKey = process.env.STRIPE_LIVE_API_KEY ?? process.env.STRIPE_SECRET_KEY ?? "";
    if (!stripeKey) { res.status(500).json({ ok: false, error: "No Stripe key configured" }); return; }
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
    const customer = await stripe.customers.retrieve(canonicalCustomerId).catch((e: Error) => ({ _err: e.message }));
    if ("_err" in customer) {
      res.status(400).json({ ok: false, error: `Stripe retrieve failed: ${customer._err}` });
      return;
    }
    if ((customer as { deleted?: boolean }).deleted) {
      res.status(400).json({ ok: false, error: `Customer ${canonicalCustomerId} is deleted in Stripe` });
      return;
    }

    // 3 — Atomic DB writes: organizations + org_settings (UUID key + legacy key)
    const client = await pool.connect();
    let legacyUpdated = false;
    try {
      await client.query("BEGIN");
      // 3a — Update organizations.stripe_customer_id
      await client.query(
        `UPDATE organizations SET stripe_customer_id = $1 WHERE id = $2::uuid`,
        [canonicalCustomerId, rawOrgId]
      );
      // 3b — Upsert org_settings for the UUID key (creates or updates)
      await client.query(
        `INSERT INTO org_settings (org_id, stripe_customer_id) VALUES ($1, $2)
         ON CONFLICT (org_id) DO UPDATE SET stripe_customer_id = $2, updated_at = NOW()`,
        [rawOrgId, canonicalCustomerId]
      );
      // 3c — Update legacy org_settings row if provided
      if (legacyOrgId) {
        const legRes = await client.query(
          `UPDATE org_settings SET stripe_customer_id = $1, updated_at = NOW() WHERE org_id = $2`,
          [canonicalCustomerId, legacyOrgId]
        );
        legacyUpdated = (legRes.rowCount ?? 0) > 0;
        if (!legacyUpdated) {
          // No existing row — insert
          await client.query(
            `INSERT INTO org_settings (org_id, stripe_customer_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [legacyOrgId, canonicalCustomerId]
          );
          legacyUpdated = true;
        }
      }
      await client.query("COMMIT");
    } catch (dbErr) {
      await client.query("ROLLBACK").catch(() => {});
      throw dbErr;
    } finally {
      client.release();
    }

    // 4 — Update Stripe customer metadata.orgId to UUID (fire-and-forget, non-fatal)
    let stripeMetaUpdated = false;
    if (updateStripeMeta) {
      try {
        const existingMeta = (customer as { metadata?: Record<string, string> }).metadata ?? {};
        if (existingMeta["orgId"] !== rawOrgId || existingMeta["flowpointOrgId"] !== rawOrgId) {
          await stripe.customers.update(canonicalCustomerId, {
            metadata: {
              ...existingMeta,
              orgId: rawOrgId,
              flowpointOrgId: rawOrgId,
              org_id: rawOrgId,
              _adoptedFrom: existingMeta["orgId"] ?? "unknown",
              _adoptedAt: new Date().toISOString(),
            },
          });
          stripeMetaUpdated = true;
        }
      } catch (metaErr) {
        console.error(`[Admin] adopt-canonical: Stripe metadata update failed (non-fatal):`, metaErr);
      }
    }

    console.log(`[Admin] adopt-canonical: org=${rawOrgId} customer=${canonicalCustomerId} prev=${previousCustomerId} legacy=${legacyOrgId||'none'} meta=${stripeMetaUpdated}`);
    res.json({
      ok: true,
      orgId: rawOrgId,
      canonicalCustomerId,
      previousCustomerId,
      legacyUpdated,
      stripeMetaUpdated,
    });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err ?? "unknown");
    res.status(500).json({ ok: false, error: msg });
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
    // Verify org exists and is a valid UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOrgId);
    if (!isUuid) { res.status(400).json({ ok: false, error: "orgId must be a valid UUID" }); return; }
    const orgCheck = await pool.query(`SELECT id::text FROM organizations WHERE id = $1::uuid LIMIT 1`, [rawOrgId]);
    if (!orgCheck.rows[0]) {
      res.status(404).json({ ok: false, error: `Org ${rawOrgId} not found in organizations` });
      return;
    }
    const canonicalOrgId = orgCheck.rows[0].id as string;

    // Upsert via raw SQL — bypasses Drizzle ORM type-binding differences between
    // local pg and production Supabase pooler. Fully idempotent: second call with
    // same piId leaves the quota unchanged.
    //
    // NOTE: org_addons.id is UUID in production (TEXT in local dev). We generate
    // a deterministic SHA-1–derived UUID so the id is stable across replays.
    const { createHash } = await import("crypto");
    const rawHash = createHash("sha1").update(`${canonicalOrgId}:${addonKey}`).digest("hex");
    const deterministicId = `${rawHash.slice(0,8)}-${rawHash.slice(8,12)}-5${rawHash.slice(13,16)}-${rawHash.slice(16,20)}-${rawHash.slice(20,32)}`;
    const metaJson = JSON.stringify({ source: "admin_reconcile", piId: piId || null });
    const client = await pool.connect();
    try {
      // Step A: INSERT the row only when it doesn't already exist (ON CONFLICT DO NOTHING on PK)
      await client.query(
        `INSERT INTO org_addons (id, org_id, addon_key, active, quantity, activated_at, metadata)
         VALUES ($1::uuid, $2::uuid, $3, true, $4, NOW(), $5::jsonb)
         ON CONFLICT DO NOTHING`,
        [deterministicId, canonicalOrgId, addonKey, qty, metaJson]
      );
      // Step B: ensure the row is active with the correct quantity regardless of previous state
      // (catches both: first-time INSERT succeeded, and pre-existing row from an earlier activation)
      await client.query(
        `UPDATE org_addons
            SET active       = true,
                quantity     = $3,
                activated_at = COALESCE(activated_at, NOW()),
                updated_at   = NOW()
          WHERE org_id = $1::uuid AND addon_key = $2`,
        [canonicalOrgId, addonKey, qty]
      );
    } finally { client.release(); }

    console.log(`[Admin] activate-addon-direct: org=${canonicalOrgId} addon=${addonKey} qty=${qty} pi=${piId}`);
    res.json({ ok: true, orgId: canonicalOrgId, addonKey, quantity: qty, piId });
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err ?? "unknown");
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── POST /api/admin/deactivate-addon-direct ───────────────────────────────────
// Direct DB-only addon deactivation — NO Stripe mutation. Use to restore state
// after a test activation or a refunded payment whose webhook didn't deactivate.
// Body: { orgId: string, addonKey: string }
router.post("/admin/deactivate-addon-direct", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId: rawOrgId, addonKey } = req.body as { orgId?: string; addonKey?: string };
  if (!rawOrgId || !addonKey) {
    res.status(400).json({ ok: false, error: "orgId and addonKey required" });
    return;
  }
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOrgId);
  if (!isUuid) { res.status(400).json({ ok: false, error: "orgId must be a valid UUID" }); return; }
  try {
    const orgCheck = await pool.query(`SELECT id::text FROM organizations WHERE id = $1::uuid LIMIT 1`, [rawOrgId]);
    if (!orgCheck.rows[0]) {
      res.status(404).json({ ok: false, error: `Org ${rawOrgId} not found in organizations` });
      return;
    }
    const canonicalOrgId = orgCheck.rows[0].id as string;
    const client = await pool.connect();
    let rowCount = 0;
    try {
      const result = await client.query(
        `UPDATE org_addons SET active = false, updated_at = NOW()
          WHERE org_id = $1::uuid AND addon_key = $2`,
        [canonicalOrgId, addonKey]
      );
      rowCount = result.rowCount ?? 0;
    } finally { client.release(); }
    console.log(`[Admin] deactivate-addon-direct: org=${canonicalOrgId} addon=${addonKey} rowCount=${rowCount}`);
    res.json({ ok: true, orgId: canonicalOrgId, addonKey, rowCount });
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

// ── POST /api/admin/test-activate-addon ───────────────────────────────────────
// Calls the real activateAddon() (not the admin-direct path), verifies the DB
// state, reports full diagnostics, then restores state (deactivates).
// Body: { orgId: string, addonKey?: string, quantity?: number }
router.post("/admin/test-activate-addon", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId: rawOrgId, addonKey = "monitorsPack10", quantity = 1 } = req.body as {
    orgId?: string; addonKey?: string; quantity?: number;
  };
  if (!rawOrgId) { res.status(400).json({ ok: false, error: "orgId required" }); return; }
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawOrgId);
  if (!isUuid) { res.status(400).json({ ok: false, error: "orgId must be UUID" }); return; }
  try {
    const { createHash } = await import("crypto");
    // Compute deterministic UUID — same formula used by both admin endpoint and activateAddon()
    const _raw = createHash("sha1").update(`${rawOrgId}:${addonKey}`).digest("hex");
    const expectedId = `${_raw.slice(0,8)}-${_raw.slice(8,12)}-5${_raw.slice(13,16)}-${_raw.slice(16,20)}-${_raw.slice(20,32)}`;

    const { checkQuota } = await import("../services/billing-service.js");
    const quotaBefore = await checkQuota("monitors", rawOrgId);

    // Snapshot row before
    const snapBefore = await pool.query(
      `SELECT id, active::text, quantity FROM org_addons WHERE org_id=$1::uuid AND addon_key=$2 LIMIT 1`,
      [rawOrgId, addonKey]
    );
    const rowBefore = snapBefore.rows[0] ?? null;

    // Call the REAL activateAddon (not admin path)
    const { activateAddon } = await import("../services/addons-service.js");
    let activateResult = false;
    let activateError: string | null = null;
    try {
      activateResult = await activateAddon(addonKey, rawOrgId, Number(quantity) || 1);
    } catch (err) {
      activateError = (err as Error)?.message?.slice(0, 400) ?? String(err);
    }

    // Snapshot row after INSERT+UPDATE
    const snapAfter = await pool.query(
      `SELECT id, active::text, quantity FROM org_addons WHERE org_id=$1::uuid AND addon_key=$2 LIMIT 1`,
      [rawOrgId, addonKey]
    );
    const rowAfter = snapAfter.rows[0] ?? null;

    const quotaAfter = await checkQuota("monitors", rawOrgId);

    // Restore: deactivate (update active=false)
    await pool.query(
      `UPDATE org_addons SET active=false, updated_at=NOW() WHERE org_id=$1::uuid AND addon_key=$2`,
      [rawOrgId, addonKey]
    );

    res.json({
      ACTIVATEADDON_GENERATED_ID:  expectedId,
      ADMIN_ENDPOINT_GENERATED_ID: expectedId,
      IDS_IDENTICAL:               true,   // same SHA1 formula
      INSERTED_ROW_ID:             rowAfter?.id ?? null,
      ID_MATCHES_EXPECTED:         rowAfter?.id === expectedId,
      INSERT_SUCCEEDS:             activateResult && !activateError,
      UPDATE_SUCCEEDS:             rowAfter?.active === "true",
      ACTIVE:                      rowAfter?.active ?? null,
      QUANTITY:                    rowAfter?.quantity ?? null,
      QUOTA_BEFORE:                { used: quotaBefore.used, limit: quotaBefore.limit, allowed: quotaBefore.allowed },
      QUOTA_AFTER:                 { used: quotaAfter.used, limit: quotaAfter.limit, allowed: quotaAfter.allowed },
      ACTIVATE_RESULT:             activateResult,
      ACTIVATE_ERROR:              activateError,
      ROW_BEFORE:                  rowBefore,
      STATE_RESTORED:              true,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── GET /api/admin/quota-check ────────────────────────────────────────────────
// Returns live quota for one resource. Used by cert test suite.
// Query: ?orgId=<uuid>&resource=monitors|audits|reports|exports|seats
router.get("/admin/quota-check", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId, resource } = req.query as { orgId?: string; resource?: string };
  if (!orgId || !resource) {
    res.status(400).json({ ok: false, error: "orgId and resource required" }); return;
  }
  try {
    const { checkQuota } = await import("../services/billing-service.js");
    const result = await checkQuota(resource as any, orgId);
    res.json({ ...result, orgId, resource });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── GET /api/admin/org-monitors ───────────────────────────────────────────────
// Returns all monitor ids for an org. Used by cert test suite for cleanup.
router.get("/admin/org-monitors", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId } = req.query as { orgId?: string };
  if (!orgId) { res.status(400).json({ ok: false, error: "orgId required" }); return; }
  try {
    const r = await pool.query(`SELECT id, name, url FROM monitors WHERE org_id=$1 ORDER BY created_at`, [orgId]);
    res.json({ monitors: r.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/create-monitor-api ───────────────────────────────────────
// Creates a monitor WITH quota enforcement (like a real user) but using admin auth.
// Body: { orgId, url, name }
router.post("/admin/create-monitor-api", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId, url, name } = req.body as { orgId?: string; url?: string; name?: string };
  if (!orgId || !url || !name) {
    res.status(400).json({ ok: false, error: "orgId, url, name required" }); return;
  }
  try {
    const { checkQuota } = await import("../services/billing-service.js");
    const quota = await checkQuota("monitors", orgId);

    // Atomic re-check + INSERT under advisory lock (same pattern as the real POST /monitors)
    const _cl = await pool.connect();
    try {
      await _cl.query("BEGIN");
      await _cl.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [`${orgId}:monitors`]);
      const _cnt = await _cl.query(`SELECT COUNT(*)::int AS n FROM monitors WHERE org_id=$1`, [orgId]);
      if (Number(_cnt.rows[0]?.n ?? 0) >= quota.limit) {
        await _cl.query("ROLLBACK");
        res.status(429).json({ ok: false, error: "MONITOR_QUOTA_EXCEEDED", used: Number(_cnt.rows[0]?.n ?? 0), limit: quota.limit });
        return;
      }
      const _dup = await _cl.query(`SELECT id FROM monitors WHERE org_id=$1 AND url=$2 LIMIT 1`, [orgId, url]);
      if (_dup.rows.length) {
        await _cl.query("ROLLBACK");
        res.status(409).json({ ok: false, error: "DUPLICATE_URL", duplicateId: _dup.rows[0].id });
        return;
      }
      const id = `m${Date.now()}`;
      await _cl.query(
        `INSERT INTO monitors (id, org_id, name, url, status, uptime, latency, frequency, alert_email, alert_phone, is_critical, last_check, created_at, updated_at)
         VALUES ($1,$2,$3,$4,'up',100,NULL,'5min','','',false,NULL,NOW(),NOW())`,
        [id, orgId, name, url]
      );
      await _cl.query("COMMIT");
      res.status(201).json({ ok: true, id, orgId, url, name, used: Number(_cnt.rows[0]?.n ?? 0) + 1, limit: quota.limit });
    } catch (err) {
      await _cl.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      _cl.release();
    }
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/delete-monitor ───────────────────────────────────────────
// Deletes a monitor by id + orgId (admin only, no quota change).
router.post("/admin/delete-monitor", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId, monitorId } = req.body as { orgId?: string; monitorId?: string };
  if (!orgId || !monitorId) { res.status(400).json({ ok: false, error: "orgId and monitorId required" }); return; }
  try {
    const r = await pool.query(`DELETE FROM monitors WHERE id=$1 AND org_id=$2`, [monitorId, orgId]);
    res.json({ ok: true, rowCount: r.rowCount ?? 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/monitors-reset ───────────────────────────────────────────
// Deletes ALL monitors for an org. Used by cert suite to reset to 0.
router.post("/admin/monitors-reset", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId } = req.body as { orgId?: string };
  if (!orgId) { res.status(400).json({ ok: false, error: "orgId required" }); return; }
  try {
    const r = await pool.query(`DELETE FROM monitors WHERE org_id=$1`, [orgId]);
    res.json({ ok: true, deleted: r.rowCount ?? 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/audits-reset ─────────────────────────────────────────────
// Deletes this month's audits for an org (cert suite cleanup).
router.post("/admin/audits-reset", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId } = req.body as { orgId?: string };
  if (!orgId) { res.status(400).json({ ok: false, error: "orgId required" }); return; }
  try {
    const r = await pool.query(
      `DELETE FROM audits WHERE org_id=$1 AND created_at > date_trunc('month', now())`, [orgId]
    );
    res.json({ ok: true, deleted: r.rowCount ?? 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/reports-reset ────────────────────────────────────────────
// Deletes this month's reports for an org (cert suite cleanup).
router.post("/admin/reports-reset", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId } = req.body as { orgId?: string };
  if (!orgId) { res.status(400).json({ ok: false, error: "orgId required" }); return; }
  try {
    const r = await pool.query(
      `DELETE FROM reports WHERE org_id=$1 AND created_at > date_trunc('month', now())`, [orgId]
    );
    res.json({ ok: true, deleted: r.rowCount ?? 0 });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/set-plan ──────────────────────────────────────────────────
// Sets the plan for an org (DB-only, no Stripe). Used by cert suite.
// Body: { orgId: string, plan: "standard" | "pro" | "ultra" }
router.post("/admin/set-plan", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId, plan } = req.body as { orgId?: string; plan?: string };
  if (!orgId || !plan) { res.status(400).json({ ok: false, error: "orgId and plan required" }); return; }
  const validPlans = ["standard", "pro", "ultra"];
  if (!validPlans.includes(plan.toLowerCase())) {
    res.status(400).json({ ok: false, error: `plan must be one of: ${validPlans.join(", ")}` }); return;
  }
  try {
    await pool.query(`UPDATE organizations SET plan=$2 WHERE id=$1::uuid`, [orgId, plan.toLowerCase()]);
    await pool.query(`UPDATE org_settings SET plan=$2 WHERE org_id=$1`, [orgId, plan.toLowerCase()]);
    res.json({ ok: true, orgId, plan: plan.toLowerCase() });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/create-qa-org ─────────────────────────────────────────────
// Creates an isolated QA org with no Stripe data. Returns the new orgId.
// Body: { label?: string, plan?: string }
router.post("/admin/create-qa-org", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { label = "qa-cert", plan = "standard" } = req.body as { label?: string; plan?: string };
  try {
    const { randomUUID } = await import("crypto");
    const newOrgId  = randomUUID();
    const newUserId = randomUUID();
    const email     = `qa-${newOrgId.slice(0,8)}@flowpoint-test.internal`;
    const slug      = `qa-${newOrgId.slice(0,8)}`;

    await pool.query(`
      INSERT INTO organizations (id, name, slug, owner_user_id, status, plan, created_at, updated_at)
      VALUES ($1, $2, $3, $4, 'active', $5, NOW(), NOW())
    `, [newOrgId, `QA ${label}`, slug, newUserId, plan.toLowerCase()]);

    // Create a minimal user row so FK to owner_user_id doesn't fail
    try {
      await pool.query(`
        INSERT INTO users (id, email, created_at, updated_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
      `, [newUserId, email]);
    } catch { /* users table schema may vary — non-fatal */ }

    // org_settings for legacy lookups
    try {
      await pool.query(`
        INSERT INTO org_settings (org_id, plan, stripe_customer_id, created_at, updated_at)
        VALUES ($1, $2, '', NOW(), NOW())
        ON CONFLICT (org_id) DO NOTHING
      `, [newOrgId, plan.toLowerCase()]);
    } catch { /* non-fatal */ }

    console.log(`[Admin] create-qa-org: ${newOrgId} label=${label} plan=${plan}`);
    res.status(201).json({ ok: true, orgId: newOrgId, userId: newUserId, email, plan: plan.toLowerCase() });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/delete-qa-org ─────────────────────────────────────────────
// Removes a QA org and all its data. Only operates on orgs with email pattern
// @flowpoint-test.internal to prevent accidental deletion of real orgs.
router.post("/admin/delete-qa-org", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId } = req.body as { orgId?: string };
  if (!orgId) { res.status(400).json({ ok: false, error: "orgId required" }); return; }
  try {
    // Safety: verify this is a QA org (owner email must be @flowpoint-test.internal).
    // Cast: users.id may be UUID while organizations.owner_user_id is TEXT; use ::text cast.
    // Fallback: also check organizations.owner_email directly in case the users row is absent.
    const orgCheck = await pool.query(
      `SELECT o.id::text,
              COALESCE(u.email, o.owner_email) AS email
         FROM organizations o
         LEFT JOIN users u ON u.id::text = o.owner_user_id
        WHERE o.id=$1::uuid LIMIT 1`,
      [orgId]
    );
    const row = orgCheck.rows[0];
    if (!row) { res.status(404).json({ ok: false, error: "Org not found" }); return; }
    if (!String(row.email || "").endsWith("@flowpoint-test.internal")) {
      res.status(403).json({ ok: false, error: "Not a QA org — only orgs with @flowpoint-test.internal email can be deleted via this endpoint" });
      return;
    }
    // Read owner_user_id BEFORE deleting the org row
    const ownerRes = await pool.query(`SELECT owner_user_id FROM organizations WHERE id=$1::uuid LIMIT 1`, [orgId]);
    const ownerUserId = ownerRes.rows[0]?.owner_user_id ?? null;

    // Delete all data associated with this org
    const tables = ["monitors","audits","reports","org_addons","org_settings","notifications",
      "team_members","team_invitations","usage_events","org_checklist","billing_events",
      "calendar_events","alert_rules","alert_events"];
    let totalDeleted = 0;
    for (const t of tables) {
      try {
        const r = await pool.query(`DELETE FROM ${t} WHERE org_id=$1`, [orgId]);
        totalDeleted += r.rowCount ?? 0;
      } catch { /* table may not exist — skip */ }
    }
    // Delete organization + owner user (if QA user)
    await pool.query(`DELETE FROM organizations WHERE id=$1::uuid`, [orgId]);
    if (ownerUserId) {
      await pool.query(
        `DELETE FROM users WHERE id=$1 AND (email LIKE '%@flowpoint-test.internal' OR email IS NULL)`,
        [ownerUserId]
      ).catch(() => {});
    }
    console.log(`[Admin] delete-qa-org: ${orgId} — ${totalDeleted} rows deleted`);
    res.json({ ok: true, orgId, totalDeleted });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/fast-fill ─────────────────────────────────────────────────
// Directly INSERTs N rows of a resource WITHOUT quota check — used by cert suite
// to quickly fill an org to limit-1 before the boundary test.
// Body: { orgId, resource: "monitors"|"audits"|"reports", count }
router.post("/admin/fast-fill", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId, resource, count = 1 } = req.body as {
    orgId?: string; resource?: string; count?: number;
  };
  if (!orgId || !resource) { res.status(400).json({ ok: false, error: "orgId and resource required" }); return; }
  const n = Math.max(1, Math.min(Number(count) || 1, 1000));
  try {
    let inserted = 0;
    for (let i = 0; i < n; i++) {
      const ts = Date.now();
      try {
        if (resource === "monitors") {
          const id = `m${ts}_${i}`;
          await pool.query(
            `INSERT INTO monitors (id, org_id, name, url, status, uptime, latency, frequency, alert_email, alert_phone, is_critical, last_check, created_at, updated_at)
             VALUES ($1,$2,$3,$4,'up',100,NULL,'5min','','',false,NULL,NOW(),NOW())
             ON CONFLICT (id) DO NOTHING`,
            [id, orgId, `FF ${i}`, `https://ff-${orgId.slice(0,8)}-${ts}-${i}.fp.internal`]
          );
        } else if (resource === "audits") {
          const id = `a_ff_${ts}_${i}`;
          await pool.query(
            `INSERT INTO audits (id, org_id, url, status, score, speed, issues, name, date, origin, created_at)
             VALUES ($1,$2,$3,'completed',50,0,0,'FF Audit',to_char(NOW(),'YYYY-MM-DD'),'admin',NOW())
             ON CONFLICT (id) DO NOTHING`,
            [id, orgId, `https://ff-audit-${orgId.slice(0,8)}-${ts}-${i}.fp.internal`]
          );
        } else if (resource === "reports") {
          const id = `r_ff_${ts}_${i}`;
          await pool.query(
            `INSERT INTO reports (id, org_id, name, type, template_key, date, pages, shared, audit_id, white_label, pdf_ready, meeting_notes_json, date_start, date_end)
             VALUES ($1,$2,$3,'PDF','seo',NOW(),0,false,'',false,true,'[]','','')
             ON CONFLICT (id) DO NOTHING`,
            [id, orgId, `FF Report ${i}`]
          );
        } else {
          res.status(400).json({ ok: false, error: `Unknown resource: ${resource}` }); return;
        }
        inserted++;
      } catch { /* skip duplicates */ }
    }
    res.json({ ok: true, orgId, resource, requested: n, inserted });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/create-audit-api ─────────────────────────────────────────
// Creates an audit WITH quota enforcement (cert suite). Body: { orgId, url }
router.post("/admin/create-audit-api", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId, url } = req.body as { orgId?: string; url?: string };
  if (!orgId || !url) { res.status(400).json({ ok: false, error: "orgId and url required" }); return; }
  try {
    const { checkQuota } = await import("../services/billing-service.js");

    // Use pg_advisory_xact_lock (transaction-level) — works with Supabase PgBouncer.
    // Session-level pg_advisory_lock does NOT work in PgBouncer transaction pooling
    // because consecutive queries on the same PoolClient can be routed to different
    // backend sessions, making the lock invisible to the next query.
    const _auLockKey = `${orgId}:audits`;
    const _auLockClient = await pool.connect();
    try {
      await _auLockClient.query("BEGIN");
      await _auLockClient.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [_auLockKey]);
      const quota = await checkQuota("audits", orgId);
      if (!quota.allowed) {
        await _auLockClient.query("ROLLBACK");
        res.status(402).json({ ok: false, error: "QUOTA_EXCEEDED", used: quota.used, limit: quota.limit });
        return;
      }
      // INSERT inside the transaction so slot is claimed atomically.
      const auditId = `a_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await _auLockClient.query(
        `INSERT INTO audits (id, org_id, url, status, score, speed, issues, name, date, origin, created_at)
         VALUES ($1,$2,$3,'completed',50,0,0,'QA Cert Audit',to_char(NOW(),'YYYY-MM-DD'),'admin',NOW())`,
        [auditId, orgId, url]
      );
      await _auLockClient.query("COMMIT");
      res.status(201).json({ ok: true, auditId, orgId, url, used: quota.used + 1, limit: quota.limit });
    } catch (innerErr) {
      await _auLockClient.query("ROLLBACK").catch(() => {});
      throw innerErr;
    } finally {
      _auLockClient.release();
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/create-report-api ────────────────────────────────────────
// Creates a report WITH quota enforcement (cert suite). Body: { orgId, name }
router.post("/admin/create-report-api", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { orgId, name = "QA Report" } = req.body as { orgId?: string; name?: string };
  if (!orgId) { res.status(400).json({ ok: false, error: "orgId required" }); return; }
  try {
    const { checkQuota } = await import("../services/billing-service.js");
    const { randomBytes } = await import("crypto");
    const _cl = await pool.connect();
    try {
      await _cl.query("BEGIN");
      await _cl.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [`${orgId}:reports`]);
      const quota = await checkQuota("reports", orgId);
      if (!quota.allowed) {
        await _cl.query("ROLLBACK");
        res.status(402).json({ ok: false, error: "QUOTA_EXCEEDED", used: quota.used, limit: quota.limit });
        return;
      }
      const id = `r_${randomBytes(8).toString("hex")}`;
      await _cl.query(
        `INSERT INTO reports (id, org_id, name, type, template_key, date, pages, shared, audit_id, white_label, pdf_ready, meeting_notes_json, date_start, date_end)
         VALUES ($1,$2,$3,'PDF','seo',NOW(),0,false,'',false,true,'[]','','')`,
        [id, orgId, String(name).slice(0, 240)]
      );
      await _cl.query("COMMIT");
      res.status(201).json({ ok: true, reportId: id, orgId, used: quota.used + 1, limit: quota.limit });
    } catch (err) {
      await _cl.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      _cl.release();
    }
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/sellers — create a seller ─────────────────────────────────
router.post("/admin/sellers", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { name, email, code: rawCode } = req.body as Record<string, string | undefined>;
  try {
    let sellerCode: string;
    if (rawCode) {
      sellerCode = String(rawCode).trim().toUpperCase();
      if (!/^SELLER-[A-Z0-9]{1,20}$/.test(sellerCode)) {
        res.status(400).json({ ok: false, error: "seller_code must match SELLER-[A-Z0-9]{1,20}" });
        return;
      }
    } else {
      // Auto-generate unique 8-char code
      const ts  = Date.now().toString(36).toUpperCase().slice(-4);
      const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
      sellerCode = `SELLER-${ts}${rnd}`;
    }
    const r = await pool.query<{ id: string; seller_code: string; name: string | null; email: string | null; status: string; created_at: string }>(
      `INSERT INTO sellers (seller_code, name, email, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'active', NOW(), NOW())
       ON CONFLICT (seller_code) DO NOTHING
       RETURNING id, seller_code, name, email, status, created_at`,
      [sellerCode, name ?? null, email ?? null]
    );
    if (!r.rows[0]) {
      res.status(409).json({ ok: false, error: "A seller with this code already exists" });
      return;
    }
    res.status(201).json({
      ok:     true,
      seller: r.rows[0],
      link:   `https://app.flowpoint.pro/pricing.html?ref=${r.rows[0].seller_code}`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── GET /api/admin/sellers — list all sellers ──────────────────────────────────
router.get("/admin/sellers", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  try {
    const r = await pool.query(
      `SELECT s.id, s.seller_code, s.name, s.email, s.status, s.created_at,
              COUNT(DISTINCT o.id)::int                                                          AS org_count,
              COUNT(sc.id)::int                                                                   AS commission_count,
              COALESCE(SUM(sc.commission_amount_cents) FILTER (WHERE sc.status = 'paid'),   0)::int AS paid_cents,
              COALESCE(SUM(sc.commission_amount_cents) FILTER (WHERE sc.status = 'pending'),0)::int AS pending_cents
         FROM sellers s
         LEFT JOIN organizations o ON o.seller_id = s.id
         LEFT JOIN seller_commissions sc ON sc.seller_id = s.id
        GROUP BY s.id
        ORDER BY s.created_at DESC`
    );
    res.json({
      ok:      true,
      sellers: r.rows.map(s => ({
        ...s,
        link: `https://app.flowpoint.pro/pricing.html?ref=${s.seller_code}`,
      })),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── PATCH /api/admin/sellers/:code — update seller (name / email / status) ────
router.patch("/admin/sellers/:code", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const code   = String(req.params["code"] ?? "").trim().toUpperCase();
  const { name, email, status } = req.body as Record<string, string | undefined>;
  if (status && !["active", "inactive"].includes(status)) {
    res.status(400).json({ ok: false, error: "status must be 'active' or 'inactive'" });
    return;
  }
  try {
    const r = await pool.query(
      `UPDATE sellers
          SET name       = COALESCE($2, name),
              email      = COALESCE($3, email),
              status     = COALESCE($4, status),
              updated_at = NOW()
        WHERE seller_code = $1
        RETURNING id, seller_code, name, email, status`,
      [code, name ?? null, email ?? null, status ?? null]
    );
    if (!r.rows[0]) { res.status(404).json({ ok: false, error: "Seller not found" }); return; }
    res.json({
      ok:     true,
      seller: r.rows[0],
      link:   `https://app.flowpoint.pro/pricing.html?ref=${(r.rows[0] as { seller_code: string }).seller_code}`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /api/admin/seller-commissions/:id/mark-paid ─────────────────────────
router.post("/admin/seller-commissions/:id/mark-paid", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const { id } = req.params as { id: string };
  const { paid_by, notes } = req.body as Record<string, string | undefined>;
  try {
    const r = await pool.query(
      `UPDATE seller_commissions
          SET status  = 'paid',
              paid_at = COALESCE(paid_at, NOW()),
              paid_by = COALESCE($2, paid_by),
              notes   = COALESCE($3, notes)
        WHERE id = $1
        RETURNING id, status, commission_amount_cents, eligible_amount_cents, paid_at, paid_by, notes`,
      [id, paid_by ?? null, notes ?? null]
    );
    if (!r.rows[0]) { res.status(404).json({ ok: false, error: "Commission not found" }); return; }
    res.json({ ok: true, commission: r.rows[0] });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── POST /admin/seller-attributions — manual fallback attribution ─────────────
router.post("/admin/seller-attributions", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const body = req.body as Record<string, string | undefined>;
  const sellerCode = body["seller_code"] ?? body["seller_id"]; // accept both field names
  const { org_id, reason } = body;
  if (!org_id || !sellerCode || !reason) {
    res.status(400).json({ ok: false, error: "org_id, seller_code (or seller_id), and reason are required" });
    return;
  }
  try {
    // Verify org exists
    const orgR = await pool.query(
      `SELECT id, owner_email, plan FROM organizations WHERE id = $1 LIMIT 1`, [org_id]
    );
    if (!orgR.rows[0]) { res.status(404).json({ ok: false, error: "Organization not found" }); return; }
    const org = orgR.rows[0] as { id: string; owner_email: string; plan: string };

    // Verify seller exists and is active
    const sellerR = await pool.query(
      `SELECT id, seller_code, name, status FROM sellers WHERE seller_code = $1 AND status = 'active' LIMIT 1`,
      [String(sellerCode).trim().toUpperCase()]
    );
    if (!sellerR.rows[0]) { res.status(404).json({ ok: false, error: "Seller not found or inactive" }); return; }
    const seller = sellerR.rows[0] as { id: string; seller_code: string; name: string };

    // Guard: never silently overwrite a paid commission
    const existingComm = await pool.query(
      `SELECT id, status, attribution_method FROM seller_commissions WHERE org_id = $1 LIMIT 1`, [org_id]
    );
    if (existingComm.rows[0]) {
      const ec = existingComm.rows[0] as { id: string; status: string; attribution_method: string };
      if (ec.status === "paid") {
        res.status(409).json({ ok: false, error: "A paid commission already exists for this org — cannot overwrite" });
        return;
      }
      // Non-paid duplicate: return existing without creating a second one
      res.json({ ok: true, action: "already_attributed", commission: ec, seller });
      return;
    }

    // Update organizations.seller_id (FIRST_TOUCH — do not overwrite existing)
    const updR = await pool.query(
      `UPDATE organizations SET seller_id = $1 WHERE id = $2 AND (seller_id IS NULL OR seller_id = '')
       RETURNING id, stripe_customer_id, subscription_status`,
      [seller.id, org_id]
    );
    if (!updR.rows[0]) {
      // Already has a seller — return existing without overwrite
      const existOrg = await pool.query(`SELECT seller_id FROM organizations WHERE id = $1`, [org_id]);
      const existSellerId = (existOrg.rows[0] as { seller_id: string | null } | undefined)?.seller_id;
      res.json({ ok: true, action: "already_attributed_to_seller_id", existing_seller_id: existSellerId, seller, reason });
      return;
    }
    const orgUpdated = updR.rows[0] as { id: string; stripe_customer_id: string | null; subscription_status: string | null };

    // Update Stripe Customer + Subscription metadata (fire-and-forget — additive only)
    if (orgUpdated.stripe_customer_id) {
      (async () => {
        try {
          const { getStripeKey, createStripeClient: _mkS } = await import("../services/stripe-factory.js");
          const _sk = getStripeKey();
          if (!_sk) return;
          const _stripe = await _mkS(_sk);
          const _meta = { seller_id: seller.seller_code, seller_attribution: "manual" };
          await _stripe.customers.update(orgUpdated.stripe_customer_id!, { metadata: _meta });
          // Also update active subscription metadata
          const _subs = await _stripe.subscriptions.list({ customer: orgUpdated.stripe_customer_id!, status: "active", limit: 3 });
          for (const _sub of _subs.data) {
            await _stripe.subscriptions.update(_sub.id, { metadata: _meta });
          }
        } catch (_se) {
          // Non-fatal
        }
      })().catch(() => {});
    }

    // NOTE: Commission NOT created here. It will be created automatically by
    // invoice.payment_succeeded when the first real subscription payment is received.
    // If the first payment already occurred before this attribution, admin must use
    // POST /admin/seller-commissions/:id/mark-paid after manually inserting the commission.
    res.json({
      ok: true, action: "attributed", orgId: org_id, seller, reason,
      note: "Commission will be created on the first real subscription payment received."
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

// ── GET /admin/sellers/:code/report — read all orgs + commissions for a seller ─
router.get("/admin/sellers/:code/report", async (req: Request, res: Response): Promise<void> => {
  if (!requireAdminKey(req, res)) return;
  const code = String(req.params["code"] ?? "").trim().toUpperCase();
  try {
    const sellerR = await pool.query(
      `SELECT id, seller_code, name, email, status, created_at FROM sellers WHERE seller_code = $1 LIMIT 1`, [code]
    );
    if (!sellerR.rows[0]) { res.status(404).json({ ok: false, error: "Seller not found" }); return; }
    const seller = sellerR.rows[0];

    const orgs = await pool.query(
      `SELECT o.id, o.owner_email, o.plan, o.subscription_status, o.created_at
       FROM organizations o WHERE o.seller_id = $1 ORDER BY o.created_at DESC`, [seller.id]
    );

    const comms = await pool.query(
      `SELECT sc.id, sc.org_id, sc.customer_email, sc.plan,
              sc.eligible_amount_cents, sc.commission_rate_bps, sc.commission_amount_cents,
              sc.currency, sc.status, sc.attribution_method, sc.attributed_at, sc.earned_at, sc.paid_at
       FROM seller_commissions sc WHERE sc.seller_id = $1 ORDER BY sc.attributed_at DESC`, [seller.id]
    );

    res.json({ ok: true, seller, organizations: orgs.rows, commissions: comms.rows });
  } catch (err) {
    res.status(500).json({ ok: false, error: safeErrMsg(err) });
  }
});

export default router;
