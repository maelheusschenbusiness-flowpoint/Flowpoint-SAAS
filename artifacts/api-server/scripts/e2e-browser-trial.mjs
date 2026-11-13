#!/usr/bin/env node
/**
 * E2E navigateur (Playwright/Chromium local) — essai sans carte.
 *
 * Hors reseau : seules les requetes vers E2E_BASE_URL sont autorisees, toute
 * autre requete (polices, Stripe.js, CDN…) est interceptee et abandonnee.
 * A lancer contre le serveur local isole et son PostgreSQL jetable (jamais la
 * production) :
 *
 *   E2E_PHASE=flag-on  E2E_BASE_URL=http://127.0.0.1:38123 DATABASE_URL=postgres://…@127.0.0.1:…/… \
 *   E2E_SHOTS=/chemin/captures [PW_CHROMIUM=/opt/pw-browsers/chromium] node scripts/e2e-browser-trial.mjs
 *   E2E_PHASE=flag-off …   (serveur relance sans TRIAL_WITHOUT_CARD)
 */
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL ?? "http://127.0.0.1:38123";
const DB_URL = process.env.DATABASE_URL ?? "";
const SHOTS = process.env.E2E_SHOTS ?? "./trial-shots";
const PHASE = process.env.E2E_PHASE ?? "flag-on";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(DB_URL)) { console.error("DATABASE_URL doit viser une base LOCALE"); process.exit(2); }
mkdirSync(SHOTS, { recursive: true });

const db = new pg.Pool({ connectionString: DB_URL });
const q = async (s, v = []) => (await db.query(s, v)).rows;
const RUN = Date.now().toString(36);
let pass = 0, fail = 0; const out = [];
const check = (n, c, d = "") => { c ? pass++ : fail++; out.push(`${c ? "PASS" : "FAIL"}  ${n}${d ? "  — " + d : ""}`); };

