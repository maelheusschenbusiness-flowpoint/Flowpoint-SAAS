/**
 * V6 final — Utilisation quotidienne: mission + Activité + Notifs + Messages + Recherche + Overview
 * Fix: pas de status change (cause overview), header buttons via JS plus tôt, timing serré
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-fv6'; mkdirSync(TMP, { recursive: true });
const DEST = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';

const r = await fetch(BASE+'/api/admin/test-session',{
  method:'POST',headers:{'x-admin-key':process.env.ADMIN_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({orgId:QA_ORG,role:'admin',ttlMinutes:480}),
});
const {token}=await r.json();
if(!token)throw new Error('No token');

const CSR=`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
async function inj(p){
  await p.evaluate(s=>{
    document.getElementById('_fpa')?.remove();const w=document.createElement('div');w.id='_fpa';
    w.style.cssText='position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML=s;document.body.appendChild(w);let cx=640,cy=360;
    document.addEventListener('mousemove',e=>{cx=e.clientX;cy=e.clientY;w.style.left=cx+'px';w.style.top=cy+'px';},{passive:true});
    window._cx=cx;window._cy=cy;
  },CSR);
}
async function go(p,tx,ty,ms=380){
  const {x,y}=await p.evaluate(()=>({x:window._cx||640,y:window._cy||360}));
  const n=Math.max(14,Math.round(ms/14));
  for(let i=1;i<=n;i++){const t=i/n,e=t<.5?2*t*t:-1+(4-2*t)*t;await p.mouse.move(Math.round(x+(tx-x)*e),Math.round(y+(ty-y)*e));await p.waitForTimeout(14);}
  await p.evaluate(q=>{window._cx=q.x;window._cy=q.y;},{x:tx,y:ty});
}
async function sidebarNav(p,route){
  await p.evaluate(r=>{const el=document.querySelector(`.fp-nav-item[data-route="${r}"]`);if(el)el.click();else if(window.navigate)window.navigate(r);},route);
  await p.waitForFunction(r=>window.STATE?.route===r,route,{timeout:8000,polling:200}).catch(()=>{});
  await p.waitForTimeout(500);
}
async function cl(p,s,ams=450,mms=300){
  try{
    const el=p.locator(s).first();if(!await el.isVisible({timeout:4000}).catch(()=>false))return false;
    const b=await el.boundingBox();if(!b||b.x<150)return false;
    await go(p,b.x+b.width/2,b.y+b.height/2,mms);await p.waitForTimeout(60);
    await p.mouse.click(b.x+b.width/2,b.y+b.height/2);await p.waitForTimeout(ams);await inj(p);return true;
  }catch{return false;}
}
async function fi(p,s,t){
  try{
    const el=p.locator(s).first();await el.waitFor({state:'visible',timeout:5000});
    const b=await el.boundingBox();if(!b)return false;
    await go(p,b.x+b.width/2,b.y+b.height/2,240);await el.click();await p.waitForTimeout(120);await el.fill(t);await p.waitForTimeout(150);return true;
  }catch{return false;}
}
async function hov(p,s,max=3,d=260){
  const it=p.locator(s);const n=Math.min(await it.count(),max);
  for(let i=0;i<n;i++){const b=await it.nth(i).boundingBox().catch(()=>null);if(b&&b.x>150){await go(p,b.x+b.width/2,b.y+b.height/2,270);await p.waitForTimeout(d);}}
}
// Click header button by ID via JS — bypasses coordinate-based safe zones entirely
async function hdrBtn(p,id,waitMs=850){
  const ok=await p.evaluate(bid=>{const el=document.getElementById(bid);if(el){el.click();return true;}return false;},id);
  if(ok)await p.waitForTimeout(waitMs);
  await inj(p);return ok;
}

const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({
  viewport:{width:1280,height:720},recordVideo:{dir:TMP,size:{width:1280,height:720}},
  userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
});
await ctx.addInitScript(tok=>{
  try{sessionStorage.setItem('fp_session_token',tok);}catch{}
  try{sessionStorage.setItem('fp_last_route','missions');}catch{}
},token);
const page=await ctx.newPage();
const t0=Date.now();

await page.goto(BASE+'/dashboard.html#missions',{waitUntil:'domcontentloaded',timeout:30000});
try{await page.waitForFunction(()=>window.STATE?.loading===false,{timeout:25000,polling:300});}catch{await page.waitForTimeout(3000);}
for(const s of['button:has-text("Passer la visite")','button:has-text("Ignorer")'
]){try{const b=page.locator(s).first();if(await b.isVisible({timeout:400}).catch(()=>false)){await b.click();await page.waitForTimeout(250);}}catch{}}

await sidebarNav(page,'missions');
await page.waitForFunction(()=>document.querySelectorAll('table tbody tr,.fp-mission-row,.mission-item').length>0,{timeout:8000,polling:300}).catch(()=>{});
await page.waitForTimeout(500);
const skip=Date.now()-t0;

await page.mouse.move(640,360);await page.evaluate(()=>{window._cx=640;window._cy=360;});await inj(page);

// === 1. MISSIONS — hover stat blocs + rows ===
for(const[x,y]of[[220,165],[430,165],[630,165],[820,165]]){await go(page,x,y,280);await page.waitForTimeout(230);}
await hov(page,'table tbody tr,.fp-mission-row,.mission-item',3,270);

// === 2. Open mission detail ===
const mrows=page.locator('table tbody tr,.fp-mission-row,.mission-item');
if(await mrows.count()>0){
  const mb=await mrows.first().boundingBox().catch(()=>null);
  if(mb&&mb.x>150){
    await go(page,mb.x+mb.width*0.4,mb.y+mb.height/2,280);
    await page.waitForTimeout(80);
    await page.mouse.click(mb.x+mb.width*0.4,mb.y+mb.height/2);
    await page.waitForTimeout(1100);await inj(page);
  }
}

// Show mission panel briefly — hover elements inside
const panel=page.locator('.fp-float-panel').first();
const pb=await panel.boundingBox().catch(()=>null);
if(pb){
  await go(page,pb.x+pb.width*0.4,pb.y+90,240);await page.waitForTimeout(350);
  await go(page,pb.x+pb.width*0.7,pb.y+120,230);await page.waitForTimeout(350);
}
// Close panel — no status change (triggers navigate)
await page.keyboard.press('Escape').catch(()=>{});
await page.waitForTimeout(400);
await inj(page);

// === 3. ACTIVITÉ via JS click on header button ===
const actOpened=await hdrBtn(page,'fp-activity-btn',1000);
if(actOpened){
  // Move cursor into activity panel
  const actPanel=page.locator('#fp-activity-panel,.fp-activity-panel,.fp-activity-dropdown').first();
  const ap=await actPanel.boundingBox().catch(()=>null);
  if(ap){
    await go(page,ap.x+ap.width/2,ap.y+60,270);await page.waitForTimeout(350);
    // Hover real activity items (Monitor DOWN, Audit terminé, etc.)
    const actItems=page.locator('.fp-activity-item,.fp-activity-row');
    const aiCnt=Math.min(await actItems.count(),4);
    for(let i=0;i<aiCnt;i++){
      const b=await actItems.nth(i).boundingBox().catch(()=>null);
      if(b&&b.x>150){await go(page,b.x+b.width/2,b.y+b.height/2,260);await page.waitForTimeout(280);}
    }
    await page.waitForTimeout(350);
  }
  await page.mouse.click(400,450);await page.waitForTimeout(450);await inj(page);
}

// === 4. NOTIFICATIONS via JS click ===
const notifOpened=await hdrBtn(page,'fp-notif-btn',900);
if(notifOpened){
  const notifDrop=page.locator('#fp-notif-dropdown,.fp-notif-dropdown').first();
  const nd=await notifDrop.boundingBox().catch(()=>null);
  if(nd){
    await go(page,nd.x+nd.width/2,nd.y+50,260);await page.waitForTimeout(350);
    const notifItems=page.locator('.fp-notif-item,.notification-item');
    const niCnt=Math.min(await notifItems.count(),3);
    for(let i=0;i<niCnt;i++){
      const b=await notifItems.nth(i).boundingBox().catch(()=>null);
      if(b&&b.x>150){await go(page,b.x+b.width/2,b.y+b.height/2,250);await page.waitForTimeout(270);}
    }
    // Click first notification to open it
    if(niCnt>0){
      const nb=await notifItems.first().boundingBox().catch(()=>null);
      if(nb&&nb.x>150){
        await go(page,nb.x+nb.width/2,nb.y+nb.height/2,230);await page.waitForTimeout(160);
        await page.mouse.click(nb.x+nb.width/2,nb.y+nb.height/2);await page.waitForTimeout(600);await inj(page);
      }
    }
  }
  await page.mouse.click(400,450);await page.waitForTimeout(400);await inj(page);
}

// === 5. MESSAGES via JS click ===
const msgOpened=await hdrBtn(page,'fp-msg-btn',900);
if(msgOpened){
  const msgDrop=page.locator('#fp-msg-dropdown,.fp-msg-dropdown').first();
  const md=await msgDrop.boundingBox().catch(()=>null);
  if(md){
    await go(page,md.x+md.width/2,md.y+60,260);await page.waitForTimeout(350);
    // Click general channel
    const chanBtn=page.locator('.fp-msg-channel-btn,.fp-channel-btn').first();
    const cb=await chanBtn.boundingBox().catch(()=>null);
    if(cb&&cb.x>150){
      await go(page,cb.x+cb.width/2,cb.y+cb.height/2,250);await page.waitForTimeout(170);
      await page.mouse.click(cb.x+cb.width/2,cb.y+cb.height/2);await page.waitForTimeout(500);await inj(page);
    }
    // Hover existing messages
    await hov(page,'.fp-msg-item,.fp-message-item',2,260);
    // Send a quick message
    await fi(page,'#fp-msg-input,input[placeholder*="Message"],textarea[placeholder*="Message"]','Rapport SEO ✓');
    await cl(page,'#fp-msg-send,button[aria-label*="Envoyer"]',350,220);
    await page.waitForTimeout(300);
  }
  await page.mouse.click(400,450);await page.waitForTimeout(400);await inj(page);
}

// === 6. RECHERCHE GLOBALE via JS click ===
const searchOpened=await page.evaluate(()=>{const el=document.getElementById('fp-search-trigger');if(el){el.click();return true;}return false;});
await page.waitForTimeout(700);await inj(page);
if(searchOpened){
  const si=page.locator('#fp-cmd-palette .fp-cmd-input,.fp-cmd-input').first();
  if(await si.isVisible({timeout:2000}).catch(()=>false)){
    await si.fill('monitor');await page.waitForTimeout(550);
    const results=page.locator('.fp-cmd-item,.fp-search-result,.fp-cmd-result');
    const rCnt=Math.min(await results.count(),3);
    for(let i=0;i<rCnt;i++){const b=await results.nth(i).boundingBox().catch(()=>null);if(b&&b.x>150){await go(page,b.x+b.width/2,b.y+b.height/2,240);await page.waitForTimeout(260);}}
    if(rCnt>0){
      const rb=await results.first().boundingBox().catch(()=>null);
      if(rb&&rb.x>150){
        await go(page,rb.x+rb.width/2,rb.y+rb.height/2,240);await page.waitForTimeout(160);
        await page.mouse.click(rb.x+rb.width/2,rb.y+rb.height/2);await page.waitForTimeout(700);await inj(page);
      }
    } else {await page.keyboard.press('Escape').catch(()=>{});}
  } else {await page.keyboard.press('Escape').catch(()=>{});}
}

// === 7. Return to Overview ===
await sidebarNav(page,'overview');
await page.waitForTimeout(1400);await inj(page);
const kpis=page.locator('.fp-kpi-card,.kpi-card,.fp-stat-card');
const kCnt=Math.min(await kpis.count(),4);
for(let i=0;i<kCnt;i++){const b=await kpis.nth(i).boundingBox().catch(()=>null);if(b&&b.x>150){await go(page,b.x+b.width/2,b.y+b.height/2,270);await page.waitForTimeout(250);}}
await go(page,640,360,230);await page.waitForTimeout(600);

await page.close();await ctx.close();await browser.close();

const files=readdirSync(TMP).filter(f=>f.endsWith('.webm'));
const mp4=join(TMP,'step6.mp4');
const ss=Math.max(0,(skip-400)/1000);
const args=['-y'];if(ss>0.5)args.push('-ss',ss.toFixed(2));
args.push('-i',join(TMP,files[0]),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',mp4);
spawnSync('ffmpeg',args,{stdio:'pipe'});
spawnSync('cp',[mp4,join(DEST,'step6-daily.mp4')]);
const dur=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4],{stdio:'pipe'}).stdout.toString().trim();
console.log(`✓ V6  step6-daily.mp4  ${parseFloat(dur).toFixed(1)}s`);
mkdirSync('/tmp/fv6',{recursive:true});
for(const t of[1,5,10,15,20,25,30,35])spawnSync('ffmpeg',['-y','-ss',String(t),'-i',mp4,'-frames:v','1','-vf','scale=640:360',`/tmp/fv6/t${t}.jpg`],{stdio:'pipe'});
console.log('V6 frames ok');
