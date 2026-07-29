/**
 * Settings P1 Fixes — Certification tests
 *
 * Covers the three P1 bugs fixed in the Settings stabilisation pass:
 *
 *   BUG-1  White Label branding persisted to DB via PATCH /api/me/prefs
 *          (previously saved to localStorage only)
 *
 *   BUG-2  POST /api/auth/logout revokes the server-side session and clears
 *          the HttpOnly fp_token cookie (previously front-end-only clear)
 *
 *   BUG-3  User-pref alertEmail (user_prefs.settings.alertEmail) is correctly
 *          stored and retrievable — consumed by the monitor alert engine as the
 *          second-tier recipient fallback
 *
 * Run:
 *   cd artifacts/api-server && pnpm tsx tests/certification/settings_p1_fixes.test.ts
 */

import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { pool } from "@workspace/db";
import { orgContext } from "../../src/middlewares/orgContext.js";
import { dbContext }  from "../../src/middlewares/dbContext.js";
import meRouter from "../../src/routes/me.js";
import authRouter from "../../src/routes/auth.js";
import { createSession, deleteSession } from "../../src/services/sessions.js";

// ─── test harness ─────────────────────────────────────────────────────────────

const RUN_ID = `sp1_${Date.now()}`;
let server: Server;
let BASE: string;

function orgId(tag: string) { return `${RUN_ID}_${tag}`; }

async function makeSession(tag: string, role = "owner"): Promise<string> {
  const oid = orgId(tag);
  const uid = `usr_${tag}`;
  return createSession({ userId: uid, orgId: oid, email: `${tag}@test.invalid`, role });
}

async function ensureOrg(tag: string) {
  const oid = orgId(tag);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO org_settings (org_id, subscription_status, plan)
       VALUES ($1, 'active', 'ultra')
       ON CONFLICT (org_id) DO UPDATE
         SET subscription_status = 'active', plan = 'ultra'`,
      [oid]
    );
    await client.query(
      `INSERT INTO organizations (id, name, plan, subscription_status)
       VALUES ($1, $2, 'Ultra', 'active')
       ON CONFLICT (id) DO UPDATE SET plan = 'Ultra', subscription_status = 'active'`,
      [oid, `Test Org ${tag}`]
    );
    await client.query(
      `INSERT INTO user_prefs (org_id, settings, streak, pinned, checklist)
       VALUES ($1, '{}', 0, '{}', NULL)
       ON CONFLICT (org_id) DO NOTHING`,
      [oid]
    );
  } finally { client.release(); }
}

async function cleanup(tags: string[]) {
  const ids = tags.map(t => orgId(t));
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM user_prefs    WHERE org_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM org_settings  WHERE org_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM organizations WHERE id     = ANY($1)`, [ids]);
    await client.query(`DELETE FROM user_sessions WHERE org_id = ANY($1)`, [ids]);
  } catch { /* non-fatal */ } finally { client.release(); }
}

