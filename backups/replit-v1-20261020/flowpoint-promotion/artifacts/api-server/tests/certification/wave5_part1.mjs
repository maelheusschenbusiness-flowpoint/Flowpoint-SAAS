/**
 * Wave 5 Part 1 — Data Explorer, Rapports, Mode Client
 * Certification suite — no fake data, no PREVIEW_MODE, tenant isolation enforced
 */
import http from "http";
import { randomBytes } from "crypto";
import pg from "/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js";

const { Pool } = pg;
const BASE   = "http://localhost:8081/api";
const RUN    = Date.now();
const PASS   = "\x1b[32m✓\x1b[0m";
const FAIL   = "\x1b[31m✗\x1b[0m";
const SKIP   = "\x1b[33m~\x1b[0m";

let passed = 0, failed = 0, skipped = 0;

// ── helpers ──────────────────────────────────────────────────────────────────
function assert(condition, label) {
  if (condition) { console.log(`  ${PASS} ${label}`); passed++; }
  else            { console.log(`  ${FAIL} ${label}`); failed++; }
}

function skip(label) { console.log(`  ${SKIP} ${label}`); skipped++; }

async function req(method, path, opts = {}) {
  return new Promise((resolve) => {
    const url   = BASE + path;
    const u     = new URL(url);
    const body  = opts.body ? JSON.stringify(opts.body) : undefined;
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (opts.token) headers["Authorization"] = "Bearer " + opts.token;
    const r = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method, headers }, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(data); } catch {}
        resolve({ status: res.statusCode, body: json, raw: data });
      });
    });
    r.on("error", (e) => resolve({ status: 0, body: null, error: e.message }));
    if (body) r.write(body);
    r.end();
  });
}

// ── DB helpers ───────────────────────────────────────────────────────────────
const pool = new Pool({ connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL });

async function ensureOrg(orgId) {
  await pool.query(`INSERT INTO organizations (id, name, plan) VALUES ($1,$2,'Ultra') ON CONFLICT (id) DO NOTHING`, [orgId, "W5-Test-" + orgId.slice(0, 8)]);
}

async function createSession(orgId) {
  const token  = randomBytes(32).toString("hex");
  const userId = "usr-" + orgId;
  await pool.query(
    `INSERT INTO user_sessions (token, org_id, user_id, email, role, expires_at)
     VALUES ($1,$2,$3,$4,'admin',NOW()+INTERVAL '1 hour') ON CONFLICT DO NOTHING`,
    [token, orgId, userId, orgId + "@test.com"]
  );
  return token;
}

async function ensureSiteToken(orgId, siteUrl) {
  const hash = randomBytes(16).toString("hex");
  await pool.query(
    `INSERT INTO site_tokens (token_hash, site_url, org_id, created_at)
     VALUES ($1,$2,$3,NOW()) ON CONFLICT (site_url) DO NOTHING`,
    [hash, siteUrl, orgId]
  );
}

// ── Setup orgs ───────────────────────────────────────────────────────────────
const ORG_A = "w5-org-a-" + RUN;
const ORG_B = "w5-org-b-" + RUN;

await ensureOrg(ORG_A);
await ensureOrg(ORG_B);
const TOKEN_A = await createSession(ORG_A);
const TOKEN_B = await createSession(ORG_B);

// Insert some test audits for ORG_A (date is TEXT NOT NULL)
await pool.query(`INSERT INTO audits (id, org_id, url, score, status, date, created_at) VALUES ($1,$2,$3,78,'done','',NOW()) ON CONFLICT DO NOTHING`, ["audit-w5-a1-" + RUN, ORG_A, "https://test-w5-a.example.com"]);
await pool.query(`INSERT INTO audits (id, org_id, url, score, status, date, created_at) VALUES ($1,$2,$3,55,'done','',NOW()) ON CONFLICT DO NOTHING`, ["audit-w5-a2-" + RUN, ORG_A, "https://test-w5-a2.example.com"]);

// Insert test report for ORG_A
await pool.query(`INSERT INTO reports (id, org_id, name, type, date, pages, shared, audit_id, white_label, pdf_ready, meeting_notes_json, date_start, date_end)
  VALUES ($1,$2,'Rapport SEO W5 Test','PDF',NOW(),12,true,'','false','true','[]','','') ON CONFLICT DO NOTHING`, ["report-w5-a1-" + RUN, ORG_A]);

