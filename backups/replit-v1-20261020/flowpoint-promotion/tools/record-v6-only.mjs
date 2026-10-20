/**
 * FlowPoint — V6 only (fast, ≤ 60s scenario)
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE   = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const DEST   = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';
const TMP    = '/tmp/fp-v6only';
mkdirSync(TMP, { recursive: true });

async function getToken() {
  const r = await fetch(`${BASE}/api/admin/test-session`, {
    method: 'POST',
    headers: { 'x-admin-key': process.env.ADMIN_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 480 }),
  });
  const d = await r.json();
  if (!d.ok || !d.token) throw new Error('token: ' + JSON.stringify(d));
  return d.token;
}

const CSR = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
async function inj(p) {
  await p.evaluate(s => {
    document.getElementById('_fpa')?.remove();
    const w = document.createElement('div'); w.id = '_fpa';
    w.style.cssText = 'position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML = s; document.body.appendChild(w);
    let cx=660,cy=360;
    document.addEventListener('mousemove',e=>{cx=e.clientX;cy=e.clientY;w.style.left=cx+'px';w.style.top=cy+'px'},{passive:true});
    window._cx=cx;window._cy=cy;
  }, CSR);
}

async function go(p, tx, ty, ms=400) {
  const {x,y} = await p.evaluate(()=>({x:window._cx||660,y:window._cy||360}));
  const n = Math.max(12,Math.round(ms/14));
  for(let i=1;i<=n;i++){const t=i/n,e=t<.5?2*t*t:-1+(4-2*t)*t;await p.mouse.move(Math.round(x+(tx-x)*e),Math.round(y+(ty-y)*e));await p.waitForTimeout(14);}
  await p.evaluate(q=>{window._cx=q.x;window._cy=q.y;},{x:tx,y:ty});
}

async function sc(p,d,ms=400){const n=Math.max(5,Math.round(ms/30));for(let i=0;i<n;i++){await p.mouse.wheel(0,d/n);await p.waitForTimeout(30);}await p.waitForTimeout(80);}

async function cl(p,sel,ams=500,mms=340){
  try{
    const el=p.locator(sel).first();
    if(!await el.isVisible({timeout:3500}).catch(()=>false))return false;
    const b=await el.boundingBox();
    if(!b||b.x<155||b.y<56)return false;
    await go(p,b.x+b.width/2,b.y+b.height/2,mms);
    await p.waitForTimeout(65);await p.mouse.click(b.x+b.width/2,b.y+b.height/2);
    await p.waitForTimeout(ams);await inj(p);return true;
  }catch{return false;}
}

async function fi(p,sel,text){
  try{
    const el=p.locator(sel).first();
    await el.waitFor({state:'visible',timeout:4000});
    const b=await el.boundingBox();if(!b||b.x<155)return false;
    await go(p,b.x+b.width/2,b.y+b.height/2,280);
    await el.click();await p.waitForTimeout(150);await el.fill(text);await p.waitForTimeout(160);return true;
  }catch{return false;}
}

async function hov(p,sel,max=3,dw=280){
  const it=p.locator(sel);const n=Math.min(await it.count().catch(()=>0),max);
  for(let i=0;i<n;i++){const b=await it.nth(i).boundingBox().catch(()=>null);if(b&&b.x>155&&b.y>56&&b.width>40){await go(p,b.x+b.width/2,b.y+b.height/2,340);await p.waitForTimeout(dw);}}
}

async function nav(p,route){
  await p.evaluate(r=>{if(window.navigate)window.navigate(r);else window.location.hash=r;},route);
  await p.waitForTimeout(1800);await inj(p);
}

const tok = await getToken();
const outDir = join(TMP, 'vid');
mkdirSync(outDir, {recursive:true});
const browser = await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx = await browser.newContext({
  viewport:{width:1280,height:720},
  recordVideo:{dir:outDir,size:{width:1280,height:720}},
  userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
});
await ctx.addInitScript(t=>{try{sessionStorage.setItem('fp_session_token',t);}catch{}Object.defineProperty(navigator,'webdriver',{get:()=>undefined});},tok);
const p = await ctx.newPage();

// BOOT — missions
const t0 = Date.now();
await p.goto(`${BASE}/dashboard.html#missions`,{waitUntil:'domcontentloaded',timeout:30000});
try{await p.waitForFunction(()=>typeof window.STATE!=='undefined'&&window.STATE.loading===false,{timeout:26000,polling:300});}
catch{await p.waitForSelector('.fp-card,h1',{timeout:8000}).catch(()=>{});}
await p.waitForTimeout(2200);
for(const s of['button:has-text("Passer la visite")','button:has-text("Ignorer")']){
  try{const b=p.locator(s).first();if(await b.isVisible({timeout:500}).catch(()=>false)){await b.click();await p.waitForTimeout(400);break;}}catch{}
}
const h=await p.evaluate(()=>window.location.hash.replace('#',''));
if(h!=='missions'){await p.evaluate(()=>{if(window.navigate)window.navigate('missions');else window.location.hash='missions';});await p.waitForTimeout(2000);}
await p.mouse.move(660,360);await p.evaluate(()=>{window._cx=660;window._cy=360;});await inj(p);
const skipMs = Date.now() - t0;
console.log(`boot ${skipMs}ms`);

// ── SCENARIO ───────────────────────────────────────────────────────────────

// Hover mission items (safe: real data visible at t=1 from V6 frame)
await hov(p,'table tbody tr,.mission-item,.fp-mission-card,.fp-card',3,340);
await p.waitForTimeout(300);

// Open first mission
const firstRow = await p.locator('table tbody tr,.mission-item,.fp-mission-card').first().boundingBox().catch(()=>null);
if(firstRow&&firstRow.x>155&&firstRow.y>56){
  await go(p,firstRow.x+firstRow.width/2,firstRow.y+firstRow.height/2,380);
  await p.waitForTimeout(70);
  await p.mouse.click(firstRow.x+firstRow.width/2,firstRow.y+firstRow.height/2);
  await p.waitForTimeout(900);await inj(p);
  await hov(p,'.fp-badge,.fp-stat,.fp-priority,.fp-status-badge',2,280);
  await sc(p,70,350);await p.waitForTimeout(280);await sc(p,-70,320);
  await p.keyboard.press('Escape').catch(()=>{});
  await p.waitForTimeout(450);await inj(p);
}

// Tab navigation: Kanban, À faire, En cours
await cl(p,'[role="tab"]:has-text("Kanban"),button:has-text("Kanban")',500,300);
await p.waitForTimeout(300);
await hov(p,'.fp-kanban-col,.fp-kanban-card,.fp-card',2,280);
await cl(p,'[role="tab"]:has-text("Toutes"),button:has-text("Toutes")',400,280);
await p.waitForTimeout(300);

// Stat blocks — safe y≥230
for(const [x,y] of [[265,230],[490,230],[720,230],[945,230]]){
  await go(p,x,y,270);await p.waitForTimeout(220);
}

// Navigate to overview for a view with real monitors data
await nav(p,'overview');
await hov(p,'.fp-kpi-card,.kpi-card,.fp-stat-card,.fp-stat',3,280);
for(const [x,y] of [[280,230],[520,230],[760,230],[1000,230]]){
  await go(p,x,y,270);await p.waitForTimeout(210);
}
await sc(p,120,450);await p.waitForTimeout(320);
await hov(p,'.fp-card',2,260);

// Navigate back to missions and create a mission
await nav(p,'missions');
await p.waitForTimeout(300);
const newMBtn = await p.locator('button:has-text("+ Mission"),button:has-text("Nouvelle mission"),#mission-new-btn').first().boundingBox().catch(()=>null);
if(newMBtn&&newMBtn.x>155&&newMBtn.y>56){
  await go(p,newMBtn.x+newMBtn.width/2,newMBtn.y+newMBtn.height/2,360);
  await p.waitForTimeout(65);
  await p.mouse.click(newMBtn.x+newMBtn.width/2,newMBtn.y+newMBtn.height/2);
  await p.waitForTimeout(700);await inj(p);
  const filled = await fi(p,'input[placeholder*="Titre"],input[placeholder*="titre"],input[name="title"]','Améliorer vitesse page accueil');
  if(!filled) await fi(p,'input[type="text"]:visible','Améliorer vitesse page accueil');
  await p.waitForTimeout(260);
  await cl(p,'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]',1100,330);
  await p.waitForTimeout(350);
  await p.keyboard.press('Escape').catch(()=>{});
  await p.waitForTimeout(400);await inj(p);
}

// Final hover on missions list
await hov(p,'table tbody tr,.mission-item,.fp-mission-card',2,280);
await sc(p,80,380);await p.waitForTimeout(280);await sc(p,-80,350);
await p.waitForTimeout(350);

// ── WRAP UP ────────────────────────────────────────────────────────────────
await p.close();await ctx.close();await browser.close();

const files=readdirSync(outDir).filter(f=>f.endsWith('.webm'));
if(!files.length)throw new Error('No webm');
const mp4=join(outDir,'v6.mp4');
const ss=Math.max(0,(skipMs-500)/1000);
const args=['-y'];if(ss>0.3)args.push('-ss',ss.toFixed(2));
args.push('-i',join(outDir,files[0]),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',mp4);
spawnSync('ffmpeg',args,{stdio:'pipe'});
spawnSync('cp',[mp4,join(DEST,'step6-daily.mp4')]);
const dur=parseFloat(spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4],{stdio:'pipe'}).stdout.toString())||0;
console.log(`✓ step6-daily.mp4  ${dur.toFixed(1)}s  (trimmed ${(skipMs/1000).toFixed(1)}s)`);
for(const t of[1,Math.floor(dur/3),Math.floor(2*dur/3),Math.max(1,Math.floor(dur)-2)]){
  spawnSync('ffmpeg',['-y','-ss',String(t),'-i',mp4,'-frames:v','1','-vf','scale=640:360',`/tmp/fp-v6only/chk_t${t}.jpg`],{stdio:'pipe'});
}
console.log('frames done');
