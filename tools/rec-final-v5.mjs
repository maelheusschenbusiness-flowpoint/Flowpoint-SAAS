/**
 * V5 final — Assistant IA réponse texte visible + Génération rapport SEO
 * Fix: bloquer window.navigate ET STATE.route changes pour que le texte IA reste visible
 */
import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'https://app.flowpoint.pro';
const QA_ORG = '10000000-0000-4000-8000-000000000002';
const TMP = '/tmp/rec-fv5'; mkdirSync(TMP, { recursive: true });
const DEST = '/home/runner/workspace/artifacts/flowpoint-export/onboarding';

const r = await fetch(BASE + '/api/admin/test-session', {
  method: 'POST', headers: { 'x-admin-key': process.env.ADMIN_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ orgId: QA_ORG, role: 'admin', ttlMinutes: 480 }),
});
const { token } = await r.json();
if (!token) throw new Error('No token');

const CSR = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;
async function inj(p) {
  await p.evaluate(s=>{
    document.getElementById('_fpa')?.remove();const w=document.createElement('div');w.id='_fpa';
    w.style.cssText='position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';
    w.innerHTML=s;document.body.appendChild(w);let cx=640,cy=360;
    document.addEventListener('mousemove',e=>{cx=e.clientX;cy=e.clientY;w.style.left=cx+'px';w.style.top=cy+'px';},{passive:true});
    window._cx=cx;window._cy=cy;
  },CSR);
}
async function go(p, tx, ty, ms=380) {
  const {x,y}=await p.evaluate(()=>({x:window._cx||640,y:window._cy||360}));
  const n=Math.max(14,Math.round(ms/14));
  for(let i=1;i<=n;i++){const t=i/n,e=t<.5?2*t*t:-1+(4-2*t)*t;await p.mouse.move(Math.round(x+(tx-x)*e),Math.round(y+(ty-y)*e));await p.waitForTimeout(14);}
  await p.evaluate(q=>{window._cx=q.x;window._cy=q.y;},{x:tx,y:ty});
}
async function sidebarNav(p, route) {
  await p.evaluate(r=>{const el=document.querySelector(`.fp-nav-item[data-route="${r}"]`);if(el)el.click();else if(window.navigate)window.navigate(r);},route);
  await p.waitForFunction(r=>window.STATE?.route===r,route,{timeout:8000,polling:200}).catch(()=>{});
  await p.waitForTimeout(500);
}
async function cl(p, s, ams=450, mms=300) {
  try{
    const el=p.locator(s).first();if(!await el.isVisible({timeout:4000}).catch(()=>false))return false;
    const b=await el.boundingBox();if(!b||b.x<150)return false;
    await go(p,b.x+b.width/2,b.y+b.height/2,mms);await p.waitForTimeout(60);
    await p.mouse.click(b.x+b.width/2,b.y+b.height/2);await p.waitForTimeout(ams);await inj(p);return true;
  }catch{return false;}
}
async function hov(p, s, max=3, d=270) {
  const it=p.locator(s);const n=Math.min(await it.count(),max);
  for(let i=0;i<n;i++){const b=await it.nth(i).boundingBox().catch(()=>null);if(b&&b.x>150){await go(p,b.x+b.width/2,b.y+b.height/2,280);await p.waitForTimeout(d);}}
}
async function sc(p, d, ms=360) {
  const n=Math.max(5,Math.round(ms/30));for(let i=0;i<n;i++){await p.mouse.wheel(0,d/n);await p.waitForTimeout(30);}await p.waitForTimeout(80);
}

const browser = await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx = await browser.newContext({
  viewport:{width:1280,height:720},recordVideo:{dir:TMP,size:{width:1280,height:720}},
  userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36',
});
await ctx.addInitScript(tok=>{
  try{sessionStorage.setItem('fp_session_token',tok);}catch{}
  try{sessionStorage.setItem('fp_last_route','ai');}catch{}
},token);
const page = await ctx.newPage();
const t0 = Date.now();

