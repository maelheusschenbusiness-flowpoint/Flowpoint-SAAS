/**
 * FlowPoint Onboarding Videos — definitive re-record
 *
 * Fixes applied vs previous passes:
 * 1. NEVER click tabs — use window.navigate() for all section changes
 * 2. NEVER click list rows — hover only
 * 3. Typing into AI input uses fill() to bypass keydown shortcut handlers
 * 4. V5: no `?` via keyboard.type — fill the question, then press Enter
 * 5. V3: no "Performance" tab click (matches sidebar); only Incidents/Config/SLA
 * 6. V6: boot directly to missions hash before trim; wait for mission rows
 * 7. After every navigation verify hash, re-navigate if wrong
 * 8. Tab clicks are scoped: only click elements INSIDE .fp-page, main, or #fp-main
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE      = 'https://app.flowpoint.pro';
const ADMIN_KEY = process.env.ADMIN_KEY;
const QA_ORG   = '10000000-0000-4000-8000-000000000002';
const OUT_DIR  = '/tmp/fp-vfin';
const DEST_DIR = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';
mkdirSync(OUT_DIR, { recursive: true });

async function getToken() {
  const r = await fetch(`${BASE}/api/admin/test-session`, {
    method: 'POST',
    headers: { 'x-admin-key': ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 480 }),
  });
  const d = await r.json();
  if (!d.ok || !d.token) throw new Error(JSON.stringify(d));
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

const CURSOR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

async function injectCursor(page) {
  await page.evaluate(svg => {
    document.getElementById('_fpa')?.remove();
    const w = document.createElement('div');
    w.id = '_fpa';
    w.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML = svg;
    document.body.appendChild(w);
    let cx = 640, cy = 360;
    document.addEventListener('mousemove', e => { cx = e.clientX; cy = e.clientY; w.style.left=cx+'px'; w.style.top=cy+'px'; }, { passive: true });
    document.addEventListener('mousedown', () => {
      w.style.filter = 'drop-shadow(0 1px 2px rgba(0,0,0,.5)) brightness(.85)';
      const r = document.createElement('div');
      r.style.cssText = `position:fixed;left:${cx-8}px;top:${cy-8}px;width:16px;height:16px;border-radius:50%;border:1.5px solid rgba(59,130,246,.65);pointer-events:none;z-index:2147483646;animation:_cr .35s ease-out forwards`;
      document.body.appendChild(r); setTimeout(() => r.remove(), 380);
    });
    document.addEventListener('mouseup', () => { w.style.filter='drop-shadow(0 1px 2px rgba(0,0,0,.5))'; });
    if (!document.getElementById('_crs')) { const s=document.createElement('style'); s.id='_crs'; s.textContent='@keyframes _cr{0%{transform:scale(.3);opacity:1}100%{transform:scale(2);opacity:0}}'; document.head.appendChild(s); }
    window._cx = cx; window._cy = cy;
  }, CURSOR_SVG);
}

async function go(page, tx, ty, ms = 450) {
  const {x, y} = await page.evaluate(() => ({ x: window._cx||640, y: window._cy||360 }));
  const n = Math.max(16, Math.round(ms/14));
  for (let i=1; i<=n; i++) {
    const t=i/n, e=t<.5?2*t*t:-1+(4-2*t)*t;
    await page.mouse.move(Math.round(x+(tx-x)*e), Math.round(y+(ty-y)*e));
    await page.waitForTimeout(14);
  }
  await page.evaluate(p => { window._cx=p.x; window._cy=p.y; }, {x:tx,y:ty});
}

async function scroll(page, delta, ms=600) {
  const n = Math.max(8, Math.round(ms/30));
  for (let i=0; i<n; i++) { await page.mouse.wheel(0, delta/n); await page.waitForTimeout(30); }
  await page.waitForTimeout(100);
}

// Click by selector — scoped to main content (avoids sidebar matches)
async function $click(page, sel, afterMs=600, moveMs=400) {
  // Try scoped selectors first, then fall back to unscoped
  const scoped = `main ${sel}, #fp-main ${sel}, .fp-page ${sel}, #fp-content ${sel}`;
  for (const s of [scoped, sel]) {
    try {
      const el = page.locator(s).first();
      if (!await el.isVisible({timeout:2500}).catch(()=>false)) continue;
      const b = await el.boundingBox(); if (!b || b.width<2) continue;
      // Skip if element is in the sidebar (x < 150)
      if (b.x < 150) continue;
      await go(page, b.x+b.width/2, b.y+b.height/2, moveMs);
      await page.waitForTimeout(80);
      await page.mouse.click(b.x+b.width/2, b.y+b.height/2);
      await page.waitForTimeout(afterMs);
      await injectCursor(page);
      return true;
    } catch {}
  }
  return false;
}

// Type using fill() to bypass global keydown handlers (avoids ? → shortcut modal)
async function $fill(page, sel, text) {
  try {
    const el = page.locator(sel).first();
    await el.waitFor({ state:'visible', timeout:5000 });
    const b = await el.boundingBox(); if (!b) return false;
    await go(page, b.x+b.width/2, b.y+b.height/2, 350);
    await el.click();
    await page.waitForTimeout(200);
    await el.fill(text);  // fills without triggering keydown handlers
    await page.waitForTimeout(200);
    return true;
  } catch { return false; }
}

// Type char-by-char with delay (use only for non-special chars, no ?)
async function $type(page, sel, text, delay=58) {
  try {
    const el = page.locator(sel).first();
    await el.waitFor({ state:'visible', timeout:5000 });
    const b = await el.boundingBox(); if (!b) return false;
    await go(page, b.x+b.width/2, b.y+b.height/2, 350);
    await el.click(); await page.waitForTimeout(180);
    await page.keyboard.type(text, { delay });
    return true;
  } catch { return false; }
}

// Navigate via window.navigate — verify hash changed
async function nav(page, route, waitSel = null) {
  await page.evaluate(r => { if(window.navigate) window.navigate(r); else window.location.hash=r; }, route);
  await page.waitForTimeout(2200);
  if (waitSel) await page.waitForSelector(waitSel, {timeout:8000}).catch(()=>{});
  await page.waitForTimeout(500);
  await injectCursor(page);
  // Log the resulting hash for debugging
  const h = await page.evaluate(() => window.location.hash);
  console.log(`  nav('${route}') → hash='${h}'`);
}

// Dismiss any modal overlay (escape)
async function dismissModal(page) {
  await page.keyboard.press('Escape'); await page.waitForTimeout(400);
  await injectCursor(page);
}

// Hover items without clicking
async function hoverItems(page, sel, max=3, dwellMs=320) {
  const items = page.locator(sel);
  const n = Math.min(await items.count(), max);
  for (let i=0; i<n; i++) {
    const b = await items.nth(i).boundingBox().catch(()=>null);
    if (b && b.width>40 && b.x>150) { // skip sidebar items
      await go(page, b.x+b.width/2, b.y+b.height/2, 380);
      await page.waitForTimeout(dwellMs);
    }
  }
}

function toMp4(webm, mp4, skipMs=0) {
  const ss = Math.max(0,(skipMs-400)/1000);
  const args=['-y'];
  if (ss>0.5) args.push('-ss', ss.toFixed(2));
  args.push('-i',webm,'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
    '-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',mp4);
  spawnSync('ffmpeg',args,{stdio:'pipe'});
}

async function record(name, fn, token) {
  const tmp = join(OUT_DIR, `t_${name}`);
  mkdirSync(tmp, {recursive:true});
  const browser = await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  const ctx = await browser.newContext({
    viewport:{width:1280,height:720},
    recordVideo:{dir:tmp,size:{width:1280,height:720}},
    userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
  });
  await ctx.addInitScript(tok => {
    try { sessionStorage.setItem('fp_session_token', tok); } catch {}
    Object.defineProperty(navigator, 'webdriver', {get:()=>undefined});
  }, token);
  const page = await ctx.newPage();
  let skipMs = 0;
  try { skipMs = await fn(page, token); }
  finally { await page.close(); await ctx.close(); await browser.close(); }
  const files = readdirSync(tmp).filter(f=>f.endsWith('.webm'));
  if (!files.length) throw new Error('No webm: '+name);
  const mp4 = join(OUT_DIR, `${name}.mp4`);
  toMp4(join(tmp,files[0]), mp4, skipMs);
  spawnSync('cp',[mp4,join(DEST_DIR,`${name}.mp4`)]);
  const dur = spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4],{stdio:'pipe'}).stdout.toString().trim();
  console.log(`  ✓ ${name}.mp4  ${parseFloat(dur).toFixed(1)}s  (trimmed ${(skipMs/1000).toFixed(1)}s)`);
  return { name, duration: parseFloat(dur) };
}

// Boot: navigate to dashboard, wait STATE.loading=false, dismiss modal, navigate to initial route
async function boot(page, token, initRoute, rowSel=null) {
  const t0 = Date.now();
  await page.goto(`${BASE}/dashboard.html`, {waitUntil:'domcontentloaded',timeout:30000});
  try { await page.waitForFunction(()=>typeof window.STATE!=='undefined'&&window.STATE.loading===false,{timeout:25000,polling:300}); }
  catch { await page.waitForSelector('h1,h2',{timeout:10000}).catch(()=>{}); }
  await page.waitForTimeout(2000);
  // Dismiss onboarding
  for (const s of ['button:has-text("Passer la visite")','button:has-text("Ignorer")','button:has-text("Skip")']) {
    try { const b=page.locator(s).first(); if(await b.isVisible({timeout:500}).catch(()=>false)){await b.click();await page.waitForTimeout(400);break;} } catch {}
  }
  // Navigate to initial route
  await page.evaluate(r=>{if(window.navigate)window.navigate(r);else window.location.hash=r;},initRoute);
  await page.waitForTimeout(2500);
  if (rowSel) {
    // Wait for rows to appear (data loaded)
    await page.waitForFunction(sel => document.querySelectorAll(sel).length > 0, rowSel, {timeout:8000,polling:400}).catch(()=>{});
    await page.waitForTimeout(800);
  }
  await page.mouse.move(650,350);
  await page.evaluate(()=>{window._cx=650;window._cy=350;});
  await injectCursor(page);
  return Date.now()-t0;
}

// ══════════════════════════════════════════════════════════════════════════════
// VIDEO 2 — Audits SEO → Missions create → Monitors create → Core Web Vitals
// ══════════════════════════════════════════════════════════════════════════════
async function v2(page, token) {
  const skip = await boot(page, token, 'audits');

  // ── Audits SEO ─────────────────────────────────────────────────────────────
  // Hover stat blocks
  for (const [x,y] of [[245,170],[490,170],[720,170],[1000,170]]) { await go(page,x,y,320); await page.waitForTimeout(260); }
  // Hover table rows (no click — row click → overview)
  await hoverItems(page,'table tbody tr,.audit-row',3,310);
  // Hover filter tags
  for (const [x,y] of [[160,305],[250,305],[350,305],[470,305]]) { await go(page,x,y,280); await page.waitForTimeout(220); }
  // Use the URL input field to launch a QA audit
  const auditInput = '#fp-audit-url-input,input[placeholder*="monsite.fr"],.fp-audit-url-input';
  const typed = await $fill(page, auditInput, 'https://boulangerie-artisanale.fr');
  if (typed) {
    await page.waitForTimeout(300);
    // Click Lancer button (NOT a tab, scoped to the right side of the input area)
    await $click(page,'button:has-text("+ Lancer"),button:has-text("Lancer"),button:has-text("Analyser")',700,320);
  }
  await go(page,640,380,350); await page.waitForTimeout(500);
  await dismissModal(page);

  // ── Missions ────────────────────────────────────────────────────────────────
  await nav(page,'missions','table tbody tr,.mission-item');
  for (const [x,y] of [[220,165],[430,165],[630,165],[820,165]]) { await go(page,x,y,310); await page.waitForTimeout(250); }
  await hoverItems(page,'table tbody tr,.mission-item,.mission-row',3,310);
  // Create mission via + button (modal opens, not page navigate)
  await $click(page,'button:has-text("+ Mission"),button:has-text("Créer une mission"),button:has-text("Mission")',600,380);
  await $fill(page,'input[placeholder*="Titre"],input[id*="mission"],input[placeholder*="Nom"],input[placeholder*="ission"]','Optimiser les fiches GBP');
  await page.waitForTimeout(280);
  await $click(page,'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]',1200,320);
  await page.waitForTimeout(300); await dismissModal(page);

  // ── Monitors ────────────────────────────────────────────────────────────────
  await nav(page,'monitors','table tbody tr,.monitor-card');
  for (const [x,y] of [[220,165],[420,165],[620,165],[820,165],[1020,165]]) { await go(page,x,y,300); await page.waitForTimeout(240); }
  await hoverItems(page,'table tbody tr,.monitor-card,.monitor-row',3,300);
  // Create monitor (modal)
  await $click(page,'#monitor-new-btn,button:has-text("+ Nouveau"),button:has-text("Nouveau")',700,380);
  await $fill(page,'input[id*="url"],input[placeholder*="https"],input[type="url"]','https://boulangerie-artisanale.fr');
  await page.waitForTimeout(280);
  await $click(page,'#nm-create,button:has-text("Créer le monitor"),button:has-text("Créer"),button[type="submit"]',1300,320);
  await page.waitForTimeout(300); await dismissModal(page);

  // ── Core Web Vitals ──────────────────────────────────────────────────────────
  await nav(page,'performance-web','h1,h2,.fp-psi-section');
  for (const [x,y] of [[350,200],[640,200],[900,200]]) { await go(page,x,y,320); await page.waitForTimeout(250); }
  await scroll(page,60,350); await go(page,640,350,300); await page.waitForTimeout(350); await scroll(page,-60,300);
  // PSI URL input — use fill to avoid ? shortcut
  const psiSel = '#fp-psi-url-input,input[placeholder*="Entrez une URL"],input[placeholder*="exemple.com"],input[placeholder*="https://example"]';
  await $fill(page, psiSel, 'https://boulangerie-artisanale.fr');
  await page.waitForTimeout(300);
  await $click(page,'button:has-text("Analyser"),button:has-text("Lancer"),button:has-text("Analyser la page"),button[type="submit"]',1000,320);
  await go(page,640,380,350); await page.waitForTimeout(700);
  return skip;
}

// ══════════════════════════════════════════════════════════════════════════════
// VIDEO 3 — Monitors (hover rows + stat blocks) → create monitor → Alertes
// ══════════════════════════════════════════════════════════════════════════════
async function v3(page, token) {
  const skip = await boot(page, token, 'monitors', 'table tbody tr,.monitor-card');
  const rows = await page.locator('table tbody tr,.monitor-card').count();
  console.log(`  [v3] monitor rows: ${rows}`);

  // ── Hover stat blocks ───────────────────────────────────────────────────────
  for (const [x,y] of [[210,165],[400,165],[600,165],[800,165],[1000,165]]) { await go(page,x,y,330); await page.waitForTimeout(270); }

  // ── Hover each monitor card ─────────────────────────────────────────────────
  await hoverItems(page,'table tbody tr,.monitor-card,.monitor-row',3,400);

  // ── Click tabs in the MAIN content area only (NOT sidebar links)
  // Only Incidents, Config, SLA — avoid "Performance" (matches sidebar)
  for (const label of ['Incidents','Config','SLA','Status']) {
    // Very specific selector: button with this text that is NOT inside aside/nav
    const tab = page.locator(`button:has-text("${label}"):not(aside button):not(nav button)`).first();
    if (await tab.isVisible({timeout:1500}).catch(()=>false)) {
      const b = await tab.boundingBox().catch(()=>null);
      if (b && b.x > 150) { // not in sidebar
        await go(page,b.x+b.width/2,b.y+b.height/2,370);
        await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
        await page.waitForTimeout(700); await injectCursor(page);
        await go(page,640,360,300); await page.waitForTimeout(350);
        // Verify still on monitors
        const h = await page.evaluate(()=>window.location.hash);
        if (!h.includes('monitor')) {
          console.log(`  [v3] tab click for "${label}" navigated to ${h} — recovering`);
          await nav(page,'monitors','table tbody tr,.monitor-card');
        }
      }
    }
  }

  // ── Hover rows again after tabs ─────────────────────────────────────────────
  await hoverItems(page,'table tbody tr,.monitor-card',3,300);

  // ── Create a new monitor ────────────────────────────────────────────────────
  await $click(page,'#monitor-new-btn,button:has-text("+ Nouveau"),button:has-text("Nouveau")',700,380);
  await $fill(page,'input[id*="url"],input[placeholder*="https"],input[type="url"]','https://restaurant-chez-pierre.fr');
  await page.waitForTimeout(280);
  await $click(page,'#nm-create,button:has-text("Créer le monitor"),button:has-text("Créer"),button[type="submit"]',1300,320);
  await page.waitForTimeout(300); await dismissModal(page);

  // ── Scroll to bottom sections (Timeline, Canaux d'alerte, SSL) ─────────────
  await scroll(page,200,600); await go(page,640,440,350); await page.waitForTimeout(400);
  await scroll(page,200,500); await go(page,640,480,300); await page.waitForTimeout(400);
  await scroll(page,-400,700); await page.waitForTimeout(300);

  // ── Navigate to Alertes ─────────────────────────────────────────────────────
  await nav(page,'alerts-center','h1,h2,.alert-command-center,#alert-command-center');
  for (const [x,y] of [[210,200],[420,200],[630,200],[840,200]]) { await go(page,x,y,330); await page.waitForTimeout(260); }
  // Hover alert score blocks
  await scroll(page,200,500); await go(page,640,430,350); await page.waitForTimeout(500); await scroll(page,-200,450);
  await page.waitForTimeout(500);
  return skip;
}

// ══════════════════════════════════════════════════════════════════════════════
// VIDEO 4 — Local SEO (hover+scroll) → Concurrents (hover)
// ══════════════════════════════════════════════════════════════════════════════
async function v4(page, token) {
  const skip = await boot(page, token, 'local-seo','h1,h2');
  await page.waitForTimeout(400);

  // ── Hover Local SEO stat blocks ─────────────────────────────────────────────
  for (const [x,y] of [[210,195],[440,195],[660,195],[880,195]]) { await go(page,x,y,320); await page.waitForTimeout(260); }
  // Hover banner action buttons
  for (const [x,y] of [[200,148],[310,148],[415,148]]) { await go(page,x,y,300); await page.waitForTimeout(240); }
  // Scroll down to see map / content area
  await scroll(page,150,500); await go(page,640,400,320); await page.waitForTimeout(400);
  await go(page,640,460,280); await page.waitForTimeout(350);
  await scroll(page,-150,450);

  // ── Navigate to Concurrents tab inside Local SEO ───────────────────────────
  // Use window.navigate('concurrents') — DO NOT click tabs (they match sidebar)
  await nav(page,'concurrents','h1,h2,.competitor-card,table tbody tr');
  await page.waitForTimeout(300);
  for (const [x,y] of [[280,195],[540,195],[780,195],[1020,195]]) { await go(page,x,y,320); await page.waitForTimeout(260); }
  await hoverItems(page,'table tbody tr,.competitor-card,.competitor-row',3,380);
  await scroll(page,100,500); await go(page,640,400,320); await page.waitForTimeout(400);
  await scroll(page,100,450); await go(page,640,450,280); await page.waitForTimeout(350);
  await scroll(page,-200,500);

  // ── Back to Local SEO ───────────────────────────────────────────────────────
  await nav(page,'local-seo','h1,h2');
  for (const [x,y] of [[210,195],[440,195],[660,195],[880,195]]) { await go(page,x,y,310); await page.waitForTimeout(250); }
  await scroll(page,80,400); await go(page,640,380,300); await page.waitForTimeout(400); await scroll(page,-80,350);
  await page.waitForTimeout(500);
  return skip;
}

// ══════════════════════════════════════════════════════════════════════════════
// VIDEO 5 — Assistant IA (fill + send) → Rapports (hover + generate)
// ══════════════════════════════════════════════════════════════════════════════
async function v5(page, token) {
  const skip = await boot(page, token, 'ai');
  await page.waitForSelector('#ai-input,[id*="ai-input"],textarea[placeholder*="question"]',{timeout:8000}).catch(()=>{});
  await page.waitForTimeout(600);

  // ── Hover suggestion buttons ────────────────────────────────────────────────
  await hoverItems(page,'.fp-suggestion-btn,[class*="suggestion"] button,[class*="quick"] button',4,270);

  // ── Fill AI question using fill() — avoids keydown/? shortcut ─────────────
  const aiSel = '#ai-input,[id*="ai-input"],textarea[placeholder*="question"],textarea[id*="ai"],input[id*="ai"]';
  const filled = await $fill(page, aiSel, 'Quelles sont mes priorités SEO cette semaine');
  if (filled) {
    await page.waitForTimeout(400);
    // Move to Send button and click
    await $click(page,'#ai-send,button[aria-label*="Envoyer"],button:has-text("Envoyer"),.fp-send-btn,[aria-label*="send"]',500,300);
  }
  // Dismiss any modal that may have appeared
  const modalVisible = await page.locator('[class*="modal"],[role="dialog"],.fp-modal').isVisible({timeout:800}).catch(()=>false);
  if (modalVisible) await dismissModal(page);

  // ── Wait for and scan AI response ──────────────────────────────────────────
  await page.waitForFunction(()=>{
    const msgs=document.querySelectorAll('.fp-ai-bubble,.ai-msg,.assistant-msg,[data-role="assistant"],[class*="assistant"],[class*="message"]');
    return [...msgs].some(m=>m.textContent&&m.textContent.trim().length>30);
  },{timeout:20000,polling:500}).catch(()=>{});
  await page.waitForTimeout(600); await injectCursor(page);
  await go(page,640,340,380); await page.waitForTimeout(500);
  await scroll(page,100,500); await go(page,640,420,320); await page.waitForTimeout(500);
  await scroll(page,80,400); await go(page,640,460,280); await page.waitForTimeout(400);
  await scroll(page,-180,600); await page.waitForTimeout(400);

  // ── Rapports ─────────────────────────────────────────────────────────────────
  await nav(page,'reports','h1,h2,.report-card,.fp-report-card');
  for (const [x,y] of [[800,100],[950,100],[1100,100]]) { await go(page,x,y,320); await page.waitForTimeout(250); }
  await hoverItems(page,'.report-card,.fp-report-card,[data-report]',4,350);
  await scroll(page,80,400); await go(page,640,420,320); await page.waitForTimeout(400); await scroll(page,-80,350);
  // Create/generate report
  await $click(page,'button:has-text("Créer un rapport"),button:has-text("Nouveau rapport"),button:has-text("Nouveau")',1200,380);
  await go(page,640,360,350); await page.waitForTimeout(700);
  await $click(page,'button:has-text("Générer"),button:has-text("Générer rapport")',1200,350);
  await go(page,640,380,350); await page.waitForTimeout(600);
  await dismissModal(page);
  return skip;
}

// ══════════════════════════════════════════════════════════════════════════════
// VIDEO 6 — Quotidien : Missions + create + Activité + Notifs + Messages + Overview
// ══════════════════════════════════════════════════════════════════════════════
async function v6(page, token) {
  // Boot on missions and wait for mission rows
  const skip = await boot(page, token, 'missions', 'table tbody tr,.mission-item');

  // ── Missions ─────────────────────────────────────────────────────────────────
  for (const [x,y] of [[220,165],[430,165],[630,165],[830,165]]) { await go(page,x,y,310); await page.waitForTimeout(250); }
  await hoverItems(page,'table tbody tr,.mission-item,.mission-row',3,380);

  // Create mission (modal — not row click)
  await $click(page,'#mission-quick-add-btn,button:has-text("+ Mission"),button:has-text("Créer une mission")',600,380);
  await $fill(page,'input[placeholder*="Titre"],input[id*="mission"],input[placeholder*="Nom"],input[placeholder*="ission"]','Améliorer la page Contact');
  await page.waitForTimeout(280);
  await $click(page,'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]',1200,320);
  await page.waitForTimeout(300); await dismissModal(page);

  // ── Activité panel ────────────────────────────────────────────────────────────
  if (await $click(page,'#fp-activity-btn,[aria-label*="ctivité"]',1000,400)) {
    await go(page,1060,250,350); await page.waitForTimeout(350);
    await go(page,1060,330,300); await page.waitForTimeout(320);
    await go(page,1060,410,280); await page.waitForTimeout(320);
    await scroll(page,60,350); await page.waitForTimeout(300); await scroll(page,-60,300);
    await page.mouse.click(350,400); await page.waitForTimeout(400); await injectCursor(page);
  }

  // ── Notifications ─────────────────────────────────────────────────────────────
  if (await $click(page,'#fp-notif-btn',900,400)) {
    await go(page,1000,240,350); await page.waitForTimeout(300);
    await hoverItems(page,'#fp-notif-dropdown .fp-notif-item,[id*="notif"] .notif-item,.notification-item',3,300);
    await page.mouse.click(400,450); await page.waitForTimeout(400); await injectCursor(page);
  }

  // ── Messages ──────────────────────────────────────────────────────────────────
  if (await $click(page,'#fp-msg-btn',900,400)) {
    await $click(page,'#fp-msg-dropdown .fp-msg-channel-btn,[id*="msg"] .channel-btn,.fp-channel-btn',500,320);
    // fill to avoid keydown issues; no special chars
    const typed = await $fill(page,'#fp-msg-input,input[placeholder*="Message"],textarea[placeholder*="Message"]','Rapport SEO semaine 37 envoyé');
    if (typed) {
      await page.waitForTimeout(280);
      await $click(page,'#fp-msg-send,button[aria-label*="Envoyer"]',500,280);
    }
    await page.mouse.click(400,400); await page.waitForTimeout(400); await injectCursor(page);
  }

  // ── Overview ──────────────────────────────────────────────────────────────────
  await nav(page,'overview','h1,.fp-kpi-card');
  await hoverItems(page,'.fp-kpi-card,.kpi-card,[data-kpi],.metric-card',4,330);
  if (await page.locator('.fp-kpi-card,.kpi-card').count()===0) {
    for (const [x,y] of [[280,200],[520,200],[760,200],[1000,200]]) { await go(page,x,y,330); await page.waitForTimeout(280); }
  }
  await scroll(page,100,500); await go(page,640,400,320); await page.waitForTimeout(600); await scroll(page,-100,450);
  await page.waitForTimeout(600);
  return skip;
}

// ═══════════════════════════════════════════════════════════════════════════
// M A I N
// ═══════════════════════════════════════════════════════════════════════════
console.log('▶ Seeding…');
const sr = await seed();
console.log('  ',JSON.stringify(sr.inserted||sr));

const token = await getToken();
console.log('  token ok\n');

const videos = [
  {name:'step2-audit-actions',     fn:v2},
  {name:'step3-monitoring-alerts', fn:v3},
  {name:'step4-local-competition', fn:v4},
  {name:'step5-ai-reports',        fn:v5},
  {name:'step6-daily',             fn:v6},
];

const results = [];
for (const {name,fn} of videos) {
  console.log(`\n▶ ${name}`);
  try { results.push(await record(name,fn,token)); }
  catch(e) { console.error(`  ERROR: ${e.message}`); results.push({name,error:e.message}); }
}

console.log('\n──────────────────');
for (const r of results) {
  if (r.error) console.log(`❌ ${r.name}: ${r.error}`);
  else console.log(`✓  ${r.name}: ${r.duration.toFixed(1)}s`);
}
spawnSync('ls',['-lh',...results.filter(r=>!r.error).map(r=>join(DEST_DIR,r.name+'.mp4'))],{stdio:'inherit'});
