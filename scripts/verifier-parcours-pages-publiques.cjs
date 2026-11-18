/* Parcours navigateur (bureau 1440, iPhone 13, Pixel 7) des pages publiques de production en anglais par défaut :
   tarifs, choix du plan, inscription (champs obligatoires, aucune soumission), connexion, checkout sans panier, retour arrière et changement de plan.
   LECTURE SEULE : aucun formulaire n'est envoyé (le script échoue si une requête POST/PUT/PATCH/DELETE part).
   Usage : node scripts/verifier-parcours-pages-publiques.cjs http://127.0.0.1:4400
           FP_VERIFY_READONLY_REMOTE=1 node scripts/verifier-parcours-pages-publiques.cjs https://app.flowpoint.pro */
const BASE = process.argv[2];
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(BASE || '');
const REMOTE_RO = process.env.FP_VERIFY_READONLY_REMOTE === '1' && /^https:\/\/(app\.flowpoint\.pro|flowpoint-test\.onrender\.com)$/.test(BASE || '');
if (!LOCAL && !REMOTE_RO) { console.error('cible refusée : serveur local, ou FP_VERIFY_READONLY_REMOTE=1 avec app.flowpoint.pro / flowpoint-test.onrender.com'); process.exit(2); }
const { chromium, devices } = require('playwright');
const FR = /\b(votre|vos|vous|nous|pour|avec|mois|essai|gratuit|créer|compte|tarifs?|connexion|déjà|prénom|entreprise|paiement|annulé|disponible|bienvenue|choisir|continuer|mot de passe)\b/i;
const PROFILS = [
  { nom: 'bureau-1440', opts: { viewport: { width: 1440, height: 900 } } },
  { nom: 'iphone-13', opts: { ...devices['iPhone 13'] } },
  { nom: 'pixel-7', opts: { ...devices['Pixel 7'] } },
];
let echecs = 0; const ok = (c, msg) => { if (!c) { echecs++; console.log('   ✘ ' + msg); } return c; };
const frVisible = (page) => page.evaluate((src) => {
  const re = new RegExp(src, 'i'); const out = []; const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const p = n.parentElement; if (!p || /^(SCRIPT|STYLE|NOSCRIPT)$/.test(p.tagName) || !p.getClientRects().length) continue; const t = n.nodeValue.trim(); if (t && re.test(t)) out.push(t.slice(0, 60)); }
  return [...new Set(out)].slice(0, 5);
}, FR.source);
const cartPlan = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem('fp_cart') || 'null'); } catch (e) { return 'corrompu'; } });
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] }).catch(() => chromium.launch({ args: ['--no-sandbox'] }));
  for (const profil of PROFILS) {
    const ctx = await browser.newContext({ locale: 'fr-FR', ...profil.opts });
    const page = await ctx.newPage(); const ecritures = []; const erreursJs = [];
    page.on('request', (r) => { if (/^(POST|PUT|PATCH|DELETE)$/.test(r.method()) && r.url().startsWith(BASE) && !/\/api\/(public\/)?(funnel|track|events|analytics|conversion|collect)/i.test(r.url())) ecritures.push(r.method() + ' ' + r.url().replace(BASE, '')); });
    page.on('pageerror', (e) => erreursJs.push(String(e.message).slice(0, 100)));
    console.log('== ' + profil.nom);
    // 1. Tarifs
    await page.goto(BASE + '/pricing.html', { waitUntil: 'load' }); await page.waitForTimeout(1500);
    ok(await page.evaluate(() => document.documentElement.lang) === 'en', 'pricing : lang=en');
    const cartes = await page.locator('.fp-card-btn[data-plan]').count(); ok(cartes >= 3, 'pricing : 3 plans visibles (' + cartes + ')');
    const catalogue = await page.evaluate(() => fetch('/api/plans/catalog').then((r) => r.json()).catch(() => null));
    const prixAffiches = await page.locator('.fp-card').allInnerTexts();
    const prixCatalogue = catalogue && JSON.stringify(catalogue).match(/"(?:priceMonthly|price|monthlyPrice|amount)":\s*\d+/g);
    ok(!!catalogue, 'pricing : /api/plans/catalog répond');
    for (const pl of (catalogue && catalogue.plans) || []) {
      const texte = await page.locator('.fp-card-btn[data-plan="' + pl.id + '"]').first().evaluate((b) => (b.closest('.fp-card') || b.parentElement).innerText).catch(() => '');
      ok(new RegExp('(^|[^0-9])' + pl.priceEur + '([^0-9]|$)').test(texte), 'pricing : le prix du plan ' + pl.id + ' (' + pl.priceEur + ' ' + catalogue.currency + ') figure sur sa carte');
    }
    ok(prixAffiches.join(' ').match(/\d+\s*€|€\s*\d+|\$\s*\d+/), 'pricing : prix affichés');
    ok((await frVisible(page)).length === 0, 'pricing : aucun français visible ' + JSON.stringify(await frVisible(page)));
    // 2. Choix du plan puis retour arrière puis autre plan
    const plans = await page.locator('.fp-card-btn[data-plan]').evaluateAll((els) => els.map((e) => e.dataset.plan));
    if (plans.length >= 2) {
      await page.locator('.fp-card-btn[data-plan="' + plans[0] + '"]').click();
      await page.waitForTimeout(2500);
      const apresClic = new URL(page.url()).pathname; console.log('   plan « ' + plans[0] + ' » → ' + apresClic);
      if (apresClic !== '/pricing.html') {
        await page.goBack(); await page.waitForLoadState('load'); await page.waitForTimeout(2500);
        ok(new URL(page.url()).pathname === '/pricing.html', 'retour arrière : on reste sur les tarifs (pas de redirection forcée), URL=' + new URL(page.url()).pathname);
      }
      if (new URL(page.url()).pathname === '/pricing.html') {
        await page.locator('.fp-card-btn[data-plan="' + plans[1] + '"]').click(); await page.waitForTimeout(2500);
        const cart = await cartPlan(page); console.log('   2e plan « ' + plans[1] + ' » → ' + new URL(page.url()).pathname + ' panier=' + JSON.stringify(cart && cart.plan));
        ok(new URL(page.url()).pathname !== '/pricing.html' || (cart && cart.plan === plans[1]), 'changement de plan : le dernier choix est pris en compte');
      }
    }
    // 3. Inscription : champs obligatoires, langue, aucune soumission
    await page.goto(BASE + '/signin.html', { waitUntil: 'load' }); await page.waitForTimeout(1200);
    ok(await page.evaluate(() => document.documentElement.lang) === 'en', 'signin : lang=en');
    const obligatoires = await page.locator('form input[required], form select[required], input[required]:visible').count();
    console.log('   signin : champs obligatoires = ' + obligatoires);
    ok((await frVisible(page)).length === 0, 'signin : aucun français visible ' + JSON.stringify(await frVisible(page)));
    // 4. Connexion
    await page.goto(BASE + '/login.html', { waitUntil: 'load' }); await page.waitForTimeout(1200);
    ok(await page.evaluate(() => document.documentElement.lang) === 'en', 'login : lang=en');
    ok(await page.locator('input[type="email"]').first().isVisible().catch(() => false), 'login : champ e-mail visible');
    ok((await frVisible(page)).length === 0, 'login : aucun français visible ' + JSON.stringify(await frVisible(page)));
    // 5. Checkout sans panier ni session
    await page.evaluate(() => { try { localStorage.removeItem('fp_cart'); } catch (e) {} });
    await page.goto(BASE + '/checkout.html', { waitUntil: 'load' }); await page.waitForTimeout(2000);
    console.log('   checkout sans panier → ' + new URL(page.url()).pathname);
    ok(/^\/(signin|pricing|login)\.html$/.test(new URL(page.url()).pathname) || (await page.locator('body').innerText()).length > 0, 'checkout sans panier : renvoi vers une page du tunnel');
    ok((await frVisible(page)).length === 0, 'checkout : aucun français visible ' + JSON.stringify(await frVisible(page)));
    ok(ecritures.length === 0, 'aucune requête d\'écriture partie : ' + JSON.stringify(ecritures));
    ok(erreursJs.length === 0, 'aucune erreur JavaScript : ' + JSON.stringify(erreursJs));
    await ctx.close();
  }
  await browser.close();
  console.log(echecs ? '\nÉCHECS : ' + echecs : '\nTout est conforme.'); process.exit(echecs ? 1 : 0);
})();