await page.goto(BASE+'/dashboard.html#ai',{waitUntil:'domcontentloaded',timeout:30000});
try{await page.waitForFunction(()=>window.STATE?.loading===false,{timeout:25000,polling:300});}catch{await page.waitForTimeout(3000);}
for(const s of['button:has-text("Passer la visite")','button:has-text("Ignorer")'
]){try{const b=page.locator(s).first();if(await b.isVisible({timeout:400}).catch(()=>false)){await b.click();await page.waitForTimeout(250);}}catch{}}

await sidebarNav(page, 'ai');
await page.waitForFunction(()=>!!document.querySelector('#fp-chat-input,textarea'),{timeout:8000,polling:300}).catch(()=>{});
await page.waitForTimeout(600);
const skip = Date.now() - t0;

await page.mouse.move(640,360);await page.evaluate(()=>{window._cx=640;window._cy=360;});await inj(page);

// === 1. Show AI page ===
await go(page,640,230,250);await page.waitForTimeout(400);
await hov(page, '.fp-quick-chip,.fp-suggestion-chip', 3, 300);
await page.waitForTimeout(300);

// === 2. Block BOTH window.navigate AND STATE.route changes ===
await page.evaluate(()=>{
  window._origNavigate = window.navigate;
  window._navBlocked = true;
  window.navigate = s => { window._blockedNavTarget = s; };
  // Intercept STATE.route setter
  if (window.STATE) {
    try {
      let _r = window.STATE.route;
      Object.defineProperty(window.STATE, 'route', {
        get() { return _r; },
        set(v) {
          if (window._navBlocked) { window._blockedNavTarget = v; }
          else { _r = v; if (window.render) window.render(); }
        },
        configurable: true, enumerable: true,
      });
    } catch(e) {}
  }
  // Also intercept setState or any render triggers
  const origRender = window.render;
  if (origRender) {
    window.render = function() {
      if (window._navBlocked && window._blockedNavTarget) return; // suppress renders during block
      origRender.apply(this, arguments);
    };
    window._origRender = origRender;
  }
});

// === 3. Type question via JS (native setter) ===
await page.evaluate(()=>{
  const el=document.querySelector('#fp-chat-input,textarea[placeholder]');
  if(!el)return;
  el.focus();
  const setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value')?.set
    ||Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set;
  if(setter)setter.call(el,'Quelles sont mes priorités SEO cette semaine ?');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  el.dispatchEvent(new Event('change',{bubbles:true}));
});
await page.waitForTimeout(350);

// Move to textarea to show the typed text
const ta=page.locator('#fp-chat-input,textarea').first();
const taBox=await ta.boundingBox().catch(()=>null);
if(taBox&&taBox.x>150)await go(page,taBox.x+taBox.width/2,taBox.y+taBox.height/2,250);
await page.waitForTimeout(300);

// === 4. Click send button ===
await cl(page,'#fp-chat-send,#fp-send-btn,button[aria-label*="Envoyer"],form button[type="submit"]',300,230);

// === 5. Wait for assistant response bubble (fp-ai-msg--assistant) ===
const gotResponse = await page.waitForFunction(()=>{
  const bubbles=document.querySelectorAll('.fp-ai-msg--assistant .fp-ai-msg-bubble');
  for(const b of bubbles){
    const txt=b.textContent?.trim()||'';
    if(txt.length>20)return true;
  }
  return false;
},{timeout:25000,polling:200}).catch(()=>null);
console.log('AI response bubble:', !!gotResponse);

// === 6. Show response for 6 seconds ===
await go(page, 640, 380, 250); await page.waitForTimeout(2000);
const chat = page.locator('#fp-chat-messages,.fp-chat-body').first();
const ca = await chat.boundingBox().catch(()=>null);
if(ca){ await go(page,ca.x+ca.width/2,ca.y+ca.height*0.6,240);await page.waitForTimeout(400); }
await sc(page,80,320);await page.waitForTimeout(500);
await go(page,660,400,230);await page.waitForTimeout(1500);
await inj(page);await page.waitForTimeout(800);

