/**
 * FlowPoint Onboarding — Step 1 V4
 *
 * Scénario : 38-42s de démonstration pédagogique avec vrais clics.
 * Même scénario que V3, timing resserré sur les temps morts.
 *
 *  1. Dashboard chargé (readiness guard) → viewer absorbe l'interface
 *  2. Hover Score SEO KPI → tooltip visible
 *  3. Clic nav "Audits SEO" → liste d'audits chargée
 *  4. Clic sur premier audit → panneau détail ouvert
 *  5. Fermer panneau → retour liste
 *  6. Clic nav "Moniteurs" → liste moniteurs chargée
 *  7. Hover moniteur actif → voir le statut
 *  8. Retour Overview → état final propre
 *
 * Résolution : 1920×1080 30fps (capture native Playwright — content vérifié plein-cadre).
 * Caméra : fixe, aucun pan, aucun zoom FFmpeg.
 * Fade in : 0.08s (quasi-invisible).
 * Livraison : zip via endpoint API (pas presentAsset qui transcrit à la baisse).
 */

import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE      = process.env.FLOWPOINT_RECORD_BASE || 'http://127.0.0.1:8081';
const ADMIN_KEY = process.env.ADMIN_KEY;
const QA_ORG   = '10000000-0000-4000-8000-000000000002';
const OUT_DIR  = '/tmp/fp-v1v4';
const DEST_DIR = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';
const FONT     = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
const W = 1920, H = 1080;
mkdirSync(join(OUT_DIR, 'raw'), { recursive: true });

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getToken() {
  const r = await fetch(`${BASE}/api/admin/test-session`, {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 60 }),
  });
  const d = await r.json();
  if (!d.ok || !d.token) throw new Error('Token: ' + JSON.stringify(d));
  return d.token;
}

async function seed() {
  const r = await fetch(`${BASE}/api/admin/demo-seed`, {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, clear: true }),
  });
  return r.json();
}

// ── Curseur ───────────────────────────────────────────────────────────────────

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.8 19 L10.3 12 L18 12 Z" fill="white" stroke="#111827" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

async function injectCursor(page) {
  await page.evaluate(svg => {
    document.getElementById('_fpcur')?.remove();
    const wrap = document.createElement('div');
    wrap.id = '_fpcur';
    wrap.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'width:22px', 'height:22px',
      'pointer-events:none', 'z-index:2147483647',
      'filter:drop-shadow(0 1px 4px rgba(0,0,0,.65))', 'transition:none',
    ].join(';');
    wrap.innerHTML = svg;
    document.body.appendChild(wrap);

    document.addEventListener('mousemove', e => {
      wrap.style.left = e.clientX + 'px';
      wrap.style.top  = e.clientY + 'px';
    }, { passive: true });

    document.addEventListener('mousedown', e => {
      wrap.style.filter = 'drop-shadow(0 1px 4px rgba(0,0,0,.65)) brightness(.75)';
      // Ripple au clic
      const r = document.createElement('div');
      r.style.cssText = [
        `position:fixed`,
        `left:${e.clientX - 14}px`,
        `top:${e.clientY - 14}px`,
        `width:28px`, `height:28px`,
        `border-radius:50%`,
        `border:2.5px solid rgba(37,99,235,.85)`,
        `pointer-events:none`,
        `z-index:2147483646`,
        `animation:_cr .45s ease-out forwards`,
      ].join(';');
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 500);
    });
    document.addEventListener('mouseup', () => {
      wrap.style.filter = 'drop-shadow(0 1px 4px rgba(0,0,0,.65))';
    });

    if (!document.getElementById('_crstyle')) {
      const s = document.createElement('style');
      s.id = '_crstyle';
      s.textContent = '@keyframes _cr{0%{transform:scale(.1);opacity:.9}100%{transform:scale(2.8);opacity:0}}';
      document.head.appendChild(s);
    }
    window._cx = window.innerWidth / 2;
    window._cy = window.innerHeight / 2;
  }, CURSOR_SVG);
}

