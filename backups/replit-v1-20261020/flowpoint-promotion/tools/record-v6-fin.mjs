import pkg from '/home/runner/workspace/node_modules/.pnpm/playwright@1.61.1/node_modules/playwright/index.js';
const { chromium } = pkg;
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE='https://app.flowpoint.pro';
const QA_ORG='10000000-0000-4000-8000-000000000002';
const OUT_DIR='/tmp/fp-vfin';
const DEST_DIR='/home/runner/workspace/artifacts/flowpoint-export/onboarding';
mkdirSync(join(OUT_DIR,'t_v6b'),{recursive:true});

const r=await fetch(BASE+'/api/admin/test-session',{method:'POST',headers:{'x-admin-key':process.env.ADMIN_KEY,'Content-Type':'application/json'},body:JSON.stringify({orgId:QA_ORG,role:'admin',ttlMinutes:480})});
const d=await r.json();
if(!d.ok||!d.token) throw new Error(JSON.stringify(d));
const token=d.token;
console.log('token ok');

const CSR=`<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22"><path d="M3 1.5 L3 18 L7.5 13.5 L11 20.5 L13.5 19 L10 12 L17.5 12 Z" fill="white" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round"/></svg>`;

async function inj(p){await p.evaluate(s=>{document.getElementById('_fpa')?.remove();const w=document.createElement('div');w.id='_fpa';w.style.cssText='position:fixed;top:0;left:0;width:22px;height:22px;pointer-events:none;z-index:2147483647;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))';w.innerHTML=s;document.body.appendChild(w);let cx=640,cy=360;document.addEventListener('mousemove',e=>{cx=e.clientX;cy=e.clientY;w.style.left=cx+'px';w.style.top=cy+'px'},{passive:true});window._cx=cx;window._cy=cy;},CSR);}

async function go(p,tx,ty,ms=450){const{x,y}=await p.evaluate(()=>({x:window._cx||640,y:window._cy||360}));const n=Math.max(16,Math.round(ms/14));for(let i=1;i<=n;i++){const t=i/n,e=t<.5?2*t*t:-1+(4-2*t)*t;await p.mouse.move(Math.round(x+(tx-x)*e),Math.round(y+(ty-y)*e));await p.waitForTimeout(14);}await p.evaluate(q=>{window._cx=q.x;window._cy=q.y;},{x:tx,y:ty});}

async function sc(p,d,ms=500){const n=Math.max(6,Math.round(ms/30));for(let i=0;i<n;i++){await p.mouse.wheel(0,d/n);await p.waitForTimeout(30);}await p.waitForTimeout(100);}

async function cl(p,s,ams=600,mms=400){try{const el=p.locator(s).first();if(!await el.isVisible({timeout:3000}).catch(()=>false))return false;const b=await el.boundingBox();if(!b||b.x<150)return false;await go(p,b.x+b.width/2,b.y+b.height/2,mms);await p.waitForTimeout(80);await p.mouse.click(b.x+b.width/2,b.y+b.height/2);await p.waitForTimeout(ams);await inj(p);return true;}catch{return false;}}

async function fi(p,s,t){try{const el=p.locator(s).first();await el.waitFor({state:'visible',timeout:5000});const b=await el.boundingBox();if(!b)return false;await go(p,b.x+b.width/2,b.y+b.height/2,320);await el.click();await p.waitForTimeout(180);await el.fill(t);await p.waitForTimeout(200);return true;}catch{return false;}}

async function hov(p,s,max=3,d=320){const it=p.locator(s);const n=Math.min(await it.count(),max);for(let i=0;i<n;i++){const b=await it.nth(i).boundingBox().catch(()=>null);if(b&&b.width>40&&b.x>150){await go(p,b.x+b.width/2,b.y+b.height/2,380);await p.waitForTimeout(d);}}}

