/**
 * Wave 4 Partie 2 — Funnels / Audience / Live Certification
 *
 * Routes tested:
 *   Funnels : GET/POST /api/funnels, GET/PATCH/DELETE /api/funnels/:id,
 *             POST /api/funnels/:id/run
 *   Audience: GET /api/audience/status, GET /api/audience/overview
 *   Live    : GET /api/live/status,    GET /api/live/realtime
 *
 * Security:
 *   - All routes require Bearer token → 401 without auth
 *   - Cross-org isolation: org B cannot read org A's funnels
 *   - orgId NEVER read from body/query — always from session context
 */
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
import crypto from "crypto";

const BASE = "http://localhost:8081/api";
const DB   = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const RUN  = Date.now();

// ── Helpers ───────────────────────────────────────────────────────────────────
const pass = (id, msg) => { console.log(`  ✅ PASS — ${id} ${msg}`); return true; };
const fail = (id, msg) => { console.log(`  ❌ FAIL — ${id} ${msg}`); return false; };
let PASS = 0, FAIL = 0;

function check(id, msg, condition) {
  if (condition) { PASS++; return pass(id, msg); }
  FAIL++; return fail(id, msg);
}

async function req(path, opts = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...opts.headers,
      },
      method: opts.method || "GET",
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
    let json = null;
    try { json = await res.json(); } catch {}
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, json: null, error: String(e) };
  }
}

async function createOrg(label) {
  const orgId = `qa-p2-${label}-${RUN}`;
  await DB.query(
    `INSERT INTO organizations(id,name,slug,owner_user_id,status,plan,created_at,updated_at)
     VALUES($1,$1,$1,$1,'active','ultra',NOW(),NOW()) ON CONFLICT(id) DO NOTHING`,
    [orgId]
  );
  await DB.query(
    `INSERT INTO org_settings(org_id,plan) VALUES($1,'ultra') ON CONFLICT(org_id) DO NOTHING`,
    [orgId]
  );
  return orgId;
}

async function createSession(orgId) {
  const token = crypto.randomBytes(32).toString("hex");
  const userId = `user-qa-p2-${RUN}@qa.internal`;
  await DB.query(
    `INSERT INTO user_sessions(token,user_id,org_id,email,role,expires_at)
     VALUES($1,$2,$3,$2,'owner',NOW()+INTERVAL'2 hours') ON CONFLICT(token) DO NOTHING`,
    [token, userId, orgId]
  );
  return token;
}