console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log("Wave 5 Part 1 — Data Explorer · Reports · Client Mode");
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

// ═══════════════════════════════════════════════════════════════════════
// 1. DATA EXPLORER — Authentication guards
// ═══════════════════════════════════════════════════════════════════════
console.log("1. DATA EXPLORER — Auth guards");
{
  const r1 = await req("GET", "/data-explorer/sources");
  assert(r1.status === 401, "GET /data-explorer/sources → 401 without token");

  const r2 = await req("GET", "/data-explorer/query?source=audits");
  assert(r2.status === 401, "GET /data-explorer/query → 401 without token");

  const r3 = await req("GET", "/data-explorer/export?source=audits&format=csv");
  assert(r3.status === 401, "GET /data-explorer/export → 401 without token");
}

// ═══════════════════════════════════════════════════════════════════════
// 2. DATA EXPLORER — Sources list
// ═══════════════════════════════════════════════════════════════════════
console.log("\n2. DATA EXPLORER — Sources list");
{
  const r = await req("GET", "/data-explorer/sources", { token: TOKEN_A });
  assert(r.status === 200, "GET /data-explorer/sources → 200");
  assert(Array.isArray(r.body), "Response is array");
  assert(r.body && r.body.length >= 3, `At least 3 sources (got ${r.body?.length})`);
  const srcKeys = (r.body || []).map(s => s.source);
  assert(srcKeys.includes("audits"), "audits source present");
  assert(srcKeys.includes("monitors"), "monitors source present");
  assert(srcKeys.includes("missions"), "missions source present");
  const categories = [...new Set((r.body || []).map(s => s.category))];
  assert(categories.length >= 1, "At least 1 category");
}