function api(path: string, token: string, opts: RequestInit = {}) {
  return fetch(`${BASE}${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(opts.headers ?? {}) },
  });
}

// ─── setup / teardown ────────────────────────────────────────────────────────

async function setup() {
  const app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use(orgContext);
  app.use(dbContext);   // sets req.orgDb used by me.ts routes
  app.use("/api", meRouter);
  app.use("/api", authRouter);
  server = createServer(app);
  server.listen(0);
  await once(server, "listening");
  const addr = server.address() as { port: number };
  BASE = `http://127.0.0.1:${addr.port}`;
}

async function teardown() {
  await cleanup(["wl1", "lo1", "ae1", "ae2"]);
  server?.close();
}

// ─── assertion helper ────────────────────────────────────────────────────────

let passed = 0; let failed = 0;
function assert(label: string, condition: boolean, detail = "") {
  if (condition) { console.log(`  ✅ ${label}`); passed++; }
  else           { console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`); failed++; }
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG-1 Tests — White Label branding persistence
// ─────────────────────────────────────────────────────────────────────────────

async function testBug1_WlBranding() {
  console.log("\n── BUG-1: White Label branding persistence ──────────────────");
  await ensureOrg("wl1");
  const token = await makeSession("wl1");

  const wlBranding = {
    logoUrl:        "https://agency.example.com/logo.png",
    agencyName:     "Test Agency",
    primaryColor:   "#1234AB",
    secondaryColor: "#ABCDEF",
    footerMsg:      "Confidentiel © Test Agency 2026",
  };

  // T1 — PATCH /api/me/prefs with settings.wlBranding persists to DB
  const patchRes = await api("/api/me/prefs", token, {
    method: "PATCH",
    body: JSON.stringify({ settings: { wlBranding } }),
  });
  const patchJson = await patchRes.json() as Record<string, unknown>;
  assert("T1  PATCH /api/me/prefs with wlBranding returns ok:true", patchRes.status === 200 && patchJson.ok === true, JSON.stringify(patchJson));

  // T2 — GET /api/me/settings returns the stored wlBranding
  const getRes = await api("/api/me/settings", token);
  const getJson = await getRes.json() as Record<string, unknown>;
  const stored = getJson.wlBranding as Record<string, unknown> | undefined;
  assert("T2  GET /api/me/settings returns wlBranding object", !!stored, JSON.stringify(getJson));
  assert("T3  stored logoUrl matches", stored?.logoUrl === wlBranding.logoUrl, String(stored?.logoUrl));
  assert("T4  stored agencyName matches", stored?.agencyName === wlBranding.agencyName, String(stored?.agencyName));
  assert("T5  stored primaryColor matches", stored?.primaryColor === wlBranding.primaryColor, String(stored?.primaryColor));
  assert("T6  stored footerMsg matches", stored?.footerMsg === wlBranding.footerMsg, String(stored?.footerMsg));

  // T7 — wlBranding can be updated (merge, not replace of other settings keys)
  await api("/api/me/prefs", token, {
    method: "PATCH",
    body: JSON.stringify({ settings: { theme: "dark" } }),
  });
  const getRes2 = await api("/api/me/settings", token);
  const getJson2 = await getRes2.json() as Record<string, unknown>;
  const stored2 = getJson2.wlBranding as Record<string, unknown> | undefined;
  assert("T7  wlBranding preserved after unrelated settings update", stored2?.agencyName === wlBranding.agencyName, JSON.stringify(stored2));
  assert("T8  new settings key coexists with wlBranding", getJson2.theme === "dark", JSON.stringify(getJson2));
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG-2 Tests — POST /api/auth/logout server-side session revocation
// ─────────────────────────────────────────────────────────────────────────────

async function testBug2_Logout() {
  console.log("\n── BUG-2: Server-side session revocation on logout ──────────");
  await ensureOrg("lo1");
  const token = await makeSession("lo1");

  // T9 — GET /api/me succeeds before logout (session valid)
  const beforeRes = await api("/api/me", token);
  assert("T9  GET /api/me returns 200 before logout", beforeRes.status === 200, String(beforeRes.status));

  // T10 — POST /api/auth/logout returns ok:true
  const logoutRes = await api("/api/auth/logout", token, { method: "POST" });
  const logoutJson = await logoutRes.json() as Record<string, unknown>;
  assert("T10 POST /api/auth/logout returns 200", logoutRes.status === 200, String(logoutRes.status));
  assert("T11 POST /api/auth/logout returns ok:true", logoutJson.ok === true, JSON.stringify(logoutJson));

  // T12 — Set-Cookie header clears fp_token
  const setCookieHeader = logoutRes.headers.get("set-cookie") ?? "";
  assert("T12 logout response clears fp_token cookie", setCookieHeader.includes("fp_token=;") || setCookieHeader.includes("fp_token=,") || setCookieHeader.includes("Max-Age=0") || setCookieHeader.includes("Expires="), setCookieHeader.slice(0, 120));

  // T13 — GET /api/me with the same token now returns 401 (session deleted from DB)
  const afterRes = await api("/api/me", token);
  assert("T13 GET /api/me returns 401 after logout (session revoked)", afterRes.status === 401, String(afterRes.status));

  // T14 — Calling logout again is idempotent (no server error)
  const idempotentRes = await api("/api/auth/logout", token, { method: "POST" });
  assert("T14 second logout call is idempotent (no 500)", idempotentRes.status !== 500, String(idempotentRes.status));
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG-3 Tests — alertEmail stored in user_prefs and retrievable
// ─────────────────────────────────────────────────────────────────────────────

async function testBug3_AlertEmail() {
  console.log("\n── BUG-3: alertEmail preference storage and retrieval ────────");
  await ensureOrg("ae1");
  const token = await makeSession("ae1");

  // T15 — PATCH /api/me/prefs with settings.alertEmail (correct nesting) persists
  const patchRes = await api("/api/me/prefs", token, {
    method: "PATCH",
    body: JSON.stringify({ settings: { alertEmail: "alerts@agency.example.com" } }),
  });
  const patchJson = await patchRes.json() as Record<string, unknown>;
  assert("T15 PATCH /api/me/prefs with settings.alertEmail returns ok:true", patchRes.status === 200 && patchJson.ok === true, JSON.stringify(patchJson));

  // T16 — GET /api/me/settings returns the stored alertEmail
  const getRes = await api("/api/me/settings", token);
  const getJson = await getRes.json() as Record<string, unknown>;
  assert("T16 GET /api/me/settings returns alertEmail", getJson.alertEmail === "alerts@agency.example.com", JSON.stringify(getJson));

  // T17 — Direct DB verification: user_prefs.settings->>alertEmail matches
  const oid = orgId("ae1");
  const dbRow = await pool.query(
    `SELECT settings->>'alertEmail' AS alert_email FROM user_prefs WHERE org_id = $1`,
    [oid]
  );
  assert("T17 DB user_prefs.settings.alertEmail matches saved value",
    dbRow.rows[0]?.alert_email === "alerts@agency.example.com",
    String(dbRow.rows[0]?.alert_email)
  );

  // T18 — alertEmail at top level (old broken pattern) is silently ignored
  await ensureOrg("ae2");
  const token2 = await makeSession("ae2");
  await api("/api/me/prefs", token2, {
    method: "PATCH",
    body: JSON.stringify({ alertEmail: "should-not-be-stored@test.invalid" }),
  });
  const oid2 = orgId("ae2");
  const dbRow2 = await pool.query(
    `SELECT settings->>'alertEmail' AS alert_email FROM user_prefs WHERE org_id = $1`,
    [oid2]
  );
  assert("T18 top-level alertEmail (old broken pattern) is NOT stored in settings",
    !dbRow2.rows[0]?.alert_email,
    String(dbRow2.rows[0]?.alert_email)
  );

  // T19 — alertEmail update does not erase other settings keys
  await api("/api/me/prefs", token, {
    method: "PATCH",
    body: JSON.stringify({ settings: { theme: "light", language: "fr" } }),
  });
  await api("/api/me/prefs", token, {
    method: "PATCH",
    body: JSON.stringify({ settings: { alertEmail: "updated@agency.example.com" } }),
  });
  const getRes2 = await api("/api/me/settings", token);
  const getJson2 = await getRes2.json() as Record<string, unknown>;
  assert("T19 alertEmail update preserves other settings (theme, language)",
    getJson2.theme === "light" && getJson2.language === "fr" && getJson2.alertEmail === "updated@agency.example.com",
    JSON.stringify(getJson2)
  );
}

// ─── main ─────────────────────────────────────────────────────────────────────

(async () => {
  await setup();
  try {
    await testBug1_WlBranding();
    await testBug2_Logout();
    await testBug3_AlertEmail();
  } finally {
    await teardown();
  }
  console.log(`\n${"─".repeat(56)}`);
  console.log(`Settings P1 results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