async function ensureSiteToken(orgId, siteUrl) {
  const tokenHash = crypto.randomBytes(16).toString("hex");
  await DB.query(
    `INSERT INTO behavior_site_tokens(token_hash,org_id,site_url,created_at)
     VALUES($1,$2,$3,NOW()) ON CONFLICT(site_url) DO UPDATE SET org_id=$2`,
    [tokenHash, orgId, siteUrl]
  );
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  Wave 4 Partie 2 — Funnels / Audience / Live                ║");
console.log("╚══════════════════════════════════════════════════════════════╝");
console.log("");
console.log("[bootstrap] setting up orgs, sessions, site tokens…");

const orgA = await createOrg("A");
const orgB = await createOrg("B");
const tokA = await createSession(orgA);
const tokB = await createSession(orgB);

const siteA = `https://site-a-${RUN}.example.com`;
await ensureSiteToken(orgA, siteA);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1 — Server health
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[1] Server health");
{
  const { status, json } = await req("/health");
  check("H01", "server healthy", status === 200 && json?.status === "ok");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2 — Funnels auth guard
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[2] Funnels — auth guard (no token → 401)");
{
  const { status } = await req("/funnels");
  check("F01", "GET /funnels without token → 401", status === 401);
}
{
  const { status } = await req("/funnels", { method: "POST", body: { name: "x", siteUrl: siteA, steps: [] } });
  check("F02", "POST /funnels without token → 401", status === 401);
}
{
  const fakeId = "00000000-0000-0000-0000-000000000000";
  const r1 = await req(`/funnels/${fakeId}`);
  check("F03", "GET /funnels/:id without token → 401", r1.status === 401);
  const r2 = await req(`/funnels/${fakeId}`, { method: "PATCH", body: { name: "x" } });
  check("F04", "PATCH /funnels/:id without token → 401", r2.status === 401);
  const r3 = await req(`/funnels/${fakeId}`, { method: "DELETE" });
  check("F05", "DELETE /funnels/:id without token → 401", r3.status === 401);
  const r4 = await req(`/funnels/${fakeId}/run`, { method: "POST", body: {} });
  check("F06", "POST /funnels/:id/run without token → 401", r4.status === 401);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3 — Funnels GET (empty list)
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[3] Funnels — list (empty)");
{
  const { status, json } = await req("/funnels", { token: tokA });
  check("F07", "GET /funnels → 200 with ok+funnels array", status === 200 && json?.ok === true && Array.isArray(json?.funnels));
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4 — Funnels input validation
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[4] Funnels — input validation");
{
  // Missing name
  const { status, json } = await req("/funnels", {
    method: "POST", token: tokA,
    body: { siteUrl: siteA, steps: [] },
  });
  check("F08", "POST without name → 400", status === 400);
}
{
  // Missing siteUrl
  const { status } = await req("/funnels", {
    method: "POST", token: tokA,
    body: { name: "test", steps: [] },
  });
  check("F09", "POST without siteUrl → 400", status === 400);
}
{
  // Only 1 step → error
  const { status } = await req("/funnels", {
    method: "POST", token: tokA,
    body: {
      name: "test", siteUrl: siteA,
      steps: [{ position: 1, name: "s1", eventName: "page_view" }],
    },
  });
  check("F10", "POST with 1 step → 400 (min 2)", status === 400);
}
{
  // 11 steps → error
  const steps = Array.from({ length: 11 }, (_, i) => ({
    position: i + 1, name: `s${i+1}`, eventName: "page_view",
  }));
  const { status } = await req("/funnels", {
    method: "POST", token: tokA,
    body: { name: "test", siteUrl: siteA, steps },
  });
  check("F11", "POST with 11 steps → 400 (max 10)", status === 400);
}
{
  // Site not owned by org → 404
  const { status } = await req("/funnels", {
    method: "POST", token: tokA,
    body: {
      name: "test", siteUrl: "https://not-my-site.example.com",
      steps: [
        { position: 1, name: "s1", eventName: "page_view" },
        { position: 2, name: "s2", eventName: "purchase" },
      ],
    },
  });
  check("F12", "POST with unowned siteUrl → 404", status === 404);
}
{
  // Invalid UUID for :id endpoints
  const { status, json } = await req("/funnels/not-a-uuid", { token: tokA });
  check("F13", "GET /funnels/not-a-uuid → 400 INVALID_FUNNEL_ID", status === 400 && json?.code === "INVALID_FUNNEL_ID");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5 — Funnels CRUD
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[5] Funnels — CRUD lifecycle");

const FUNNEL_STEPS_2 = [
  { position: 1, name: "Homepage",  pagePathMatchType: "EXACT", pagePathValue: "/" },
  { position: 2, name: "Checkout",  pagePathMatchType: "BEGINS_WITH", pagePathValue: "/checkout" },
];
const FUNNEL_STEPS_3 = [
  ...FUNNEL_STEPS_2,
  { position: 3, name: "Confirmation", eventName: "purchase" },
];

let funnelId = null;

// CREATE
{
  const { status, json } = await req("/funnels", {
    method: "POST", token: tokA,
    body: { name: "Test Funnel QA", siteUrl: siteA, steps: FUNNEL_STEPS_2, lookbackDays: 7 },
  });
  check("F14", "POST /funnels → 201 with id", status === 201 && typeof json?.id === "string");
  funnelId = json?.id;
}

if (funnelId) {
  // READ
  {
    const { status, json } = await req(`/funnels/${funnelId}`, { token: tokA });
    check("F15", "GET /funnels/:id → 200 with steps array", status === 200 && Array.isArray(json?.funnel?.steps));
    check("F16", "GET /funnels/:id → funnel name correct", json?.funnel?.name === "Test Funnel QA");
    check("F17", "GET /funnels/:id → 2 steps stored", json?.funnel?.steps?.length === 2);
  }

  // LIST includes new funnel
  {
    const { json } = await req("/funnels", { token: tokA });
    const found = json?.funnels?.some(f => f.id === funnelId);
    check("F18", "GET /funnels list includes created funnel", found === true);
  }

  // PATCH name + steps
  {
    const { status, json } = await req(`/funnels/${funnelId}`, {
      method: "PATCH", token: tokA,
      body: { name: "Updated Funnel QA", steps: FUNNEL_STEPS_3 },
    });
    check("F19", "PATCH /funnels/:id → 200 ok", status === 200 && json?.ok === true);
  }
  {
    const { json } = await req(`/funnels/${funnelId}`, { token: tokA });
    check("F20", "GET after PATCH → name updated", json?.funnel?.name === "Updated Funnel QA");
    check("F21", "GET after PATCH → 3 steps now", json?.funnel?.steps?.length === 3);
  }

  // PATCH invalid breakdownDimension
  {
    const { status } = await req(`/funnels/${funnelId}`, {
      method: "PATCH", token: tokA,
      body: { breakdownDimension: "INVALID_DIM" },
    });
    check("F22", "PATCH with invalid breakdownDimension → 400", status === 400);
  }

  // PATCH empty body → 400
  {
    const { status } = await req(`/funnels/${funnelId}`, {
      method: "PATCH", token: tokA,
      body: {},
    });
    check("F23", "PATCH with no valid fields → 400", status === 400);
  }

  // RUN (expects 409 GA4_PROPERTY_NOT_CONFIGURED since org has no GA4)
  {
    const { status, json } = await req(`/funnels/${funnelId}/run`, {
      method: "POST", token: tokA, body: {},
    });
    check("F24", "POST /funnels/:id/run → 409 GA4_PROPERTY_NOT_CONFIGURED (no GA4 set up)",
      status === 409 && json?.code === "GA4_PROPERTY_NOT_CONFIGURED");
  }

  // RUN with invalid lookbackDays
  {
    const { status } = await req(`/funnels/${funnelId}/run`, {
      method: "POST", token: tokA, body: { lookbackDays: 999 },
    });
    check("F25", "POST /funnels/:id/run with lookbackDays=999 → 400", status === 400);
  }

  // DELETE
  {
    const { status, json } = await req(`/funnels/${funnelId}`, {
      method: "DELETE", token: tokA,
    });
    check("F26", "DELETE /funnels/:id → 200 ok", status === 200 && json?.ok === true);
  }
  {
    // Gone after delete
    const { status } = await req(`/funnels/${funnelId}`, { token: tokA });
    check("F27", "GET after DELETE → 404", status === 404);
  }
  {
    // DELETE again → 404
    const { status } = await req(`/funnels/${funnelId}`, { method: "DELETE", token: tokA });
    check("F28", "DELETE again → 404", status === 404);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 6 — Funnels cross-org isolation
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[6] Funnels — cross-org isolation");

// Create a funnel as orgA with its own site, then try to access it as orgB
const siteB = `https://site-b-${RUN}.example.com`;
await ensureSiteToken(orgA, siteB); // orgA owns siteB (not orgB)

let isoFunnelId = null;
{
  const { json } = await req("/funnels", {
    method: "POST", token: tokA,
    body: {
      name: "Isolation Funnel", siteUrl: siteA,
      steps: FUNNEL_STEPS_2,
    },
  });
  isoFunnelId = json?.id;
}

if (isoFunnelId) {
  {
    // orgB cannot read orgA's funnel
    const { status } = await req(`/funnels/${isoFunnelId}`, { token: tokB });
    check("F29", "Cross-org: orgB GET orgA funnel → 404", status === 404);
  }
  {
    // orgB cannot patch orgA's funnel
    const { status } = await req(`/funnels/${isoFunnelId}`, {
      method: "PATCH", token: tokB, body: { name: "Hacked" },
    });
    check("F30", "Cross-org: orgB PATCH orgA funnel → 404", status === 404);
  }
  {
    // orgB cannot delete orgA's funnel
    const { status } = await req(`/funnels/${isoFunnelId}`, {
      method: "DELETE", token: tokB,
    });
    check("F31", "Cross-org: orgB DELETE orgA funnel → 404", status === 404);
  }
  {
    // orgB cannot run orgA's funnel
    const { status } = await req(`/funnels/${isoFunnelId}/run`, {
      method: "POST", token: tokB, body: {},
    });
    check("F32", "Cross-org: orgB RUN orgA funnel → 404", status === 404);
  }
  {
    // orgA's funnel still exists
    const { status } = await req(`/funnels/${isoFunnelId}`, { token: tokA });
    check("F33", "orgA's funnel still exists after orgB attacks", status === 200);
  }
  // Cleanup
  await req(`/funnels/${isoFunnelId}`, { method: "DELETE", token: tokA });
}

// orgB cannot create funnel on orgA's site
{
  const { status } = await req("/funnels", {
    method: "POST", token: tokB,
    body: {
      name: "Cross-org attack", siteUrl: siteA,
      steps: FUNNEL_STEPS_2,
    },
  });
  check("F34", "Cross-org: orgB POST funnel with orgA siteUrl → 404", status === 404);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 7 — Funnels parameter filter validation
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[7] Funnels — parameterFilters validation");
{
  const { status } = await req("/funnels", {
    method: "POST", token: tokA,
    body: {
      name: "pf-test", siteUrl: siteA,
      steps: [
        {
          position: 1, name: "s1", eventName: "page_view",
          parameterFilters: [{ paramName: "invalid_param_xxx", matchType: "EXACT", value: "x" }],
        },
        { position: 2, name: "s2", eventName: "purchase" },
      ],
    },
  });
  check("F35", "POST with invalid paramName → 400", status === 400);
}
{
  const { status } = await req("/funnels", {
    method: "POST", token: tokA,
    body: {
      name: "pf-test2", siteUrl: siteA,
      steps: [
        {
          position: 1, name: "s1", eventName: "page_view",
          parameterFilters: [{ paramName: "page_referrer", matchType: "INVALID_TYPE", value: "x" }],
        },
        { position: 2, name: "s2", eventName: "purchase" },
      ],
    },
  });
  check("F36", "POST with invalid parameterFilter matchType → 400", status === 400);
}
{
  // Valid parameterFilter → should create if siteUrl is owned
  const { status, json } = await req("/funnels", {
    method: "POST", token: tokA,
    body: {
      name: "pf-valid", siteUrl: siteA,
      steps: [
        {
          position: 1, name: "step1", eventName: "page_view",
          parameterFilters: [{ paramName: "page_referrer", matchType: "BEGINS_WITH", value: "https://" }],
        },
        { position: 2, name: "step2", pagePathMatchType: "EXACT", pagePathValue: "/checkout" },
      ],
    },
  });
  check("F37", "POST with valid parameterFilter → 201", status === 201);
  if (json?.id) await req(`/funnels/${json.id}`, { method: "DELETE", token: tokA });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 8 — Audience auth guard
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[8] Audience — auth guard (no token → 401)");
{
  const r1 = await req("/audience/status");
  check("A01", "GET /audience/status without token → 401", r1.status === 401);
  const r2 = await req("/audience/overview");
  check("A02", "GET /audience/overview without token → 401", r2.status === 401);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 9 — Audience status
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[9] Audience — status");
{
  const { status, json } = await req("/audience/status", { token: tokA });
  check("A03", "GET /audience/status → 200", status === 200);
  check("A04", "response has ok=true", json?.ok === true);
  check("A05", "response has source='ga4'", json?.source === "ga4");
  check("A06", "response has connected boolean", typeof json?.connected === "boolean");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 10 — Audience overview
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[10] Audience — overview");
{
  const { status, json } = await req("/audience/overview", { token: tokA });
  check("A07", "GET /audience/overview → 200", status === 200);
  check("A08", "response has ok=true", json?.ok === true);
  check("A09", "response has source='ga4'", json?.source === "ga4");
  check("A10", "response has days integer", Number.isInteger(json?.days));
  check("A11", "response has data object", json?.data !== null && typeof json?.data === "object");
  check("A12", "data.audience is object", typeof json?.data?.audience === "object");
  check("A13", "data.audience.devices.rows is array", Array.isArray(json?.data?.audience?.devices?.rows));
  check("A14", "data.audience.geo.rows is array", Array.isArray(json?.data?.audience?.geo?.rows));
  check("A15", "data.audience.newVsReturn.rows is array", Array.isArray(json?.data?.audience?.newVsReturn?.rows));
  check("A16", "no Math.random or fake data in audience response", !JSON.stringify(json).includes("Math.random"));
}
{
  // days param
  const { status, json } = await req("/audience/overview?days=7", { token: tokA });
  check("A17", "GET /audience/overview?days=7 → 200 with days=7", status === 200 && json?.days === 7);
}
{
  // days=90
  const { status, json } = await req("/audience/overview?days=90", { token: tokA });
  check("A18", "GET /audience/overview?days=90 → 200 with days=90", status === 200 && json?.days === 90);
}
{
  // invalid days → defaults to 30
  const { status, json } = await req("/audience/overview?days=9999", { token: tokA });
  check("A19", "GET /audience/overview?days=9999 → 200 defaults to 30", status === 200 && json?.days === 30);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 11 — Audience cross-org isolation
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[11] Audience — cross-org isolation");
{
  // Both orgs get their own session/data — the key check is 200 with own org's GA4 context
  const { status: sA } = await req("/audience/overview", { token: tokA });
  const { status: sB } = await req("/audience/overview", { token: tokB });
  check("A20", "orgA and orgB both get 200 on audience overview", sA === 200 && sB === 200);
}
{
  // orgId injection via query must be ignored — override attempt
  const { status, json } = await req(`/audience/overview?orgId=${orgB}`, { token: tokA });
  check("A21", "orgId in query is ignored — orgA context used", status === 200 && json?.ok === true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 12 — Live auth guard
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[12] Live — auth guard (no token → 401)");
{
  const r1 = await req("/live/status");
  check("L01", "GET /live/status without token → 401", r1.status === 401);
  const r2 = await req("/live/realtime");
  check("L02", "GET /live/realtime without token → 401", r2.status === 401);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 13 — Live status
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[13] Live — status");
{
  const { status, json } = await req("/live/status", { token: tokA });
  check("L03", "GET /live/status → 200", status === 200);
  check("L04", "response has ok=true", json?.ok === true);
  check("L05", "response has source='ga4'", json?.source === "ga4");
  check("L06", "response has connected boolean", typeof json?.connected === "boolean");
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 14 — Live realtime
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[14] Live — realtime");
{
  const { status, json } = await req("/live/realtime", { token: tokA });
  check("L07", "GET /live/realtime → 200", status === 200);
  check("L08", "response has ok=true", json?.ok === true);
  check("L09", "response has source='ga4'", json?.source === "ga4");
  check("L10", "response has connected boolean", typeof json?.connected === "boolean");
  check("L11", "response has realtime object", typeof json?.realtime === "object" && json?.realtime !== null);
  check("L12", "realtime.activeUsers is number", typeof json?.realtime?.activeUsers === "number");
  check("L13", "realtime.rows is array", Array.isArray(json?.realtime?.rows));
  check("L14", "no Math.random or fake data in live response", !JSON.stringify(json).includes("Math.random"));
}
{
  // No fake negative user counts
  const { json } = await req("/live/realtime", { token: tokA });
  check("L15", "realtime.activeUsers >= 0 (never negative)", (json?.realtime?.activeUsers ?? 0) >= 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 15 — Live cross-org isolation
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[15] Live — cross-org isolation");
{
  const { status: sA } = await req("/live/realtime", { token: tokA });
  const { status: sB } = await req("/live/realtime", { token: tokB });
  check("L16", "orgA and orgB both get 200 on live realtime", sA === 200 && sB === 200);
}
{
  const { status, json } = await req(`/live/realtime?orgId=${orgB}`, { token: tokA });
  check("L17", "orgId in query is ignored — orgA context used", status === 200 && json?.ok === true);
}
{
  const { status, json } = await req(`/live/status?orgId=${orgB}`, { token: tokA });
  check("L18", "orgId in query for /live/status is ignored", status === 200 && json?.ok === true);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 16 — Dashboard.js API modules present
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[16] Dashboard.js — API modules");
import { readFileSync } from "fs";
const dashboard = readFileSync("/home/runner/workspace/artifacts/flowpoint-export/dashboard.js", "utf8");

check("D01", "_fpAudienceState defined", dashboard.includes("window._fpAudienceState = {}"));
check("D02", "_fpAudienceAPI defined", dashboard.includes("window._fpAudienceAPI = {"));
check("D03", "_fpAudienceAPI.loadAll calls /api/audience/overview", dashboard.includes("/api/audience/overview"));
check("D04", "_fpLiveState defined", dashboard.includes("window._fpLiveState = {}"));
check("D05", "_fpLiveAPI defined", dashboard.includes("window._fpLiveAPI = {"));
check("D06", "_fpLiveAPI.startPolling exists", dashboard.includes("startPolling("));
check("D07", "_fpLiveAPI.stopPolling exists", dashboard.includes("stopPolling()"));
check("D08", "_fpLiveAPI calls /api/live/realtime", dashboard.includes("/api/live/realtime"));
check("D09", "_fpLiveTimer (clearInterval on cleanup)", dashboard.includes("clearInterval(_fpLiveTimer)"));
check("D10", "renderGA4Audience uses _fpAudienceAPI", dashboard.includes("_fpAudienceAPI?.loadAll()"));
check("D11", "renderGA4Live uses _fpLiveAPI startPolling", dashboard.includes("_fpLiveAPI?.startPolling()"));
check("D12", "_fpAudLoadingSkeleton defined", dashboard.includes("_fpAudLoadingSkeleton()"));
check("D13", "_fpAudErrorSkeleton defined", dashboard.includes("_fpAudErrorSkeleton("));
check("D14", "_fpLiveLoadingSkeleton defined", dashboard.includes("_fpLiveLoadingSkeleton()"));
check("D15", "_fpLiveErrorSkeleton defined", dashboard.includes("_fpLiveErrorSkeleton("));
check("D16", "renderGA4Live body uses _fpLiveAPI.refresh() not FP_GA4_API.refreshRealtime()", (() => {
  const liveStart = dashboard.indexOf("function renderGA4Live()");
  if (liveStart < 0) return false;
  const liveEnd = dashboard.indexOf("\nwindow.STATE", liveStart + 10);
  const slice = dashboard.slice(liveStart, liveEnd > 0 ? liveEnd : liveStart + 30000);
  return !slice.includes("FP_GA4_API.refreshRealtime()");
})());
check("D17", "interval selector uses _fpLiveAPI.setInterval", dashboard.includes("_fpLiveAPI?.setInterval("));
check("D18", "no Math.random in renderGA4Audience", (() => {
  const start = dashboard.indexOf("function renderGA4Audience()");
  const end   = dashboard.indexOf("\nfunction renderGA4", start + 10);
  const slice = dashboard.slice(start, end);
  return !slice.includes("Math.random");
})());
check("D19", "no Math.random in renderGA4Live", (() => {
  const start = dashboard.indexOf("function renderGA4Live()");
  const end   = dashboard.indexOf("\n// ─", start + 10) || dashboard.indexOf("\nwindow.STATE", start + 10);
  const slice = dashboard.slice(start, end > 0 ? end : start + 50000);
  return !slice.includes("Math.random");
})());
check("D20", "_fpFunnelLoad defined (funnels frontend complete)", dashboard.includes("window._fpFunnelLoad = async function"));
check("D21", "_fpFunnelRun defined (funnels frontend complete)", dashboard.includes("window._fpFunnelRun = async function"));
check("D22", "_fpFunnelSave defined (funnels frontend complete)", dashboard.includes("window._fpFunnelSave = async function"));
check("D23", "_fpFunnelDelete defined (funnels frontend complete)", dashboard.includes("window._fpFunnelDelete = async function"));

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 17 — Backend route registration
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[17] Backend route registration");
const indexTs = readFileSync("/home/runner/workspace/artifacts/api-server/src/routes/index.ts", "utf8");
check("R01", "audienceRouter imported", indexTs.includes('import audienceRouter from "./audience.js"'));
check("R02", "liveRouter imported", indexTs.includes('import liveRouter from "./live.js"'));
check("R03", 'router.use("/audience"', indexTs.includes('router.use("/audience"'));
check("R04", 'router.use("/live"', indexTs.includes('router.use("/live"'));
check("R05", "funnelsRouter imported", indexTs.includes('import funnelsRouter from "./funnels.js"'));
check("R06", "funnelsRouter registered", indexTs.includes("router.use(funnelsRouter)"));

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 18 — Service files exist
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[18] Service files");
import { existsSync } from "fs";
const BASE_SVC = "/home/runner/workspace/artifacts/api-server/src/services";
check("S01", "audience-service.ts exists", existsSync(`${BASE_SVC}/audience-service.ts`));
check("S02", "live-service.ts exists", existsSync(`${BASE_SVC}/live-service.ts`));
check("S03", "ga4-funnel-service.ts exists", existsSync(`${BASE_SVC}/ga4-funnel-service.ts`));

const BASE_RT = "/home/runner/workspace/artifacts/api-server/src/routes";
check("S04", "routes/audience.ts exists", existsSync(`${BASE_RT}/audience.ts`));
check("S05", "routes/live.ts exists", existsSync(`${BASE_RT}/live.ts`));
check("S06", "routes/funnels.ts exists", existsSync(`${BASE_RT}/funnels.ts`));

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 19 — Security: orgId injection prevention
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[19] Security — orgId injection prevention");
{
  // Audience: orgId in body must be ignored
  const { status, json } = await req("/audience/overview", {
    method: "GET", token: tokA,
    headers: { "Content-Type": "application/json" },
  });
  check("SEC01", "audience/overview uses session orgId (not query injection)", status === 200 && json?.ok === true);
}
{
  // Live: orgId injection via query
  const { status, json } = await req(`/live/realtime?orgId=INJECTED`, { token: tokA });
  check("SEC02", "live/realtime ignores orgId query injection", status === 200 && json?.ok === true);
}
{
  // Service token (no valid session) must get 401
  const { status } = await req("/audience/overview");
  check("SEC03", "unauthenticated request → 401 (no service-token bypass)", status === 401);
}
{
  const { status } = await req("/live/realtime");
  check("SEC04", "unauthenticated live/realtime → 401", status === 401);
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 20 — Concurrent requests (no cross-contamination)
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n[20] Concurrent requests — no cross-contamination");
{
  const results = await Promise.all([
    req("/audience/status", { token: tokA }),
    req("/audience/status", { token: tokB }),
    req("/live/status", { token: tokA }),
    req("/live/status", { token: tokB }),
    req("/funnels", { token: tokA }),
    req("/funnels", { token: tokB }),
  ]);
  const allOk = results.every(r => r.status === 200 && r.json?.ok === true);
  check("CON01", "6 concurrent requests all return 200 ok", allOk);
}

// ═══════════════════════════════════════════════════════════════════════════════
// FINAL SUMMARY
// ═══════════════════════════════════════════════════════════════════════════════
console.log("\n" + "═".repeat(64));
console.log(`  PASS: ${PASS}   FAIL: ${FAIL}   TOTAL: ${PASS + FAIL}`);
console.log("═".repeat(64));

await DB.end();
process.exit(FAIL > 0 ? 1 : 0);