// === 7. Release block and navigate to Rapports ===
await page.evaluate(()=>{
  window._navBlocked=false;
  if(window._origRender)window.render=window._origRender;
  if(window._origNavigate)window.navigate=window._origNavigate;
  // Restore STATE.route setter
  if(window.STATE&&window._blockedNavTarget){
    try{
      let _r=window.STATE.route;
      Object.defineProperty(window.STATE,'route',{get(){return _r;},set(v){_r=v;},configurable:true,enumerable:true});
    }catch{}
  }
  if(window.navigate)window.navigate('reports');
});
await page.waitForFunction(()=>window.STATE?.route==='reports',{timeout:8000,polling:200}).catch(()=>{});
await page.waitForTimeout(1000);
await inj(page);

// === 8. Hover report cards ===
await hov(page, '.fp-report-card,.fp-template-card', 4, 290);

// === 9. Click "Rapport SEO" card ===
const seoCard = page.locator('.fp-report-card:has-text("SEO"),.fp-template-card:has-text("SEO")').first();
const scBox = await seoCard.boundingBox().catch(()=>null);
if(scBox&&scBox.x>150){
  await go(page,scBox.x+scBox.width/2,scBox.y+scBox.height/2,280);await page.waitForTimeout(170);
  await page.mouse.click(scBox.x+scBox.width/2,scBox.y+scBox.height/2);await page.waitForTimeout(700);await inj(page);
} else {
  await cl(page,'button:has-text("Générer rapport"),#report-new-btn',500,280);
}

// === 10. Panel open — show form, select audit ===
const panel=page.locator('.fp-float-panel').first();
const panelBox=await panel.boundingBox().catch(()=>null);
if(panelBox){
  await go(page,panelBox.x+panelBox.width/2,panelBox.y+80,240);await page.waitForTimeout(450);
  // Try to select audit
  const auditSel=page.locator('#nr-audit,select[id*="audit"]').first();
  const aBox=await auditSel.boundingBox().catch(()=>null);
  if(aBox&&aBox.x>150){
    await go(page,aBox.x+aBox.width/2,aBox.y+aBox.height/2,230);await page.waitForTimeout(200);
    await page.evaluate(()=>{const sel=document.getElementById('nr-audit');if(sel&&sel.options.length>1){sel.selectedIndex=1;sel.dispatchEvent(new Event('change',{bubbles:true}));}});
    await page.waitForTimeout(220);
  }
  await sc(page,60,320);await page.waitForTimeout(350);
  await go(page,panelBox.x+panelBox.width*0.6,panelBox.y+170,230);await page.waitForTimeout(300);
}

// === 11. Click Générer button ===
await cl(page,'button:has-text("Générer"),button:has-text("Créer le rapport"),button:has-text("Créer"),button[type="submit"]',1300,260);
await page.waitForTimeout(500);
await inj(page);
await go(page,640,360,230);await page.waitForTimeout(1000);

await page.close();await ctx.close();await browser.close();

const files=readdirSync(TMP).filter(f=>f.endsWith('.webm'));
const mp4=join(TMP,'step5.mp4');
const ss=Math.max(0,(skip-400)/1000);
const args=['-y'];if(ss>0.5)args.push('-ss',ss.toFixed(2));
args.push('-i',join(TMP,files[0]),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',mp4);
spawnSync('ffmpeg',args,{stdio:'pipe'});
spawnSync('cp',[mp4,join(DEST,'step5-ai-reports.mp4')]);
const dur=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4],{stdio:'pipe'}).stdout.toString().trim();
console.log(`✓ V5  step5-ai-reports.mp4  ${parseFloat(dur).toFixed(1)}s`);
mkdirSync('/tmp/fv5',{recursive:true});
for(const t of[1,4,7,11,15,19,23,28])spawnSync('ffmpeg',['-y','-ss',String(t),'-i',mp4,'-frames:v','1','-vf','scale=640:360',`/tmp/fv5/t${t}.jpg`],{stdio:'pipe'});
console.log('V5 frames ok');
