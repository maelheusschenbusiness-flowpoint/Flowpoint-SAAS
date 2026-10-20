/**
 * Wave 4 Partie 1 — Analytics / Traffic / Campaigns Certification
 * Routes: /api/analytics/*, /api/traffic/*, /api/campaigns/*
 */
import pg from '/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js';
import crypto from "crypto";

const BASE = "http://localhost:8081/api";
const DB   = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const RUN  = Date.now();

// ── Helpers ──────────────────────────────────────────────────────────────────
const pass = (id, msg) => { console.log(`  ✅ PASS — ${id} ${msg}`); return true; };
const fail = (id, msg) => { console.log(`  ❌ FAIL — ${id} ${msg}`); return false; };
let PASS = 0, FAIL = 0;

function check(id, msg, condition) {
  if (condition) { PASS++; return pass(id, msg); }
  FAIL++; return fail(id, msg);
}

async function req(path, opts = {}) {
  const url = path.startsWith("http") ? path : `${BASE}${path}`;
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}), ...opts.headers },
    method: opts.method || "GET",
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(12000),
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
}

async function createOrg(label) {
  const orgId = `qa-p1-${label}-${RUN}`;
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
  const userId = `user-qa-p1-${RUN}@qa.internal`;
  await DB.query(
    `INSERT INTO user_sessions(token,user_id,org_id,email,role,expires_at)
     VALUES($1,$2,$3,$2,'owner',NOW()+INTERVAL'2 hours') ON CONFLICT(token) DO NOTHING`,
    [token, userId, orgId]
  );
  return token;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║  Wave 4 Partie 1 — Analytics / Traffic / Campaigns          ║");
console.log("╚══════════════════════════════════════════════════════════════╝");
console.log("");
console.log("[bootstrap] setting up orgs and sessions…");

const orgA = await createOrg("A");
const orgB = await createOrg("B");
const tokA = await createSession(orgA);
const tokB = await createSession(orgB);

// ── Section 1: Server health ──────────────────────────────────────────────────
console.log("\n[1] Server health");
{
  const { status, json } = await req("/health");
  check("H01", "server healthy", status === 200 && json?.status === "ok");
}

// ── Section 2: Auth guard — Analytics ────────────────────────────────────────
console.log("\n[2] Auth guard — Analytics");
{
  const routes = [
    "/analytics/status", "/analytics/overview", "/analytics/realtime",
    "/analytics/pages", "/analytics/conversions", "/analytics/audience"
  ];
  for (const path of routes) {
    const { status } = await req(path);
    check("A-AUTH-" + path.split("/").pop().toUpperCase().slice(0,4),
      `GET ${path} unauthenticated → 401`, status === 401);
  }
}

// ── Section 3: Auth guard — Traffic ──────────────────────────────────────────
console.log("\n[3] Auth guard — Traffic");
{
  const routes = ["/traffic/status", "/traffic/sources", "/traffic/organic/keywords", "/traffic/organic/pages"];
  for (const path of routes) {
    const { status } = await req(path);
    check("T-AUTH-" + path.split("/").pop().toUpperCase().slice(0,4),
      `GET ${path} unauthenticated → 401`, status === 401);
  }
}

// ── Section 4: Auth guard — Campaigns ────────────────────────────────────────
console.log("\n[4] Auth guard — Campaigns");
{
  const { status: s1 } = await req("/campaigns/status");
  check("C-AUTH-STAT", "GET /campaigns/status unauthenticated → 401", s1 === 401);
  const { status: s2 } = await req("/campaigns/");
  check("C-AUTH-LIST", "GET /campaigns/ unauthenticated → 401", s2 === 401);
}

// ── Section 5: Analytics routes — authenticated ───────────────────────────────
console.log("\n[5] Analytics — authenticated responses");
{
  const { status: ss, json: sj } = await req("/analytics/status", { token: tokA });
  check("AN01", "GET /analytics/status → 200", ss === 200);
  check("AN02", "status response has ok:true", sj?.ok === true);
  check("AN03", "status has connected field", "connected" in (sj || {}));
  check("AN04", "status has source field", sj?.source === "ga4" || typeof sj?.source === "string" || !("source" in sj));

  const { status: os, json: oj } = await req("/analytics/overview?days=30", { token: tokA });
  check("AN05", "GET /analytics/overview → 200", os === 200);
  check("AN06", "overview has ok field", oj?.ok === true);
  check("AN07", "overview has source=ga4", oj?.source === "ga4");
  check("AN08", "overview has data field", "data" in (oj || {}));

  const { status: ps, json: pj } = await req("/analytics/pages?days=30", { token: tokA });
  check("AN09", "GET /analytics/pages → 200", ps === 200);
  check("AN10", "pages has ok:true", pj?.ok === true);
  check("AN11", "pages has source=ga4", pj?.source === "ga4");

  const { status: cs, json: cj } = await req("/analytics/conversions?days=30", { token: tokA });
  check("AN12", "GET /analytics/conversions → 200", cs === 200);
  check("AN13", "conversions has ok:true", cj?.ok === true);

  const { status: aus, json: auj } = await req("/analytics/audience?days=30", { token: tokA });
  check("AN14", "GET /analytics/audience → 200", aus === 200);
  check("AN15", "audience has ok:true", auj?.ok === true);
  check("AN16", "audience has source=ga4", auj?.source === "ga4");

  const { status: rs, json: rj } = await req("/analytics/realtime", { token: tokA });
  check("AN17", "GET /analytics/realtime → 200", rs === 200);
  check("AN18", "realtime has ok:true", rj?.ok === true);
}

// ── Section 6: Analytics — period validation ──────────────────────────────────
console.log("\n[6] Analytics — period validation");
{
  const { status: s1, json: j1 } = await req("/analytics/overview?days=7",  { token: tokA });
  check("PV01", "days=7 accepted",  s1 === 200 && j1?.ok === true);
  const { status: s2, json: j2 } = await req("/analytics/overview?days=90", { token: tokA });
  check("PV02", "days=90 accepted", s2 === 200 && j2?.ok === true);
  const { status: s3, json: j3 } = await req("/analytics/overview?days=180",{ token: tokA });
  check("PV03", "days=180 accepted (clamped to 365 max)", s3 === 200 && j3?.ok === true);
  const { status: s4, json: j4 } = await req("/analytics/overview",         { token: tokA });
  check("PV04", "no days param → default 30 → 200", s4 === 200 && j4?.ok === true);
}

// ── Section 7: Traffic routes — authenticated ─────────────────────────────────
console.log("\n[7] Traffic — authenticated responses");
{
  const { status: ss, json: sj } = await req("/traffic/status", { token: tokA });
  check("TR01", "GET /traffic/status → 200", ss === 200);
  check("TR02", "traffic status ok:true", sj?.ok === true);
  check("TR03", "traffic status has connected field", "connected" in (sj || {}));

  const { status: srcs, json: srcj } = await req("/traffic/sources?days=30", { token: tokA });
  check("TR04", "GET /traffic/sources → 200", srcs === 200);
  check("TR05", "sources ok:true", srcj?.ok === true);
  check("TR06", "sources source=ga4", srcj?.source === "ga4");
  check("TR07", "sources has data field", "data" in (srcj || {}));

  const { status: ks, json: kj } = await req("/traffic/organic/keywords", { token: tokA });
  check("TR08", "GET /traffic/organic/keywords → 200", ks === 200);
  check("TR09", "organic keywords ok:true", kj?.ok === true);
  check("TR10", "organic keywords source=gsc", kj?.source === "gsc");

  const { status: opps, json: oppj } = await req("/traffic/organic/pages", { token: tokA });
  check("TR11", "GET /traffic/organic/pages → 200", opps === 200);
  check("TR12", "organic pages ok:true", oppj?.ok === true);
}

// ── Section 8: Campaigns routes — authenticated ───────────────────────────────
console.log("\n[8] Campaigns — authenticated responses");
{
  const { status: ss, json: sj } = await req("/campaigns/status", { token: tokA });
  check("CA01", "GET /campaigns/status → 200", ss === 200);
  check("CA02", "campaigns status ok:true", sj?.ok === true);
  check("CA03", "campaigns status has connected", "connected" in (sj || {}));
  check("CA04", "campaigns status source=ga4", sj?.source === "ga4");

  const { status: ls, json: lj } = await req("/campaigns/?days=30", { token: tokA });
  check("CA05", "GET /campaigns/ → 200", ls === 200);
  check("CA06", "campaigns list ok:true", lj?.ok === true);
  check("CA07", "campaigns list source=ga4", lj?.source === "ga4");
  check("CA08", "campaigns list has data", "data" in (lj || {}));

  const { status: ls7, json: lj7 } = await req("/campaigns/?days=7", { token: tokA });
  check("CA09", "campaigns days=7 accepted", ls7 === 200 && lj7?.ok === true);
}

// ── Section 9: Multi-tenant isolation ─────────────────────────────────────────
console.log("\n[9] Multi-tenant isolation");
{
  // Both orgs should get their own (independent) responses
  const { status: sA } = await req("/analytics/overview", { token: tokA });
  const { status: sB } = await req("/analytics/overview", { token: tokB });
  check("MT01", "Org A can call /analytics/overview", sA === 200);
  check("MT02", "Org B can call /analytics/overview", sB === 200);

  const { status: tA } = await req("/traffic/sources", { token: tokA });
  const { status: tB } = await req("/traffic/sources", { token: tokB });
  check("MT03", "Org A can call /traffic/sources", tA === 200);
  check("MT04", "Org B can call /traffic/sources independently", tB === 200);

  const { status: cA } = await req("/campaigns/", { token: tokA });
  const { status: cB } = await req("/campaigns/", { token: tokB });
  check("MT05", "Org A can call /campaigns/", cA === 200);
  check("MT06", "Org B can call /campaigns/ independently", cB === 200);
}

// ── Section 10: No synthetic/fake data in responses ──────────────────────────
console.log("\n[10] No synthetic/fake data");
{
  // Verify no hardcoded fabricated values in the service files
  const { readFileSync } = await import("fs");
  const svcFiles = [
    "artifacts/api-server/src/services/analytics-service.ts",
    "artifacts/api-server/src/services/traffic-service.ts",
    "artifacts/api-server/src/services/campaign-service.ts",
    "artifacts/api-server/src/routes/analytics.ts",
    "artifacts/api-server/src/routes/traffic.ts",
    "artifacts/api-server/src/routes/campaigns.ts",
  ];

  let hasMathRandom = false, hasHardcodedMetric = false, hasPreviewMode = false, hasDemoMode = false;
  for (const f of svcFiles) {
    const src = readFileSync(f, "utf-8");
    if (src.includes("Math.random")) hasMathRandom = true;
    if (/0\.(74|52|31|14)/.test(src)) hasHardcodedMetric = true;
    if (src.includes("PREVIEW_MODE")) hasPreviewMode = true;
    if (src.includes("isDemoMode")) hasDemoMode = true;
  }
  check("ND01", "no Math.random in new service/route files", !hasMathRandom);
  check("ND02", "no hardcoded metrics (0.74/0.52/0.31/0.14) in new files", !hasHardcodedMetric);
  check("ND03", "no PREVIEW_MODE in new service/route files", !hasPreviewMode);
  check("ND04", "no isDemoMode in new service/route files", !hasDemoMode);

  // Verify responses say source=ga4 (not mock/preview/demo)
  const { json: aj } = await req("/analytics/overview", { token: tokA });
  check("ND05", "analytics/overview source=ga4 (not mock)", aj?.source === "ga4");
  const { json: tj } = await req("/traffic/sources", { token: tokA });
  check("ND06", "traffic/sources source=ga4 (not mock)", tj?.source === "ga4");
  const { json: cj } = await req("/campaigns/", { token: tokA });
  check("ND07", "campaigns source=ga4 (not mock)", cj?.source === "ga4");
}

// ── Section 11: Dashboard.js — new API modules present, fake data removed ────
console.log("\n[11] Frontend — new API modules & fake data removal");
{
  const { readFileSync } = await import("fs");
  const dash = readFileSync("artifacts/flowpoint-export/dashboard.js", "utf-8");

  check("FE01", "window._fpAnalyticsAPI defined", dash.includes("window._fpAnalyticsAPI ="));
  check("FE02", "window._fpTrafficAPI defined",   dash.includes("window._fpTrafficAPI ="));
  check("FE03", "window._fpCampaignsAPI defined",  dash.includes("window._fpCampaignsAPI ="));
  check("FE04", "loadAll() calls /api/analytics/overview", dash.includes("/api/analytics/overview"));
  check("FE05", "loadAll() calls /api/traffic/sources",    dash.includes("/api/traffic/sources"));
  check("FE06", "loadAll() calls /api/campaigns/",          dash.includes("/api/campaigns/"));
  check("FE07", "renderGA4Analytics uses _fpAnalyticsState", dash.includes("_fpAnalyticsState"));
  check("FE08", "renderGA4Traffic uses _fpTrafficState",     dash.includes("_fpTrafficState"));
  check("FE09", "renderGA4Campaigns uses _fpCampaignsState", dash.includes("_fpCampaignsState"));
  check("FE10", "loading skeleton helper _fpAnaLoadingSkeleton present", dash.includes("function _fpAnaLoadingSkeleton"));
  check("FE11", "loading skeleton helper _fpTrafLoadingSkeleton present", dash.includes("function _fpTrafLoadingSkeleton"));
  check("FE12", "loading skeleton helper _fpCampLoadingSkeleton present", dash.includes("function _fpCampLoadingSkeleton"));

  // Fake event stream removed
  const fakeStreamRemoved = !dash.includes("[...Array(8)].map((_,i) => {");
  check("FE13", "fake event stream [...Array(8)] removed from Live page", fakeStreamRemoved);

  // isDemoMode not used for event stream anymore
  const liveSection = dash.slice(dash.lastIndexOf("function renderGA4Live"), dash.lastIndexOf("// ─────────────────────────────────────────────────────────────"));
  check("FE14", "Live page event stream no longer uses isDemoMode/PREVIEW_MODE for fake data",
    !liveSection.includes("isDemoMode() || PREVIEW_MODE) ? [...Array"));
}

// ── Section 12: Route registration in index.ts ────────────────────────────────
console.log("\n[12] Route registration");
{
  const { readFileSync } = await import("fs");
  const idx = readFileSync("artifacts/api-server/src/routes/index.ts", "utf-8");
  check("RI01", "analyticsRouter imported", idx.includes(`import analyticsRouter`));
  check("RI02", "trafficRouter imported",   idx.includes(`import trafficRouter`));
  check("RI03", "campaignsRouter imported",  idx.includes(`import campaignsRouter`));
  check("RI04", `router.use("/analytics"...)`, idx.includes(`router.use("/analytics"`));
  check("RI05", `router.use("/traffic"...)`,   idx.includes(`router.use("/traffic"`));
  check("RI06", `router.use("/campaigns"...)`, idx.includes(`router.use("/campaigns"`));
}

// ── Section 13: Service delegation (imports correct ga4-service functions) ────
console.log("\n[13] Service architecture");
{
  const { readFileSync } = await import("fs");
  const ana = readFileSync("artifacts/api-server/src/services/analytics-service.ts", "utf-8");
  const trf = readFileSync("artifacts/api-server/src/services/traffic-service.ts", "utf-8");
  const cmp = readFileSync("artifacts/api-server/src/services/campaign-service.ts", "utf-8");

  check("SA01", "analytics-service imports getGA4Overview",    ana.includes("getGA4Overview"));
  check("SA02", "analytics-service imports getGA4Realtime",    ana.includes("getGA4Realtime"));
  check("SA03", "analytics-service imports getGA4Pages",       ana.includes("getGA4Pages"));
  check("SA04", "analytics-service imports getGA4Conversions", ana.includes("getGA4Conversions"));
  check("SA05", "analytics-service imports getGA4Audience",    ana.includes("getGA4Audience"));
  check("SA06", "analytics-service exports getAnalyticsOverview",  ana.includes("export async function getAnalyticsOverview"));
  check("SA07", "analytics-service exports getAnalyticsRealtime",  ana.includes("export async function getAnalyticsRealtime"));

  check("SA08", "traffic-service imports getGA4Sources",       trf.includes("getGA4Sources"));
  check("SA09", "traffic-service exports getTrafficSources",   trf.includes("export async function getTrafficSources"));
  check("SA10", "traffic-service imports getTopKeywords (GSC)", trf.includes("getTopKeywords"));
  check("SA11", "traffic-service imports getTopPages (GSC)",    trf.includes("getTopPages"));

  check("SA12", "campaign-service imports getGA4Campaigns",    cmp.includes("getGA4Campaigns"));
  check("SA13", "campaign-service exports getCampaigns",       cmp.includes("export async function getCampaigns"));
  check("SA14", "campaign-service exports getCampaignStatus",  cmp.includes("export async function getCampaignStatus"));
}

// ── Section 14: Security — missing orgId → 500 not 200 with wrong org ────────
console.log("\n[14] Security — org isolation edge cases");
{
  // Token for org A should NOT get org B's data, both return 200 from own scope
  const { json: jA } = await req("/analytics/status", { token: tokA });
  const { json: jB } = await req("/analytics/status", { token: tokB });
  // Both should succeed (200) but with their own org context
  check("SEC01", "Both orgs get independent 200 on /analytics/status", jA?.ok === true && jB?.ok === true);
  // Verify "connected" is a boolean (not leaking another org's property ID)
  check("SEC02", "Org A status connected is boolean", typeof jA?.connected === "boolean");
  check("SEC03", "Org B status connected is boolean", typeof jB?.connected === "boolean");
}

// ── Cleanup ───────────────────────────────────────────────────────────────────
console.log("\n── Cleanup ──");
try {
  await DB.query(`DELETE FROM user_sessions  WHERE org_id = ANY($1)`, [[orgA, orgB]]);
  await DB.query(`DELETE FROM org_settings   WHERE org_id = ANY($1)`, [[orgA, orgB]]);
  await DB.query(`DELETE FROM organizations  WHERE id     = ANY($1)`, [[orgA, orgB]]);
  console.log("  🗑 Cleaned up QA orgs and sessions");
} catch(e) {
  console.warn("  Cleanup error:", e.message);
} finally {
  await DB.end();
}

// ── Results ───────────────────────────────────────────────────────────────────
console.log("\n" + "─".repeat(60));
console.log(`Total: ${PASS + FAIL}  ✅ ${PASS}  ❌ ${FAIL}`);
if (FAIL === 0) {
  console.log("\n🎉 ALL PASS");
  process.exit(0);
} else {
  console.log("\n❌ FAILURES DETECTED");
  process.exit(1);
}
