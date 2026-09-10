import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const BASE='https://app.flowpoint.pro';
const QA_ORG='10000000-0000-4000-8000-000000000002';
const DEST_DIR='/home/runner/workspace/artifacts/flowpoint-export/onboarding';
mkdirSync('/tmp/fp-v5b/t',{recursive:true});
const {token}=await (await fetch(BASE+'/api/admin/test-session',{method:'POST',headers:{'x-admin-key':process.env.ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify({orgId:QA_ORG,role:'admin',ttlMinutes:480})})).json();
console.log('token ok');
const CSR=`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
async function inj(p){await p.evaluate(s=>{document.getElementById('_fpa')?.remove();const w=document.createElement('div');w.id='_fpa';w.style.cssText='position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';w.innerHTML=s;document.body.appendChild(w);let cx=640,cy=360;document.addEventListener('mousemove',e=>{cx=e.clientX;cy=e.clientY;w.style.left=cx+'px';w.style.top=cy+'px'},{passive:true});window._cx=cx;window._cy=cy;},CSR);}
async function go(p,tx,ty,ms=420){const{x,y}=await p.evaluate(()=>({x:window._cx||640,y:window._cy||360}));const n=Math.max(15,Math.round(ms/14));for(let i=1;i<=n;i++){const t=i/n,e=t<.5?2*t*t:-1+(4-2*t)*t;await p.mouse.move(Math.round(x+(tx-x)*e),Math.round(y+(ty-y)*e));await p.waitForTimeout(14);}await p.evaluate(q=>{window._cx=q.x;window._cy=q.y;},{x:tx,y:ty});}
async function sc(p,d,ms=500){const n=Math.max(6,Math.round(ms/30));for(let i=0;i<n;i++){await p.mouse.wheel(0,d/n);await p.waitForTimeout(30);}await p.waitForTimeout(100);}
async function fi(p,sel,text){try{const el=p.locator(sel).first();await el.waitFor({state:'visible',timeout:5000});const b=await el.boundingBox();if(!b)return false;await go(p,b.x+b.width/2,b.y+b.height/2,300);await el.click();await p.waitForTimeout(180);await el.fill(text);await p.waitForTimeout(200);return true;}catch{return false;}}
async function hov(p,sel,max=3,dw=290){const it=p.locator(sel);const n=Math.min(await it.count(),max);for(let i=0;i<n;i++){const b=await it.nth(i).boundingBox().catch(()=>null);if(b&&b.x>170&&b.y>55&&b.width>40){await go(p,b.x+b.width/2,b.y+b.height/2,360);await p.waitForTimeout(dw);}}}

const tmp='/tmp/fp-v5b/t';
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
// Navigate to AI and wait for the AI input field to appear
await page.evaluate(()=>{if(window.navigate)window.navigate('ai');});
await page.waitForSelector('#ai-input,[id*="ai-input"],textarea[placeholder*="question"],.fp-ai-input',{timeout:10000}).catch(()=>{});
await page.waitForTimeout(1200);
const skip=Date.now()-t0;
await page.mouse.move(650,360);await page.evaluate(()=>{window._cx=650;window._cy=360;});await inj(page);
console.log(`  boot skip=${(skip/1000).toFixed(1)}s hash='${await page.evaluate(()=>window.location.hash)}'`);

// Hover suggestion buttons
await hov(page,'.fp-suggestion-btn,[class*="suggestion"] button,[class*="quick"] button',4,240);
// Fill question (no ?)
const aiSel='#ai-input,[id*="ai-input"],textarea[placeholder*="question"],textarea[id*="ai"]';
await fi(page,aiSel,'Quelles sont mes priorités SEO cette semaine');
await page.waitForTimeout(340);
// Click send — must be x>500,y>55
const sb=page.locator('#ai-send,button[aria-label*="Envoyer"],button:has-text("Envoyer"),.fp-send-btn').first();
if(await sb.isVisible({timeout:2000}).catch(()=>false)){
  const b=await sb.boundingBox().catch(()=>null);
  if(b&&b.x>500){await go(page,b.x+b.width/2,b.y+b.height/2,260);await page.mouse.click(b.x+b.width/2,b.y+b.height/2);await page.waitForTimeout(500);await inj(page);}
}
// Wait for AI response (up to 18s)
await page.waitForFunction(()=>{
  const msgs=document.querySelectorAll('.fp-ai-bubble,.ai-msg,.assistant-msg,[data-role="assistant"],[class*="assistant"],[class*="message"]');
  return [...msgs].some(m=>m.textContent&&m.textContent.trim().length>40);
},{timeout:18000,polling:500}).catch(()=>{});
await page.waitForTimeout(700);await inj(page);
// Scroll through response
await go(page,640,340,330);await page.waitForTimeout(440);
await sc(page,100,470);await go(page,640,420,270);await page.waitForTimeout,420;
await sc(page,80,400);await go(page,640,460,250);await page.waitForTimeout,360;
await sc(page,-180,560);await page.waitForTimeout(400);
// AI sub-tabs (safe: x>170, y>55, not sidebar)
for(const label of['AI Credits','Intelligence','Insights','Actions Rapides']){
  const tab=page.locator(`button:has-text("${label}")`).first();
  if(await tab.isVisible({timeout:1000}).catch(()=>false)){
    const b=await tab.boundingBox().catch(()=>null);
    if(b&&b.x>170&&b.y>55&&b.x<1200){
      await go(page,b.x+b.width/2,b.y+b.height/2,310);
      await page.mouse.click(b.x+b.width/2,b.y+b.height/2);
      await page.waitForTimeout(650);await inj(page);
      // Bail if navigated away from AI
      const h=await page.evaluate(()=>window.location.hash);
      if(!h.includes('ai')){console.log(`  ⚠ tab ${label} navigated to ${h}`);await page.evaluate(()=>{if(window.navigate)window.navigate('ai');});await page.waitForTimeout(1400);await inj(page);}
      await go(page,640,360,260);await page.waitForTimeout(300);
    }
  }
}
await go(page,640,380,300);await page.waitForTimeout(600);

await page.close();await ctx.close();await browser.close();
const files=readdirSync(tmp).filter(f=>f.endsWith('.webm'));
const mp4='/tmp/fp-v5b/step5-ai-reports.mp4';
const ss=Math.max(0,(skip-400)/1000);
const a=['-y'];if(ss>0.5)a.push('-ss',ss.toFixed(2));
a.push('-i',join(tmp,files[0]),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',mp4);
spawnSync('ffmpeg',a,{stdio:'pipe'});
spawnSync('cp',[mp4,DEST_DIR+'/step5-ai-reports.mp4']);
const dur=+spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4],{stdio:'pipe'}).stdout.toString().trim();
console.log(`✓ step5-ai-reports.mp4  ${dur.toFixed(1)}s  (trimmed ${(skip/1000).toFixed(1)}s)`);
for(const t of[1,8,18]){spawnSync('ffmpeg',['-y','-ss',String(t),'-i',mp4,'-frames:v','1','-vf','scale=640:360',`/tmp/vfs/chk_v5_t${t}.jpg`],{stdio:'pipe'});}
