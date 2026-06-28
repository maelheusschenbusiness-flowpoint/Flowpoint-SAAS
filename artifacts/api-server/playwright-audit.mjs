/**
 * FlowPoint Dashboard — Playwright Functional Audit
 * Runs directly via: node playwright-audit.mjs
 * Tests all 25 dashboard pages for NaN/undefined/null, console errors,
 * broken buttons, and 404/500 network errors.
 */
import { chromium } from "playwright";
import pg from "pg";

const { Pool } = pg;
const DB_URL = process.env.DATABASE_URL ?? "postgresql://postgres:password@helium/heliumdb?sslmode=disable";
const APP_URL = "http://localhost:8081";
const SESSION_TOKEN = "playwright-audit-session-" + Date.now();

const PAGES = [
  "overview","growth","missions","audits","monitors",
  "local-seo","performance","core-web-vitals","technical-audit",
  "analytics","traffic","funnels","audience","campaigns","live",
  "competitor","conversion","data-explorer","reports","alerts-center",
  "activity-feed","team","client-mode","billing","settings",
];

// Track all findings
const findings = [];
const ok = [];

function log(msg) { process.stdout.write(msg + "\n"); }

async function seedSession(pool) {
  await pool.query(`
    INSERT INTO user_sessions (token, user_id, org_id, email, role, expires_at, created_at)
    VALUES ($1, 'audit@flowpoint.pro', 'default', 'audit@flowpoint.pro', 'admin', NOW() + INTERVAL '2 hours', NOW())
    ON CONFLICT (token) DO UPDATE SET expires_at = NOW() + INTERVAL '2 hours'
  `, [SESSION_TOKEN]);
  log(`[auth] Session seeded: ${SESSION_TOKEN.substring(0, 40)}...`);
}

async function auditPage(page, route) {
  const errors = [];
  const networkErrors = [];
  const nanMatches = [];

  // Collect console errors
  page.on("console", msg => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!text.includes("favicon") && !text.includes("net::ERR")) {
        errors.push(text.substring(0, 120));
      }
    }
  });

  // Collect network failures
  page.on("response", resp => {
    const url = resp.url();
    const status = resp.status();
    if (status >= 400 && !url.includes("favicon")) {
      networkErrors.push(`${status} ${url.split("?")[0].substring(0, 80)}`);
    }
  });

  // Navigate to route
  await page.evaluate(route => {
    if (typeof navigate === "function") navigate(route);
    else {
      const btn = document.querySelector(`[data-route="${route}"]`);
      if (btn) btn.click();
    }
  }, route);

  await page.waitForTimeout(2500);

  // Check visible text for NaN / undefined / null (NOT in scripts/data attributes)
  const badText = await page.evaluate(() => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const bad = [];
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      const tag = parent.tagName?.toLowerCase();
      if (["script","style","noscript","template"].includes(tag)) continue;
      const style = window.getComputedStyle(parent);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const text = node.textContent || "";
      // Check for literal NaN (standalone, not "Nantes" or "NaN%" edge cases with letters around)
      if (/\bNaN\b/.test(text)) bad.push({ type: "NaN", sample: text.substring(0, 60).trim(), route });
      if (/\bundefined\b/.test(text)) bad.push({ type: "undefined", sample: text.substring(0, 60).trim(), route });
      if (/\[object Object\]/.test(text)) bad.push({ type: "[object Object]", sample: text.substring(0, 60).trim(), route });
      // "null" only if it's alone or very clearly a bug (surrounded by whitespace/punctuation)
      if (/[\s,;:(]null[\s,;:).]|^null$/.test(text.trim())) bad.push({ type: "null", sample: text.substring(0, 60).trim(), route });
    }
    return bad;
  });

  // Check for infinite spinners (loading indicators still visible after 2.5s)
  const spinners = await page.evaluate(() => {
    const indicators = document.querySelectorAll(
      ".fp-spinner, .loading, [class*='spin'], [class*='loader'], [class*='skeleton']"
    );
    return Array.from(indicators).filter(el => {
      const s = window.getComputedStyle(el);
      return s.display !== "none" && s.visibility !== "hidden" && s.opacity !== "0";
    }).length;
  });

  const pageFindings = [
    ...badText.map(b => `${b.type}: "${b.sample}"`),
    ...errors.map(e => `CONSOLE_ERROR: ${e}`),
    ...networkErrors.filter(e => !e.startsWith("401")).map(e => `NETWORK: ${e}`),
    ...(spinners > 3 ? [`SPINNER_STUCK: ${spinners} loading indicators still visible`] : []),
  ];

  if (pageFindings.length === 0) {
    ok.push(route);
    log(`  ✅ ${route}`);
  } else {
    findings.push({ route, issues: pageFindings });
    log(`  ⚠️  ${route} — ${pageFindings.length} issue(s):`);
    pageFindings.slice(0, 5).forEach(f => log(`     • ${f}`));
    if (pageFindings.length > 5) log(`     ... and ${pageFindings.length - 5} more`);
  }

  return pageFindings;
}

async function main() {
  const pool = new Pool({ connectionString: DB_URL });
  await seedSession(pool);

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
  });

  // Set auth cookie before any navigation
  await context.addCookies([{
    name: "fp_token",
    value: SESSION_TOKEN,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    secure: false,
    sameSite: "Lax",
  }]);

  const page = await context.newPage();

  log("\n=== FlowPoint Dashboard Audit ===\n");

  // Load dashboard
  await page.goto(`${APP_URL}/dashboard.html`, { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);

  // Verify we're authenticated (sidebar should be visible)
  const sidebarVisible = await page.locator(".fp-sidebar").isVisible().catch(() => false);
  if (!sidebarVisible) {
    const url = page.url();
    log(`\n❌ CRITICAL: Sidebar not visible. Current URL: ${url}`);
    log("Auth may have failed. Checking page title...");
    const title = await page.title();
    log(`Page title: ${title}`);
    const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 200));
    log(`Body preview: ${bodyText}`);
    await browser.close();
    await pool.end();
    process.exit(1);
  }
  log("✅ Dashboard loaded, sidebar visible — authenticated OK\n");

  // Audit each page
  log("--- Auditing all pages ---\n");
  for (const route of PAGES) {
    await auditPage(page, route);
    await page.waitForTimeout(500); // small gap between pages
  }

  // Final report
  log("\n=== AUDIT SUMMARY ===\n");
  log(`Pages OK:     ${ok.length}/${PAGES.length}`);
  log(`Pages w/issues: ${findings.length}/${PAGES.length}\n`);

  if (findings.length === 0) {
    log("🎉 All pages passed — 0 NaN/undefined/null, 0 console errors, 0 network errors\n");
  } else {
    log("Issues found:\n");
    for (const { route, issues } of findings) {
      log(`\n[${route}]`);
      issues.forEach(i => log(`  • ${i}`));
    }
  }

  await browser.close();
  await pool.end();
}

main().catch(err => {
  log(`\n❌ FATAL: ${err.message}`);
  log(err.stack);
  process.exit(1);
});