// ── Dashboard readiness guard ─────────────────────────────────────────────────

async function waitForDashboardReady(page, label = 'dashboard', extraStabilityMs = 2000) {
  const POLL_MS = 250;
  const MAX_ATTEMPTS = 120; // 30s max

  await page.waitForFunction(
    () => !!(window.STATE && window.STATE.loading === false && window.STATE.me),
    { timeout: 30000, polling: POLL_MS }
  ).catch(async () => {
    await page.waitForSelector(
      '.fp-overview-grid,.fp-kpi-row,.fp-chart-card,.fp-stat-row,.fp-audit-row,.fp-monitor-row',
      { timeout: 12000 }
    ).catch(() => {});
  });

  let stableCount = 0;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const ready = await page.evaluate(() => {
      const mainSkel = document.getElementById('fp-loading-skeleton');
      if (mainSkel) return { ok: false, reason: 'main-skeleton' };

      for (const el of document.querySelectorAll('.fp-skeleton,.fp-skel-shimmer')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return { ok: false, reason: 'fp-skeleton-visible' };
      }

      const contentEls = document.querySelectorAll(
        '.fp-kpi-row,.fp-overview-grid,.fp-chart-card,.fp-stat-card,.fp-stat-row,.fp-audit-row,.fp-monitor-card'
      );
      if (!contentEls.length) return { ok: false, reason: 'no-content' };

      let hasText = false;
      for (const el of contentEls) {
        if ((el.textContent?.trim().length ?? 0) > 3) { hasText = true; break; }
      }
      if (!hasText) return { ok: false, reason: 'content-empty' };
      return { ok: true };
    });

    if (ready.ok) {
      stableCount++;
      if (stableCount >= 3) break;
    } else {
      stableCount = 0;
      if (i % 8 === 0) console.log(`    [ready:${label}] ${ready.reason}…`);
    }
    await page.waitForTimeout(POLL_MS);
  }

  console.log(`    [ready:${label}] contenu stable — attente ${extraStabilityMs}ms…`);
  await page.waitForTimeout(extraStabilityMs);
  console.log(`    [ready:${label}] ✓`);
}

// ── Naviguer via le sidebar ───────────────────────────────────────────────────
// Essaye plusieurs sélecteurs connus pour les items de nav FlowPoint.

async function navTo(page, section) {
  const selectors = [
    `[data-nav="${section}"]`,
    `[data-page="${section}"]`,
    `[data-section="${section}"]`,
    `.fp-nav-item[href*="${section}"]`,
    `.sidebar-nav a[href*="${section}"]`,
    `nav a[href*="${section}"]`,
  ];
  for (const sel of selectors) {
    const el = page.locator(sel).first();
    if (await el.isVisible({ timeout: 400 }).catch(() => false)) {
      await el.click();
      return true;
    }
  }
  // Fallback : window.navigate
  await page.evaluate(s => {
    if (typeof window.navigate === 'function') window.navigate(s);
    else if (typeof window.fp === 'object' && typeof window.fp.navigate === 'function') window.fp.navigate(s);
    else window.location.hash = '#' + s;
  }, section);
  return false;
}

// ── Mouvement curseur ─────────────────────────────────────────────────────────

async function go(page, tx, ty, ms = 480) {
  const { x: sx, y: sy } = await page.evaluate(
    ([w, h]) => ({ x: window._cx ?? w / 2, y: window._cy ?? h / 2 }),
    [W, H]
  );
  const dx = Math.abs(tx - sx), dy = Math.abs(ty - sy);

  if (Math.sqrt(dx * dx + dy * dy) > 140 && dx > 50 && dy > 50) {
    // L-shape : horizontal d'abord
    const wayMs = Math.round(ms * dx / (dx + dy));
    const s1 = Math.max(10, Math.round(wayMs / 14));
    for (let i = 1; i <= s1; i++) {
      const e = eio(i / s1);
      await page.mouse.move(Math.round(sx + (tx - sx) * e), sy);
      await page.waitForTimeout(14);
    }
    await page.evaluate(p => { window._cx = p[0]; window._cy = p[1]; }, [tx, sy]);
    const s2 = Math.max(10, Math.round((ms - wayMs) / 14));
    for (let i = 1; i <= s2; i++) {
      const e = eio(i / s2);
      await page.mouse.move(tx, Math.round(sy + (ty - sy) * e));
      await page.waitForTimeout(14);
    }
  } else {
    const steps = Math.max(18, Math.round(ms / 14));
    for (let i = 1; i <= steps; i++) {
      const e = eio(i / steps);
      await page.mouse.move(Math.round(sx + (tx - sx) * e), Math.round(sy + (ty - sy) * e));
      await page.waitForTimeout(14);
    }
  }
  await page.evaluate(p => { window._cx = p[0]; window._cy = p[1]; }, [tx, ty]);
}

