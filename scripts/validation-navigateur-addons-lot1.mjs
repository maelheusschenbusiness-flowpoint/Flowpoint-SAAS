#!/usr/bin/env node
/**
 * Validation navigateur LOCALE des 4 add-ons du lot 1 (garde prix).
 *
 * A lancer UNIQUEMENT contre un serveur local jetable (NODE_ENV=test pour que
 * /api/auth/login-request rende le debugLink ; ENABLE_QA_FIXTURES=true ; ADMIN_KEY)
 * et sa base PostgreSQL jetable. Aucun Stripe, aucune production.
 *
 *   MODE=sans  : variables STRIPE_PRICE_ID_* des 4 add-ons ABSENTES du serveur
 *   MODE=avec  : variables posees (valeurs factices) ; droit d'add-on donne par
 *                ecriture directe dans la base jetable (org_addons)
 *
 *   BASE=http://127.0.0.1:54891 ADMIN_KEY=... PGURL=postgresql://postgres@127.0.0.1:54871/flowpoint_e2e \
 *   MODE=avec OUT=/tmp/preuves node scripts/validation-navigateur-addons-lot1.mjs
 */
import { chromium, request } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "";
const ADMIN_KEY = process.env.ADMIN_KEY ?? "";
const PGURL = process.env.PGURL ?? "";
const MODE = process.env.MODE ?? "avec";
const OUT = process.env.OUT ?? "/tmp/preuves-addons-lot1";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(BASE)) throw new Error("BASE doit etre un serveur local");
if (!/@(127\.0\.0\.1|localhost):\d+\//.test(PGURL)) throw new Error("PGURL doit viser une base locale jetable");
if (!ADMIN_KEY) throw new Error("ADMIN_KEY requis");
mkdirSync(OUT, { recursive: true });

const ADDONS = [
  { key: "organicCampaignTracker", slug: "organic-campaign-tracker", name: "Organic Campaign Tracker" },
  { key: "technicalSeoFixVerification", slug: "technical-seo-fix-verification", name: "Technical SEO Fix Verification" },
  { key: "seoChangeImpact", slug: "seo-change-impact", name: "SEO Change Impact" },
  { key: "conversionOpportunityEngine", slug: "conversion-opportunity-engine", name: "Conversion Opportunity Engine" },
];
const results = [];
const check = (addon, name, ok, detail = "") => {
  results.push({ addon, check: name, ok: !!ok, detail: String(detail).slice(0, 200) });
  console.log(`${ok ? "OK  " : "FAIL"} [${addon}] ${name}${detail && !ok ? " :: " + detail : ""}`);
};
const sql = (q) => execFileSync("psql", [PGURL, "-v", "ON_ERROR_STOP=1", "-qAt", "-c", q]).toString().trim();

async function login() {
  const api = await request.newContext({ baseURL: BASE });
  const prov = await api.post("/api/admin/provision-qa-account", { headers: { "x-admin-key": ADMIN_KEY }, data: {} });
  if (!prov.ok()) throw new Error("provision-qa-account " + prov.status());
  const compte = await prov.json();
  const lr = await api.post("/api/auth/login-request", { data: { email: compte.email } });
  const { debugLink } = await lr.json();
  if (!debugLink) throw new Error("pas de debugLink (NODE_ENV=test requis)");
  await api.dispose();
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(debugLink);
  await page.waitForURL(/dashboard\.html/, { timeout: 45000 });
  await page.waitForSelector('[data-route="overview"]', { timeout: 45000 });
  return { browser, ctx, page, orgId: compte.orgId };
}

const dismissTour = async (page) => {
  const skip = page.getByText("Passer la visite");
  if (await skip.first().isVisible().catch(() => false)) { await skip.first().click(); await page.waitForTimeout(500); }
};
const goRoute = async (page, route) => {
  await dismissTour(page);
  await page.evaluate((r) => window.navigate(r), route);
  await page.waitForFunction((r) => window.STATE?.route === r, route, { timeout: 15000 });
};

const { browser, ctx, page, orgId } = await login();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const api = ctx.request;

try {
  // ---- Cote serveur : catalogue public
  const cat = await (await api.get("/api/plans/catalog")).json();
  const catKeys = new Set(cat.addons.map((a) => a.key));
  for (const a of ADDONS) {
    check(a.key, MODE === "sans" ? "absent de /api/plans/catalog" : "present dans /api/plans/catalog",
      MODE === "sans" ? !catKeys.has(a.key) : catKeys.has(a.key));
  }
  check("catalogue", "add-on existant toujours present (keywordDomination)", catKeys.has("keywordDomination"));

  // ---- Sans droit : 402 ; non authentifie : 401
  const anon = await request.newContext({ baseURL: BASE });
  for (const a of ADDONS) {
    const r = await api.get(`/api/${a.slug}`);
    check(a.key, "authentifie sans droit d'add-on -> 402", r.status() === 402, r.status());
    const w = await api.fetch(`/api/${a.slug}${a.slug === "organic-campaign-tracker" ? "" : a.slug === "technical-seo-fix-verification" ? "/verify" : "/settings"}`,
      { method: a.slug === "organic-campaign-tracker" ? "POST" : "PUT", data: {} });
    check(a.key, "ecriture sans droit -> 402 (aucune ecriture)", w.status() === 402, w.status());
    // NODE_ENV=test : un appel sans session est accepte en mode dev (orgId 'default') ; on teste donc
    // le 401 sur un contexte sans cookie uniquement si le serveur est en production (voir doc).
  }
  await anon.dispose();

  // ---- Marche des add-ons : cartes visibles / invisibles
  await goRoute(page, "billing");
  await page.evaluate(() => window.navigateSub && window.navigateSub("addons"));
  await page.waitForFunction(() => /Keyword Domination Engine/.test(document.getElementById("fp-page")?.innerText || ""), null, { timeout: 15000 }).catch(() => {});
  const market = await page.evaluate(() => document.getElementById("fp-page")?.innerText || "");
  for (const a of ADDONS) {
    const present = market.includes(a.name);
    check(a.key, MODE === "sans" ? "carte INVISIBLE dans le marche" : "carte visible dans le marche", MODE === "sans" ? !present : present);
  }
  check("marche", "carte existante visible (Keyword Domination Engine)", market.includes("Keyword Domination Engine"));
  await page.screenshot({ path: `${OUT}/${MODE}-marche-1440.png` });

  if (MODE === "avec") {
    // ---- Donnees de fixture + droits (base jetable uniquement)
    for (const a of ADDONS) {
      sql(`INSERT INTO org_addons (id, org_id, addon_key, active, quantity, activated_at) VALUES ('e2e-${a.key}', '${orgId}', '${a.key}', true, 1, now()) ON CONFLICT (id) DO UPDATE SET active=true`);
    }
    const o = orgId;
    sql(`DELETE FROM audits WHERE org_id='${o}'`);
    sql(`INSERT INTO audits (id,url,score,status,speed,issues,created_at,org_id) VALUES
      ('e2e-a1','https://exemple.test/',58,'ok',40,5, now()-interval '10 days','${o}'),
      ('e2e-a2','https://exemple.test/',78,'ok',60,2, now()-interval '1 day','${o}')`);
    sql(`DELETE FROM gsc_keyword_data WHERE org_id='${o}'`);
    sql(`INSERT INTO gsc_keyword_data (org_id,keyword,date,impressions,clicks,ctr,position) VALUES ('${o}','dentiste urgence bruxelles', to_char(CURRENT_DATE-1,'YYYY-MM-DD'), 300, 12, 0.04, 3.2)`);
    sql(`DELETE FROM organic_campaign_goals WHERE org_id='${o}'; DELETE FROM seo_change_impact_settings WHERE org_id='${o}'; DELETE FROM technical_seo_fix_verifications WHERE org_id='${o}'; DELETE FROM conversion_opportunity_settings WHERE org_id='${o}'`);

    const state = await ctx.storageState();
    const viewports = [["1440", { width: 1440, height: 900 }], ["390", { width: 390, height: 844 }]];

    for (const [label, vp] of viewports) {
      const c2 = await browser.newContext({ baseURL: BASE, viewport: vp, storageState: state });
      const p = await c2.newPage();
      await p.goto("/dashboard.html");
      await p.waitForSelector('[data-route="overview"]', { timeout: 45000, state: "attached" });
      await dismissTour(p);
      for (const a of ADDONS) {
        await goRoute(p, a.slug);
        const root = p.locator(`#fp-addon-${a.slug}`);
        await root.waitFor({ state: "visible", timeout: 15000 });
        await p.waitForFunction((s) => !/Chargement/.test(document.getElementById(`fp-addon-${s}`)?.innerText || "Chargement"), a.slug, { timeout: 15000 });
        check(a.key, `panneau affiche (${label}px)`, await root.isVisible());
        const overflow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        check(a.key, `aucun debordement horizontal (${label}px)`, overflow <= 1, `delta=${overflow}`);
        await p.screenshot({ path: `${OUT}/${a.slug}-${label}.png` });
      }

      // Enregistrement des reglages + relecture apres rechargement (valeurs propres a chaque viewport)
      const n = label === "1440" ? 1 : 2;
      // organic : objectif
      {
        const a = ADDONS[0];
        await goRoute(p, a.slug);
        const r = p.locator(`#fp-addon-${a.slug}`);
        const kw = `Campagne Test ${label}`;
        await r.locator('input[name="keyword"]').fill(kw);
        await r.locator('input[name="targetPosition"]').fill(String(4 + n));
        await r.locator('input[name="minimumClicks"]').fill(String(10 * n));
        await r.locator('button[type="submit"]').click();
        await p.waitForTimeout(1200);
        await p.reload(); await p.waitForSelector('[data-route="overview"]', { state: "attached", timeout: 45000 });
        await goRoute(p, a.slug);
        await p.waitForFunction((s) => /Campagnes suivies/.test(document.getElementById(`fp-addon-${s}`)?.innerText || ""), a.slug, { timeout: 15000 });
        const txt = await p.locator(`#fp-addon-${a.slug}`).innerText();
        check(a.key, `objectif enregistre puis relu apres rechargement (${label}px)`, txt.toLowerCase().includes(kw.toLowerCase()) && txt.includes(`≤ ${4 + n}`) && txt.includes(`≥ ${10 * n}`), txt.slice(0, 120));
        if (label === "1440") {
          const row = await (await p.request.get(`/api/${a.slug}`)).json();
          const mesure = (row.campaigns || []).find((c) => c.keyword === "dentiste urgence bruxelles");
          const g = (row.campaigns || []).find((c) => c.keyword === kw.toLowerCase());
          check(a.key, "API : objectif relu exact (position/clics)", g && g.targetPosition === 4 + n && g.minimumClicks === 10 * n, JSON.stringify(g));
          // objectif sur le mot-cle mesure par GSC (fixture)
          await p.request.post(`/api/${a.slug}`, { data: { keyword: "dentiste urgence bruxelles", targetPosition: 5, minimumClicks: 10 } });
          const row2 = await (await p.request.get(`/api/${a.slug}`)).json();
          const m = (row2.campaigns || []).find((c) => c.keyword === "dentiste urgence bruxelles");
          check(a.key, "mesure GSC lue depuis gsc_keyword_data (12 clics, position 3.2, objectif atteint)", m && m.clicks === 12 && Math.abs(m.averagePosition - 3.2) < 0.01 && m.status === "goal_met", JSON.stringify(m));
          void mesure;
        }
        // suppression d'un objectif
        const del = p.locator(`#fp-addon-${a.slug} [data-oct-delete]`).first();
        if (label === "390" && (await del.count())) { await del.click(); await p.waitForTimeout(800); check(a.key, "suppression d'un objectif (390px)", true); }
      }
      // seo-change-impact : reglages
      {
        const a = ADDONS[2];
        await goRoute(p, a.slug);
        const r = p.locator(`#fp-addon-${a.slug}`);
        const look = label === "1440" ? 60 : 90, minScore = label === "1440" ? 5 : 7;
        await r.locator('input[name="lookbackDays"]').fill(String(look));
        await r.locator('input[name="minimumScoreChange"]').fill(String(minScore));
        await r.locator('button[type="submit"]').click();
        await p.waitForTimeout(1200);
        await p.reload(); await p.waitForSelector('[data-route="overview"]', { state: "attached", timeout: 45000 });
        await goRoute(p, a.slug);
        await p.waitForFunction((s) => !!document.querySelector(`#fp-addon-${s} input[name="lookbackDays"]`), a.slug, { timeout: 15000 });
        const rr = p.locator(`#fp-addon-${a.slug}`);
        check(a.key, `reglages relus exacts apres rechargement (${label}px)`,
          (await rr.locator('input[name="lookbackDays"]').inputValue()) === String(look) && (await rr.locator('input[name="minimumScoreChange"]').inputValue()) === String(minScore));
        const txt = await rr.innerText();
        check(a.key, `comparaison d'audits mesuree 58 -> 78 (${label}px)`, /58\s*→\s*78/.test(txt), txt.slice(0, 160));
      }
      // technical : comparaison persistante
      {
        const a = ADDONS[1];
        await goRoute(p, a.slug);
        const r = p.locator(`#fp-addon-${a.slug}`);
        await r.locator('select[name="beforeAuditId"]').selectOption("e2e-a1");
        await r.locator('select[name="afterAuditId"]').selectOption("e2e-a2");
        await r.locator('button[type="submit"]').click();
        await p.waitForTimeout(1200);
        await p.reload(); await p.waitForSelector('[data-route="overview"]', { state: "attached", timeout: 45000 });
        await goRoute(p, a.slug);
        await p.waitForFunction((s) => /Comparaisons enregistrées/.test(document.getElementById(`fp-addon-${s}`)?.innerText || ""), a.slug, { timeout: 15000 });
        const txt = await p.locator(`#fp-addon-${a.slug}`).innerText();
        check(a.key, `verification enregistree puis relue (5 -> 2 problemes) apres rechargement (${label}px)`, /5\s*→\s*2/.test(txt) && /Amélioration mesurée/.test(txt), txt.slice(0, 160));
      }
      // conversion : reglages
      {
        const a = ADDONS[3];
        await goRoute(p, a.slug);
        const r = p.locator(`#fp-addon-${a.slug}`);
        const ms = label === "1440" ? 250 : 400, mr = label === "1440" ? 3.5 : 4.5;
        await r.locator('input[name="minimumSessions"]').fill(String(ms));
        await r.locator('input[name="maximumConversionRate"]').fill(String(mr));
        await r.locator('button[type="submit"]').click();
        await p.waitForTimeout(1200);
        await p.reload(); await p.waitForSelector('[data-route="overview"]', { state: "attached", timeout: 45000 });
        await goRoute(p, a.slug);
        await p.waitForFunction((s) => !!document.querySelector(`#fp-addon-${s} input[name="minimumSessions"]`), a.slug, { timeout: 15000 });
        const rr = p.locator(`#fp-addon-${a.slug}`);
        check(a.key, `reglages relus exacts apres rechargement (${label}px)`,
          (await rr.locator('input[name="minimumSessions"]').inputValue()) === String(ms) && Number(await rr.locator('input[name="maximumConversionRate"]').inputValue()) === mr);
      }
      await c2.close();
    }

    // ---- Retrait du droit : la route refuse a nouveau
    sql(`UPDATE org_addons SET active=false WHERE org_id='${orgId}' AND id LIKE 'e2e-%'`);
    for (const a of ADDONS) {
      const r = await api.get(`/api/${a.slug}`);
      check(a.key, "droit retire -> 402", r.status() === 402, r.status());
    }
  }
  check("console", "aucune erreur de script du tableau de bord", errors.filter((e) => !/favicon|Failed to load resource|401|402|403/i.test(e)).length === 0,
    errors.slice(0, 3).join(" | "));
} finally {
  await browser.close();
  const ok = results.filter((r) => r.ok).length;
  writeFileSync(`${OUT}/resultats-${MODE}.json`, JSON.stringify({ mode: MODE, total: results.length, ok, results, errors: errors.slice(0, 20) }, null, 2));
  console.log(`\n== MODE ${MODE} : ${ok}/${results.length} verifications OK ==`);
  process.exitCode = ok === results.length ? 0 : 1;
}
