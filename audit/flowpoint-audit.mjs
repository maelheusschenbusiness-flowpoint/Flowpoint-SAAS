/**
 * FlowPoint Comprehensive Playwright Audit
 * Tests every page, button, modal, tab and action.
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://localhost:8081';
const MAGIC = 'c131dcbe802ace4538925e8fd1a8ccd0cee9999d45f42bfc6395a00dfe61eb00';
const SS_DIR = './audit/screenshots';

fs.mkdirSync(SS_DIR, { recursive: true });

const bugs = [];
const fixes = [];

function bug(page, msg, severity = 'HIGH') {
  console.error(`[BUG][${severity}] ${page}: ${msg}`);
  bugs.push({ page, msg, severity });
}
function ok(page, msg) {
  console.log(`[OK] ${page}: ${msg}`);
}

async function ss(page, name) {
  const p = path.join(SS_DIR, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false });
  return p;
}

async function waitNoSpinner(page, timeout = 5000) {
  try {
    await page.waitForFunction(() => {
      const spinners = document.querySelectorAll('.spinner, .loading, [data-loading="true"]');
      return spinners.length === 0;
    }, { timeout });
  } catch {}
}

async function getErrors(page) {
  return await page.evaluate(() => window.__auditErrors || []);
}

async function getApiFails(page) {
  return await page.evaluate(() => window.__auditApiFails || []);
}

async function clickNav(page, text) {
  try {
    const el = await page.locator(`nav a, aside a, [role=navigation] a, .sidebar a, .nav-item, .sidebar-item`).filter({ hasText: text }).first();
    if (await el.count() > 0) {
      await el.click();
      await page.waitForTimeout(1500);
      return true;
    }
    // Try sidebar buttons
    const btn = await page.locator(`button, [role=button]`).filter({ hasText: text }).first();
    if (await btn.count() > 0) {
      await btn.click();
      await page.waitForTimeout(1500);
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

async function clickTab(page, text) {
  try {
    const el = await page.locator(`[role=tab], .tab, .pill, .sub-tab, nav button, .tabs button`).filter({ hasText: text }).first();
    if (await el.count() > 0) {
      await el.click();
      await page.waitForTimeout(1000);
      return true;
    }
    // also try generic buttons in the content area header
    const btn = await page.locator('.content button, .page-header button, .subnav button').filter({ hasText: text }).first();
    if (await btn.count() > 0) {
      await btn.click();
      await page.waitForTimeout(1000);
      return true;
    }
    return false;
  } catch { return false; }
}

async function tryClick(page, selector, label) {
  try {
    const el = page.locator(selector).first();
    if (await el.count() > 0 && await el.isVisible()) {
      await el.click();
      await page.waitForTimeout(800);
      return true;
    }
    return false;
  } catch { return false; }
}

async function checkForErrors(page, pageName) {
  const errs = await getErrors(page);
  const fails = await getApiFails(page);
  if (errs.length) {
    errs.forEach(e => bug(pageName, `JS error: ${e}`, 'HIGH'));
  }
  if (fails.length) {
    fails.forEach(f => bug(pageName, `API fail: ${f}`, 'HIGH'));
  }
  // clear
  await page.evaluate(() => { window.__auditErrors = []; window.__auditApiFails = []; });
  return { errs, fails };
}

async function checkEmptyState(page, pageName) {
  const text = await page.textContent('body');
  const emptySignals = ['Aucune donnée', 'No data', 'Aucun résultat', 'Vide', 'Empty'];
  const found = emptySignals.filter(s => text.includes(s));
  if (found.length > 0) {
    console.log(`[WARN] ${pageName}: empty state signals: ${found.join(', ')}`);
  }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
const browser = await chromium.launch({
  executablePath: '/home/runner/workspace/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

// Inject error capture
await page.addInitScript(() => {
  window.__auditErrors = [];
  window.__auditApiFails = [];
  const origErr = window.onerror;
  window.onerror = function(msg, src, line, col, err) {
    window.__auditErrors.push(`${msg} @ ${src}:${line}`);
    if (origErr) origErr.apply(this, arguments);
  };
  window.addEventListener('unhandledrejection', e => {
    window.__auditErrors.push(`UnhandledRejection: ${e.reason}`);
  });
  const origFetch = window.fetch;
  window.fetch = async function(...args) {
    const res = await origFetch.apply(this, args);
    if (!res.ok) {
      window.__auditApiFails.push(`${res.status} ${res.url || args[0]}`);
    }
    return res;
  };
});

// ─── AUTH ────────────────────────────────────────────────────────────────────
console.log('\n=== AUTH ===');
await page.goto(`${BASE}/api/auth/login-verify?token=${MAGIC}`);
await page.waitForTimeout(1500);
await page.goto(`${BASE}/dashboard.html`);
await page.evaluate(() => localStorage.setItem('fp-onboarded', '1'));
await page.waitForTimeout(6000);
await ss(page, '00-dashboard-loaded');

const stateOk = await page.evaluate(() => !!window.STATE);
if (!stateOk) {
  bug('AUTH', 'window.STATE not populated after loadData()', 'CRITICAL');
  process.exit(1);
}

const stateInfo = await page.evaluate(() => ({
  audits: window.STATE.audits?.length,
  monitors: window.STATE.monitors?.length,
  missions: window.STATE.missions?.length,
  keywords: window.STATE.keywords?.length,
  competitors: window.STATE.competitors?.length,
  reports: window.STATE.reports?.length,
  alertRules: window.STATE.alertRules?.length,
  overview: !!window.STATE.overview,
}));
console.log('STATE:', JSON.stringify(stateInfo));
ok('AUTH', `STATE loaded: audits=${stateInfo.audits}, monitors=${stateInfo.monitors}, missions=${stateInfo.missions}`);

await checkForErrors(page, 'INIT');

// ─── OVERVIEW ────────────────────────────────────────────────────────────────
console.log('\n=== OVERVIEW ===');
await ss(page, 'P01-overview');

// Check health gauges are non-zero
const gauges = await page.evaluate(() => {
  const nums = [];
  document.querySelectorAll('.gauge-value, .ring-value, .metric-val, .score-val, .health-val').forEach(el => {
    nums.push(el.textContent?.trim());
  });
  return nums;
});
ok('OVERVIEW', `Gauge values found: ${gauges.slice(0,6).join(', ')}`);

// Click Insights sub-section if available
await clickTab(page, 'Insights');
await ss(page, 'P01b-overview-insights');
await clickTab(page, 'Quick Wins');
await clickTab(page, 'Checklist');
await page.waitForTimeout(500);
await checkForErrors(page, 'OVERVIEW');

// ─── AUDITS ──────────────────────────────────────────────────────────────────
console.log('\n=== AUDITS ===');
const navAudits = await clickNav(page, 'Audits');
if (!navAudits) bug('AUDITS', 'Could not navigate to Audits', 'HIGH');
await page.waitForTimeout(1500);
await ss(page, 'P02-audits');

const auditCount = await page.evaluate(() =>
  document.querySelectorAll('.audit-card, .audit-row, [data-audit-id], .audit-item').length
);
ok('AUDITS', `Audit cards visible: ${auditCount}`);
if (auditCount === 0 && stateInfo.audits > 0) {
  bug('AUDITS', `${stateInfo.audits} audits in STATE but 0 cards rendered`, 'HIGH');
}

// Click first audit card if exists
const firstAudit = page.locator('.audit-card, .audit-row, [data-audit-id], .audit-item, .card').first();
if (await firstAudit.count() > 0) {
  await firstAudit.click();
  await page.waitForTimeout(1000);
  await ss(page, 'P02b-audit-detail');
  // Close panel
  await tryClick(page, '.panel-close, .close-btn, [aria-label="Close"], .btn-close, .modal-close', 'close audit panel');
  await tryClick(page, 'button:has-text("Fermer"), button:has-text("✕"), button:has-text("×")', 'close audit panel 2');
}

// Sub-tabs
const auditSubTabs = ['Analyse', 'Comparer', 'Historique', 'Opportunités'];
for (const tab of auditSubTabs) {
  const clicked = await clickTab(page, tab);
  if (clicked) {
    await ss(page, `P02-audits-${tab.toLowerCase()}`);
    await checkForErrors(page, `AUDITS-${tab}`);
  }
}

// "Lancer un audit" button
const launchBtn = page.locator('button').filter({ hasText: /Lancer|Nouvel audit|New audit/i }).first();
if (await launchBtn.count() > 0 && await launchBtn.isVisible()) {
  await launchBtn.click();
  await page.waitForTimeout(1000);
  await ss(page, 'P02c-new-audit-panel');
  await tryClick(page, '.panel-close, .close-btn, [aria-label="Close"], .btn-close, button:has-text("Annuler"), button:has-text("✕")', 'close new audit panel');
  await page.waitForTimeout(500);
}
await checkForErrors(page, 'AUDITS');

// ─── MONITORS ────────────────────────────────────────────────────────────────
console.log('\n=== MONITORS ===');
await clickNav(page, 'Monitors');
await page.waitForTimeout(1500);
await ss(page, 'P03-monitors');

const monitorCount = await page.evaluate(() =>
  document.querySelectorAll('.monitor-card, .monitor-row, [data-monitor-id], .monitor-item').length
);
ok('MONITORS', `Monitor cards: ${monitorCount}`);
if (monitorCount === 0 && stateInfo.monitors > 0) {
  bug('MONITORS', `${stateInfo.monitors} monitors in STATE but 0 cards rendered`, 'HIGH');
}

for (const tab of ['Performance', 'Incidents', 'Configuration']) {
  const clicked = await clickTab(page, tab);
  if (clicked) {
    await ss(page, `P03-monitors-${tab.toLowerCase()}`);
    await checkForErrors(page, `MONITORS-${tab}`);
  }
}

// "Ajouter un monitor" button
const addMonitorBtn = page.locator('button').filter({ hasText: /Ajouter|Nouveau monitor|Add monitor/i }).first();
if (await addMonitorBtn.count() > 0 && await addMonitorBtn.isVisible()) {
  await addMonitorBtn.click();
  await page.waitForTimeout(1000);
  await ss(page, 'P03b-new-monitor-panel');
  await tryClick(page, '.panel-close, .close-btn, button:has-text("Annuler"), button:has-text("✕"), button:has-text("×")', 'close monitor panel');
}
await checkForErrors(page, 'MONITORS');

// ─── MISSIONS ────────────────────────────────────────────────────────────────
console.log('\n=== MISSIONS ===');
await clickNav(page, 'Missions');
await page.waitForTimeout(1500);
await ss(page, 'P04-missions');

const missionCount = await page.evaluate(() =>
  document.querySelectorAll('.mission-card, .mission-row, [data-mission-id], .mission-item').length
);
ok('MISSIONS', `Mission cards: ${missionCount}`);
if (missionCount === 0 && stateInfo.missions > 0) {
  bug('MISSIONS', `${stateInfo.missions} missions in STATE but 0 cards rendered`, 'HIGH');
}

// Filters
for (const f of ['En cours', 'Terminées', 'Toutes', 'Bibliothèque']) {
  const clicked = await clickTab(page, f);
  if (clicked) await ss(page, `P04-missions-${f.toLowerCase().replace(/ /g, '-')}`);
}

// Click first mission card
await clickTab(page, 'Toutes'); // reset filter
await page.waitForTimeout(500);
const firstMission = page.locator('.mission-card, .mission-row, .mission-item').first();
if (await firstMission.count() > 0) {
  await firstMission.click();
  await page.waitForTimeout(1000);
  await ss(page, 'P04b-mission-detail');
  await tryClick(page, '.panel-close, .close-btn, button:has-text("Fermer"), button:has-text("✕"), button:has-text("×")', 'close mission panel');
  await page.waitForTimeout(500);
}

// New mission button
const newMissionBtn = page.locator('button').filter({ hasText: /Nouvelle mission|Ajouter mission|New mission/i }).first();
if (await newMissionBtn.count() > 0 && await newMissionBtn.isVisible()) {
  await newMissionBtn.click();
  await page.waitForTimeout(1000);
  await ss(page, 'P04c-new-mission-panel');
  await tryClick(page, '.panel-close, .close-btn, button:has-text("Annuler"), button:has-text("✕")', 'close');
}
await checkForErrors(page, 'MISSIONS');

// ─── REPORTS ────────────────────────────────────────────────────────────────
console.log('\n=== REPORTS ===');
await clickNav(page, 'Rapports');
if (!await clickNav(page, 'Rapports')) await clickNav(page, 'Reports');
await page.waitForTimeout(1500);
await ss(page, 'P05-reports');

const reportCount = await page.evaluate(() =>
  document.querySelectorAll('.report-card, .report-row, [data-report-id], .report-item').length
);
ok('REPORTS', `Report items: ${reportCount}`);
if (reportCount === 0 && stateInfo.reports > 0) {
  bug('REPORTS', `${stateInfo.reports} reports in STATE but 0 items rendered`, 'HIGH');
}

for (const tab of ['Historique', 'Modèles', 'Templates']) {
  await clickTab(page, tab);
}
await ss(page, 'P05b-reports-tabs');

// New report
const newReportBtn = page.locator('button').filter({ hasText: /Nouveau rapport|Générer|Generate/i }).first();
if (await newReportBtn.count() > 0 && await newReportBtn.isVisible()) {
  await newReportBtn.click();
  await page.waitForTimeout(1000);
  await ss(page, 'P05c-new-report-panel');
  await tryClick(page, '.panel-close, .close-btn, button:has-text("Annuler"), button:has-text("✕")', 'close');
}
await checkForErrors(page, 'REPORTS');

// ─── LOCAL SEO ───────────────────────────────────────────────────────────────
console.log('\n=== LOCAL SEO ===');
await clickNav(page, 'Local SEO');
await page.waitForTimeout(1500);
await ss(page, 'P06-local-seo');

for (const tab of ['Zones', 'Concurrents', 'Opportunités', 'Avis']) {
  const clicked = await clickTab(page, tab);
  if (clicked) {
    await ss(page, `P06-local-seo-${tab.toLowerCase()}`);
    await checkForErrors(page, `LOCAL-SEO-${tab}`);
  }
}
await checkForErrors(page, 'LOCAL-SEO');

// ─── TEAM ────────────────────────────────────────────────────────────────────
console.log('\n=== TEAM ===');
await clickNav(page, 'Équipe');
if (!await page.evaluate(() => document.querySelector('.team-page, [data-page="team"]'))) {
  await clickNav(page, 'Team');
}
await page.waitForTimeout(1500);
await ss(page, 'P07-team');

for (const tab of ['Chat', 'Activité', 'Fichiers']) {
  const clicked = await clickTab(page, tab);
  if (clicked) {
    await ss(page, `P07-team-${tab.toLowerCase()}`);
    await checkForErrors(page, `TEAM-${tab}`);
  }
}

// Invite button
const inviteBtn = page.locator('button').filter({ hasText: /Inviter|Invite/i }).first();
if (await inviteBtn.count() > 0 && await inviteBtn.isVisible()) {
  await inviteBtn.click();
  await page.waitForTimeout(1000);
  await ss(page, 'P07b-invite-panel');
  await tryClick(page, '.panel-close, .close-btn, button:has-text("Annuler"), button:has-text("✕")', 'close');
}
await checkForErrors(page, 'TEAM');

// ─── BILLING ────────────────────────────────────────────────────────────────
console.log('\n=== BILLING ===');
await clickNav(page, 'Facturation');
await page.waitForTimeout(1500);
await ss(page, 'P08-billing');

const billingText = await page.evaluate(() => document.body.innerText);
const hasHardcoded = billingText.includes('01/06/2026') || billingText.includes('3 modules');
if (hasHardcoded) {
  bug('BILLING', 'Still contains hardcoded "01/06/2026" or "3 modules"', 'HIGH');
} else {
  ok('BILLING', 'No hardcoded billing values found');
}
await checkForErrors(page, 'BILLING');

// ─── ALERT RULES ─────────────────────────────────────────────────────────────
console.log('\n=== ALERT RULES ===');
await clickNav(page, 'Alertes');
if (!await page.evaluate(() => document.querySelector('.alerts-page, [data-page="alerts"]'))) {
  await clickNav(page, 'Alert');
}
await page.waitForTimeout(1500);
await ss(page, 'P09-alerts');

const alertCount = await page.evaluate(() =>
  document.querySelectorAll('.alert-rule-card, .alert-row, [data-rule-id], .rule-item, .alert-item').length
);
ok('ALERTS', `Alert rule items: ${alertCount}`);
if (alertCount === 0 && stateInfo.alertRules > 0) {
  bug('ALERTS', `${stateInfo.alertRules} alert rules in STATE but 0 rendered`, 'HIGH');
}

// New alert rule
const newAlertBtn = page.locator('button').filter({ hasText: /Nouvelle règle|Ajouter|Add rule|New rule/i }).first();
if (await newAlertBtn.count() > 0 && await newAlertBtn.isVisible()) {
  await newAlertBtn.click();
  await page.waitForTimeout(1000);
  await ss(page, 'P09b-new-alert-panel');
  await tryClick(page, '.panel-close, .close-btn, button:has-text("Annuler"), button:has-text("✕")', 'close');
}
await checkForErrors(page, 'ALERTS');

// ─── SETTINGS ────────────────────────────────────────────────────────────────
console.log('\n=== SETTINGS ===');
await clickNav(page, 'Paramètres');
if (!await page.evaluate(() => document.querySelector('.settings-page, [data-page="settings"]'))) {
  await clickNav(page, 'Settings');
}
await page.waitForTimeout(1500);
await ss(page, 'P10-settings');

for (const tab of ['Général', 'Compte', 'Notifications', 'Intégrations', 'SSO', 'White Label', 'Permissions', 'API']) {
  const clicked = await clickTab(page, tab);
  if (clicked) {
    await ss(page, `P10-settings-${tab.toLowerCase().replace(/ /g, '-')}`);
    await checkForErrors(page, `SETTINGS-${tab}`);
  }
}
await checkForErrors(page, 'SETTINGS');

// ─── AI ASSISTANT ─────────────────────────────────────────────────────────────
console.log('\n=== AI ===');
await clickNav(page, 'AI');
if (!await page.evaluate(() => document.querySelector('.ai-page, [data-page="ai"]'))) {
  await clickNav(page, 'Assistant');
}
await page.waitForTimeout(1500);
await ss(page, 'P11-ai');
await checkForErrors(page, 'AI');

// ─── ADDITIONAL PAGES VIA URL hash/params ────────────────────────────────────
console.log('\n=== ADDITIONAL SECTIONS ===');

// Try keywords/competitors via sidebar or URL
const extraSections = [
  { text: 'Keywords', screenshot: 'P12-keywords' },
  { text: 'Concurrents', screenshot: 'P13-competitors' },
  { text: 'CRM', screenshot: 'P14-crm' },
  { text: 'Market Intel', screenshot: 'P15-market-intel' },
  { text: 'Performance', screenshot: 'P16-performance' },
  { text: 'Google Search Console', screenshot: 'P17-gsc' },
  { text: 'GitHub', screenshot: 'P18-github' },
];

for (const sec of extraSections) {
  const clicked = await clickNav(page, sec.text);
  if (clicked) {
    await page.waitForTimeout(1000);
    await ss(page, sec.screenshot);
    await checkForErrors(page, sec.text.toUpperCase());
  }
}

// ─── GLOBAL INTERACTION TEST ──────────────────────────────────────────────────
console.log('\n=== GLOBAL INTERACTIONS ===');
// Go back to overview and test FAB, notifications, user menu
await clickNav(page, 'Overview');
await page.waitForTimeout(1000);

// FAB (floating action button)
const fab = page.locator('.fab, .fab-btn, [aria-label="Actions rapides"], button.floating').first();
if (await fab.count() > 0) {
  await fab.click();
  await page.waitForTimeout(800);
  await ss(page, 'GLOBAL-fab-open');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// Notifications bell
const notifBell = page.locator('.notif-btn, .notification-bell, [aria-label*="notif"], button:has(.bell-icon)').first();
if (await notifBell.count() > 0) {
  await notifBell.click();
  await page.waitForTimeout(800);
  await ss(page, 'GLOBAL-notifications');
  await page.keyboard.press('Escape');
}

// User menu / avatar
const userMenu = page.locator('.user-menu, .avatar, .user-avatar, [aria-label*="profile"], [aria-label*="user"]').first();
if (await userMenu.count() > 0) {
  await userMenu.click();
  await page.waitForTimeout(800);
  await ss(page, 'GLOBAL-user-menu');
  await page.keyboard.press('Escape');
}

// Command palette (Cmd+K or /)
await page.keyboard.press('Meta+k');
await page.waitForTimeout(800);
const cmdPalette = await page.locator('.cmd-palette, .command-palette, [role=dialog][aria-label*="search"]').count();
if (cmdPalette > 0) {
  await ss(page, 'GLOBAL-cmd-palette');
  await page.keyboard.press('Escape');
} else {
  // try / shortcut
  await page.keyboard.press('/');
  await page.waitForTimeout(500);
  await page.keyboard.press('Escape');
}

await checkForErrors(page, 'GLOBAL');

// ─── FINAL REPORT ─────────────────────────────────────────────────────────────
console.log('\n\n=================================================');
console.log('AUDIT COMPLETE');
console.log('=================================================');
console.log(`\nBUGS FOUND: ${bugs.length}`);
bugs.forEach((b, i) => console.log(`  ${i+1}. [${b.severity}] ${b.page}: ${b.msg}`));

const screenshots = fs.readdirSync(SS_DIR).filter(f => f.endsWith('.png'));
console.log(`\nSCREENSHOTS: ${screenshots.length}`);
screenshots.forEach(s => console.log(`  - ${SS_DIR}/${s}`));

// Write JSON report
fs.writeFileSync('./audit/bugs.json', JSON.stringify(bugs, null, 2));
console.log('\nReport saved to ./audit/bugs.json');

await browser.close();
process.exit(bugs.filter(b => b.severity === 'HIGH' || b.severity === 'CRITICAL').length > 0 ? 1 : 0);