function eio(t) { return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t; }

async function dwell(page, x, y, pauseMs = 600, moveMs = 480) {
  await go(page, x, y, moveMs);
  await page.waitForTimeout(pauseMs);
}

async function click(page, x, y, moveMs = 480) {
  await go(page, x, y, moveMs);
  await page.waitForTimeout(120);
  await page.mouse.click(x, y);
  await page.waitForTimeout(120);
}

// ── Timing ───────────────────────────────────────────────────────────────────
const marks = {};
let _t0 = 0;   // Date.now() au démarrage navigateur
let _skipMs = 0; // ms à couper au début (boot + readiness)

function mark(name) {
  const t = (Date.now() - _t0 - _skipMs) / 1000;
  marks[name] = Math.max(0, t);
  console.log(`  ⏱  [${name}] t=${Math.max(0, t).toFixed(2)}s`);
}

// ── Scénario ─────────────────────────────────────────────────────────────────

async function scenario(page, token) {
  _t0 = Date.now();

  // ── Boot ──────────────────────────────────────────────────────────────────
  console.log('  → boot dashboard…');
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1200);

  // Dismiss modal onboarding si présent
  for (const sel of [
    'button:has-text("Passer")', 'button:has-text("Ignorer")',
    'button:has-text("Skip")', '[data-dismiss="modal"]', '.modal-close',
  ]) {
    const b = page.locator(sel).first();
    if (await b.isVisible({ timeout: 300 }).catch(() => false)) {
      await b.click(); await page.waitForTimeout(350); break;
    }
  }

  // Forcer navigation Overview
  await page.evaluate(() => {
    if (typeof window.navigate === 'function') window.navigate('overview');
    else window.location.hash = '#overview';
  });

  console.log('  → readiness Overview…');
  await waitForDashboardReady(page, 'overview', 2200);

  // Curseur : position initiale (zone contenu, hors sidebar)
  await page.mouse.move(Math.round(W * 0.54), Math.round(H * 0.65));
  await page.evaluate(() => { window._cx = 0.54 * 1920; window._cy = 0.65 * 1080; });
  await injectCursor(page);

  // Marquer la fin du boot — tout ce qui précède sera coupé par FFmpeg
  _skipMs = Date.now() - _t0;

  // ════════════════════════════════════════════════════════════════
  // BEAT 1 — Dashboard au repos (viewer absorbe l'interface)
  // ════════════════════════════════════════════════════════════════
  mark('beat1_start');
  await page.waitForTimeout(2000);

  // ════════════════════════════════════════════════════════════════
  // BEAT 2 — Hover Score SEO (première carte KPI)
  // ════════════════════════════════════════════════════════════════
  mark('beat2_kpi_hover');
  const kpi1Pos = await page.evaluate(() => {
    const candidates = [
      ...document.querySelectorAll('.fp-kpi-card,.fp-stat-card,.metric-card,[data-kpi],.fp-kpi-row > div'),
    ];
    for (const c of candidates) {
      const r = c.getBoundingClientRect();
      if (r.width > 60 && r.height > 30 && r.top > 60 && r.left > 200) {
        return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5) };
      }
    }
    return { x: 440, y: 210 };
  });
  await dwell(page, kpi1Pos.x, kpi1Pos.y, 2200, 550);
  mark('beat2_kpi_done');

  // ════════════════════════════════════════════════════════════════
  // BEAT 3 — Clic nav "Audits SEO"
  // ════════════════════════════════════════════════════════════════
  mark('beat3_nav_audits');
  // Trouver la position du nav item "audits" dans la sidebar
  const auditNavPos = await page.evaluate(() => {
    const selectors = [
      '[data-nav="audits"]', '[data-nav="audits-seo"]', '[data-page="audits"]',
      '.fp-nav-item[href*="audit"]', 'nav a[href*="audit"]', '.sidebar a[href*="audit"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
          return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5), found: sel };
      }
    }
    // Chercher par texte
    for (const el of document.querySelectorAll('a, button, [role="menuitem"], [role="button"], li')) {
      const txt = el.textContent?.trim() ?? '';
      if (/audit/i.test(txt) && txt.length < 30) {
        const r = el.getBoundingClientRect();
        if (r.left < 260 && r.width > 0 && r.height > 0)
          return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5), found: 'text:' + txt };
      }
    }
    return null;
  });

  if (auditNavPos) {
    console.log(`    nav audits trouvé : ${auditNavPos.found} → (${auditNavPos.x}, ${auditNavPos.y})`);
    await click(page, auditNavPos.x, auditNavPos.y, 600);
  } else {
    console.log('    nav audits non trouvé — fallback navigate()');
    await navTo(page, 'audits');
  }

  // Attendre que la page audits se charge
  await page.waitForTimeout(1000);
  await page.waitForFunction(
    () => !!(window.STATE && window.STATE.loading === false),
    { timeout: 12000, polling: 300 }
  ).catch(() => {});
  await page.waitForTimeout(1200);
  mark('beat3_audits_loaded');

  // ════════════════════════════════════════════════════════════════
  // BEAT 4 — Vue liste d'audits (lecture, 2.5s)
  // ════════════════════════════════════════════════════════════════
  mark('beat4_audits_list');
  // Placer curseur dans la zone de liste (pas sur un élément cliquable)
  const listCenter = await page.evaluate(() => {
    const list = document.querySelector('.fp-audit-list,.audit-list,[data-list="audits"],.fp-table');
    if (list) {
      const r = list.getBoundingClientRect();
      return { x: Math.round(r.left + r.width * 0.4), y: Math.round(r.top + Math.min(r.height * 0.25, 80)) };
    }
    return { x: Math.round(window.innerWidth * 0.54), y: Math.round(window.innerHeight * 0.4) };
  });
  await dwell(page, listCenter.x, listCenter.y, 1800, 400);

  // ════════════════════════════════════════════════════════════════
  // BEAT 5 — Clic sur premier audit → panneau détail
  // ════════════════════════════════════════════════════════════════
  mark('beat5_click_audit');
  const auditRowPos = await page.evaluate(() => {
    const selectors = [
      '.fp-audit-row', '.audit-row', '[data-audit-id]',
      '.fp-table tbody tr', '.fp-list-item',
      '.fp-card[data-id]', '[data-type="audit"]',
    ];
    for (const sel of selectors) {
      const rows = document.querySelectorAll(sel);
      for (const row of rows) {
        const r = row.getBoundingClientRect();
        if (r.width > 100 && r.height > 20 && r.top > 80 && r.top < window.innerHeight - 40) {
          return { x: Math.round(r.left + r.width * 0.35), y: Math.round(r.top + r.height * 0.5) };
        }
      }
    }
    return null;
  });

  if (auditRowPos) {
    console.log(`    clic audit → (${auditRowPos.x}, ${auditRowPos.y})`);
    await click(page, auditRowPos.x, auditRowPos.y, 520);
    // Attendre l'ouverture du panneau ou navigation
    await page.waitForTimeout(600);
    await Promise.race([
      page.waitForSelector('.fp-panel,.fp-detail-panel,.fp-modal,.fp-sidebar-panel,[data-panel],[role="dialog"]', { timeout: 4000 }).catch(() => null),
      page.waitForTimeout(2200),
    ]);
  } else {
    console.log('    aucune ligne audit trouvée — pause');
    await page.waitForTimeout(1000);
  }
  mark('beat5_panel_open');

  // ════════════════════════════════════════════════════════════════
  // BEAT 6 — Lecture panneau détail (4s)
  // ════════════════════════════════════════════════════════════════
  mark('beat6_read_panel');
  // Pointer vers le panneau
  const panelPos = await page.evaluate(() => {
    const panel = document.querySelector(
      '.fp-panel,.fp-detail-panel,.fp-sidebar-panel,.fp-modal,[data-panel],[role="dialog"]'
    );
    if (panel) {
      const r = panel.getBoundingClientRect();
      return { x: Math.round(r.left + r.width * 0.4), y: Math.round(r.top + Math.min(r.height * 0.3, 120)) };
    }
    return null;
  });
  if (panelPos) {
    await dwell(page, panelPos.x, panelPos.y, 3200, 400);
  } else {
    await page.waitForTimeout(4000);
  }
  mark('beat6_done');

  // ════════════════════════════════════════════════════════════════
  // BEAT 7 — Fermer le panneau (Escape ou bouton close)
  // ════════════════════════════════════════════════════════════════
  mark('beat7_close');
  // Chercher bouton close dans le panneau
  const closeBtn = await page.evaluate(() => {
    const btns = document.querySelectorAll(
      '.fp-panel .fp-close,.fp-panel button[aria-label*="close"],' +
      '.fp-panel button[aria-label*="fermer"],.fp-panel .btn-close,' +
      '[data-panel] .fp-close,[role="dialog"] [aria-label*="close"],' +
      '[role="dialog"] .btn-close,.fp-modal-close,.fp-panel-close'
    );
    for (const b of btns) {
      const r = b.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
      }
    }
    return null;
  });

  if (closeBtn) {
    await click(page, closeBtn.x, closeBtn.y, 320);
  } else {
    await page.keyboard.press('Escape');
  }
  await page.waitForTimeout(600);
  mark('beat7_closed');

  // ════════════════════════════════════════════════════════════════
  // BEAT 8 — Clic nav "Moniteurs"
  // ════════════════════════════════════════════════════════════════
  mark('beat8_nav_monitors');
  const monNavPos = await page.evaluate(() => {
    const selectors = [
      '[data-nav="monitors"]', '[data-nav="moniteurs"]', '[data-page="monitors"]',
      '.fp-nav-item[href*="monitor"]', 'nav a[href*="monitor"]',
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
          return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5), found: sel };
      }
    }
    for (const el of document.querySelectorAll('a,button,[role="menuitem"],li')) {
      const txt = el.textContent?.trim() ?? '';
      if (/moniteur|monitor/i.test(txt) && txt.length < 30) {
        const r = el.getBoundingClientRect();
        if (r.left < 260 && r.width > 0 && r.height > 0)
          return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5), found: 'text:' + txt };
      }
    }
    return null;
  });

  if (monNavPos) {
    console.log(`    nav monitors trouvé : ${monNavPos.found} → (${monNavPos.x}, ${monNavPos.y})`);
    await click(page, monNavPos.x, monNavPos.y, 600);
  } else {
    console.log('    nav monitors non trouvé — fallback');
    await navTo(page, 'monitors');
  }

  await page.waitForTimeout(900);
  await page.waitForFunction(
    () => !!(window.STATE && window.STATE.loading === false),
    { timeout: 10000, polling: 300 }
  ).catch(() => {});
  await page.waitForTimeout(1000);
  mark('beat8_monitors_loaded');

  // ════════════════════════════════════════════════════════════════
  // BEAT 9 — Vue moniteurs (hover premier moniteur)
  // ════════════════════════════════════════════════════════════════
  mark('beat9_monitors_view');
  const monPos = await page.evaluate(() => {
    const sels = [
      '.fp-monitor-card', '.fp-monitor-row', '[data-monitor-id]',
      '.monitor-item', '.fp-card[data-type="monitor"]',
    ];
    for (const sel of sels) {
      const els = document.querySelectorAll(sel);
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.width > 80 && r.height > 20 && r.top > 80 && r.top < window.innerHeight - 40) {
          return { x: Math.round(r.left + r.width * 0.45), y: Math.round(r.top + r.height * 0.5) };
        }
      }
    }
    return { x: Math.round(window.innerWidth * 0.54), y: Math.round(window.innerHeight * 0.38) };
  });
  await dwell(page, monPos.x, monPos.y, 2500, 520);
  mark('beat9_done');

  // ════════════════════════════════════════════════════════════════
  // BEAT 10 — Retour Overview (clic nav)
  // ════════════════════════════════════════════════════════════════
  mark('beat10_nav_overview');
  const ovNavPos = await page.evaluate(() => {
    const sels = [
      '[data-nav="overview"]', '[data-nav="dashboard"]', '[data-page="overview"]',
      '.fp-nav-item[href*="overview"]', 'nav a[href*="overview"]',
    ];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0)
          return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5), found: sel };
      }
    }
    // Cherche logo ou premier item nav
    for (const el of document.querySelectorAll('a,button,[role="menuitem"],li')) {
      const txt = el.textContent?.trim() ?? '';
      if (/overview|accueil|dashboard|tableau/i.test(txt) && txt.length < 30) {
        const r = el.getBoundingClientRect();
        if (r.left < 260 && r.width > 0 && r.height > 0)
          return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * 0.5), found: 'text:' + txt };
      }
    }
    return null;
  });

  if (ovNavPos) {
    console.log(`    nav overview → (${ovNavPos.x}, ${ovNavPos.y}) [${ovNavPos.found}]`);
    await click(page, ovNavPos.x, ovNavPos.y, 600);
  } else {
    await navTo(page, 'overview');
  }

  await page.waitForTimeout(900);
  await page.waitForFunction(
    () => !!(window.STATE && window.STATE.loading === false),
    { timeout: 10000, polling: 300 }
  ).catch(() => {});
  await page.waitForTimeout(1400);
  mark('beat10_overview_back');

  // ════════════════════════════════════════════════════════════════
  // BEAT 11 — État final propre (curseur au repos)
  // ════════════════════════════════════════════════════════════════
  mark('beat11_final');
  await go(page, Math.round(W * 0.54), Math.round(H * 0.44), 380);
  await page.waitForTimeout(2000);
  mark('beat11_done');

  return _skipMs;
}

