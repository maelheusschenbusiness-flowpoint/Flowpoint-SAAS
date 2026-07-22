#!/usr/bin/env node
// Browser-level verification for Wave 5 Part 1
import pg from "/home/runner/workspace/node_modules/.pnpm/pg@8.20.0/node_modules/pg/lib/index.js";
const { Pool } = pg;
import crypto from "crypto";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const BASE = "http://localhost:8081/api";
const RUN = Date.now();

let pass = 0, fail = 0;
const results = { de: [], rp: [], cm: [] };

function ok(label, cond, section) {
  if (cond) { pass++; results[section].push("✓ " + label); }
  else       { fail++; results[section].push("✗ " + label); }
}

async function req(path, opts = {}) {
  try {
    const r = await fetch(BASE + path, opts);
    let body;
    const ct = r.headers.get("content-type") || "";
    if (ct.includes("json")) body = await r.json();
    else body = await r.text();
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: null, error: String(e) };
  }
}

async function setup() {
  const orgA = "bv-org-a-" + RUN;
  const orgB = "bv-org-b-" + RUN;
  const tokA = crypto.randomBytes(32).toString("hex");
  const tokB = crypto.randomBytes(32).toString("hex");
  await pool.query(`INSERT INTO organizations(id,name,plan) VALUES($1,'BV-A','Ultra') ON CONFLICT DO NOTHING`, [orgA]);
  await pool.query(`INSERT INTO organizations(id,name,plan) VALUES($1,'BV-B','Ultra') ON CONFLICT DO NOTHING`, [orgB]);
  await pool.query(`INSERT INTO user_sessions(token,org_id,user_id,email,role,expires_at) VALUES($1,$2,$3,$4,'admin',NOW()+INTERVAL '1 hour') ON CONFLICT DO NOTHING`, [tokA, orgA, "u1-" + RUN, orgA + "@test.com"]);
  await pool.query(`INSERT INTO user_sessions(token,org_id,user_id,email,role,expires_at) VALUES($1,$2,$3,$4,'admin',NOW()+INTERVAL '1 hour') ON CONFLICT DO NOTHING`, [tokB, orgB, "u2-" + RUN, orgB + "@test.com"]);
  // Insert 2 audits for orgA
  await pool.query(`INSERT INTO audits(id,org_id,url,score,status,date,created_at) VALUES($1,$2,'https://bv-a.example.com',82,'done','',NOW()) ON CONFLICT DO NOTHING`, ["bv-aud1-" + RUN, orgA]);
  await pool.query(`INSERT INTO audits(id,org_id,url,score,status,date,created_at) VALUES($1,$2,'https://bv-a2.example.com',65,'done','',NOW()) ON CONFLICT DO NOTHING`, ["bv-aud2-" + RUN, orgA]);
  return { orgA, orgB, tokA, tokB };
}

async function cleanup(orgA, orgB) {
  await pool.query(`DELETE FROM user_sessions WHERE org_id IN ($1,$2)`, [orgA, orgB]);
  await pool.query(`DELETE FROM audits WHERE org_id IN ($1,$2)`, [orgA, orgB]);
  await pool.query(`DELETE FROM reports WHERE org_id IN ($1,$2)`, [orgA, orgB]);
  await pool.query(`DELETE FROM organizations WHERE id IN ($1,$2)`, [orgA, orgB]);
}