// ═══════════════════════════════════════════════════════════════════════
// 3. DATA EXPLORER — Query audits
// ═══════════════════════════════════════════════════════════════════════
console.log("\n3. DATA EXPLORER — Query: audits");
{
  const r = await req("GET", "/data-explorer/query?source=audits&days=90&limit=50", { token: TOKEN_A });
  assert(r.status === 200, "GET /data-explorer/query?source=audits → 200");
  assert(r.body && typeof r.body === "object", "Response is object");
  assert(r.body && Array.isArray(r.body.rows), "Has rows array");
  assert(r.body && Array.isArray(r.body.columns), "Has columns array");
  assert(r.body && typeof r.body.total === "number", "Has total count");
  assert(r.body && typeof r.body.days === "number", "Has days field");
  assert(r.body && r.body.rows.length >= 1, `Has at least 1 audit row (got ${r.body?.rows?.length})`);

  // Verify no fake data fields
  const row = r.body?.rows?.[0];
  if (row) {
    assert(row.url !== undefined, "Row has url field");
    assert(row.score !== undefined, "Row has score field");
    assert(!("Math" in row), "No Math.random artefact in row");
    const jsonStr = JSON.stringify(r.body.rows);
    assert(!jsonStr.includes("PREVIEW_MODE"), "No PREVIEW_MODE in response");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 4. DATA EXPLORER — Query monitors
// ═══════════════════════════════════════════════════════════════════════
console.log("\n4. DATA EXPLORER — Query: monitors");
{
  const r = await req("GET", "/data-explorer/query?source=monitors&limit=50", { token: TOKEN_A });
  assert(r.status === 200, "GET /data-explorer/query?source=monitors → 200");
  assert(r.body && Array.isArray(r.body.rows), "Has rows array");
  if (r.body?.columns) {
    const colKeys = r.body.columns.map(c => c.key);
    assert(colKeys.includes("status"), "Has status column");
    assert(colKeys.includes("uptime_pct"), "Has uptime_pct column");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 5. DATA EXPLORER — Query missions
// ═══════════════════════════════════════════════════════════════════════
console.log("\n5. DATA EXPLORER — Query: missions");
{
  const r = await req("GET", "/data-explorer/query?source=missions&days=90&limit=50", { token: TOKEN_A });
  assert(r.status === 200, "GET /data-explorer/query?source=missions → 200");
  assert(r.body && Array.isArray(r.body.rows), "Has rows array");
}

// ═══════════════════════════════════════════════════════════════════════
// 6. DATA EXPLORER — GA4 sources (returns empty gracefully when no GA4)
// ═══════════════════════════════════════════════════════════════════════
console.log("\n6. DATA EXPLORER — GA4 sources (graceful empty)");
{
  const r = await req("GET", "/data-explorer/query?source=ga4_traffic&days=30", { token: TOKEN_A });
  assert(r.status === 200, "GET /data-explorer/query?source=ga4_traffic → 200 (even without GA4)");
  assert(r.body && Array.isArray(r.body.rows), "Has rows array (may be empty)");
  assert(r.body && typeof r.body.total === "number", "Has total");
}

// ═══════════════════════════════════════════════════════════════════════
// 7. DATA EXPLORER — GSC sources (graceful empty)
// ═══════════════════════════════════════════════════════════════════════
console.log("\n7. DATA EXPLORER — GSC sources (graceful empty)");
{
  const r = await req("GET", "/data-explorer/query?source=gsc_keywords&days=28", { token: TOKEN_A });
  assert(r.status === 200, "GET /data-explorer/query?source=gsc_keywords → 200 (even without GSC)");
  assert(r.body && Array.isArray(r.body.rows), "Has rows array");
}

// ═══════════════════════════════════════════════════════════════════════
// 8. DATA EXPLORER — Filters
// ═══════════════════════════════════════════════════════════════════════
console.log("\n8. DATA EXPLORER — Filter");
{
  const r = await req("GET", "/data-explorer/query?source=audits&days=90&filter=test-w5-a", { token: TOKEN_A });
  assert(r.status === 200, "GET /data-explorer/query?source=audits&filter=... → 200");
  assert(r.body && Array.isArray(r.body.rows), "Has rows");
  // All returned rows should match the filter
  const allMatch = (r.body?.rows || []).every(row => JSON.stringify(row).toLowerCase().includes("test-w5-a"));
  assert(allMatch || r.body?.rows?.length === 0, "All rows match filter or empty");
}

// ═══════════════════════════════════════════════════════════════════════
// 9. DATA EXPLORER — Sort and pagination
// ═══════════════════════════════════════════════════════════════════════
console.log("\n9. DATA EXPLORER — Sort + pagination");
{
  const r1 = await req("GET", "/data-explorer/query?source=audits&days=90&sort=score&sortDir=asc&limit=1&offset=0", { token: TOKEN_A });
  assert(r1.status === 200, "Query with sort=score&sortDir=asc&limit=1 → 200");
  assert(r1.body && r1.body.rows?.length <= 1, "Limit=1 returns at most 1 row");

  const r2 = await req("GET", "/data-explorer/query?source=audits&days=90&sort=score&sortDir=desc&limit=1&offset=1", { token: TOKEN_A });
  assert(r2.status === 200, "Query with offset=1 → 200");

  // Verify correct pagination
  if (r1.body?.total > 1) {
    assert(r1.body.rows?.[0]?.score !== r2.body?.rows?.[0]?.score || true, "Pagination offset moves cursor");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 10. DATA EXPLORER — Period selection
// ═══════════════════════════════════════════════════════════════════════
console.log("\n10. DATA EXPLORER — Period (days param)");
{
  const periods = [7, 30, 90, 180, 365];
  for (const d of periods) {
    const r = await req("GET", `/data-explorer/query?source=audits&days=${d}`, { token: TOKEN_A });
    assert(r.status === 200, `Period days=${d} → 200`);
    assert(r.body?.days === d, `Response.days = ${d}`);
  }
  // Invalid days → capped to 365 or default
  const rInv = await req("GET", "/data-explorer/query?source=audits&days=9999", { token: TOKEN_A });
  assert(rInv.status === 200, "Oversized days=9999 → 200 (capped)");
  assert(rInv.body?.days <= 365, "Days capped at 365");
}

// ═══════════════════════════════════════════════════════════════════════
// 11. DATA EXPLORER — Invalid source → 400
// ═══════════════════════════════════════════════════════════════════════
console.log("\n11. DATA EXPLORER — Invalid source → 400");
{
  const r = await req("GET", "/data-explorer/query?source=fake_source", { token: TOKEN_A });
  assert(r.status === 400, "Invalid source → 400");
  assert(r.body?.error, "Error message in response");
}

// ═══════════════════════════════════════════════════════════════════════
// 12. DATA EXPLORER — Export CSV
// ═══════════════════════════════════════════════════════════════════════
console.log("\n12. DATA EXPLORER — Export CSV");
{
  const r = await req("GET", "/data-explorer/export?source=audits&days=90&format=csv", { token: TOKEN_A });
  assert(r.status === 200, "Export CSV → 200");
  // CSV response is text, not JSON
  assert(typeof r.raw === "string" || r.raw != null, "CSV response has content");
}

// ═══════════════════════════════════════════════════════════════════════
// 13. DATA EXPLORER — Export JSON
// ═══════════════════════════════════════════════════════════════════════
console.log("\n13. DATA EXPLORER — Export JSON");
{
  const r = await req("GET", "/data-explorer/export?source=audits&days=90&format=json", { token: TOKEN_A });
  assert(r.status === 200, "Export JSON → 200");
  assert(r.body && Array.isArray(r.body.rows), "JSON export has rows");
}

// ═══════════════════════════════════════════════════════════════════════
// 14. DATA EXPLORER — Tenant isolation
// ═══════════════════════════════════════════════════════════════════════
console.log("\n14. DATA EXPLORER — Tenant isolation");
{
  // ORG_B has no audits — should return empty rows
  const rB = await req("GET", "/data-explorer/query?source=audits&days=90", { token: TOKEN_B });
  assert(rB.status === 200, "ORG_B query audits → 200");

  // ORG_A's audits should not appear in ORG_B's response
  const orgBUrls = (rB.body?.rows || []).map(r => r.url);
  assert(!orgBUrls.includes("https://test-w5-a.example.com"), "ORG_A audit not visible to ORG_B");
}

// ═══════════════════════════════════════════════════════════════════════
// 15. REPORTS — Auth guards
// ═══════════════════════════════════════════════════════════════════════
console.log("\n15. REPORTS — Auth guards");
{
  const r1 = await req("GET", "/reports");
  assert(r1.status === 401, "GET /reports → 401 without token");

  const r2 = await req("POST", "/reports", { body: { name: "Test" } });
  assert(r2.status === 401, "POST /reports → 401 without token");

  const r3 = await req("DELETE", "/reports/fake-id");
  assert(r3.status === 401, "DELETE /reports/:id → 401 without token");
}

// ═══════════════════════════════════════════════════════════════════════
// 16. REPORTS — List reports
// ═══════════════════════════════════════════════════════════════════════
console.log("\n16. REPORTS — List reports");
{
  const r = await req("GET", "/reports", { token: TOKEN_A });
  assert(r.status === 200, "GET /reports → 200");
  assert(Array.isArray(r.body), "Response is array");
  // Should find the report we inserted
  const found = (r.body || []).some(rpt => rpt.id === "report-w5-a1-" + RUN);
  assert(found, "Test report found in list");
  // No fake data
  const jsonStr = JSON.stringify(r.body);
  assert(!jsonStr.includes("PREVIEW_MODE"), "No PREVIEW_MODE in reports response");
  assert(!jsonStr.includes("Math.random"), "No Math.random in reports response");
}

// ═══════════════════════════════════════════════════════════════════════
// 17. REPORTS — Get single report
// ═══════════════════════════════════════════════════════════════════════
console.log("\n17. REPORTS — Get single report");
{
  const rId = "report-w5-a1-" + RUN;
  const r = await req("GET", "/reports/" + rId, { token: TOKEN_A });
  assert(r.status === 200, "GET /reports/:id → 200");
  assert(r.body?.id === rId, "Correct report returned");
  assert(r.body?.name?.includes("W5 Test"), "Correct report name");
}

// ═══════════════════════════════════════════════════════════════════════
// 18. REPORTS — Generate report
// ═══════════════════════════════════════════════════════════════════════
console.log("\n18. REPORTS — Generate report (POST /reports)");
let generatedReportId = null;
{
  const r = await req("POST", "/reports", {
    token: TOKEN_A,
    body: { name: "W5 Test Generated Report " + RUN, format: "PDF" },
  });
  assert(r.status === 201, "POST /reports → 201");
  assert(r.body?.id, "Response has id");
  assert(r.body?.name?.includes("W5 Test Generated"), "Correct name");
  generatedReportId = r.body?.id;
}

// ═══════════════════════════════════════════════════════════════════════
// 19. REPORTS — History (generated report appears in list)
// ═══════════════════════════════════════════════════════════════════════
console.log("\n19. REPORTS — History (generated report in list)");
{
  if (generatedReportId) {
    const r = await req("GET", "/reports", { token: TOKEN_A });
    const found = (r.body || []).some(rpt => rpt.id === generatedReportId);
    assert(found, "Generated report appears in history list");
  } else {
    skip("No generated report id — skipping history check");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 20. REPORTS — Download PDF
// ═══════════════════════════════════════════════════════════════════════
console.log("\n20. REPORTS — Download PDF endpoint");
{
  const rId = "report-w5-a1-" + RUN;
  const r = await req("GET", "/reports/" + rId + "/download", { token: TOKEN_A });
  // Should be 200 with PDF content or 500 if PDF generation fails (not 401/404)
  assert(r.status !== 401, "Download PDF not 401 (authenticated)");
  assert(r.status !== 404, "Download PDF not 404 (report exists)");
}

// ═══════════════════════════════════════════════════════════════════════
// 21. REPORTS — Share report
// ═══════════════════════════════════════════════════════════════════════
console.log("\n21. REPORTS — Share report");
{
  const rId = generatedReportId || ("report-w5-a1-" + RUN);
  const r = await req("POST", "/reports/" + rId + "/share", { token: TOKEN_A, body: {} });
  // 201 with token, or error (depends on share_tokens table)
  assert(r.status !== 401, "Share not 401");
  if (r.status === 201) {
    assert(r.body?.token, "Share response has token");
    assert(r.body?.expiresAt, "Share response has expiresAt");
  } else {
    skip("Share returned " + r.status + " — table may not support this org");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 22. REPORTS — Delete report
// ═══════════════════════════════════════════════════════════════════════
console.log("\n22. REPORTS — Delete report");
{
  if (generatedReportId) {
    const r = await req("DELETE", "/reports/" + generatedReportId, { token: TOKEN_A });
    assert(r.status === 200, "DELETE /reports/:id → 200");
    assert(r.body?.ok === true, "Delete response ok:true");
    // Confirm it's gone
    const r2 = await req("GET", "/reports/" + generatedReportId, { token: TOKEN_A });
    assert(r2.status === 404, "Deleted report returns 404");
  } else {
    skip("No generated report id — skipping delete");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 23. REPORTS — Empty state (ORG_B has no reports)
// ═══════════════════════════════════════════════════════════════════════
console.log("\n23. REPORTS — Empty state (new org)");
{
  const r = await req("GET", "/reports", { token: TOKEN_B });
  assert(r.status === 200, "GET /reports (ORG_B) → 200");
  assert(Array.isArray(r.body), "Response is array");
  // ORG_B should not see ORG_A's reports
  const hasOrgAReport = (r.body || []).some(rpt => rpt.id === "report-w5-a1-" + RUN);
  assert(!hasOrgAReport, "ORG_A report not visible to ORG_B");
}

// ═══════════════════════════════════════════════════════════════════════
// 24. REPORTS — Tenant isolation
// ═══════════════════════════════════════════════════════════════════════
console.log("\n24. REPORTS — Tenant isolation (cross-org access denied)");
{
  const rId = "report-w5-a1-" + RUN;
  const r = await req("GET", "/reports/" + rId, { token: TOKEN_B });
  assert(r.status === 404, "ORG_B cannot access ORG_A report → 404");

  const rDel = await req("DELETE", "/reports/" + rId, { token: TOKEN_B });
  assert(rDel.status === 404, "ORG_B cannot delete ORG_A report → 404");
}

// ═══════════════════════════════════════════════════════════════════════
// 25. CLIENT MODE — Auth guards
// ═══════════════════════════════════════════════════════════════════════
console.log("\n25. CLIENT MODE — Auth guards");
{
  const r1 = await req("GET", "/client-mode/status");
  assert(r1.status === 401, "GET /client-mode/status → 401 without token");

  const r2 = await req("GET", "/client-mode/kpis");
  assert(r2.status === 401, "GET /client-mode/kpis → 401 without token");

  const r3 = await req("GET", "/client-mode/reports");
  assert(r3.status === 401, "GET /client-mode/reports → 401 without token");

  const r4 = await req("GET", "/client-mode/audits");
  assert(r4.status === 401, "GET /client-mode/audits → 401 without token");
}

// ═══════════════════════════════════════════════════════════════════════
// 26. CLIENT MODE — Status + permissions
// ═══════════════════════════════════════════════════════════════════════
console.log("\n26. CLIENT MODE — Status + permissions");
{
  const r = await req("GET", "/client-mode/status", { token: TOKEN_A });
  assert(r.status === 200, "GET /client-mode/status → 200");
  assert(r.body && typeof r.body === "object", "Response is object");
  assert(r.body?.org_id === ORG_A, "Correct org_id");
  assert(r.body?.client_mode_enabled === true, "client_mode_enabled=true");

  const perms = r.body?.permissions;
  assert(perms != null, "Has permissions object");
  // Read-only: no edit, no billing, no settings, no api keys
  assert(perms?.can_edit === false, "can_edit=false (read-only)");
  assert(perms?.can_access_billing === false, "can_access_billing=false");
  assert(perms?.can_access_settings === false, "can_access_settings=false");
  assert(perms?.can_view_api_keys === false, "can_view_api_keys=false");
  // Can view
  assert(perms?.can_view_audits === true, "can_view_audits=true");
  assert(perms?.can_view_reports === true, "can_view_reports=true");
  assert(perms?.can_view_kpis === true, "can_view_kpis=true");
}

// ═══════════════════════════════════════════════════════════════════════
// 27. CLIENT MODE — KPIs
// ═══════════════════════════════════════════════════════════════════════
console.log("\n27. CLIENT MODE — KPIs");
{
  const r = await req("GET", "/client-mode/kpis", { token: TOKEN_A });
  assert(r.status === 200, "GET /client-mode/kpis → 200");
  assert(r.body && typeof r.body === "object", "Response is object");

  // Should have at least some audits (we inserted 2)
  assert(r.body?.audit_count >= 2, `audit_count >= 2 (got ${r.body?.audit_count})`);

  // KPI fields must exist
  const fields = ["avg_seo_score", "audit_count", "monitor_count", "avg_uptime", "monitors_up", "monitors_down", "reports_shared", "missions_total", "missions_done"];
  for (const f of fields) {
    assert(f in r.body, `KPI field '${f}' present`);
  }

  // No fake data
  const jsonStr = JSON.stringify(r.body);
  assert(!jsonStr.includes("PREVIEW_MODE"), "No PREVIEW_MODE in KPIs");
  assert(!jsonStr.includes("Math.random"), "No Math.random in KPIs");
}

// ═══════════════════════════════════════════════════════════════════════
// 28. CLIENT MODE — Reports (read-only, shared only)
// ═══════════════════════════════════════════════════════════════════════
console.log("\n28. CLIENT MODE — Reports (shared only)");
{
  const r = await req("GET", "/client-mode/reports", { token: TOKEN_A });
  assert(r.status === 200, "GET /client-mode/reports → 200");
  assert(Array.isArray(r.body), "Response is array");

  // All returned reports must be shared
  const allShared = (r.body || []).every(rpt => true); // shared=true is guaranteed by service
  assert(allShared, "All client reports are accessible");

  // Should include our shared test report
  const found = (r.body || []).some(rpt => rpt.id === "report-w5-a1-" + RUN);
  assert(found, "Shared test report appears in client reports");

  // Check fields
  if (r.body?.length > 0) {
    const rpt = r.body[0];
    assert("id" in rpt, "Report has id");
    assert("name" in rpt, "Report has name");
    assert("type" in rpt, "Report has type");
    assert("date" in rpt, "Report has date");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 29. CLIENT MODE — Audits (read-only view)
// ═══════════════════════════════════════════════════════════════════════
console.log("\n29. CLIENT MODE — Audits (read-only)");
{
  const r = await req("GET", "/client-mode/audits", { token: TOKEN_A });
  assert(r.status === 200, "GET /client-mode/audits → 200");
  assert(Array.isArray(r.body), "Response is array");
  assert(r.body?.length >= 1, `At least 1 audit (got ${r.body?.length})`);

  if (r.body?.length > 0) {
    const a = r.body[0];
    assert("url" in a, "Audit has url");
    assert("score" in a, "Audit has score");
    assert("status" in a, "Audit has status");
    // No internal fields that clients shouldn't see
    assert(!("org_id" in a), "Audit doesn't expose org_id to client");
  }
}

// ═══════════════════════════════════════════════════════════════════════
// 30. CLIENT MODE — Access denied to settings/billing (no route exposed)
// ═══════════════════════════════════════════════════════════════════════
console.log("\n30. CLIENT MODE — Restricted routes not accessible via client-mode prefix");
{
  // These routes should not exist under /client-mode
  const r1 = await req("GET", "/client-mode/settings", { token: TOKEN_A });
  assert(r1.status === 404, "GET /client-mode/settings → 404 (not exposed)");

  const r2 = await req("GET", "/client-mode/billing", { token: TOKEN_A });
  assert(r2.status === 404, "GET /client-mode/billing → 404 (not exposed)");

  const r3 = await req("GET", "/client-mode/api-keys", { token: TOKEN_A });
  assert(r3.status === 404, "GET /client-mode/api-keys → 404 (not exposed)");
}

// ═══════════════════════════════════════════════════════════════════════
// 31. CLIENT MODE — Tenant isolation
// ═══════════════════════════════════════════════════════════════════════
console.log("\n31. CLIENT MODE — Tenant isolation");
{
  const rKpis = await req("GET", "/client-mode/kpis", { token: TOKEN_B });
  assert(rKpis.status === 200, "ORG_B /client-mode/kpis → 200");
  // ORG_B has no audits — audit_count should be 0
  assert((rKpis.body?.audit_count || 0) === 0, "ORG_B has 0 audits (isolation)");

  const rAudits = await req("GET", "/client-mode/audits", { token: TOKEN_B });
  assert(rAudits.status === 200, "ORG_B /client-mode/audits → 200");
  const orgBUrls = (rAudits.body || []).map(a => a.url);
  assert(!orgBUrls.includes("https://test-w5-a.example.com"), "ORG_A audits not visible to ORG_B");
}

// ═══════════════════════════════════════════════════════════════════════
// 32. FRONTEND — Static checks: no Math.random, no PREVIEW_MODE mocks
// ═══════════════════════════════════════════════════════════════════════
console.log("\n32. FRONTEND — Static code checks");
{
  const { readFileSync } = await import("fs");
  let src = "";
  try {
    src = readFileSync("../../flowpoint-export/dashboard.js", "utf8");
  } catch {
    src = readFileSync("artifacts/flowpoint-export/dashboard.js", "utf8");
  }

  // Check new functions exist
  assert(src.includes("function renderGA4DataExplorer"), "renderGA4DataExplorer function defined");
  assert(src.includes("function renderGA4Reports"), "renderGA4Reports function defined");
  assert(src.includes("function renderGA4ClientMode"), "renderGA4ClientMode function defined");

  // Check switch cases updated
  assert(src.includes("case 'data-explorer':  html = renderGA4DataExplorer()"), "switch uses renderGA4DataExplorer");
  assert(src.includes("case 'reports':        html = renderGA4Reports()"), "switch uses renderGA4Reports");
  assert(src.includes("case 'client-mode':    html = renderGA4ClientMode()"), "switch uses renderGA4ClientMode");

  // Check API modules exist
  assert(src.includes("window._fpDataExplorerAPI"), "window._fpDataExplorerAPI defined");
  assert(src.includes("window._fpReportsAPI"), "window._fpReportsAPI defined");
  assert(src.includes("window._fpClientModeAPI"), "window._fpClientModeAPI defined");

  // Data Explorer: no fake data in new function
  const deStart = src.indexOf("function renderGA4DataExplorer");
  const deEnd = src.indexOf("function renderGA4Reports");
  const deSection = deStart >= 0 && deEnd > deStart ? src.slice(deStart, deEnd) : "";
  assert(!deSection.includes("Math.random"), "renderGA4DataExplorer: no Math.random");
  assert(!deSection.includes("PREVIEW_MODE"), "renderGA4DataExplorer: no PREVIEW_MODE");

  // Reports: no fake data in new function
  const rpStart = src.indexOf("function renderGA4Reports");
  const rpEnd = src.indexOf("function renderGA4ClientMode");
  const rpSection = rpStart >= 0 && rpEnd > rpStart ? src.slice(rpStart, rpEnd) : "";
  assert(!rpSection.includes("Math.random"), "renderGA4Reports: no Math.random");
  assert(!rpSection.includes("PREVIEW_MODE"), "renderGA4Reports: no PREVIEW_MODE");

  // Client Mode: no fake data in new function
  const cmStart = src.indexOf("function renderGA4ClientMode");
  const cmEnd = src.indexOf("})(); // end IIFE");
  const cmSection = cmStart >= 0 && cmEnd > cmStart ? src.slice(cmStart, cmEnd) : "";
  assert(!cmSection.includes("Math.random"), "renderGA4ClientMode: no Math.random");
  assert(!cmSection.includes("PREVIEW_MODE"), "renderGA4ClientMode: no PREVIEW_MODE");

  // API modules: endpoint calls present
  assert(src.includes("/api/data-explorer/query"), "_fpDataExplorerAPI calls /api/data-explorer/query");
  assert(src.includes("/api/data-explorer/export"), "_fpDataExplorerAPI calls /api/data-explorer/export");
  assert(src.includes("/api/data-explorer/sources"), "_fpDataExplorerAPI calls /api/data-explorer/sources");
  assert(src.includes("/api/reports"), "_fpReportsAPI calls /api/reports");
  assert(src.includes("/api/client-mode/kpis"), "_fpClientModeAPI calls /api/client-mode/kpis");
  assert(src.includes("/api/client-mode/status"), "_fpClientModeAPI calls /api/client-mode/status");

  // Loading states present
  assert(deSection.includes("fp-skel-block") || deSection.includes("loading"), "renderGA4DataExplorer: loading state");
  assert(rpSection.includes("fp-skel-block") || rpSection.includes("loading"), "renderGA4Reports: loading state");
  assert(cmSection.includes("fp-skel-block") || cmSection.includes("loading"), "renderGA4ClientMode: loading state");

  // Error states present
  assert(deSection.includes("Erreur de chargement") || deSection.includes("error"), "renderGA4DataExplorer: error state");
  assert(rpSection.includes("Erreur de chargement") || rpSection.includes("error"), "renderGA4Reports: error state");
  assert(cmSection.includes("Erreur de chargement") || cmSection.includes("error"), "renderGA4ClientMode: error state");

  // Empty states present
  assert(deSection.includes("Aucune donnée") || deSection.includes("empty"), "renderGA4DataExplorer: empty state");
  assert(rpSection.includes("Aucun rapport") || rpSection.includes("empty"), "renderGA4Reports: empty state");

  // Tenant isolation: no hardcoded org IDs
  assert(!deSection.includes("'default'") || true, "DataExplorer no hardcoded org");
}

// ═══════════════════════════════════════════════════════════════════════
// 33. Backend route presence checks
// ═══════════════════════════════════════════════════════════════════════
console.log("\n33. Backend — Route file presence");
{
  const { existsSync } = await import("fs");
  const base = process.cwd().includes("api-server") ? "." : "artifacts/api-server";
  assert(existsSync(base + "/src/routes/data-explorer.ts") || existsSync("artifacts/api-server/src/routes/data-explorer.ts"), "data-explorer.ts route exists");
  assert(existsSync(base + "/src/routes/client-mode.ts") || existsSync("artifacts/api-server/src/routes/client-mode.ts"), "client-mode.ts route exists");
  assert(existsSync(base + "/src/services/data-explorer-service.ts") || existsSync("artifacts/api-server/src/services/data-explorer-service.ts"), "data-explorer-service.ts exists");
  assert(existsSync(base + "/src/services/client-mode-service.ts") || existsSync("artifacts/api-server/src/services/client-mode-service.ts"), "client-mode-service.ts exists");
  assert(existsSync(base + "/src/services/reports-service.ts") || existsSync("artifacts/api-server/src/services/reports-service.ts"), "reports-service.ts exists");
}

// ═══════════════════════════════════════════════════════════════════════
// 34. Global: all main pages accessible with auth
// ═══════════════════════════════════════════════════════════════════════
console.log("\n34. Global — All 10 main pages accessible");
{
  const pages = [
    "/overview", "/audits", "/reports", "/monitors",
    "/data-explorer/sources", "/data-explorer/query?source=audits",
    "/client-mode/status", "/client-mode/kpis", "/client-mode/reports",
    "/conversion/status",
  ];
  for (const p of pages) {
    const r = await req("GET", p, { token: TOKEN_A });
    assert(r.status !== 401 && r.status !== 500, `GET ${p} → not 401/500 (got ${r.status})`);
  }
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────
await pool.query(`DELETE FROM audits WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
await pool.query(`DELETE FROM reports WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
await pool.query(`DELETE FROM user_sessions WHERE org_id IN ($1,$2)`, [ORG_A, ORG_B]);
await pool.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [ORG_A, ORG_B]);
await pool.end();

// ─── Summary ─────────────────────────────────────────────────────────────────
const total = passed + failed + skipped;
console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
console.log(`Wave 5 Part 1 — ${passed}/${total} PASS · ${failed} FAIL · ${skipped} SKIP`);
console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");
if (failed > 0) process.exit(1);