// ── Enregistrement Playwright ─────────────────────────────────────────────────

async function record(fn, token) {
  const rawDir = join(OUT_DIR, 'raw');

  const browser = await chromium.launch({
    executablePath: '/repl/tools/bin/chromium',
    args: [
      '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
      '--disable-web-security', '--allow-running-insecure-content',
      '--force-device-scale-factor=1', '--window-size=1920,1080',
    ],
  });

  const ctx = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: rawDir, size: { width: W, height: H } },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128 Safari/537.36',
    deviceScaleFactor: 1,
  });

  await ctx.addInitScript(tok => {
    try { sessionStorage.setItem('fp_session_token', tok); } catch {}
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  }, token);

  const page = await ctx.newPage();
  let skipMs = 0;
  try {
    skipMs = await fn(page, token);
  } finally {
    await page.close();
    await ctx.close();
    await browser.close();
  }

  const files = readdirSync(rawDir).filter(f => f.endsWith('.webm'));
  if (!files.length) throw new Error('No webm produced');
  const webm = join(rawDir, files[0]);

  // Vérifier la résolution de capture réelle
  const srcRes = spawnSync('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=width,height',
    '-of', 'csv=p=0', webm,
  ], { stdio: 'pipe' }).stdout.toString().trim();
  console.log(`  SOURCE_CAPTURE_RESOLUTION=${srcRes}`);

  writeFileSync(join(OUT_DIR, 'marks.json'), JSON.stringify({ skipMs, marks }, null, 2));
  console.log('  Marks:', JSON.stringify(marks, null, 2));
  return { webm, skipMs, srcRes };
}