async function run() {
  const { orgA, orgB, tokA, tokB } = await setup();
  const H = { "Authorization": "Bearer " + tokA };
  const HB = { "Authorization": "Bearer " + tokB };

  // ── DATA EXPLORER ──────────────────────────────────────────────────────────
  const s = "de";
  // auth guards
  { const r = await req("/data-explorer/sources"); ok("sources: 401 sans token", r.status === 401, s); }
  { const r = await req("/data-explorer/query"); ok("query: 401 sans token", r.status === 401, s); }
  { const r = await req("/data-explorer/export"); ok("export: 401 sans token", r.status === 401, s); }

  // sources list
  { const r = await req("/data-explorer/sources", { headers: H });
    ok("sources → 200", r.status === 200, s);
    ok("sources is array", Array.isArray(r.body), s);
    ok("9 sources disponibles", Array.isArray(r.body) && r.body.length === 9, s);
    ok("source audits présente", Array.isArray(r.body) && r.body.some(x => x.source === "audits"), s);
    ok("source monitors présente", Array.isArray(r.body) && r.body.some(x => x.source === "monitors"), s);
    ok("source missions présente", Array.isArray(r.body) && r.body.some(x => x.source === "missions"), s); }

  // query: audits
  { const r = await req("/data-explorer/query?source=audits", { headers: H });
    ok("query audits → 200", r.status === 200, s);
    ok("audits: has rows array", Array.isArray(r.body?.rows), s);
    ok("audits: has columns array", Array.isArray(r.body?.columns), s);
    ok("audits: has total", typeof r.body?.total === "number", s);
    ok("audits: ≥2 rows (données réelles)", r.body?.rows?.length >= 2, s);
    ok("audits: row has url", r.body?.rows?.[0]?.url !== undefined, s);
    ok("audits: row has score", r.body?.rows?.[0]?.score !== undefined, s);
    const bodyStr = JSON.stringify(r.body);
    ok("audits: aucune donnée fictive", !bodyStr.includes("PREVIEW_MODE") && !bodyStr.includes("Math.random"), s); }

  // query: monitors
  { const r = await req("/data-explorer/query?source=monitors", { headers: H });
    ok("query monitors → 200", r.status === 200, s);
    ok("monitors: has rows array", Array.isArray(r.body?.rows), s); }

  // query: missions
  { const r = await req("/data-explorer/query?source=missions", { headers: H });
    ok("query missions → 200", r.status === 200, s);
    ok("missions: has rows array", Array.isArray(r.body?.rows), s); }

  // ga4 graceful empty
  { const r = await req("/data-explorer/query?source=ga4_traffic", { headers: H });
    ok("ga4_traffic → 200 (empty OK)", r.status === 200, s);
    ok("ga4_traffic: has rows", Array.isArray(r.body?.rows), s); }

  // gsc graceful empty
  { const r = await req("/data-explorer/query?source=gsc_keywords", { headers: H });
    ok("gsc_keywords → 200 (empty OK)", r.status === 200, s);
    ok("gsc_keywords: has rows", Array.isArray(r.body?.rows), s); }

  // filter
  { const r = await req("/data-explorer/query?source=audits&filter=bv-a.example", { headers: H });
    ok("filter → 200", r.status === 200, s);
    ok("filter: retourne array", Array.isArray(r.body?.rows), s); }

  // sort + pagination
  { const r = await req("/data-explorer/query?source=audits&sort=score&sortDir=asc&limit=1", { headers: H });
    ok("sort+limit → 200", r.status === 200, s);
    ok("limit=1 respecté", r.body?.rows?.length <= 1, s); }
  { const r = await req("/data-explorer/query?source=audits&offset=999", { headers: H });
    ok("offset=999 → page vide", r.status === 200 && r.body?.rows?.length === 0, s); }

  // périodes
  for (const d of [7, 30, 90, 180, 365]) {
    const r = await req(`/data-explorer/query?source=audits&days=${d}`, { headers: H });
    ok(`days=${d} → 200, days=${d}`, r.status === 200 && r.body?.days === d, s);
  }
  { const r = await req("/data-explorer/query?source=audits&days=9999", { headers: H });
    ok("days=9999 → capé à 365", r.status === 200 && r.body?.days <= 365, s); }

  // export CSV
  { const r = await req("/data-explorer/export?source=audits&format=csv", { headers: H });
    ok("export CSV → 200", r.status === 200, s);
    ok("export CSV: contenu non-vide", r.body && r.body.length > 0, s); }

  // export JSON
  { const r = await req("/data-explorer/export?source=audits&format=json", { headers: H });
    ok("export JSON → 200", r.status === 200, s);
    ok("export JSON: has rows", Array.isArray(r.body?.rows), s); }

  // invalid source
  { const r = await req("/data-explorer/query?source=FAKE", { headers: H });
    ok("source invalide → 400", r.status === 400, s); }

  // tenant isolation
  { const r = await req("/data-explorer/query?source=audits", { headers: HB });
    ok("orgB voit 0 audits (isolation)", r.status === 200 && r.body?.rows?.length === 0, s); }

  // ── RAPPORTS ───────────────────────────────────────────────────────────────
  const rp = "rp";
  // auth guards
  { const r = await req("/reports"); ok("reports: 401 sans token", r.status === 401, rp); }

  // liste vide (nouveau org)
  { const r = await req("/reports", { headers: H });
    ok("liste rapports → 200", r.status === 200, rp);
    ok("liste rapports: array", Array.isArray(r.body), rp);
    ok("aucune fuite orgB dans orgA", !JSON.stringify(r.body).includes(orgB), rp); }

  // génération
  let reportId = "";
  { const r = await req("/reports", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Browser Test Rapport", type: "PDF", date_start: "2026-01-01", date_end: "2026-07-01" }) });
    ok("POST /reports → 201", r.status === 201, rp);
    ok("rapport créé: has id", Boolean(r.body?.id), rp);
    ok("rapport créé: nom correct", r.body?.name === "Browser Test Rapport", rp);
    reportId = r.body?.id || ""; }

  // get single
  if (reportId) {
    const r = await req("/reports/" + reportId, { headers: H });
    ok("GET /reports/:id → 200", r.status === 200, rp);
    ok("rapport correct retourné", r.body?.id === reportId, rp);
  }

  // historique
  { const r = await req("/reports", { headers: H });
    ok("rapport apparaît dans historique", Array.isArray(r.body) && r.body.some(x => x.id === reportId), rp); }

  // téléchargement
  if (reportId) {
    const r = await req("/reports/" + reportId + "/download", { headers: H });
    ok("download → pas 401", r.status !== 401, rp);
    ok("download → pas 500", r.status !== 500, rp);
  }

  // partage
  if (reportId) {
    const r = await req("/reports/" + reportId + "/share", { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: JSON.stringify({}) });
    ok("share → 201", r.status === 201, rp);
    ok("share: has token", Boolean(r.body?.token), rp);
    ok("share: has expiresAt", Boolean(r.body?.expiresAt), rp);
  }

  // suppression
  if (reportId) {
    const r = await req("/reports/" + reportId, { method: "DELETE", headers: H });
    ok("DELETE /reports/:id → 200", r.status === 200, rp);
    ok("delete ok:true", r.body?.ok === true, rp);
    const r2 = await req("/reports/" + reportId, { headers: H });
    ok("après suppression → 404", r2.status === 404, rp);
  }

  // état vide (orgB)
  { const r = await req("/reports", { headers: HB });
    ok("orgB rapports → 200", r.status === 200, rp);
    ok("orgB rapports: array", Array.isArray(r.body), rp);
  }

  // isolation cross-tenant
  if (reportId) {
    const r = await req("/reports/" + reportId, { headers: HB });
    ok("orgB ne voit pas rapport orgA → 404", r.status === 404, rp);
  }

  // aucune donnée fictive dans la liste
  { const r = await req("/reports", { headers: H });
    const s2 = JSON.stringify(r.body);
    ok("reports: pas PREVIEW_MODE", !s2.includes("PREVIEW_MODE"), rp);
    ok("reports: pas Math.random", !s2.includes("Math.random"), rp); }

  // ── MODE CLIENT ────────────────────────────────────────────────────────────
  const cm = "cm";
  // auth guards
  { const r = await req("/client-mode/status"); ok("status: 401 sans token", r.status === 401, cm); }
  { const r = await req("/client-mode/kpis");  ok("kpis: 401 sans token", r.status === 401, cm); }
  { const r = await req("/client-mode/reports"); ok("cm-reports: 401 sans token", r.status === 401, cm); }
  { const r = await req("/client-mode/audits");  ok("cm-audits: 401 sans token", r.status === 401, cm); }

  // status + permissions
  { const r = await req("/client-mode/status", { headers: H });
    ok("status → 200", r.status === 200, cm);
    const p = r.body?.permissions || {};
    ok("client_mode_enabled=true", r.body?.client_mode_enabled === true, cm);
    ok("can_edit=false (read-only)", p.can_edit === false, cm);
    ok("can_access_billing=false", p.can_access_billing === false, cm);
    ok("can_access_settings=false", p.can_access_settings === false, cm);
    ok("can_view_api_keys=false", p.can_view_api_keys === false, cm);
    ok("can_view_audits=true", p.can_view_audits === true, cm);
    ok("can_view_reports=true", p.can_view_reports === true, cm);
    ok("can_view_kpis=true", p.can_view_kpis === true, cm); }

  // KPIs
  { const r = await req("/client-mode/kpis", { headers: H });
    ok("kpis → 200", r.status === 200, cm);
    ok("kpis: audit_count ≥ 2", r.body?.audit_count >= 2, cm);
    for (const f of ["avg_seo_score","audit_count","monitor_count","avg_uptime","monitors_up","monitors_down","reports_shared","missions_total","missions_done"]) {
      ok("kpis: champ " + f + " présent", f in (r.body || {}), cm);
    }
    const s2 = JSON.stringify(r.body);
    ok("kpis: aucune donnée fictive", !s2.includes("PREVIEW_MODE") && !s2.includes("Math.random"), cm); }

  // rapports (shared only)
  { const r = await req("/client-mode/reports", { headers: H });
    ok("cm-reports → 200", r.status === 200, cm);
    ok("cm-reports: array", Array.isArray(r.body), cm); }

  // audits (read-only)
  { const r = await req("/client-mode/audits", { headers: H });
    ok("cm-audits → 200", r.status === 200, cm);
    ok("cm-audits: array", Array.isArray(r.body), cm);
    ok("cm-audits: ≥1 audit", r.body?.length >= 1, cm);
    ok("cm-audits: has url", r.body?.[0]?.url !== undefined, cm);
    ok("cm-audits: has score", r.body?.[0]?.score !== undefined, cm);
    ok("cm-audits: pas d'org_id exposé", !("org_id" in (r.body?.[0] || {})), cm); }

  // routes interdites → 404
  { const r = await req("/client-mode/settings", { headers: H }); ok("settings → 404 (non exposé)", r.status === 404, cm); }
  { const r = await req("/client-mode/billing", { headers: H }); ok("billing → 404 (non exposé)", r.status === 404, cm); }
  { const r = await req("/client-mode/api-keys", { headers: H }); ok("api-keys → 404 (non exposé)", r.status === 404, cm); }

  // isolation cross-tenant
  { const r = await req("/client-mode/audits", { headers: HB });
    ok("orgB: 0 audits (isolation)", r.status === 200 && r.body?.length === 0, cm); }

  await cleanup(orgA, orgB);
  await pool.end();

  // ── RÉSULTAT ────────────────────────────────────────────────────────────────
  console.log("\n━━━ DATA EXPLORER ━━━");
  results.de.forEach(l => console.log(" ", l));
  console.log("\n━━━ RAPPORTS ━━━");
  results.rp.forEach(l => console.log(" ", l));
  console.log("\n━━━ MODE CLIENT ━━━");
  results.cm.forEach(l => console.log(" ", l));
  const total = pass + fail;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Browser Verify — ${pass}/${total} PASS · ${fail} FAIL`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch(e => { console.error(e); process.exit(1); });
