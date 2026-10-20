import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const BASE='https://app.flowpoint.pro';
const QA_ORG='10000000-0000-4000-8000-000000000002';
const DEST_DIR='/home/runner/workspace/artifacts/flowpoint-export/onboarding';
mkdirSync('/tmp/fp-v3b/t',{recursive:true});
const {token}=await (await fetch(BASE+'/api/admin/test-session',{method:'POST',headers:{'x-admin-key':process.env.ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify({orgId:QA_ORG,role:'admin',ttlMinutes:480})})).json();
console.log('token ok');
const CSR=`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
async function inj(p){await p.evaluate(s=>{document.getElementById('_fpa')?.remove();const w=document.createElement('div');w.id='_fpa';w.style.cssText='position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';w.innerHTML=s;document.body.appendChild(w);let cx=640,cy=360;document.addEventListener('mousemove',e=>{cx=e.clientX;cy=e.clientY;w.style.left=cx+'px';w.style.top=cy+'px'},{passive:true});window._cx=cx;window._cy=cy;},CSR);}
async function go(p,tx,ty,ms=420){const{x,y}=await p.evaluate(()=>({x:window._cx||640,y:window._cy||360}));const n=Math.max(15,Math.round(ms/14));for(let i=1;i<=n;i++){const t=i/n,e=t<.5?2*t*t:-1+(4-2*t)*t;await p.mouse.move(Math.round(x+(tx-x)*e),Math.round(y+(ty-y)*e));await p.waitForTimeout(14);}await p.evaluate(q=>{window._cx=q.x;window._cy=q.y;},{x:tx,y:ty});}
async function sc(p,d,ms=500){const n=Math.max(6,Math.round(ms/30));for(let i=0;i<n;i++){await p.mouse.wheel(0,d/n);await p.waitForTimeout(30);}await p.waitForTimeout(100);}
async function cl(p,sel,ams=600,mms=380){try{const el=p.locator(sel).first();if(!await el.isVisible({timeout:3000}).catch(()=>false))return false;const b=await el.boundingBox();if(!b||b.x<170||b.y<55)return false;await go(p,b.x+b.width/2,b.y+b.height/2,mms);await p.waitForTimeout(80);await p.mouse.click(b.x+b.width/2,b.y+b.height/2);await p.waitForTimeout(ams);await inj(p);return true;}catch{return false;}}
async function fi(p,sel,text){try{const el=p.locator(sel).first();await el.waitFor({state:'visible',timeout:5000});const b=await el.boundingBox();if(!b)return false;await go(p,b.x+b.width/2,b.y+b.height/2,300);await el.click();await p.waitForTimeout(180);await el.fill(text);await p.waitForTimeout(200);return true;}catch{return false;}}
async function hov(p,sel,max=3,dw=290){const it=p.locator(sel);const n=Math.min(await it.count(),max);for(let i=0;i<n;i++){const b=await it.nth(i).boundingBox().catch(()=>null);if(b&&b.x>170&&b.y>55&&b.width>40){await go(p,b.x+b.width/2,b.y+b.height/2,360);await p.waitForTimeout(dw);}}}
async function nav(p,route,waitSel=null){await p.evaluate(r=>{if(window.navigate)window.navigate(r);else window.location.hash=r;},route);await p.waitForTimeout(2000);if(waitSel)await p.waitForSelector(waitSel,{timeout:7000}).catch(()=>{});await p.waitForTimeout(600);await inj(p);console.log(`  nav('${route}') → '${await p.evaluate(()=>window.location.hash)}'`);}

const tmp='/tmp/fp-v3b/t';
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:tmp,size:{width:1280,height:720}},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/128.0.0.0'});
await ctx.addInitScript(tok=>{try{sessionStorage.setItem('fp_session_token',tok);}catch{}Object.defineProperty(navigator,'webdriver',{get:()=>undefined});},token);
const page=await ctx.newPage();
const t0=Date.now();
await page.goto(BASE+'/dashboard.html',{waitUntil:'domcontentloaded',timeout:30000});
try{await page.waitForFunction(()=>typeof window.STATE!=='undefined'&&window.STATE.loading===false,{timeout:25000,polling:300});}
catch{await page.waitForSelector('h1',{timeout:10000}).catch(()=>{});}
await page.waitForTimeout(1500);
for(const s of['button:has-text("Passer la visite")','button:has-text("Ignorer")','button:has-text("Skip")'
]){try{const b=page.locator(s).first();if(await b.isVisible({timeout:600}).catch(()=>false)){await b.click();await page.waitForTimeout(400);break;}}catch{}}
// Navigate to monitors and wait for actual monitor content
await page.evaluate(()=>{if(window.navigate)window.navigate('monitors');});
await page.waitForFunction(()=>document.querySelectorAll('table tbody tr,.monitor-card').length>0,{timeout:10000,polling:400}).catch(()=>{});
await page.waitForTimeout(1200);
const skip=Date.now()-t0;
await page.mouse.move(650,360);await page.evaluate(()=>{window._cx=650;window._cy=360;});await inj(page);
const rows0=await page.locator('table tbody tr,.monitor-card').count();
console.log(`  boot skip=${(skip/1000).toFixed(1)}s rows=${rows0} hash='${await page.evaluate(()=>window.location.hash)}'`);

// Hover stat blocks
for(const[x,y]of[[215,172],[415,172],[620,172],[820,172],[1010,172]]){await go(page,x,y,290);await page.waitForTimeout(240);}
// Hover monitor cards/rows
await hov(page,'table tbody tr,.monitor-card,.monitor-row',3,360);
// Hover latency + status area
await go(page,960,230,300);await page.waitForTimeout,260;await go(page,960,300,270);await page.waitForTimeout(250);
// Scroll to reveal more sections
await sc(page,250,620);await go(page,400,440,300);await page.waitForTimeout(360);await go(page,800,440,260);await page.waitForTimeout(310);
await sc(page,200,520);await go(page,640,460,260);await page.waitForTimeout,330;
await sc(page,-450,680);await page.waitForTimeout(400);await inj(page);
// Create monitor
await cl(page,'#monitor-new-btn,button:has-text("+ Nouveau"),button:has-text("Nouveau")',700,350);
await fi(page,'input[id*="url"],input[placeholder*="https"],input[type="url"]','https://restaurant-chez-pierre.fr');
await page.waitForTimeout(260);
await cl(page,'#nm-create,button:has-text("Créer le monitor"),button:has-text("Créer"),button[type="submit"]',1300,300);
await page.keyboard.press('Escape').catch(()=>{});await page.waitForTimeout(500);await inj(page);
// Alerts
await nav(page,'alerts-center','h1,h2');
for(const[x,y]of[[215,205],[430,205],[640,205],[850,205]]){await go(page,x,y,290);await page.waitForTimeout(240);}
await sc(page,200,500);await go(page,640,440,280);await page.waitForTimeout,400;await sc(page,-200,440);await page.waitForTimeout(500);

await page.close();await ctx.close();await browser.close();
const files=readdirSync(tmp).filter(f=>f.endsWith('.webm'));
const mp4='/tmp/fp-v3b/step3-monitoring-alerts.mp4';
const ss=Math.max(0,(skip-400)/1000);
const a=['-y'];if(ss>0.5)a.push('-ss',ss.toFixed(2));
a.push('-i',join(tmp,files[0]),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',mp4);
spawnSync('ffmpeg',a,{stdio:'pipe'});
spawnSync('cp',[mp4,DEST_DIR+'/step3-monitoring-alerts.mp4']);
const dur=+spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4],{stdio:'pipe'}).stdout.toString().trim();
console.log(`✓ step3-monitoring-alerts.mp4  ${dur.toFixed(1)}s  (trimmed ${(skip/1000).toFixed(1)}s)`);
for(const t of[1,8,18]){spawnSync('ffmpeg',['-y','-ss',String(t),'-i',mp4,'-frames:v','1','-vf','scale=640:360',`/tmp/vfs/chk_v3_t${t}.jpg`],{stdio:'pipe'});}