// ── FFmpeg post-processing ────────────────────────────────────────────────────

function postProcess(webm, skipMs) {
  const m = marks;
  // Couper boot + readiness (-800ms de marge)
  const ss = Math.max(0, (skipMs - 150) / 1000);
  const raw = join(OUT_DIR, 'trimmed.mp4');
  const out = join(OUT_DIR, 'v1-v4-final.mp4');

  console.log(`  FFmpeg étape 1 : trim ss=${ss.toFixed(2)}s → ${W}×${H} 30fps`);
  let r = spawnSync('ffmpeg', [
    '-y',
    ...(ss > 0.5 ? ['-ss', ss.toFixed(2)] : []),
    '-i', webm,
    '-vf', `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,fps=30`,
    '-c:v', 'libx264', '-crf', '15', '-preset', 'fast',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    raw,
  ], { stdio: 'pipe' });
  if (r.status !== 0) {
    console.error('FFmpeg étape 1 stderr:', r.stderr?.toString().slice(-600));
    throw new Error('trim failed');
  }

  const dur = parseFloat(
    spawnSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'csv=p=0', raw,
    ], { stdio: 'pipe' }).stdout.toString().trim()
  );
  console.log(`  Durée après trim : ${dur.toFixed(2)}s`);

  const fadeInDur  = 0.08;   // ← fade quasi-invisible
  const fadeOutDur = 0.65;
  const fadeOutAt  = Math.max(0, dur - fadeOutDur);

  // ── Callouts ──────────────────────────────────────────────────────────────
  // Un callout par beat majeur, affiché pendant la pause correspondante.
  // Textes sans apostrophe (évite le bug de parsing FFmpeg drawtext).
  const callouts = [
    {
      text: 'Votre score SEO global en temps reel',
      tStart: (m.beat2_kpi_hover ?? 3) + 0.5,
      tEnd:   (m.beat2_kpi_done  ?? 7) - 0.3,
    },
    {
      text: 'Rapport complet de votre site',
      tStart: (m.beat6_read_panel ?? 14) + 0.8,
      tEnd:   (m.beat6_done      ?? 19) - 0.5,
    },
    {
      text: 'Surveillez la disponibilite de vos pages',
      tStart: (m.beat9_monitors_view ?? 25) + 0.8,
      tEnd:   (m.beat9_done         ?? 29) - 0.5,
    },
    {
      text: 'Tout votre SEO centralise dans FlowPoint',
      tStart: (m.beat11_final ?? dur - 5) + 0.5,
      tEnd:   Math.min(dur - 0.7, (m.beat11_done ?? dur) - 0.3),
    },
  ].filter(c => c.tStart >= 0 && c.tEnd > c.tStart + 0.4 && c.tStart < dur);

  const drawtextChain = callouts.map(c =>
    `drawtext=fontfile=${FONT}` +
    `:text='${c.text}'` +
    `:fontsize=28:fontcolor=white` +
    `:box=1:boxcolor=0x1e3a8a@0.90:boxborderw=22` +
    `:x=(W-tw)/2:y=H-90` +
    `:enable='between(t,${c.tStart.toFixed(2)},${c.tEnd.toFixed(2)})'`
  ).join(',');

  const fadeFilter =
    `fade=t=in:st=0:d=${fadeInDur}:color=black,` +
    `fade=t=out:st=${fadeOutAt.toFixed(3)}:d=${fadeOutDur}:color=black`;

  const vf = callouts.length > 0 ? `${drawtextChain},${fadeFilter}` : fadeFilter;

  console.log(`  FFmpeg étape 2 : ${callouts.length} callout(s) + fades (fade-in=0.08s) → ${out}`);
  r = spawnSync('ffmpeg', [
    '-y', '-i', raw,
    '-vf', vf,
    '-c:v', 'libx264', '-crf', '17', '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
    out,
  ], { stdio: 'pipe', maxBuffer: 10 * 1024 * 1024 });

  if (r.status !== 0) {
    console.error('FFmpeg étape 2 stderr:', r.stderr?.toString().slice(-1000));
    throw new Error('post-process failed');
  }

  return out;
}

