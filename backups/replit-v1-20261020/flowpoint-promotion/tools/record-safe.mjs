/**
 * FlowPoint Onboarding — safe final recording
 *
 * Rules (hard):
 * 1. ZERO tab clicks — sidebar links match everything named "Performance","Incidents","Concurrents" etc.
 * 2. ZERO hover at y<160 on any x that might hit sidebar links or nav buttons
 * 3. Boot goes directly to target hash in the URL to avoid redirect traps
 * 4. 'reports' route shows Overview for QA — skip it; use AI tabs instead for V5
 * 5. 'missions' boot redirect: navigate to it via URL hash param directly
 * 6. Only window.navigate() for major section changes (proven working routes)
 * 7. Modals: + Nouveau / + Mission buttons → fill → Créer
 * 8. Use element.fill() for all text input — avoids ? shortcut
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE      = 'https://app.flowpoint.pro';
const ADMIN_KEY = process.env.ADMIN_KEY;
const QA_ORG   = '10000000-0000-4000-8000-000000000002';
const DEST_DIR = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';

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

const CSR = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

async function inj(p) {
  await p.evaluate(s => {
    document.getElementById('_fpa')?.remove();
    const w = document.createElement('div');
    w.id = '_fpa'; w.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML = s; document.body.appendChild(w);
    let cx=640,cy=360;
    document.addEventListener('mousemove',e=>{cx=e.clientX;cy=e.clientY;w.style.left=cx+'px';w.style.top=cy+'px'},{passive:true});
    window._cx=cx; window._cy=cy;
  }, CSR);
}

async function go(p, tx, ty, ms=420) {
  const {x,y} = await p.evaluate(()=>({x:window._cx||640,y:window._cy||360}));
  const n = Math.max(15,Math.round(ms/14));
  for (let i=1;i<=n;i++) {
    const t=i/n, e=t<.5?2*t*t:-1+(4-2*t)*t;
    await p.mouse.move(Math.round(x+(tx-x)*e),Math.round(y+(ty-y)*e));
    await p.waitForTimeout(14);
  }
  await p.evaluate(q=>{window._cx=q.x;window._cy=q.y;},{x:tx,y:ty});
}

async function sc(p,d,ms=500){const n=Math.max(6,Math.round(ms/30));for(let i=0;i<n;i++){await p.mouse.wheel(0,d/n);await p.waitForTimeout(30);}await p.waitForTimeout(100);}

// Safe hover: skip anything in sidebar (x < 170) or top nav (y < 55)
async function hov(p,sel,max=3,dw=300) {
  const it=p.locator(sel);
  const n=Math.min(await it.count(),max);
  for(let i=0;i<n;i++){
    const b=await it.nth(i).boundingBox().catch(()=>null);
    if(b&&b.x>170&&b.y>55&&b.width>40){await go(p,b.x+b.width/2,b.y+b.height/2,370);await p.waitForTimeout(dw);}
  }
}

// Click: only elements x>170,y>55 (not sidebar or top nav)
async function cl(p,sel,ams=600,mms=380) {
  try {
    const el=p.locator(sel).first();
    if(!await el.isVisible({timeout:3000}).catch(()=>false))return false;
    const b=await el.boundingBox();
    if(!b||b.x<170||b.y<55)return false;
    await go(p,b.x+b.width/2,b.y+b.height/2,mms);
    await p.waitForTimeout(80);
    await p.mouse.click(b.x+b.width/2,b.y+b.height/2);
    await p.waitForTimeout(ams);await inj(p);return true;
  }catch{return false;}
}

// Fill using element.fill() — bypasses all keydown handlers
async function fi(p,sel,text){
  try{
    const el=p.locator(sel).first();
    await el.waitFor({state:'visible',timeout:5000});
    const b=await el.boundingBox();if(!b)return false;
    await go(p,b.x+b.width/2,b.y+b.height/2,320);
    await el.click();await p.waitForTimeout(180);
    await el.fill(text);await p.waitForTimeout(200);return true;
  }catch{return false;}
}

// Navigate — never click sidebar links
async function nav(p,route,waitSel=null){
  await p.evaluate(r=>{if(window.navigate)window.navigate(r);else window.location.hash=r;},route);
  await p.waitForTimeout(2000);
  if(waitSel)await p.waitForSelector(waitSel,{timeout:7000}).catch(()=>{});
  await p.waitForTimeout(600);await inj(p);
  const h=await p.evaluate(()=>window.location.hash);
  console.log(`  nav('${route}') → '${h}'`);
}

function toMp4(webm,mp4,skipMs=0){
  const ss=Math.max(0,(skipMs-400)/1000);
  const a=['-y'];if(ss>0.5)a.push('-ss',ss.toFixed(2));
  a.push('-i',webm,'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',mp4);
  spawnSync('ffmpeg',a,{stdio:'pipe'});
}

// Boot: go directly to target URL with hash already set
async function boot(p,tok,hash) {
  const t0=Date.now();
  // Navigate directly with the hash to avoid redirect traps
  await p.goto(`${BASE}/dashboard.html#${hash}`,{waitUntil:'domcontentloaded',timeout:30000});
  try{await p.waitForFunction(()=>typeof window.STATE!=='undefined'&&window.STATE.loading===false,{timeout:25000,polling:300});}
  catch{await p.waitForSelector('h1,h2',{timeout:10000}).catch(()=>{});}
  await p.waitForTimeout(2500);
  // Dismiss onboarding
  for(const s of['button:has-text("Passer la visite")','button:has-text("Ignorer")','button:has-text("Skip")'
  ]){try{const b=p.locator(s).first();if(await b.isVisible({timeout:600}).catch(()=>false)){await b.click();await p.waitForTimeout(400);break;}}catch{}}
  // Ensure we're on the right section
  const h=await p.evaluate(()=>window.location.hash.replace('#',''));
  if(h!==hash&&h!==''){
    await p.evaluate(r=>{if(window.navigate)window.navigate(r);else window.location.hash=r;},hash);
    await p.waitForTimeout(2500);
  }
  await p.mouse.move(650,350);await p.evaluate(()=>{window._cx=650;window._cy=350;});await inj(p);
  return Date.now()-t0;
}

async function record(name,fn,hash){
  const OUT=`/tmp/fp-safe/${name}`;mkdirSync(OUT,{recursive:true});
  const tok=await getToken();
  const br=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
  const ctx=await br.newContext({viewport:{width:1280,height:720},recordVideo:{dir:OUT,size:{width:1280,height:720}},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0'});
  await ctx.addInitScript(t=>{try{sessionStorage.setItem('fp_session_token',t);}catch{}Object.defineProperty(navigator,'webdriver',{get:()=>undefined});},tok);
  const p=await ctx.newPage();
  let skip=0;
  try{skip=await fn(p,tok,hash);}
  finally{await p.close();await ctx.close();await br.close();}
  const files=readdirSync(OUT).filter(f=>f.endsWith('.webm'));
  if(!files.length)throw new Error('No webm: '+name);
  const mp4=join(OUT,`${name}.mp4`);
  toMp4(join(OUT,files[0]),mp4,skip);
  spawnSync('cp',[mp4,join(DEST_DIR,`${name}.mp4`)]);
  const dur=+spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4],{stdio:'pipe'}).stdout.toString().trim();
  console.log(`  ✓ ${name}.mp4  ${dur.toFixed(1)}s  (trimmed ${(skip/1000).toFixed(1)}s)`);
  // Extract 4 check frames
  for(const t of[1,10,20,Math.min(dur-2,30)]){
    const ti=Math.round(t);
    if(ti<dur)spawnSync('ffmpeg',['-y','-ss',String(ti),'-i',mp4,'-frames:v','1','-vf','scale=640:360',`/tmp/fp-safe/chk_${name}_t${ti}.jpg`],{stdio:'pipe'});
  }
  return dur;
}

// ──────────────────────────────────────────────────────────────────────────────
// V2 — Audits SEO → Missions (create) → Monitors (create) → Performance Web
// ──────────────────────────────────────────────────────────────────────────────
async function v2(p,tok,hash){
  const skip=await boot(p,tok,hash);
  // Hover Audits stat blocks (y≈170, safe zone x=250-780)
  for(const[x,y]of[[250,175],[480,175],[720,175]]){await go(p,x,y,300);await p.waitForTimeout(250);}
  // Hover table rows
  await hov(p,'table tbody tr,.audit-row',3,290);
  // Hover filter pills
  for(const[x,y]of[[165,307],[255,307],[355,307],[468,307]]){await go(p,x,y,260);await p.waitForTimeout(200);}
  // Type URL in inline audit input and click Lancer
  await fi(p,'input[placeholder*="monsite.fr"],.fp-audit-url-input,#fp-audit-url-input','https://boulangerie-artisanale.fr');
  // Find Lancer button NEAR the input (right of the input bar, x>800, y≈250)
  const lBtn=p.locator('button:has-text("+ Lancer"),button:has-text("Lancer"),button:has-text("Analyser")').first();
  if(await lBtn.isVisible({timeout:2000}).catch(()=>false)){
    const lb=await lBtn.boundingBox().catch(()=>null);
    if(lb&&lb.x>800){await go(p,lb.x+lb.width/2,lb.y+lb.height/2,300);await p.mouse.click(lb.x+lb.width/2,lb.y+lb.height/2);await p.waitForTimeout(700);await inj(p);}
  }
  await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(400);await inj(p);

  // Missions section
  await nav(p,'missions','table tbody tr,.mission-item');
  for(const[x,y]of[[250,168],[460,168],[660,168],[850,168]]){await go(p,x,y,290);await p.waitForTimeout(230);}
  await hov(p,'table tbody tr,.mission-item',3,300);
  // Create mission modal
  await cl(p,'#mission-quick-add-btn,button:has-text("+ Mission"),button:has-text("Mission")',600,370);
  await fi(p,'input[placeholder*="Titre"],input[placeholder*="Nom"],input[id*="mission"]','Optimiser les fiches GBP');
  await p.waitForTimeout(280);
  await cl(p,'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]',1200,310);
  await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(500);await inj(p);

  // Monitors section
  await nav(p,'monitors','table tbody tr,.monitor-card');
  for(const[x,y]of[[250,168],[450,168],[640,168],[840,168],[1040,168]]){await go(p,x,y,280);await p.waitForTimeout(220);}
  await hov(p,'table tbody tr,.monitor-card',3,290);
  // Create monitor modal
  await cl(p,'#monitor-new-btn,button:has-text("+ Nouveau"),button:has-text("Nouveau")',700,370);
  await fi(p,'input[id*="url"],input[placeholder*="https"],input[type="url"]','https://boulangerie-artisanale.fr');
  await p.waitForTimeout(280);
  await cl(p,'#nm-create,button:has-text("Créer le monitor"),button:has-text("Créer"),button[type="submit"]',1300,310);
  await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(500);await inj(p);

  // Performance Web / Core Web Vitals
  await nav(p,'performance-web','h1,h2');
  for(const[x,y]of[[360,205],[640,205],[900,205]]){await go(p,x,y,300);await p.waitForTimeout(240);}
  await sc(p,70,350);await go(p,640,360,290);await p.waitForTimeout(340);await sc(p,-70,300);
  // Fill PSI URL
  await fi(p,'#fp-psi-url-input,input[placeholder*="Entrez une URL"],input[placeholder*="exemple.com"],input[placeholder*="https://example"]','https://boulangerie-artisanale.fr');
  await p.waitForTimeout(300);
  // Analyser button — find it to the right of the URL input
  const ab=p.locator('button:has-text("Analyser"),button:has-text("Lancer l\'analyse")').first();
  if(await ab.isVisible({timeout:2000}).catch(()=>false)){
    const b=await ab.boundingBox().catch(()=>null);
    if(b&&b.x>400){await go(p,b.x+b.width/2,b.y+b.height/2,300);await p.mouse.click(b.x+b.width/2,b.y+b.height/2);await p.waitForTimeout(900);await inj(p);}
  }
  await go(p,640,380,330);await p.waitForTimeout(600);
  return skip;
}

// ──────────────────────────────────────────────────────────────────────────────
// V3 — Monitors (hover cards, scroll sections, create) → Alertes
// ──────────────────────────────────────────────────────────────────────────────
async function v3(p,tok,hash){
  const skip=await boot(p,tok,hash);
  await p.waitForSelector('table tbody tr,.monitor-card',{timeout:8000}).catch(()=>{});
  await p.waitForTimeout(400);
  const rows=await p.locator('table tbody tr,.monitor-card').count();
  console.log(`  [v3] rows: ${rows}`);
  // Hover stat blocks (safe coords x=210-1000, y=165-195)
  for(const[x,y]of[[215,172],[415,172],[620,172],[820,172],[1010,172]]){await go(p,x,y,310);await p.waitForTimeout(260);}
  // Hover each monitor card row
  await hov(p,'table tbody tr,.monitor-card,.monitor-row',3,370);
  // Hover right side (status badges, latency values)
  await go(p,960,230,320);await p.waitForTimeout(270);await go(p,960,300,280);await p.waitForTimeout(250);
  // Scroll down to reveal Timeline & SSL sections
  await sc(p,250,650);await go(p,400,440,320);await p.waitForTimeout(380);await go(p,800,440,280);await p.waitForTimeout(330);
  await sc(p,200,550);await go(p,640,470,280);await p.waitForTimeout,350;
  await sc(p,-450,700);await p.waitForTimeout(400);await inj(p);
  // Create new monitor
  await cl(p,'#monitor-new-btn,button:has-text("+ Nouveau"),button:has-text("Nouveau")',700,360);
  await fi(p,'input[id*="url"],input[placeholder*="https"],input[type="url"]','https://restaurant-chez-pierre.fr');
  await p.waitForTimeout(280);
  await cl(p,'#nm-create,button:has-text("Créer le monitor"),button:has-text("Créer"),button[type="submit"]',1300,310);
  await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(500);await inj(p);
  // Navigate to alerts-center
  await nav(p,'alerts-center','h1,h2');
  for(const[x,y]of[[215,205],[430,205],[640,205],[850,205]]){await go(p,x,y,310);await p.waitForTimeout(250);}
  await go(p,640,360,320);await p.waitForTimeout(380);
  await sc(p,200,500);await go(p,640,440,300);await p.waitForTimeout(420);await sc(p,-200,450);
  await p.waitForTimeout(500);
  return skip;
}

// ──────────────────────────────────────────────────────────────────────────────
// V4 — Local SEO (hover+scroll) → Concurrents (hover)
// ──────────────────────────────────────────────────────────────────────────────
async function v4(p,tok,hash){
  const skip=await boot(p,tok,hash);
  await p.waitForSelector('h1,h2',{timeout:6000}).catch(()=>{});
  await p.waitForTimeout(400);
  // Hover stat blocks (y≈185, safe zone x=215-880)
  for(const[x,y]of[[215,188],[445,188],[665,188],[880,188]]){await go(p,x,y,300);await p.waitForTimeout(250);}
  // Hover the blurred map area to show cursor action
  await go(p,640,310,320);await p.waitForTimeout(280);await go(p,500,350,270);await p.waitForTimeout(250);await go(p,780,330,260);await p.waitForTimeout(240);
  // Scroll down to see more content
  await sc(p,150,500);await go(p,640,400,300);await p.waitForTimeout(360);
  await sc(p,120,450);await go(p,640,450,270);await p.waitForTimeout(330);
  await sc(p,-270,600);await p.waitForTimeout(350);await inj(p);
  // Navigate to concurrents (via window.navigate — proven to work: hash='#concurrents')
  await nav(p,'concurrents','h1,h2');
  await p.waitForTimeout(300);
  for(const[x,y]of[[285,192],[545,192],[785,192],[1020,192]]){await go(p,x,y,300);await p.waitForTimeout(250);}
  await hov(p,'table tbody tr,.competitor-card,.competitor-row',3,360);
  await sc(p,100,480);await go(p,640,400,290);await p.waitForTimeout(380);
  await sc(p,100,420);await go(p,640,450,260);await p.waitForTimeout(320);
  await sc(p,-200,500);await p.waitForTimeout(350);
  return skip;
}

// ──────────────────────────────────────────────────────────────────────────────
// V5 — Assistant IA (fill + send + tabs) — no reports navigation (shows overview)
// ──────────────────────────────────────────────────────────────────────────────
async function v5(p,tok,hash){
  const skip=await boot(p,tok,hash);
  await p.waitForSelector('#ai-input,[id*="ai-input"],textarea[placeholder*="question"]',{timeout:8000}).catch(()=>{});
  await p.waitForTimeout(600);
  // Hover suggestion pills (y≈160-200, x>180)
  await hov(p,'.fp-suggestion-btn,[class*="suggestion"] button,[class*="quick"] button',4,260);
  // Fill and send AI question
  const aiSel='#ai-input,[id*="ai-input"],textarea[placeholder*="question"],textarea[id*="ai"],input[id*="ai"]';
  await fi(p,aiSel,'Quelles sont mes priorités SEO cette semaine');
  await p.waitForTimeout(350);
  // Click the send button — very strict: must be x>900 and y>600
  const sb=p.locator('#ai-send,button[aria-label*="Envoyer"],button:has-text("Envoyer"),.fp-send-btn').first();
  if(await sb.isVisible({timeout:2000}).catch(()=>false)){
    const b=await sb.boundingBox().catch(()=>null);
    if(b&&b.x>500){await go(p,b.x+b.width/2,b.y+b.height/2,280);await p.mouse.click(b.x+b.width/2,b.y+b.height/2);await p.waitForTimeout(500);await inj(p);}
  }
  // Wait for AI response
  await p.waitForFunction(()=>{
    const msgs=document.querySelectorAll('.fp-ai-bubble,.ai-msg,.assistant-msg,[data-role="assistant"],[class*="assistant"],[class*="message"]');
    return [...msgs].some(m=>m.textContent&&m.textContent.trim().length>30);
  },{timeout:18000,polling:600}).catch(()=>{});
  await p.waitForTimeout(700);await inj(p);
  // Scan the response
  await go(p,640,340,350);await p.waitForTimeout(460);
  await sc(p,100,480);await go(p,640,420,290);await p.waitForTimeout(440);
  await sc(p,80,400);await go(p,640,460,260);await p.waitForTimeout,370;
  await sc(p,-180,580);await p.waitForTimeout(400);
  // Hover AI sub-tabs (x>180, y in tab bar — but ONLY if they stay within AI section)
  // Use broad selector but verify x>170 via the cl() safety check
  for(const label of['AI Credits','Intelligence','Insights','Actions Rapides']){
    const tab=p.locator(`button:has-text("${label}"):not(aside button):not(nav button):not(a)`).first();
    if(await tab.isVisible({timeout:1200}).catch(()=>false)){
      const b=await tab.boundingBox().catch(()=>null);
      if(b&&b.x>170&&b.y>55){
        await go(p,b.x+b.width/2,b.y+b.height/2,330);
        await p.mouse.click(b.x+b.width/2,b.y+b.height/2);
        await p.waitForTimeout(700);await inj(p);
        // Check still on AI
        const h=await p.evaluate(()=>window.location.hash);
        if(!h.includes('ai')){await p.evaluate(()=>{if(window.navigate)window.navigate('ai');else window.location.hash='ai';});await p.waitForTimeout(1500);await inj(p);}
        await go(p,640,360,280);await p.waitForTimeout(320);
      }
    }
  }
  await go(p,640,380,330);await p.waitForTimeout(600);
  return skip;
}

// ──────────────────────────────────────────────────────────────────────────────
// V6 — Missions (create) → Activité → Notifs → Messages → Overview
// ──────────────────────────────────────────────────────────────────────────────
async function v6(p,tok,hash){
  // Boot directly to missions hash in URL
  const skip=await boot(p,tok,hash);
  // If overview, navigate to missions again (with extra wait)
  const h0=await p.evaluate(()=>window.location.hash);
  if(!h0.includes('mission')){
    await p.evaluate(()=>{if(window.navigate)window.navigate('missions');});
    await p.waitForTimeout(3000);
    await p.waitForFunction(s=>document.querySelectorAll(s).length>0,'table tbody tr,.mission-item',{timeout:8000,polling:400}).catch(()=>{});
    await p.waitForTimeout(600);await inj(p);
  }
  const h1=await p.evaluate(()=>window.location.hash);
  console.log(`  [v6] hash after nav: '${h1}'`);
  for(const[x,y]of[[250,168],[460,168],[660,168],[850,168]]){await go(p,x,y,290);await p.waitForTimeout(230);}
  await hov(p,'table tbody tr,.mission-item,.mission-row',3,360);
  // Create mission
  await cl(p,'#mission-quick-add-btn,button:has-text("+ Mission"),button:has-text("Créer une mission")',600,360);
  await fi(p,'input[placeholder*="Titre"],input[placeholder*="Nom"],input[id*="mission"]','Améliorer la page Contact');
  await p.waitForTimeout(280);
  await cl(p,'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]',1200,310);
  await p.keyboard.press('Escape').catch(()=>{});await p.waitForTimeout(500);await inj(p);
  // Activité
  if(await cl(p,'#fp-activity-btn',1000,400)){
    await go(p,1060,250,330);await p.waitForTimeout(320);await go(p,1060,330,280);await p.waitForTimeout(300);
    await go(p,1060,410,260);await p.waitForTimeout(300);
    await p.mouse.click(350,400);await p.waitForTimeout(400);await inj(p);
  }
  // Notifications
  if(await cl(p,'#fp-notif-btn',900,400)){
    await go(p,1000,240,320);await p.waitForTimeout(270);
    await hov(p,'#fp-notif-dropdown .fp-notif-item,.notification-item',3,270);
    await p.mouse.click(400,450);await p.waitForTimeout(400);await inj(p);
  }
  // Messages
  if(await cl(p,'#fp-msg-btn',900,400)){
    await cl(p,'#fp-msg-dropdown .fp-msg-channel-btn,.fp-channel-btn',500,300);
    await fi(p,'#fp-msg-input,input[placeholder*="Message"],textarea[placeholder*="Message"]','Rapport SEO semaine 37 envoyé');
    await p.waitForTimeout(280);
    await cl(p,'#fp-msg-send,button[aria-label*="Envoyer"]',500,260);
    await p.mouse.click(400,400);await p.waitForTimeout(400);await inj(p);
  }
  // Overview
  await nav(p,'overview','h1,.fp-kpi-card');
  await hov(p,'.fp-kpi-card,.kpi-card,[data-kpi]',4,310);
  for(const[x,y]of[[280,200],[520,200],[760,200],[1000,200]]){await go(p,x,y,300);await p.waitForTimeout(260);}
  await sc(p,100,480);await go(p,640,400,300);await p.waitForTimeout(560);await sc(p,-100,440);await p.waitForTimeout(600);
  return skip;
}

// ──────────────────────────────────────────────────────────────────────────────
// MAIN
// ──────────────────────────────────────────────────────────────────────────────
mkdirSync('/tmp/fp-safe',{recursive:true});

console.log('Seeding…');
await (async()=>{
  const r=await fetch(`${BASE}/api/admin/demo-seed`,{method:'POST',headers:{'x-admin-key':ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify({orgId:QA_ORG,clear:true})});
  const d=await r.json();console.log(' ',JSON.stringify(d.inserted||d));
})();

const videos=[
  {name:'step2-audit-actions',    fn:v2,hash:'audits'},
  {name:'step3-monitoring-alerts',fn:v3,hash:'monitors'},
  {name:'step4-local-competition',fn:v4,hash:'local-seo'},
  {name:'step5-ai-reports',       fn:v5,hash:'ai'},
  {name:'step6-daily',            fn:v6,hash:'missions'},
];

const results=[];
for(const{name,fn,hash}of videos){
  console.log(`\n▶ ${name}`);
  try{results.push({name,dur:await record(name,fn,hash)});}
  catch(e){console.error(`  ERROR: ${e.message}`);results.push({name,err:e.message});}
}
console.log('\n── Summary ──');
for(const r of results)console.log(r.err?`❌ ${r.name}: ${r.err}`:`✓  ${r.name}: ${r.dur.toFixed(1)}s`);
