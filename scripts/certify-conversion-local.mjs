#!/usr/bin/env node
/**
 * Certification LOCALE du parcours de conversion (aucun acces externe, aucun paiement).
 *
 *   BASE_URL=http://127.0.0.1:8791 ADMIN_KEY=... node scripts/certify-conversion-local.mjs
 *
 * Pilote un vrai serveur FlowPoint (base jetable) avec un navigateur mobile 390 px et trois
 * visiteurs synthetiques, puis lit les deux tableaux de bord. S'arrete a la frontiere Stripe :
 * le Checkout TEST est couvert par docs/CERTIFICATION-CONVERSION-PROTOCOLE.md.
 * Code de sortie 0 seulement si TOUS les controles passent.
 */
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = (process.env.BASE_URL || "http://127.0.0.1:8791").replace(/\/$/, "");
const ADMIN_KEY = process.env.ADMIN_KEY || "";
const LID = "AbCdEfGhIjKlMnOpQr_-12";               // fp_lid synthetique (22 caracteres)
const RUN = Math.random().toString(36).slice(2, 8);
const checks = [];
const check = (id, ok, detail = "") => { checks.push({ id, ok: !!ok, detail }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? "  — " + detail : ""}`); };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {});
const viewport = { width: 390, height: 844 };

async function visitor({ consent }) {
  const ctx = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  if (consent) await ctx.addCookies([{ name: "fp_analytics_consent", value: "accepted", url: BASE }]);
  const page = await ctx.newPage();
  const events = [], signups = [];
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    const u = new URL(r.url());
    if (u.pathname === "/api/public/funnel-event") { try { events.push(JSON.parse(r.postData() || "{}")); } catch {} }
    if (u.pathname === "/api/auth/pre-register") { try { signups.push(JSON.parse(r.postData() || "{}")); } catch {} }
  });
  return { ctx, page, events, signups };
}
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
const store = (page, k) => page.evaluate((key) => localStorage.getItem(key), k);

// ── 1. Transparence de l'essai (FAQ de la page tarifs, EN puis FR) ───────────────────────────
{
  const v = await visitor({ consent: false });
  await v.page.goto(`${BASE}/pricing.html?lang=en`, { waitUntil: "domcontentloaded" });
  await v.page.waitForTimeout(1200);
  const en = await v.page.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll(".fp-faq-a")].map((e) => e.textContent).join(" "));
  check("1a trial FAQ (EN): plan chosen before, card required, nothing charged during trial, automatic charge unless cancelled",
    /choose your plan before you start/i.test(en) && /credit card is required/i.test(en) && /nothing is charged during the trial/i.test(en) && /charged automatically, unless you cancel/i.test(en));
  check("1b no misleading wording ('choose the plan that fits your needs' after the trial)", !/after your 14-day trial, choose the plan/i.test(en));
  await v.ctx.close();
  const f = await visitor({ consent: false });
  await f.page.goto(`${BASE}/pricing.html?lang=fr`, { waitUntil: "domcontentloaded" });
  await f.page.waitForTimeout(1200);
  const fr = await f.page.evaluate(() => [...document.querySelectorAll(".fp-faq-a")].map((e) => e.textContent).join(" "));
  check("1c trial FAQ (FR): carte requise, rien debite pendant l'essai, debit automatique sauf annulation",
    /carte bancaire est requise/i.test(fr) && /rien n.est débité pendant l.essai/i.test(fr) && /débitée automatiquement, sauf si vous annulez/i.test(fr));
  await f.ctx.close();
}

// ── Visiteur A : consentant, Smartlead + UTM + fp_lid, langue FR, s'inscrit ──────────────────
const A = await visitor({ consent: true });
{
  const q = `?fp_src=smartlead&utm_source=instagram&utm_medium=social&utm_campaign=reel_${RUN}&fp_lid=${LID}&lang=fr`;
  await A.page.goto(`${BASE}/pricing.html${q}`, { waitUntil: "domcontentloaded" });
  await A.page.waitForTimeout(1500);
  check("2a mobile 390px: no horizontal page overflow on pricing", !(await overflow(A.page)));
  const pro = await A.page.evaluate(() => { const c = document.querySelector(".fp-card.featured"); const r = c.getBoundingClientRect(); return { left: r.left, right: r.right, w: innerWidth }; });
  check("2b mobile: the featured Pro card is fully visible without scrolling", pro.left >= 0 && pro.right <= pro.w, JSON.stringify(pro));
  const tiny = await A.page.evaluate(() => [...document.querySelectorAll("button, a.fp-btn")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.height < 32; }).length);
  check("2c mobile: no tap target under 32px", tiny === 0, `${tiny} found`);
  check("4a language: ?lang=fr stored once (no stored preference)", (await store(A.page, "fp:language")) === "fr");
  check("3a tarifs_vus emitted once, with the consenting visitor and the opaque lead id",
    A.events.filter((e) => e.etape === "tarifs_vus").length === 1 && A.events.some((e) => e.etape === "tarifs_vus" && e.visiteurId && e.fp_lid === LID));
  check("3b UTM campaign carried in the tracking request", A.events.some((e) => e.utm_source === "instagram" && e.utm_campaign === `reel_${RUN}`));
  // clic sur le plan Pro (visiteur anonyme)
  await A.page.locator('.fp-card-btn[data-plan="pro"]').first().tap();
  await A.page.waitForURL(/signin\.html/, { timeout: 15000 });
  const cart = JSON.parse((await store(A.page, "fp_cart")) || "null");
  check("5a plan kept: pricing -> signin keeps plan=pro in the cart", cart && cart.plan === "pro", JSON.stringify(cart));
  check("3c cta_clique emitted with the plan", A.events.some((e) => e.etape === "cta_clique" && e.plan === "pro"));
  check("4b language kept on signin page (FR, not forced to EN)", (await A.page.evaluate(() => document.documentElement.lang)) === "fr");
  check("2d mobile: no horizontal overflow on signin", !(await overflow(A.page)));
  // inscription
  await A.page.fill("#firstName", "Test"); await A.page.fill("#lastName", `Sim${RUN}`); await A.page.fill("#email", `sim-a-${RUN}@example.test`);
  await A.page.locator("#signup-btn").tap();
  await A.page.waitForURL((u) => u.pathname.endsWith("/checkout.html"), { timeout: 20000 }).catch(() => {});
  check("5b plan kept: after sign-up the visitor lands on the checkout of the chosen plan", new URL(A.page.url()).pathname.endsWith("/checkout.html") && /plan=pro/.test(A.page.url()), A.page.url().replace(BASE, ""));
  check("3d signup body carries visitor, source, lead id and campaign",
    A.signups.length === 1 && !!A.signups[0].visiteurId && A.signups[0].source === "smartlead" && A.signups[0].fp_lid === LID && A.signups[0].utm_campaign === `reel_${RUN}`, JSON.stringify(Object.keys(A.signups[0] || {})));
  // rechargements le meme jour : aucun double comptage
  for (let i = 0; i < 2; i++) { await A.page.goto(`${BASE}/pricing.html`, { waitUntil: "domcontentloaded" }); await A.page.waitForTimeout(600); }
}

// ── Visiteur B : consentant, abandonne apres les tarifs ──────────────────────────────────────
const B = await visitor({ consent: true });
{
  await B.page.goto(`${BASE}/pricing.html?fp_src=google&lang=en`, { waitUntil: "domcontentloaded" });
  await B.page.waitForTimeout(1200);
  await B.page.locator('.fp-card-btn[data-plan="standard"]').first().tap();
  await B.page.waitForURL(/signin\.html/, { timeout: 15000 });
  await B.page.waitForTimeout(800);
  check("6a abandonment measured: B emitted tarifs_vus and cta_clique, nothing after", B.events.some((e) => e.etape === "tarifs_vus") && B.events.some((e) => e.etape === "cta_clique") && B.signups.length === 0);
  check("4c language: ?lang=en kept, no French forced", (await B.page.evaluate(() => document.documentElement.lang)) === "en");
}

// ── Visiteur C : SANS consentement, s'inscrit ────────────────────────────────────────────────
const C = await visitor({ consent: false });
{
  await C.page.goto(`${BASE}/pricing.html?fp_lid=${LID}&utm_source=instagram&lang=xx`, { waitUntil: "domcontentloaded" });
  await C.page.waitForTimeout(1200);
  check("7a no consent: no tracking request at all", C.events.length === 0);
  check("7b no consent: UTM and language-less link store nothing", (await store(C.page, "fp_funnel_campaign")) === null);
  check("4d unknown ?lang=xx ignored, English fallback (never French by default)", (await store(C.page, "fp:language")) === null && (await C.page.evaluate(() => document.documentElement.lang)) === "en");
  await C.page.goto(`${BASE}/signin.html?plan=enterprise`, { waitUntil: "domcontentloaded" });
  check("5c plan allow-list: ?plan=enterprise is ignored (no cart created)", (await store(C.page, "fp_cart")) === null);
  await C.page.goto(`${BASE}/signin.html?plan=ultra`, { waitUntil: "domcontentloaded" });
  check("5d plan allow-list: ?plan=ultra seeds the cart and is removed from the URL", JSON.parse((await store(C.page, "fp_cart")) || "null")?.plan === "ultra" && !/plan=/.test(C.page.url()));
  await C.page.fill("#firstName", "Anon"); await C.page.fill("#lastName", `Sim${RUN}`); await C.page.fill("#email", `sim-c-${RUN}@example.test`);
  await C.page.locator("#signup-btn").tap();
  await C.page.waitForURL((u) => u.pathname.endsWith("/checkout.html"), { timeout: 20000 }).catch(() => {});
  check("7c no consent: sign-up works and the plan is kept", new URL(C.page.url()).pathname.endsWith("/checkout.html") && /plan=ultra/.test(C.page.url()), C.page.url().replace(BASE, ""));
  check("7d no consent: the sign-up body carries no visitor id and no campaign", C.signups.length === 1 && !C.signups[0].visiteurId && !C.signups[0].utm_campaign && !C.signups[0].utm_source);
}

// ── Tableaux de bord ─────────────────────────────────────────────────────────────────────────
await new Promise((r) => setTimeout(r, 2500)); // emissions serveur non bloquantes
if (!ADMIN_KEY) { check("8 dashboards", false, "ADMIN_KEY missing"); }
else {
  const today = new Date().toISOString().slice(0, 10);
  const get = async (p) => (await fetch(`${BASE}/api/admin/conversion/${p}?from=${today}&to=${today}`, { headers: { "x-admin-key": ADMIN_KEY } })).json();
  const g = await get("global"), o = await get("outbound");
  const s = (d, k) => d.stages?.find((x) => x.key === k);
  check("8a global: pricing views = 2 events / 2 unique consenting visitors (A once despite 3 loads, B once; C not counted)", s(g, "tarifs_vus")?.events === 2 && s(g, "tarifs_vus")?.uniqueVisitors === 2, JSON.stringify(s(g, "tarifs_vus")));
  check("8b global: CTA clicks counted for A and B", s(g, "cta_clique")?.events >= 2, JSON.stringify(s(g, "cta_clique")));
  check("8c global: only the consenting sign-up (A) is recorded; the non-consenting one (C) leaves no trace in the funnel", s(g, "signup_form_completed")?.events === 1 && s(g, "signup_form_completed")?.uniqueVisitors === 1 && s(g, "signup_form_completed")?.coverage === "consented", JSON.stringify(s(g, "signup_form_completed")));
  check("8d global: a click is never reported as a payment (no paid stage without Stripe)", (s(g, "subscription_activated")?.events ?? 0) === 0 && (s(g, "trial_activated")?.events ?? 0) === 0);
  check("8e global: consenting -> all-visitor stages give no misleading ratio", g.rates?.find((r) => r.from === "checkout_started" && r.to === "trial_activated")?.ratio === null && g.rates?.find((r) => r.from === "signup_started" && r.to === "signup_form_completed")?.reason === "ok");
  check("8f outbound: only the Smartlead visitor (A) is counted", s(o, "tarifs_vus")?.uniqueVisitors === 1 && o.measurableVisitors === 1, `measurable=${o.measurableVisitors}`);
  check("8g outbound: lead-level data is not duplicated here and nothing personal is exposed", o.external?.prospectsContacted?.status === "not_available_in_saas" && !JSON.stringify([g, o]).match(new RegExp(`${LID}|@example\\.test|reel_${RUN}`)));
  const noKey = await fetch(`${BASE}/api/admin/conversion/global?from=${today}&to=${today}`);
  check("8h dashboards refuse access without the admin key", noKey.status === 403);
}

await browser.close();
const failed = checks.filter((c) => !c.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} controles reussis`);
process.exit(failed.length ? 1 : 0);