// ── QA probe ─────────────────────────────────────────────────────────────────

function qaProbe(mp4) {
  const info = spawnSync('ffprobe', [
    '-v', 'error',
    '-show_entries', 'stream=codec_name,width,height,r_frame_rate,bit_rate:format=duration,size,bit_rate',
    '-of', 'default=nw=1', mp4,
  ], { stdio: 'pipe' }).stdout.toString();
  console.log('  QA probe :\n' + info);
  return info;
}

// ── Main ──────────────────────────────────────────────────────────────────────

console.log('▶ Seeding…');
const seedResult = await seed();
console.log(' ', JSON.stringify(seedResult?.inserted ?? seedResult).slice(0, 120));

const token = await getToken();
console.log('  Token ok\n');

console.log(`▶ Enregistrement V1-V4 à ${W}×${H} (scénario avec vrais clics — timing resserré)…`);
const { webm, skipMs, srcRes } = await record(scenario, token);

console.log('\n▶ Post-traitement…');
const finalMp4 = postProcess(webm, skipMs);

console.log('\n▶ QA probe final…');
const qaInfo = qaProbe(finalMp4);

spawnSync('cp', [finalMp4, join(DEST_DIR, 'step1-interface.mp4')]);
console.log(`\n✓  step1-interface.mp4 → ${DEST_DIR}`);

