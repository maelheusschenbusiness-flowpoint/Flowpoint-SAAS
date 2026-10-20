/**
 * Bug #236 — GitHub multi-tenant isolation + saveConnection argument fix
 *
 * Confirms:
 *  T1  saveConnection(orgId, { login, avatarUrl, accessToken }) persists correct data
 *  T2  getConnection(orgId) retrieves the saved row
 *  T3  access_token is NOT NULL after save (was NULL before fix due to arg mismatch)
 *  T4  getConnection(differentOrgId) returns null (tenant isolation)
 *  T5  GET /api/github/status returns connected:true for the org that connected
 *  T6  GET /api/github/status returns connected:false for a different org (isolation)
 *  T7  GET /api/github/repos returns 403 when not connected
 *  T8  POST /api/github/disconnect removes only that org's connection
 *  T9  GET /api/github/status returns connected:false after disconnect
 *  T10 GET /api/github/callback with no code returns 400
 *  T11 Unauthenticated request to /api/github/status returns 401
 */

import { randomBytes } from "crypto";
import { pool } from "@workspace/db";
import { saveConnection, getConnection, disconnectGitHub } from "../../src/services/github-service.js";

const BASE = "http://localhost:8081";
const RUN  = Date.now();

// ── helpers ─────────────────────────────────────────────────────────────────

async function ensureOrg(orgId: string, email: string): Promise<void> {
  await pool.query(
    `INSERT INTO organizations (id, name, owner_email, plan, created_at)
     VALUES ($1, $2, $3, 'pro', NOW())
     ON CONFLICT (id) DO NOTHING`,
    [orgId, `GH Test Org ${RUN}`, email]
  );
}

async function createSession(orgId: string, email: string): Promise<string> {
  const token = randomBytes(32).toString("hex");
  await pool.query(
    `INSERT INTO user_sessions (token, user_id, org_id, email, role, created_at, expires_at)
     VALUES ($1, $2, $3, $4, 'admin', NOW(), NOW() + INTERVAL '1 hour')`,
    [token, `gh_user_${RUN}`, orgId, email]
  );
  return token;
}

function api(path: string, token: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
}

// ── setup ────────────────────────────────────────────────────────────────────

const ORG_A = `gh-org-a-${RUN}`;
const ORG_B = `gh-org-b-${RUN}`;
const EMAIL_A = `gh-a-${RUN}@test.flowpoint`;
const EMAIL_B = `gh-b-${RUN}@test.flowpoint`;

const results: Array<{ id: string; pass: boolean }> = [];
function check(id: string, pass: boolean): void {
  results.push({ id, pass });
  console.log(`  ${pass ? "✅" : "❌"} ${id}`);
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log("\n── Bug #236: GitHub multi-tenant isolation + saveConnection fix ──────────────");

await ensureOrg(ORG_A, EMAIL_A);
await ensureOrg(ORG_B, EMAIL_B);
const tokenA = await createSession(ORG_A, EMAIL_A);
const tokenB = await createSession(ORG_B, EMAIL_B);

// Clean slate
await pool.query(`DELETE FROM github_connections WHERE org_id IN ($1, $2)`, [ORG_A, ORG_B]);

// ── T1: saveConnection stores correct data ────────────────────────────────────
await saveConnection(ORG_A, {
  githubUserId: 1234567,
  login:        "octocat-test",
  name:         "Octocat Test",
  email:        null,
  avatarUrl:    "https://avatars.github.com/octocat",
  accessToken:  "ghp_test_token_abc123",
  scope:        "repo,read:user",
});
const row = await pool.query(
  `SELECT login, avatar_url, access_token FROM github_connections WHERE org_id = $1`,
  [ORG_A]
);
check("T1  saveConnection stores login correctly", row.rows[0]?.login === "octocat-test");

// ── T2: getConnection retrieves the row ───────────────────────────────────────
const conn = await getConnection(ORG_A);
check("T2  getConnection retrieves saved connection", conn !== null && conn.login === "octocat-test");

// ── T3: access_token is NOT NULL (confirms arg-mismatch fix) ──────────────────
check("T3  access_token persisted (not NULL)", row.rows[0]?.access_token === "ghp_test_token_abc123");

// ── T4: tenant isolation at service level ─────────────────────────────────────
const connB = await getConnection(ORG_B);
check("T4  getConnection(other org) returns null", connB === null);

// ── T5: HTTP status → connected for correct org ───────────────────────────────
const statusA = await api("/api/github/status", tokenA).then(r => r.json()) as Record<string, unknown>;
check("T5  GET /github/status → connected:true for owner org",
  statusA.connected === true && statusA.login === "octocat-test");

// ── T6: HTTP status → not connected for different org ────────────────────────
const statusB = await api("/api/github/status", tokenB).then(r => r.json()) as Record<string, unknown>;
check("T6  GET /github/status → connected:false for other org", statusB.connected === false);

// ── T7: repos → 403 when not connected ───────────────────────────────────────
const reposB = await api("/api/github/repos", tokenB);
check("T7  GET /github/repos → 403 when not connected", reposB.status === 403);

// ── T8: disconnect removes only this org's connection ─────────────────────────
const disconnectResp = await api("/api/github/disconnect", tokenA, { method: "POST" });
const disconnectJson = await disconnectResp.json() as Record<string, unknown>;
check("T8  POST /github/disconnect returns ok:true", disconnectJson.ok === true);

const afterDisconnect = await pool.query(
  `SELECT 1 FROM github_connections WHERE org_id = $1`, [ORG_A]
);
check("T8b DB row removed after disconnect", afterDisconnect.rowCount === 0);

// ── T9: status → false after disconnect ───────────────────────────────────────
const statusAfter = await api("/api/github/status", tokenA).then(r => r.json()) as Record<string, unknown>;
check("T9  GET /github/status → connected:false after disconnect", statusAfter.connected === false);

// ── T10: callback with no code → 400 ──────────────────────────────────────────
const callbackResp = await api("/api/github/callback", tokenA);
check("T10 GET /github/callback without code → 400", callbackResp.status === 400);

// ── T11: unauthenticated request → 401 ────────────────────────────────────────
const unauth = await fetch(`${BASE}/api/github/status`);
check("T11 Unauthenticated /github/status → 401", unauth.status === 401);

// ── cleanup ───────────────────────────────────────────────────────────────────
await pool.query(`DELETE FROM github_connections WHERE org_id IN ($1, $2)`, [ORG_A, ORG_B]);
await pool.query(`DELETE FROM user_sessions WHERE org_id IN ($1, $2)`, [ORG_A, ORG_B]);
await pool.query(`DELETE FROM organizations WHERE id IN ($1, $2)`, [ORG_A, ORG_B]);

// ── summary ───────────────────────────────────────────────────────────────────
const passed = results.filter(r => r.pass).length;
const failed = results.filter(r => !r.pass).length;
console.log(`\n${"─".repeat(60)}`);
console.log(`GitHub #236 results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
