import { chromium } from 'playwright';
import { mkdir } from 'fs/promises';

const TOKEN = 'fp_prodtest_mtvk0b59_ycysuvb1co';
const BASE  = 'http://127.0.0.1:8081';
const OUT   = '/tmp/validation-screenshots';

await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ args: ['--no-sandbox'] });

async function page(width = 1280) {
  const ctx = await browser.newContext({ viewport: { width, height: 800 } });
  const pg  = await ctx.newPage();
  // inject session token before navigating
  await pg.addInitScript((tok) => {
    sessionStorage.setItem('fp_session_token', tok);
  }, TOKEN);
  const errors = [];
  pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  pg.on('pageerror', e => errors.push(String(e)));
  return { pg, ctx, errors };
}

async function go(pg, hash) {
  await pg.goto(`${BASE}/dashboard.html${hash}`, { waitUntil: 'networkidle', timeout: 30000 });
  await pg.waitForTimeout(2000);
}

const networkFails = [];

// ─── C1 + C2 + C3 : Local SEO (carte concurrents) light mode desktop ───
{
  const { pg, ctx, errors } = await page(1280);
  pg.on('response', r => { if (!r.ok() && r.url().includes('/api/maps')) networkFails.push(`${r.status()} ${r.url()}`); });
  await go(pg, '#local-seo');
  // switch to light mode if needed
  await pg.evaluate(() => { document.documentElement.setAttribute('data-theme','light'); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${OUT}/C1-C2-C3-light-desktop.jpg`, fullPage: false });

  // check legend DOM
  const legendBg = await pg.$eval(
    'div[style*="bottom:50px"][style*="left:12px"]',
    el => getComputedStyle(el).backgroundColor
  ).catch(() => 'NOT FOUND');
  console.log('C1 legend bg (light):', legendBg);

  // check title visibility
  const titleText = await pg.$eval(
    '.fp-card-title',
    el => el.textContent.trim()
  ).catch(() => 'NOT FOUND');
  console.log('C2 title:', titleText);

  // check radius options
  const radiusOptions = await pg.$$eval(
    '#fp-comp-radius option',
    opts => opts.map(o => o.value + '=' + o.textContent.trim())
  ).catch(() => []);
  console.log('C3 radius options:', radiusOptions.join(', '));

  // check 50km/100km options exist
  console.log('C3 50km present:', radiusOptions.some(o => o.includes('50000')));
  console.log('C3 100km present:', radiusOptions.some(o => o.includes('100000')));

  console.log('C1-C2-C3 errors:', errors);
  await ctx.close();
}

// ─── C1 dark mode check ───
{
  const { pg, ctx, errors } = await page(1280);
  await go(pg, '#local-seo');
  await pg.evaluate(() => { document.documentElement.removeAttribute('data-theme'); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${OUT}/C1-dark-desktop.jpg`, fullPage: false });
  const legendBg = await pg.$eval(
    'div[style*="bottom:50px"][style*="left:12px"]',
    el => getComputedStyle(el).backgroundColor
  ).catch(() => 'NOT FOUND');
  console.log('C1 legend bg (dark):', legendBg);
  console.log('C1 dark errors:', errors);
  await ctx.close();
}

// ─── C3 : trigger 50km request, check network ───
{
  const { pg, ctx, errors } = await page(1280);
  const reqs = [];
  pg.on('request', r => { if (r.url().includes('/api/maps/competitors')) reqs.push(r.url()); });
  pg.on('response', r => { if (r.url().includes('/api/maps/competitors')) networkFails.push(`${r.status()} ${r.url().slice(0,100)}`); });
  await go(pg, '#local-seo');
  // select 50km
  await pg.selectOption('#fp-comp-radius', '50000').catch(() => {});
  await pg.waitForTimeout(3000);
  await pg.screenshot({ path: `${OUT}/C3-50km-request.jpg`, fullPage: false });
  console.log('C3 requests fired after 50km select:', reqs.slice(-3).join('\n'));
  // select 100km
  await pg.selectOption('#fp-comp-radius', '100000').catch(() => {});
  await pg.waitForTimeout(3000);
  await pg.screenshot({ path: `${OUT}/C3-100km-request.jpg`, fullPage: false });
  console.log('C3 requests fired after 100km select:', reqs.slice(-3).join('\n'));
  console.log('C3 errors:', errors);
  await ctx.close();
}

// ─── C4 : AI stop button ───
{
  const { pg, ctx, errors } = await page(1280);
  await go(pg, '#ai');
  await pg.waitForTimeout(1000);
  // force-show the stop button for inspection
  await pg.evaluate(() => {
    const btn = document.getElementById('ai-stop');
    if (btn) { btn.style.display = 'flex'; }
  });
  await pg.screenshot({ path: `${OUT}/C4-stop-btn.jpg`, fullPage: false });
  const stopHtml = await pg.$eval('#ai-stop', el => el.innerHTML).catch(() => 'NOT FOUND');
  console.log('C4 stop btn innerHTML:', stopHtml);
  // check no ⏹ char
  console.log('C4 no ⏹ char:', !stopHtml.includes('⏹'));
  const stopBorderStyle = await pg.$eval('#ai-stop', el => getComputedStyle(el).border).catch(() => '');
  console.log('C4 stop btn border:', stopBorderStyle);
  console.log('C4 errors:', errors);
  await ctx.close();
}

// ─── C5 : Team activity ───
{
  const { pg, ctx, errors } = await page(1280);
  await go(pg, '#team');
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: `${OUT}/C5-team-activity-desktop.jpg`, fullPage: false });
  const gridStyle = await pg.$eval('.fp-team-activity-grid', el => el.style.cssText).catch(() => 'NOT FOUND');
  console.log('C5 grid style:', gridStyle);
  console.log('C5 errors:', errors);
  await ctx.close();
}

// ─── C6 : Add-on cards ───
{
  const { pg, ctx, errors } = await page(1280);
  await go(pg, '#billing&sub=addons');
  await pg.waitForTimeout(1500);
  await pg.screenshot({ path: `${OUT}/C6-addons-desktop.jpg`, fullPage: false });
  // check first addon card has flex-direction:column
  const cardStyle = await pg.$eval(
    '.fp-addon-grid > div:first-child',
    el => getComputedStyle(el).flexDirection
  ).catch(() => 'NOT FOUND');
  console.log('C6 card flex-direction:', cardStyle);
  console.log('C6 errors:', errors);
  await ctx.close();
}

// ─── RESPONSIVE : mobile 390px ───
{
  const { pg, ctx, errors } = await page(390);
  await go(pg, '#local-seo');
  await pg.evaluate(() => { document.documentElement.setAttribute('data-theme','light'); });
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${OUT}/responsive-local-seo-mobile.jpg`, fullPage: false });
  console.log('RESPONSIVE mobile errors:', errors);
  await ctx.close();
}

// ─── RESPONSIVE : tablet 768px ───
{
  const { pg, ctx, errors } = await page(768);
  await go(pg, '#local-seo');
  await pg.waitForTimeout(500);
  await pg.screenshot({ path: `${OUT}/responsive-local-seo-tablet.jpg`, fullPage: false });
  console.log('RESPONSIVE tablet errors:', errors);
  await ctx.close();
}

await browser.close();
console.log('Network fails on maps requests:', networkFails.filter(x => !x.startsWith('2')));
console.log('Done. Screenshots in', OUT);