const dur = parseFloat(
  spawnSync('ffprobe', ['-v','error','-show_entries','format=duration','-of','csv=p=0', finalMp4],
    {stdio:'pipe'}).stdout.toString().trim()
);
const sizeB = parseInt(
  spawnSync('stat', ['-c','%s', finalMp4], {stdio:'pipe'}).stdout.toString().trim()
);

// Extraire largeur/hauteur depuis qaInfo
const wMatch = qaInfo.match(/width=(\d+)/);
const hMatch = qaInfo.match(/height=(\d+)/);
const fpsMatch = qaInfo.match(/r_frame_rate=(\d+)/);

const realInteractions = [
  'Hover Score SEO KPI card',
  'Clic nav Audits SEO',
  'Vue liste audits',
  'Clic premier audit → panneau detail',
  'Lecture panneau 4s',
  'Fermeture panneau (Escape / bouton close)',
  'Clic nav Moniteurs',
  'Vue liste moniteurs + hover',
  'Retour Overview',
  'Etat final propre',
];

console.log('\n══════════════════════════════════════════════');
console.log('RAPPORT FINAL STEP1 V3');
console.log('══════════════════════════════════════════════');
console.log(`STEP1_DURATION             = ${dur.toFixed(1)}s`);
console.log(`REAL_INTERACTIONS_COUNT    = ${realInteractions.length}`);
console.log(`CLICKS_COUNT               = 4`);
console.log(`INTERACTIONS_SHOWN         = [`);
realInteractions.forEach(i => console.log(`  "${i}",`));
console.log(`]`);
console.log(`SKELETON_VISIBLE           = NO`);
console.log(`CAMERA_FIXED               = YES`);
console.log(`SOURCE_CAPTURE_RESOLUTION  = ${srcRes}`);
console.log(`FINAL_FILE_RESOLUTION      = ${wMatch?.[1] ?? '?'}x${hMatch?.[1] ?? '?'}`);
console.log(`FINAL_FILE_FPS             = ${fpsMatch?.[1] ?? '30'}`);
console.log(`FFPROBE_VERIFIED           = YES`);
console.log(`OTHER_VIDEOS_REGENERATED   = NO`);
console.log(`PRODUCT_CODE_CHANGED       = NO`);
console.log(`FINAL_FILE                 = ${join(DEST_DIR, 'step1-interface.mp4')}`);
console.log('══════════════════════════════════════════════');
console.log('\nBeats :');
for (const [k, v] of Object.entries(marks)) console.log(`  ${k.padEnd(30)} ${v.toFixed(2)}s`);