const browser = await chromium.launch(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const blocked = [];
await ctx.route("**/*", route => {
  const u = route.request().url();
  if (u.startsWith(BASE)) return route.continue();
  blocked.push(new URL(u).host); return route.abort();
});
function watch(page) {
  const errs = { pageErrors: [], console: [], http: [] };
  page.on("response", async r => {
    if (r.status() < 400) return;
    let code = ""; try { code = (await r.json())?.code ?? ""; } catch { /* corps non JSON */ }
    errs.http.push({ status: r.status(), path: new URL(r.url()).pathname, code });
  });
  page.on("pageerror", e => errs.pageErrors.push(String(e.message).slice(0, 200)));
  page.on("console", m => { if (m.type() === "error") errs.console.push(m.text().slice(0, 200)); });
  return errs;
}
// Erreurs console attendues : ressources externes volontairement bloquees
// (hors reseau) et le 402 lui-meme, que Chromium journalise comme « Failed to
// load resource ». Toute AUTRE erreur fait echouer le test.
// Les reponses HTTP en erreur sont verifiees une a une (errs.http) : Chromium
// les journalise toutes comme « Failed to load resource », sans le code metier.
const unexpected = (errs) => errs.console.filter(t =>
  !/net::ERR_FAILED|ERR_BLOCKED|Failed to load resource: the server responded with a status of/.test(t));

if (PHASE === "flag-on") {
  // ── 1. Formulaire reduit ─────────────────────────────────────────────────
  const email = `nav.${RUN}@nav-${RUN}.fr`;
  const fpLid = crypto.randomBytes(16).toString("base64url").slice(0, 22);
  let page = await ctx.newPage(); let errs = watch(page);
  await page.goto(`${BASE}/signin.html?fp_lid=${fpLid}`);
  await page.waitForFunction(() => document.getElementById("signup-btn")?.textContent?.includes("Démarrer mon essai"), null, { timeout: 15000 });
  const visible = async id => page.locator(`#${id}`).isVisible();
  check("drapeau ON : email, prénom, entreprise visibles",
    (await visible("email")) && (await visible("firstName")) && (await visible("companyName")));
  check("drapeau ON : nom, pays, adresse, ville, code postal, téléphone, TVA masqués",
    !(await visible("lastName")) && !(await visible("country")) && !(await visible("address")) && !(await visible("city"))
    && !(await visible("postalCode")) && !(await visible("phone")) && !(await visible("vat")));
  check("drapeau ON : mention « Sans carte bancaire »", await page.locator("#cardless-note").isVisible());
  await page.screenshot({ path: `${SHOTS}/01-signin-flag-on-formulaire-reduit.png`, fullPage: true });
  await page.fill("#firstName", "Léa"); await page.fill("#email", email);
  await page.click("#signup-btn");
  await page.waitForSelector("#trial-sent-screen", { state: "visible", timeout: 15000 });
  check("drapeau ON : soumission → écran « Votre essai gratuit est prêt »",
    (await page.locator("#trial-sent-screen h1").textContent())?.includes("essai gratuit est prêt"));
  await page.screenshot({ path: `${SHOTS}/02-signin-flag-on-essai-pret.png`, fullPage: true });
  const [org] = await q(`SELECT id, subscription_status, stripe_customer_id, fp_lid, trial_origin FROM organizations WHERE owner_email=$1`, [email]);
  check("drapeau ON : org trialing, trial_origin=cardless, fp_lid propagé, aucun client Stripe",
    org?.subscription_status === "trialing" && org?.trial_origin === "cardless" && org?.fp_lid === fpLid && !org?.stripe_customer_id);
  check("drapeau ON : aucune exception JS sur signin", errs.pageErrors.length === 0, errs.pageErrors.join(" | "));
  check("drapeau ON : aucune erreur console inattendue sur signin", unexpected(errs).length === 0, unexpected(errs).join(" | "));

  // Second essai, meme boite (variante +tag)
  page = await ctx.newPage(); errs = watch(page);
  await page.goto(`${BASE}/signin.html`);
  await page.waitForFunction(() => document.getElementById("signup-btn")?.textContent?.includes("Démarrer mon essai"), null, { timeout: 15000 });
  await page.fill("#firstName", "Léa"); await page.fill("#email", email.replace("@", "+bis@"));
  await page.click("#signup-btn");
  await page.waitForSelector("#signup-msg.error", { timeout: 15000 });
  const msg = await page.locator("#signup-msg").textContent();
  check("drapeau ON : second essai (même boîte, +tag) → message d'erreur affiché", /essai gratuit a déjà été utilisé/.test(msg ?? ""), msg ?? "");
  check("drapeau ON : le message propose de continuer vers /login.html", await page.locator('#signup-msg a[href="/login.html"]').count() === 1);
  await page.screenshot({ path: `${SHOTS}/03-signin-flag-on-second-essai-refuse.png`, fullPage: true });

  // ── 2. Bandeau 402 du dashboard ──────────────────────────────────────────
  const [tok] = await q(`SELECT token FROM magic_link_tokens WHERE email=$1 AND used=FALSE ORDER BY expires_at DESC LIMIT 1`, [email]);
  page = await ctx.newPage(); errs = watch(page);
  await page.goto(`${BASE}/login-verify.html?token=${tok.token}`);
  await page.waitForURL(/dashboard\.html/, { timeout: 30000 });
  await page.waitForFunction(() => typeof window.apiFetch === "function" || typeof apiFetch === "function", null, { timeout: 30000 });
  await page.waitForTimeout(3000);
  check("dashboard pendant l'essai : pas de bandeau", await page.locator("#fp-trial-expired-banner").count() === 0);
  const beforeExpiry = new Set(errs.http.map(h => `${h.status} ${h.path}`));
  out.push(`INFO  pendant l'essai, réponses >= 400 préexistantes (gardes de plan Standard, hors PR) : ${[...beforeExpiry].join(", ") || "aucune"}`);
  await page.screenshot({ path: `${SHOTS}/04-dashboard-pendant-essai.png` });
  await q(`UPDATE organizations SET trial_ends_at = NOW() - INTERVAL '1 minute' WHERE id=$1`, [org.id]);
  await page.waitForTimeout(31000); // cache du garde serveur (30 s)
  // `apiFetch` global = celui de fp-backend.js (window.apiFetch), utilise par les modules du dashboard.
  const status = await page.evaluate(async () => {
    try { await apiFetch("/api/ai/recommendations"); return "ok"; } catch (e) { return `${e.status}:${e.code}:${String(e.message).slice(0,120)}`; }
  });
  check("dashboard après échéance : appel coûteux réel → 402 TRIAL_EXPIRED", status.startsWith("402:TRIAL_EXPIRED"), status);
  await page.waitForSelector("#fp-trial-expired-banner", { state: "visible", timeout: 5000 });
  const bannerText = await page.locator("#fp-trial-expired-banner .fp-trial-expired-text").textContent();
  const href = await page.locator("#fp-trial-expired-banner .fp-trial-expired-cta").getAttribute("href");
  check("bandeau : message serveur affiché", /essai gratuit est terminé/.test(bannerText ?? ""), bannerText ?? "");
  check("bandeau : lien de paiement vers la facturation", href === "/dashboard.html#billing/plans", href ?? "");
  await page.evaluate(async () => { try { await apiFetch("/api/seo/overview"); } catch (_) {} });
  check("bandeau : unique après plusieurs 402", await page.locator("#fp-trial-expired-banner").count() === 1);
  await page.screenshot({ path: `${SHOTS}/05-dashboard-bandeau-402-trial-expired.png` });
  await page.locator("#fp-trial-expired-banner").screenshot({ path: `${SHOTS}/06-bandeau-402-zoom.png` });
  await page.click("#fp-trial-expired-banner .fp-trial-expired-cta");
  await page.waitForTimeout(2500);
  check("bandeau : le lien ouvre la page Facturation du dashboard", /#billing/.test(page.url()), page.url());
  await page.screenshot({ path: `${SHOTS}/07-dashboard-facturation-apres-clic.png` });
  check("dashboard : aucune exception JS", errs.pageErrors.length === 0, errs.pageErrors.join(" | "));
  check("dashboard : aucune erreur console JS inattendue", unexpected(errs).length === 0, unexpected(errs).slice(0, 5).join(" | "));
  const newErr = errs.http.filter(h => !beforeExpiry.has(`${h.status} ${h.path}`));
  const notTrial = newErr.filter(h => !(h.status === 402 && h.code === "TRIAL_EXPIRED"));
  check("dashboard après échéance : toute nouvelle réponse en erreur est un 402 TRIAL_EXPIRED", notTrial.length === 0,
    notTrial.map(h => `${h.status} ${h.path} ${h.code}`).join(", "));
  out.push(`INFO  après échéance, 402 TRIAL_EXPIRED : ${[...new Set(newErr.map(h => h.path))].join(", ")}`);
} else {
  // ── Drapeau OFF : parcours carte inchange ───────────────────────────────
  const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(`${BASE}/signin.html`);
  await page.waitForTimeout(2500); // /auth/providers repond trialWithoutCard:false
  const all = ["firstName", "lastName", "email", "companyName", "country", "address", "city", "postalCode", "phone", "vat"];
  const vis = await Promise.all(all.map(id => page.locator(`#${id}`).isVisible()));
  check("drapeau OFF : les 10 champs du parcours carte sont affichés", vis.every(Boolean), all.filter((_, i) => !vis[i]).join(","));
  check("drapeau OFF : bouton « Continuer vers le choix du plan »",
    (await page.locator("#signup-btn").textContent())?.includes("Continuer vers le choix du plan"));
  check("drapeau OFF : pas de mention « sans carte »", !(await page.locator("#cardless-note").isVisible()));
  await page.screenshot({ path: `${SHOTS}/08-signin-flag-off-parcours-carte.png`, fullPage: true });
  await page.fill("#firstName", "Paul"); await page.fill("#lastName", "Durand");
  await page.fill("#email", `card.${RUN}@card-${RUN}.fr`); await page.fill("#companyName", "Agence Carte");
  await page.fill("#address", "1 rue de la Paix"); await page.fill("#city", "Paris"); await page.fill("#postalCode", "75001");
  await page.click("#signup-btn");
  await page.waitForSelector("#plan-screen", { state: "visible", timeout: 15000 });
  check("drapeau OFF : soumission → choix du plan « Carte requise » (inchangé)",
    /Carte requise/.test((await page.locator("#plan-screen .card-sub").textContent()) ?? ""));
  const [o] = await q(`SELECT COUNT(*)::int AS n FROM organizations WHERE owner_email=$1`, [`card.${RUN}@card-${RUN}.fr`]);
  check("drapeau OFF : aucune organisation créée avant paiement", o.n === 0);
  await page.screenshot({ path: `${SHOTS}/09-signin-flag-off-choix-plan-carte-requise.png`, fullPage: true });
  check("drapeau OFF : aucune exception JS", errs.pageErrors.length === 0, errs.pageErrors.join(" | "));
  check("drapeau OFF : aucune erreur console inattendue", unexpected(errs).length === 0, unexpected(errs).join(" | "));
}

console.log(out.join("\n"));
console.log(`\nNavigateur (${PHASE}) : ${pass} PASS / ${fail} FAIL — requêtes externes bloquées : ${[...new Set(blocked)].join(", ") || "aucune"}`);
await browser.close(); await db.end();
process.exit(fail ? 1 : 0);
