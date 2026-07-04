import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

async function runTest() {
  const browser = await chromium.launch({
    executablePath: '/home/runner/workspace/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.route('http://localhost:8081/**', async (route) => {
      const url = new URL(route.request().url());
      let pathname = url.pathname;
      if (pathname === '/') pathname = '/index.html';
      const filePath = path.join(process.cwd(), 'artifacts/flowpoint-export', pathname);
      
      if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath);
          let contentType = 'text/html';
          if (pathname.endsWith('.js')) contentType = 'application/javascript';
          if (pathname.endsWith('.css')) contentType = 'text/css';
          await route.fulfill({ status: 200, contentType, body: content });
      } else if (url.pathname === '/api/auth/signup') {
          console.log('MOCK: signup');
          await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, data: { debugLink: 'http://localhost:8081/login-verify.html?token=test-token' } })
          });
      } else if (url.pathname === '/api/auth/login-verify') {
          console.log('MOCK: login-verify');
          await route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ ok: true, data: { ok: true } })
          });
      } else { await route.continue(); }
    });

    page.on('console', msg => console.log('BROWSER LOG:', msg.text()));

    await page.goto('http://localhost:8081/');
    await page.click('button[data-plan="pro"]');
    await page.fill('#firstName', 'Test');
    await page.fill('#lastName', 'User');
    await page.fill('#email', 'test@example.com');
    await page.fill('#companyName', 'Test Co');
    await page.selectOption('#country', 'FR');
    await page.selectOption('#companySize', '2-10');
    await page.selectOption('#objective', 'seo-local');

    console.log('Patching fetch success handler...');
    await page.evaluate(() => {
        const origFetch = window.fetch;
        window.fetch = async function(...args) {
            const res = await origFetch.apply(this, args);
            if (args[0] === '/api/auth/signup') {
                const clone = res.clone();
                const json = await clone.json();
                console.log('SIGNUP RESPONSE:', JSON.stringify(json));
                if (json.data && json.data.debugLink) {
                    console.log('FORCE REDIRECT TO:', json.data.debugLink);
                    setTimeout(() => { window.location.href = json.data.debugLink; }, 100);
                }
            }
            return res;
        };
    });

    console.log('Clicking signup...');
    await page.click('#signup-btn');
    
    console.log('Waiting for checkout.html...');
    await page.waitForURL(/checkout\.html/, { timeout: 30000 });
    console.log('Final URL reached:', page.url());

    await page.waitForSelector('.fp-plan-name', { state: 'visible' });
    const plan = await page.textContent('.fp-plan-name');
    console.log('Plan on checkout:', plan);
    
    await page.screenshot({ path: 'checkout-final.png' });
    console.log('Screenshot saved.');

    if (plan.includes('Pro')) {
        console.log('Test PASSED');
    } else {
        throw new Error('Validation failed');
    }
  } catch (err) {
    console.error('Test FAILED:', err);
    await page.screenshot({ path: 'failure.png' });
    process.exit(1);
  } finally { await browser.close(); }
}
runTest();
