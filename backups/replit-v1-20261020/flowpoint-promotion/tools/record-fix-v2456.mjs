/**
 * FlowPoint — Fix recordings V2, V4, V5, V6
 *
 * Root-cause fixes:
 * - V2: Boot to monitors (has real data), show create-mission modal + create-monitor modal + CWV
 * - V4: Boot to local-seo, iterate tabs to find content (Concurrents > Carte > Zones > Aperçu)
 * - V5: Use quick-prompt click instead of manual type; fix AI input selector
 * - V6: Fix activity/notif/msg selectors; avoid unwanted overview drift
 */

import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE     = 'https://app.flowpoint.pro';
const QA_ORG   = '10000000-0000-4000-8000-000000000002';
const DEST     = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';
const TMP      = '/tmp/fp-fix';
mkdirSync(TMP, { recursive: true });

async function getToken() {
  const r = await fetch(`${BASE}/api/admin/test-session`, {
    method: 'POST',
    headers: { 'x-admin-key': process.env.ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 480 }),
  });
  const d = await r.json();
  if (!d.ok || !d.token) throw new Error('token: ' + JSON.stringify(d));
  console.log('  token ok');
  return d.token;
}

const CSR = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
async function inj(p) {
  await p.evaluate(s => {
    document.getElementById('_fpa')?.remove();
    const w = document.createElement('div');
    w.id = '_fpa';
    w.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML = s; document.body.appendChild(w);
    let cx = 660, cy = 360;
    document.addEventListener('mousemove', e => { cx = e.clientX; cy = e.clientY; w.style.left = cx + 'px'; w.style.top = cy + 'px'; }, { passive: true });
    window._cx = cx; window._cy = cy;
  }, CSR);
}

async function go(p, tx, ty, ms = 420) {
  const { x, y } = await p.evaluate(() => ({ x: window._cx || 660, y: window._cy || 360 }));
  const n = Math.max(14, Math.round(ms / 14));
  for (let i = 1; i <= n; i++) {
    const t = i / n, e = t < .5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
    await p.mouse.move(Math.round(x + (tx - x) * e), Math.round(y + (ty - y) * e));
    await p.waitForTimeout(14);
  }
  await p.evaluate(q => { window._cx = q.x; window._cy = q.y; }, { x: tx, y: ty });
}

async function sc(p, d, ms = 500) {
  const n = Math.max(6, Math.round(ms / 30));
  for (let i = 0; i < n; i++) { await p.mouse.wheel(0, d / n); await p.waitForTimeout(30); }
  await p.waitForTimeout(100);
}

// Click with strict safe-zone check (x>170, y>60) and return boolean
async function cl(p, sel, ams = 600, mms = 360) {
  try {
    const el = p.locator(sel).first();
    if (!await el.isVisible({ timeout: 4000 }).catch(() => false)) return false;
    const b = await el.boundingBox();
    if (!b || b.x < 160 || b.y < 58) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, mms);
    await p.waitForTimeout(75);
    await p.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await p.waitForTimeout(ams);
    await inj(p);
    return true;
  } catch { return false; }
}

async function fi(p, sel, text) {
  try {
    const el = p.locator(sel).first();
    await el.waitFor({ state: 'visible', timeout: 5000 });
    const b = await el.boundingBox(); if (!b) return false;
    await go(p, b.x + b.width / 2, b.y + b.height / 2, 300);
    await el.click(); await p.waitForTimeout(160);
    await el.fill(text); await p.waitForTimeout(180);
    return true;
  } catch { return false; }
}

async function hov(p, sel, max = 3, dw = 300) {
  const it = p.locator(sel);
  const n = Math.min(await it.count().catch(() => 0), max);
  for (let i = 0; i < n; i++) {
    const b = await it.nth(i).boundingBox().catch(() => null);
    if (b && b.x > 160 && b.y > 58 && b.width > 40) {
      await go(p, b.x + b.width / 2, b.y + b.height / 2, 360);
      await p.waitForTimeout(dw);
    }
  }
}

async function nav(p, route) {
  await p.evaluate(r => { if (window.navigate) window.navigate(r); else window.location.hash = r; }, route);
  await p.waitForTimeout(2000);
  await inj(p);
}