const tmp=join(OUT_DIR,'t_v6b');
const browser=await chromium.launch({args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:1280,height:720},recordVideo:{dir:tmp,size:{width:1280,height:720}},userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'});
await ctx.addInitScript(tok=>{try{sessionStorage.setItem('fp_session_token',tok);}catch{}Object.defineProperty(navigator,'webdriver',{get:()=>undefined});},token);
const page=await ctx.newPage();
const t0=Date.now();

await page.goto(BASE+'/dashboard.html',{waitUntil:'domcontentloaded',timeout:30000});
try{await page.waitForFunction(()=>typeof window.STATE!=='undefined'&&window.STATE.loading===false,{timeout:25000,polling:300});}catch{await page.waitForSelector('h1',{timeout:10000}).catch(()=>{});}
await page.waitForTimeout(2000);
for(const s of['button:has-text("Passer la visite")','button:has-text("Ignorer")','button:has-text("Skip")'
]){try{const b=page.locator(s).first();if(await b.isVisible({timeout:500}).catch(()=>false)){await b.click();await page.waitForTimeout(400);break;}}catch{}}

await page.evaluate(()=>{if(window.navigate)window.navigate('missions');else window.location.hash='missions';});
await page.waitForTimeout(2500);
await page.waitForFunction(s=>document.querySelectorAll(s).length>0,'table tbody tr,.mission-item',{timeout:8000,polling:400}).catch(()=>{});
await page.waitForTimeout(800);
const skip=Date.now()-t0;
await page.mouse.move(650,350);await page.evaluate(()=>{window._cx=650;window._cy=350;});await inj(page);

// Missions: hover stat blocks + rows
for(const[x,y]of[[220,165],[430,165],[630,165],[820,165]]){await go(page,x,y,310);await page.waitForTimeout(250);}
await hov(page,'table tbody tr,.mission-item',3,370);

// Create mission
await cl(page,'#mission-quick-add-btn,button:has-text("+ Mission"),button:has-text("Créer une mission")',600,380);
await fi(page,'input[placeholder*="Titre"],input[placeholder*="Nom"],input[id*="mission"]','Améliorer la page Contact');
await page.waitForTimeout(280);
await cl(page,'button:has-text("Créer"),button:has-text("Ajouter"),button[type="submit"]',1200,320);
await page.waitForTimeout(300);await page.keyboard.press('Escape').catch(()=>{});await page.waitForTimeout(500);await inj(page);

// Activité
if(await cl(page,'#fp-activity-btn',1000,400)){
  await go(page,1060,250,340);await page.waitForTimeout(330);
  await go(page,1060,330,290);await page.waitForTimeout(300);
  await go(page,1060,410,270);await page.waitForTimeout(300);
  await sc(page,60,300);await page.waitForTimeout(270);await sc(page,-60,270);
  await page.mouse.click(350,400);await page.waitForTimeout(400);await inj(page);
}

// Notifs
if(await cl(page,'#fp-notif-btn',900,400)){
  await go(page,1000,240,340);await page.waitForTimeout(280);
  await hov(page,'#fp-notif-dropdown .fp-notif-item,.notification-item',3,280);
  await page.mouse.click(400,450);await page.waitForTimeout(400);await inj(page);
}

// Messages
if(await cl(page,'#fp-msg-btn',900,400)){
  await cl(page,'#fp-msg-dropdown .fp-msg-channel-btn,.fp-channel-btn',500,310);
  await fi(page,'#fp-msg-input,input[placeholder*="Message"],textarea[placeholder*="Message"]','Rapport SEO semaine 37 envoyé');
  await page.waitForTimeout(280);
  await cl(page,'#fp-msg-send,button[aria-label*="Envoyer"]',500,270);
  await page.mouse.click(400,400);await page.waitForTimeout(400);await inj(page);
}

// Overview
await page.evaluate(()=>{if(window.navigate)window.navigate('overview');else window.location.hash='overview';});
await page.waitForTimeout(2000);
await hov(page,'.fp-kpi-card,.kpi-card',4,310);
for(const[x,y]of[[280,200],[520,200],[760,200],[1000,200]]){await go(page,x,y,310);await page.waitForTimeout(260);}
await sc(page,100,460);await go(page,640,400,300);await page.waitForTimeout(540);await sc(page,-100,420);await page.waitForTimeout(600);

await page.close();await ctx.close();await browser.close();

const files=readdirSync(tmp).filter(f=>f.endsWith('.webm'));
const mp4=join(OUT_DIR,'step6-daily.mp4');
const ss=Math.max(0,(skip-400)/1000);
const a=['-y'];if(ss>0.5)a.push('-ss',ss.toFixed(2));
a.push('-i',join(tmp,files[0]),'-vf','scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2','-c:v','libx264','-crf','20','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart','-an',mp4);
spawnSync('ffmpeg',a,{stdio:'pipe'});
spawnSync('cp',[mp4,join(DEST_DIR,'step6-daily.mp4')]);
const dur=spawnSync('ffprobe',['-v','error','-show_entries','format=duration','-of','csv=p=0',mp4],{stdio:'pipe'}).stdout.toString().trim();
console.log(`✓ step6-daily.mp4  ${parseFloat(dur).toFixed(1)}s  (trimmed ${(skip/1000).toFixed(1)}s)`);

// Quick frame check
for(const t of[1,8,20]){spawnSync('ffmpeg',['-y','-ss',String(t),'-i',mp4,'-frames:v','1','-vf','scale=640:360',`/tmp/vf3/s6fin-t${t}.jpg`],{stdio:'pipe'});}
console.log('frames extracted');
