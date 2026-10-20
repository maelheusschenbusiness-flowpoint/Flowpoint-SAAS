/**
 * Re-record V2 only — boot fix: explicit navigate + wait for section-specific selector
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE='https://app.flowpoint.pro';
const QA_ORG='10000000-0000-4000-8000-000000000002';
const DEST_DIR='/home/runner/workspace/artifacts/flowpoint-export/onboarding';
mkdirSync('/tmp/fp-v2b',{recursive:true});

const r=await fetch(BASE+'/api/admin/test-session',{method:'POST',headers:{'x-admin-key':process.env.ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify({orgId:QA_ORG,role:'admin',ttlMinutes:480})});
const {token}=await r.json();
console.log('token ok');

const CSR=`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
async function inj(p){await p.evaluate(s=>{document.getElementById('_fpa')?.remove();const w=document.createElement('div');w.id='_fpa';w.style.cssText='position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';w.innerHTML=s;document.body.appendChild(w);let cx=640,cy=360;document.addEventListener('mousemove',e=>{cx=e.clientX;cy=e.clientY;w.style.left=cx+'px';w.style.top=cy+'px'},{passive:true});window._cx=cx;window._cy=cy;},CSR);}
async function go(p,tx,ty,ms=420){const{x,y}=await p.evaluate(()=>({x:window._cx||640,y:window._cy||360}));const n=Math.max(15,Math.round(ms/14));for(let i=1;i<=n;i++){const t=i/n,e=t<.5?2*t*t:-1+(4-2*t)*t;await p.mouse.move(Math.round(x+(tx-x)*e),Math.round(y+(ty-y)*e));await p.waitForTimeout(14);}await p.evaluate(q=>{window._cx=q.x;window._cy=q.y;},{x:tx,y:ty});}
async function sc(p,d,ms=500){const n=Math.max(6,Math.round(ms/30));for(let i=0;i<n;i++){await p.mouse.wheel(0,d/n);await p.waitForTimeout(30);}await p.waitForTimeout(100);}
async function cl(p,sel,ams=600,mms=380){try{const el=p.locator(sel).first();if(!await el.isVisible({timeout:3000}).catch(()=>false))return false;const b=await el.boundingBox();if(!b||b.x<170||b.y<55)return false;await go(p,b.x+b.width/2,b.y+b.height/2,mms);await p.waitForTimeout(80);await p.mouse.click(b.x+b.width/2,b.y+b.height/2);await p.waitForTimeout(ams);await inj(p);return true;}catch{return false;}}
async function fi(p,sel,text){try{const el=p.locator(sel).first();await el.waitFor({state:'visible',timeout:5000});const b=await el.boundingBox();if(!b)return false;await go(p,b.x+b.width/2,b.y+b.height/2,300);await el.click();await p.waitForTimeout(180);await el.fill(text);await p.waitForTimeout(200);return true;}catch{return false;}}
async function hov(p,sel,max=3,dw=290){const it=p.locator(sel);const n=Math.min(await it.count(),max);for(let i=0;i<n;i++){const b=await it.nth(i).boundingBox().catch(()=>null);if(b&&b.x>170&&b.y>55&&b.width>40){await go(p,b.x+b.width/2,b.y+b.height/2,360);await p.waitForTimeout(dw);}}}
async function nav(p,route,waitSel=null){
  await p.evaluate(r=>{if(window.navigate)window.navigate(r);else window.location.hash=r;},route);
  await p.waitForTimeout(2000);
  if(waitSel)await p.waitForSelector(waitSel,{timeout:7000}).catch(()=>{});
  await p.waitForTimeout(600);await inj(p);
  console.log(`  nav('${route}') → '${await p.evaluate(()=>window.location.hash)}'`);
}

const tmp='/tmp/fp-v2b/t';mkdirSync(tmp,{recursive:true});
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:tmp,size:{width:1280,height:720}},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0'});
await ctx.addInitScript(tok=>{try{sessionStorage.setItem('fp_session_token',tok);}catch{}Object.defineProperty(navigator,'webdriver',{get:()=>undefined});},token);
const page=await ctx.newPage();
const t0=Date.now();

// Load dashboard, wait for STATE.loading
await page.goto(BASE+'/dashboard.html',{waitUntil:'domcontentloaded',timeout:30000});
try{await page.waitForFunction(()=>typeof window.STATE!=='undefined'&&window.STATE.loading===false,{timeout:25000,polling:300});}
catch{await page.waitForSelector('h1',{timeout:10000}).catch(()=>{});}
await page.waitForTimeout(1500);
// Dismiss onboarding
for(const s of['button:has-text("Passer la visite")','button:has-text("Ignorer")','button:has-text("Skip")'
]){try{const b=page.locator(s).first();if(await b.isVisible({timeout:600}).catch(()=>false)){await b.click();await page.waitForTimeout(400);break;}}catch{}}
// Navigate to audits + wait for audits-specific content to appear
await page.evaluate(()=>{if(window.navigate)window.navigate('audits');else window.location.hash='audits';});
// Wait for Audits SEO heading or the audit table to appear
await page.waitForSelector('h1:has-text("Audits"),h2:has-text("Audits"),table th,.fp-audit-table',{timeout:10000}).catch(()=>{});
await page.waitForTimeout(1200);
const skip=Date.now()-t0;
await page.mouse.move(650,360);await page.evaluate(()=>{window._cx=650;window._cy=360;});await inj(page);
console.log(`  boot done, skip=${(skip/1000).toFixed(1)}s, hash='${await page.evaluate(()=>window.location.hash)}'`);

// ── Audits SEO ────────────────────────────────────────────────────────────────
for(const[x,y]of[[250,175],[480,175],[710,175]]){await go(page,x,y,290);await page.waitForTimeout(230);}
await hov(page,'table tbody tr,.audit-row',3,280);
for(const[x,y]of[[165,307],[255,307],[355,307],[468,307]]){await go(page,x,y,240);await page.waitForTimeout(190);}
// Fill + Lancer audit URL
await fi(page,'input[placeholder*="monsite.fr"],.fp-audit-url-input,#fp-audit-url-input','https://boulangerie-artisanale.fr');
const lb=page.locator('button:has-text("+ Lancer"),button:has-text("Lancer"),button:has-text("Analyser")').first();
if(await lb.isVisible({timeout:2000}).catch(()=>false)){const b=await lb.boundingBox().catch(()=>null);if(b&&b.x>700){await go(page,b.x+b.width/2,b.y+b.height/2,280);await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await page.waitForTimeout(700);await inj(page);}}
await page.keyboard.press('Escape').catch(()=>{});await page.waitForTimeout(400);await inj(page);

// ── Missions ──────────────────────────────────────────────────────────────────
await nav(page,'missions','table tbody tr,.mission-item');
for(const[x,y]of[[250,168],[460,168],[660,168],[850,168]]){await go(page,x,y,280);await page.waitForTimeout(220);}
await hov(page,'table tbody tr,.mission-item',3,280);
await cl(page,'#mission-quick-add-btn,button:has-text("+ Mission"),button:has-text("Mission")',600,360);
await fi(page,'input[placeholder*="Titre"],input[placeholder*="Nom"],input[id*="mission"]','Optimiser les fiches GBP');
await page.waitForTimeout(260);
await cl(page,'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]',1200,300);
await page.keyboard.press('Escape').catch(()=>{});await page.waitForTimeout(500);await inj(page);

// ── Monitors ──────────────────────────────────────────────────────────────────
await nav(page,'monitors','table tbody tr,.monitor-card');
for(const[x,y]of[[250,168],[450,168],[640,168],[840,168],[1040,168]]){await go(page,x,y,270);await page.waitForTimeout(210);}
await hov(page,'table tbody tr,.monitor-card',3,280);
await cl(page,'#monitor-new-btn,button:has-text("+ Nouveau"),button:has-text("Nouveau")',700,360);
await fi(page,'input[id*="url"],input[placeholder*="https"],input[type="url"]','https://boulangerie-artisanale.fr');
await page.waitForTimeout(260);
await cl(page,'#nm-create,button:has-text("Créer le monitor"),button:has-text("Créer"),button[type="submit"]',1300,300);
await page.keyboard.press('Escape').catch(()=>{});await page.waitForTimeout(500);await inj(page);

// ── Performance Web ───────────────────────────────────────────────────────────
await nav(page,'performance-web','h1,h2');
for(const[x,y]of[[360,205],[640,205],[900,205]]){await go(page,x,y,280);await page.waitForTimeout(230);}
await sc(page,70,330);await go(page,640,360,270);await page.waitForTimeout,320;await sc(page,-70,290);
await fi(page,'#fp-psi-url-input,input[placeholder*="Entrez une URL"],input[placeholder*="exemple.com"],input[placeholder*="example"]','https://boulangerie-artisanale.fr');
await page.waitForTimeout(280);
const ab=page.locator('button:has-text("Analyser"),button:has-text("Lancer")').first();
if(await ab.isVisible({timeout:2000}).catch(()=>false)){const b=await ab.boundingBox().catch(()=>null);if(b&&b.x>400){await go(page,b.x+b.width/2,b.y+b.height/2,280);await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await page.waitForTimeout(900);await inj(page);}}
await go(page,640,380,300);await page.waitForTimeout(600);

await page.close();await ctx.close();await browser.close();

const files=readdirSync(tmp).filter(f=>f.endsWith('.webm'));
const mp4='/tmp/fp-v2b/step2-audit-actions.mp4';
const ss=Math.max(0,(skip-400)/1000);
const a=['-y'];if(ss>0.5)a.push('-ss',ss.toFixed(2));
a.push('-i',join(tmp,files[0]),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',mp4);
spawnSync('ffmpeg',a,{stdio:'pipe'});
spawnSync('cp',[mp4,DEST_DIR+'/step2-audit-actions.mp4']);
const dur=+spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4],{stdio:'pipe'}).stdout.toString().trim();
console.log(`✓ step2-audit-actions.mp4  ${dur.toFixed(1)}s  (trimmed ${(skip/1000).toFixed(1)}s)`);
for(const t of[1,8,20]){spawnSync('ffmpeg',['-y','-ss',String(t),'-i',mp4,'-frames:v','1','-vf','scale=640:360',`/tmp/vfs/chk_v2_t${t}.jpg`],{stdio:'pipe'});}