// Click element directly by text content in safe zone
async function clText(p, txt, ams = 600) {
  for (const sel of [
    `button:has-text("${txt}")`,
    `a:has-text("${txt}")`,
    `[role="tab"]:has-text("${txt}")`,
    `.fp-tab:has-text("${txt}")`,
    `li:has-text("${txt}")`,
  ]) {
    const ok = await cl(p, sel, ams, 340);
    if (ok) return true;
  }
  return false;
}

// Try clicking nav icon buttons by their position in the header (safe: right side x>800)
async function clHeaderIcon(p, index, ams = 800) {
  // Header icons are at y≈25 (unsafe). Use data-attrs instead.
  // Activity = usually a bell or clock icon button in top-right
  const selectors = [
    `header button:nth-child(${index})`,
    `.fp-header-actions button:nth-child(${index})`,
    `nav button:nth-child(${index})`,
  ];
  for (const s of selectors) {
    const ok = await cl(p, s, ams, 340);
    if (ok) return true;
  }
  return false;
}

async function boot(p, hash) {
  const t0 = Date.now();
  await p.goto(`${BASE}/dashboard.html#${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  try {
    await p.waitForFunction(() => typeof window.STATE !== 'undefined' && window.STATE.loading === false, { timeout: 28000, polling: 300 });
  } catch {
    await p.waitForSelector('.fp-card,h1,h2', { timeout: 10000 }).catch(() => {});
  }
  await p.waitForTimeout(2500);
  for (const s of ['button:has-text("Passer la visite")', 'button:has-text("Ignorer")', 'button:has-text("Skip")']) {
    try {
      const b = p.locator(s).first();
      if (await b.isVisible({ timeout: 500 }).catch(() => false)) { await b.click(); await p.waitForTimeout(400); break; }
    } catch {}
  }
  const h = await p.evaluate(() => window.location.hash.replace('#', ''));
  if (h !== hash) {
    await p.evaluate(r => { if (window.navigate) window.navigate(r); else window.location.hash = r; }, hash);
    await p.waitForTimeout(2500);
  }
  await p.mouse.move(660, 360);
  await p.evaluate(() => { window._cx = 660; window._cy = 360; });
  await inj(p);
  return Date.now() - t0;
}

function toMp4(webm, mp4, skipMs = 0) {
  const ss = Math.max(0, (skipMs - 500) / 1000);
  const args = ['-y'];
  if (ss > 0.3) args.push('-ss', ss.toFixed(2));
  args.push('-i', webm, '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-c:v', 'libx264', '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', mp4);
  spawnSync('ffmpeg', args, { stdio: 'pipe' });
}

function dur(mp4) {
  return parseFloat(spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { stdio: 'pipe' }).stdout.toString()) || 0;
}

function frames(mp4, name, times) {
  mkdirSync(TMP, { recursive: true });
  for (const t of times) {
    spawnSync('ffmpeg', ['-y', '-ss', String(t), '-i', mp4, '-frames:v', '1', '-vf', 'scale=640:360', `${TMP}/fix_${name}_t${t}.jpg`], { stdio: 'pipe' });
  }
}

async function record(name, destFile, hash, scenarioFn) {
  const outDir = join(TMP, 'vid_' + name);
  mkdirSync(outDir, { recursive: true });
  const tok = await getToken();
  const browser = await chromium.launch({ args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: outDir, size: { width: 1280, height: 720 } },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
  });
  await ctx.addInitScript(t => {
    try { sessionStorage.setItem('fp_session_token', t); } catch {}
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  }, tok);
  const page = await ctx.newPage();
  let skipMs = 0;
  try {
    skipMs = await boot(page, hash);
    console.log(`  [${name}] boot ${skipMs}ms`);
    await scenarioFn(page);
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }
  const files = readdirSync(outDir).filter(f => f.endsWith('.webm'));
  if (!files.length) throw new Error('No webm: ' + name);
  const mp4 = join(outDir, `${name}.mp4`);
  toMp4(join(outDir, files[0]), mp4, skipMs);
  const d = dur(mp4);
  spawnSync('cp', [mp4, join(DEST, `${destFile}.mp4`)]);
  frames(mp4, name, [1, Math.floor(d / 4), Math.floor(d / 2), Math.floor(3 * d / 4), Math.max(1, Math.floor(d) - 2)]);
  console.log(`✓ ${destFile}.mp4  ${d.toFixed(1)}s  (trimmed ${(skipMs / 1000).toFixed(1)}s)`);
  return d;
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO 2 FIX — Boot on monitors (has real data) → hover → open detail → create
//               mission → create monitor → CWV URL
// ═══════════════════════════════════════════════════════════════════════════════
async function v2fix(page) {
  // MONITORS — real data visible (1/4 UP, 3 DOWN from V3 frames)
  await hov(page, '.fp-monitor-card,.monitor-row,.fp-card', 3, 350);
  await sc(page, 80, 400);
  await hov(page, '.fp-monitor-card,.monitor-row', 2, 300);
  await sc(page, -80, 350);
  await page.waitForTimeout(300);

  // Open first monitor detail (slide-in panel)
  const openOk = await cl(page, '.fp-monitor-card,.monitor-row', 1000, 400);
  if (openOk) {
    await hov(page, '.fp-stat,.fp-uptime,.fp-badge,.fp-metric', 2, 320);
    await sc(page, 80, 400);
    await page.waitForTimeout(350);
    await sc(page, -80, 370);
    // Ping button
    await cl(page, 'button:has-text("Ping"),button:has-text("Vérifier"),.fp-ping-btn', 700, 340).catch(() => {});
    await page.waitForTimeout(400);
    // Close panel
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    await inj(page);
  }

  // Hover tabs: Performance, Incidents
  await clText(page, 'Performance', 600);
  await hov(page, '.fp-perf-chart,.fp-chart,.recharts-wrapper', 1, 400);
  await page.waitForTimeout(300);
  await clText(page, 'Incidents', 600);
  await hov(page, '.fp-incident-row,.fp-incident-item', 2, 340);
  await page.waitForTimeout(300);
  await clText(page, 'Status', 400);
  await page.waitForTimeout(400);

  // CREATE MISSION from monitors context
  // Navigate to missions
  await nav(page, 'missions');
  await hov(page, 'table tbody tr,.mission-item,.fp-mission-card', 2, 340);
  await page.waitForTimeout(300);

  // Click "+ Mission" button
  const mOk = await cl(page,
    '#mission-new-btn,button:has-text("+ Mission"),button:has-text("Nouvelle mission"),button:has-text("Créer une mission"),button:has-text("Ajouter"),.fp-btn-new-mission',
    700, 380);
  if (mOk) {
    const filled = await fi(page, 'input[placeholder*="Titre"],input[placeholder*="titre"],input[placeholder*="mission"],input[name="title"],input[id*="mission-title"]', 'Corriger les pages DOWN : Restaurant Le Soleil');
    if (!filled) await fi(page, 'input[type="text"]:visible', 'Corriger les pages DOWN : Restaurant Le Soleil');
    await page.waitForTimeout(280);
    await cl(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1200, 340);
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    await inj(page);
  }
  await hov(page, 'table tbody tr,.mission-item,.fp-mission-card', 2, 300);
  await page.waitForTimeout(400);

  // Back to MONITORS — create a new monitor
  await nav(page, 'monitors');
  await page.waitForTimeout(400);
  const monOk = await cl(page,
    '#monitor-new-btn,button:has-text("+ Nouveau"),button:has-text("+ Monitor"),button:has-text("Nouveau monitor"),button:has-text("Ajouter"),.fp-btn-new-monitor',
    700, 380);
  if (monOk) {
    await fi(page, 'input[placeholder*="https"],input[type="url"],input[name*="url"]', 'https://example.com/blog');
    await page.waitForTimeout(200);
    await fi(page, 'input[placeholder*="nom"],input[placeholder*="Nom"],input[name*="name"],input[placeholder*="libellé"]', 'Blog QA').catch(() => {});
    await page.waitForTimeout(180);
    await cl(page, 'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]', 1300, 340);
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    await inj(page);
  }
  await hov(page, '.fp-monitor-card,.monitor-row', 2, 300);

  // CORE WEB VITALS — click the "Core Web Vitals" tab
  const cwvOk = await clText(page, 'Core Web', 800);
  if (cwvOk) {
    await page.waitForTimeout(400);
    // Add URL
    const addOk = await cl(page, 'button:has-text("+ URL"),button:has-text("Ajouter URL"),button:has-text("Nouvelle URL"),button:has-text("Analyser")', 700, 360);
    if (addOk) {
      await fi(page, 'input[placeholder*="https"],input[type="url"]', 'https://example.com/');
      await cl(page, 'button:has-text("Analyser"),button:has-text("Ajouter"),button[type="submit"]', 1000, 340);
      await page.waitForTimeout(400);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(500);
      await inj(page);
    }
    await hov(page, '.fp-cwv-item,.cwv-row,.fp-card', 2, 300);
  } else {
    // Fallback: show SLA tab
    await clText(page, 'SLA', 600);
    await hov(page, '.fp-sla-card,.fp-card', 2, 300);
  }
  await page.waitForTimeout(400);
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO 4 FIX — Boot local-seo, explore each tab to find real content
// ═══════════════════════════════════════════════════════════════════════════════
async function v4fix(page) {
  // Aperçu — hover action buttons visible
  await hov(page, '.fp-action-btn,button:has-text("Générer"),button:has-text("Rapport"),a.fp-btn', 3, 320);
  await sc(page, 100, 450);
  await page.waitForTimeout(350);

  // Try "Concurrents" tab — this shows the Google Maps competitor map
  const concOk = await clText(page, 'Concurrents', 1200);
  await page.waitForTimeout(800);
  await inj(page);

  // Whatever we see, hover it
  await hov(page, '.fp-competitor-card,.competitor-item,.fp-card:not(.fp-blurred)', 3, 350);
  await page.waitForTimeout(300);

  // Try "Carte" tab — Google Maps view
  const carteOk = await clText(page, 'Carte', 1200);
  await page.waitForTimeout(600);
  await inj(page);

  // Interact with map controls that ARE available
  // Hover the search/keyword area
  await go(page, 700, 300, 360);
  await page.waitForTimeout(300);
  await go(page, 850, 380, 320);
  await page.waitForTimeout(280);

  // Try radius selector
  const radSel = page.locator('#fp-comp-radius,select[id*="radius"]').first();
  if (await radSel.isVisible({ timeout: 2000 }).catch(() => false)) {
    const b = await radSel.boundingBox().catch(() => null);
    if (b && b.x > 160) {
      await go(page, b.x + b.width / 2, b.y + b.height / 2, 340);
      await page.waitForTimeout(280);
      await page.selectOption('#fp-comp-radius,select[id*="radius"]', '5000').catch(() => {});
      await page.waitForTimeout(400);
      await go(page, b.x + b.width / 2, b.y + b.height / 2, 300);
      await page.selectOption('#fp-comp-radius,select[id*="radius"]', '10000').catch(() => {});
      await page.waitForTimeout(400);
    }
  }

  // Try keyword input
  const kwSel = page.locator('#fp-comp-keyword,input[id*="keyword"],input[placeholder*="Mot"]').first();
  if (await kwSel.isVisible({ timeout: 2000 }).catch(() => false)) {
    const b = await kwSel.boundingBox().catch(() => null);
    if (b && b.x > 160) {
      await go(page, b.x + b.width / 2, b.y + b.height / 2, 340);
      await kwSel.click(); await page.waitForTimeout(160);
      await kwSel.fill('Boulangerie'); await page.waitForTimeout(240);
      await cl(page, 'button:has-text("Analyser"),button:has-text("Rechercher"),button:has-text("🔍")', 1200, 340);
      await page.waitForTimeout(800);
      await inj(page);
    }
  }

  // "Zones" tab
  const zonesOk = await clText(page, 'Zones', 800);
  await page.waitForTimeout(500);
  await inj(page);
  await hov(page, '.fp-zone-card,.zone-item,.fp-card', 3, 320);
  await sc(page, 80, 380);
  await page.waitForTimeout(300);

  // "Opportunités" tab
  const oppsOk = await clText(page, 'Opportunités', 800);
  await page.waitForTimeout(400);
  await hov(page, '.fp-opp-card,.fp-card,.fp-opportunity-item', 3, 320);
  await sc(page, 80, 380);
  await page.waitForTimeout(300);
  await sc(page, -80, 350);

  // Hover action buttons visible on any tab
  await hov(page, 'button.fp-btn,.fp-action-btn', 2, 300);
  await page.waitForTimeout(300);
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO 5 FIX — AI: click quick prompt (more reliable) → wait for response →
//               show conversation → navigate to Rapports → generate
// ═══════════════════════════════════════════════════════════════════════════════
async function v5fix(page) {
  // AI page is loaded. Hover quick-prompt suggestion chips.
  await hov(page, '.fp-ai-suggestion,.fp-quick-prompt,.fp-prompt-chip,button[data-ai-prompt]', 3, 320);
  await page.waitForTimeout(300);

  // Method 1: click a quick-prompt chip if visible
  let aiStarted = false;
  const chips = [
    'button:has-text("Que faire en priorité")',
    'button:has-text("Analyser mes positions")',
    'button:has-text("Plan d\'action")',
    'button:has-text("Monitors DOWN")',
    '.fp-ai-suggestion:first-child',
    '.fp-quick-prompt:first-child',
  ];
  for (const chip of chips) {
    const ok = await cl(page, chip, 400, 340);
    if (ok) { aiStarted = true; console.log('  AI chip clicked:', chip); break; }
  }

  if (!aiStarted) {
    // Method 2: type into the textarea at the bottom of the page
    // The AI input is a textarea at y≈660, which IS > 58 so our safe-zone check passes
    const inputSels = [
      'textarea.fp-ai-input', '#ai-input', 'textarea[placeholder*="question"]',
      'textarea[placeholder*="moniteurs"]', 'textarea[placeholder*="Posez"]',
      '.fp-chat-input textarea', 'textarea:visible',
    ];
    for (const sel of inputSels) {
      try {
        const el = page.locator(sel).first();
        if (!await el.isVisible({ timeout: 2000 }).catch(() => false)) continue;
        const b = await el.boundingBox(); if (!b || b.x < 160) continue;
        await go(page, b.x + b.width / 2, b.y + b.height / 2, 360);
        await el.click(); await page.waitForTimeout(200);
        await el.fill('Quelles sont mes priorités SEO cette semaine ?');
        await page.waitForTimeout(260);
        // Send: try Enter key or send button
        const sendOk = await cl(page, '#ai-send,button[aria-label*="Envoyer"],button[type="submit"],button:has-text("Envoyer")', 300, 280);
        if (!sendOk) await page.keyboard.press('Enter').catch(() => {});
        aiStarted = true;
        console.log('  AI typed & sent via:', sel);
        break;
      } catch {}
    }
  }

  if (aiStarted) {
    // Wait up to 20s for the first AI response token
    try {
      await page.waitForFunction(
        () => {
          const msgs = document.querySelectorAll('.fp-ai-msg,.fp-ai-response,.fp-msg-bubble.fp-assistant,.fp-ai-msg-content');
          if (msgs.length === 0) return false;
          const last = msgs[msgs.length - 1];
          return last && last.textContent && last.textContent.length > 20;
        },
        { timeout: 22000, polling: 400 }
      );
      await page.waitForTimeout(1800);
      await inj(page);
      await sc(page, 80, 400);
      await page.waitForTimeout(400);
      await hov(page, '.fp-ai-msg-content,.fp-ai-response,.fp-msg-bubble', 1, 400);
      await sc(page, 60, 350);
      await page.waitForTimeout(350);
    } catch {
      // AI didn't respond in time — show the chat input + partial state
      await page.waitForTimeout(1000);
      await inj(page);
    }
  }

  // Hover AI tabs/sections
  await hov(page, '.fp-tab-btn:has-text("AI Credits"),.fp-tab:has-text("Actions"), button:has-text("Insights"),button:has-text("IA Stratégiste")', 2, 300);
  await page.waitForTimeout(300);

  // Navigate to Rapports
  await nav(page, 'reports');
  await page.waitForTimeout(500);
  await hov(page, '.fp-report-type,.report-card,.fp-card', 3, 340);

  // Click first report card
  const reportCardOk = await cl(page, '.fp-report-type,.report-card', 800, 380);
  if (!reportCardOk) {
    // Try the "Nouveau" button
    await cl(page, 'button:has-text("Nouveau"),button:has-text("+ Nouveau")', 800, 380);
  }
  await page.waitForTimeout(500);
  await hov(page, '.fp-report-type,.report-card,.fp-card', 2, 300);
  // Click SEO report type
  await cl(page, '.fp-report-type:has-text("SEO"),.report-card:has-text("SEO"),button:has-text("Rapport SEO")', 800, 380);
  await page.waitForTimeout(400);
  // Click Générer
  await cl(page, 'button:has-text("Générer"),button:has-text("Créer ce rapport"),button[type="submit"]', 1200, 340);
  await page.waitForTimeout(600);
  await page.keyboard.press('Escape').catch(() => {});
  await inj(page);
  await hov(page, '.fp-report-item,.report-item,.fp-card', 2, 300);
  await sc(page, 80, 380);
  await page.waitForTimeout(300);
}

// ═══════════════════════════════════════════════════════════════════════════════
// VIDEO 6 FIX — Missions (work with real data) → open mission → stat hover
//               (safe y≥220) → Activity + Notif + Messages panels using
//               evaluate() click on exact header buttons by dataset/id
// ═══════════════════════════════════════════════════════════════════════════════
async function v6fix(page) {
  // Missions list — hover items
  await hov(page, 'table tbody tr,.mission-item,.fp-mission-card,.fp-card', 3, 340);
  await page.waitForTimeout(300);

  // Open first mission
  const mOpenOk = await cl(page, 'table tbody tr,.mission-item,.fp-mission-card', 1000, 400);
  if (mOpenOk) {
    await hov(page, '.fp-mission-detail,.fp-badge,.fp-stat', 2, 300);
    // Change status in the panel if available
    await clText(page, 'En cours', 500).catch(() => {});
    await clText(page, 'À démarrer', 500).catch(() => {});
    await sc(page, 80, 380);
    await page.waitForTimeout(300);
    // Close panel (Escape)
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(500);
    await inj(page);
  }

  // Hover stat blocks at SAFE y (y≥220, x≥250) — NOT y=165 which hits sidebar
  for (const [x, y] of [[260, 220], [490, 220], [720, 220], [950, 220]]) {
    if (x > 160 && y > 60) {
      await go(page, x, y, 300);
      await page.waitForTimeout(240);
    }
  }

  // Switch tabs: "À faire", "En cours", "Terminées"
  await clText(page, 'À faire', 500);
  await page.waitForTimeout(300);
  await clText(page, 'En cours', 500);
  await hov(page, 'table tbody tr,.mission-item', 2, 300);
  await page.waitForTimeout(300);
  await clText(page, 'Toutes', 400);
  await page.waitForTimeout(300);

  // ACTIVITY PANEL — try clicking via JS evaluate (bypasses coordinate restrictions)
  const actOk = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => {
      const id = b.id || b.dataset.action || '';
      const txt = b.textContent || b.title || b.getAttribute('aria-label') || '';
      return id.includes('activity') || txt.toLowerCase().includes('activit') || b.closest('[id*="activity"]');
    });
    if (btn) { btn.click(); return true; }
    return false;
  });
  await page.waitForTimeout(1000);
  if (actOk) {
    await inj(page);
    await hov(page, '.fp-activity-item,.activity-item', 3, 300);
    await sc(page, 70, 360); await page.waitForTimeout(250); await sc(page, -70, 330);
    // Close
    await page.evaluate(() => {
      const close = document.querySelector('[id*="activity"] button[aria-label*="Fermer"], .fp-activity-close, .fp-panel-close');
      if (close) close.click();
    });
    await page.waitForTimeout(400);
    await inj(page);
  }

  // NOTIFICATIONS PANEL
  const notifOk = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => {
      const id = b.id || b.dataset.action || '';
      const txt = b.textContent || b.title || b.getAttribute('aria-label') || '';
      return id.includes('notif') || txt.toLowerCase().includes('notif') || b.querySelector('svg[data-notif]');
    });
    if (btn) { btn.click(); return true; }
    return false;
  });
  await page.waitForTimeout(900);
  if (notifOk) {
    await inj(page);
    await hov(page, '.fp-notif-item,.notification-item', 3, 280);
    await cl(page, '.fp-notif-item,.notification-item', 400, 280);
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const close = document.querySelector('[id*="notif"] button, .fp-notif-close, .fp-panel-close');
      if (close) close.click();
    });
    await page.waitForTimeout(400);
    await inj(page);
  }

  // MESSAGES PANEL
  const msgOk = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const btn = btns.find(b => {
      const id = b.id || '';
      const txt = b.getAttribute('aria-label') || b.title || '';
      return id.includes('msg') || txt.toLowerCase().includes('message') || id === 'fp-msg-btn';
    });
    if (btn) { btn.click(); return true; }
    return false;
  });
  await page.waitForTimeout(900);
  if (msgOk) {
    await inj(page);
    // Click first channel
    const chanOk = await cl(page, '.fp-channel-btn,.fp-msg-channel-btn,.fp-msg-channel', 400, 300);
    // Type a message
    const msgTyped = await fi(page,
      '#fp-msg-input,textarea[placeholder*="Message"],input[placeholder*="Message"],.fp-msg-input',
      'Rapport prêt pour validation 👍');
    if (msgTyped) {
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(400);
    }
    await page.waitForTimeout(300);
    // Close
    await page.evaluate(() => {
      const close = document.querySelector('[id*="msg"] button[aria-label*="Fermer"], .fp-msg-close, .fp-panel-close');
      if (close) close.click();
    });
    await page.waitForTimeout(400);
    await inj(page);
  }

  // Navigate to Overview and show it
  await nav(page, 'overview');
  await page.waitForTimeout(600);
  // Hover KPI blocks safely
  for (const [x, y] of [[280, 230], [520, 230], [760, 230], [1000, 230]]) {
    await go(page, x, y, 280); await page.waitForTimeout(230);
  }
  await hov(page, '.fp-kpi-card,.kpi-card,.fp-stat-card', 3, 280);
  await sc(page, 100, 440);
  await page.waitForTimeout(350);
  await hov(page, '.fp-card', 2, 260);
  await sc(page, -100, 400);
  await page.waitForTimeout(350);
}

// ══════════════════════════════════════════════════════════════════════════════
// RUN FIXES
// ══════════════════════════════════════════════════════════════════════════════
console.log('\n═══════════════════════════════════');
console.log(' FlowPoint — Fix V2, V4, V5, V6');
console.log('═══════════════════════════════════\n');

const results = [];

try {
  console.log('▶ V2 FIX — Monitors → créer mission → créer monitor → CWV');
  const d = await record('v2fix', 'step2-audit-actions', 'monitors', v2fix);
  results.push({ v: 2, dur: d, ok: d > 18 });
} catch (e) { console.error('V2 ERROR:', e.message); results.push({ v: 2, dur: 0, ok: false }); }

try {
  console.log('\n▶ V4 FIX — Local SEO tabs exploration');
  const d = await record('v4fix', 'step4-local-competition', 'local-seo', v4fix);
  results.push({ v: 4, dur: d, ok: d > 15 });
} catch (e) { console.error('V4 ERROR:', e.message); results.push({ v: 4, dur: 0, ok: false }); }

try {
  console.log('\n▶ V5 FIX — AI quick-prompt + réponse + rapports');
  const d = await record('v5fix', 'step5-ai-reports', 'ai', v5fix);
  results.push({ v: 5, dur: d, ok: d > 18 });
} catch (e) { console.error('V5 ERROR:', e.message); results.push({ v: 5, dur: 0, ok: false }); }

try {
  console.log('\n▶ V6 FIX — Missions → activité → notifs → messages → overview');
  const d = await record('v6fix', 'step6-daily', 'missions', v6fix);
  results.push({ v: 6, dur: d, ok: d > 15 });
} catch (e) { console.error('V6 ERROR:', e.message); results.push({ v: 6, dur: 0, ok: false }); }

console.log('\n═══════════════════════════════════');
for (const r of results) console.log(`  V${r.v}: ${r.ok ? '✓' : '✗'} ${r.dur.toFixed(1)}s`);
const fail = results.filter(r => !r.ok);
if (fail.length) { console.error(`\nFailed: V${fail.map(r => r.v).join(', V')}`); process.exit(1); }
console.log('\nFix done.');
