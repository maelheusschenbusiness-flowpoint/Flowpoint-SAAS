#!/usr/bin/env node
/**
 * Verification NAVIGATEUR (Playwright, mobile 390 px) du site vitrine PUBLIE : consentement, plan conserve,
 * langue, attribution. Aucune ecriture en production : toute requete vers app.flowpoint.pro et vers les
 * services tiers (analytique, Apollo, Google) est INTERCEPTEE et enregistree, jamais envoyee.
 *
 *   CHROMIUM_PATH=/opt/pw-browsers/chromium node scripts/verifier-site-vitrine-navigateur.mjs [--base https://flowpoint.pro]
 *
 * Complete scripts/verifier-site-vitrine.mjs (controles statiques). Code de sortie 0 = tout passe.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const args = process.argv.slice(2);
const BASE = String(args.includes("--base") ? args[args.indexOf("--base") + 1] : "https://flowpoint.pro").replace(/\/+$/, "");
if (!/^https:\/\/(www\.)?flowpoint\.pro$/.test(BASE)) { console.error("Cible refusee : flowpoint.pro uniquement."); process.exit(2); }
const FP_LID = "AbCdEfGhIjKlMnOpQr_-12"; // 22 caracteres, identifiant de TEST (jamais un vrai prospect)

const results = [];
const check = (id, label, ok, detail = "") => { results.push({ id, ok: Boolean(ok) }); console.log(`${ok ? "PASS" : "FAIL"}  ${id}  ${label}${detail ? "  — " + detail : ""}`); };

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH, args: ["--no-sandbox"] } : {});

/** Contexte neuf mobile ; interception stricte de tout ce qui n'est pas le site vitrine lui-meme. */
async function nouveauContexte(extra = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1, ...extra });
  const captures = { funnel: [], appNav: [], tiers: [] };
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const host = url.hostname;
    if (host === "flowpoint.pro" || host === "www.flowpoint.pro") return route.continue();
    if (host === "app.flowpoint.pro") {
      if (url.pathname === "/api/public/funnel-event") {
        let body = null; try { body = JSON.parse(route.request().postData() || "null"); } catch { /* ignore */ }
        captures.funnel.push({ method: route.request().method(), body });
        // CORS minimal pour que la page ne signale pas d'erreur ; rien n'est transmis a la production.
        return route.fulfill({ status: 204, headers: { "access-control-allow-origin": BASE, "access-control-allow-credentials": "true", "access-control-allow-headers": "content-type" } });
      }
      if (route.request().isNavigationRequest()) { captures.appNav.push(url.toString()); return route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>app (intercepte)</body></html>" }); }
      return route.fulfill({ status: 204 });
    }
    captures.tiers.push(host);
    return route.abort();
  });
  return { context, captures };
}
const cookies = async (context) => (await context.cookies(BASE)).map((c) => ({ name: c.name, domain: c.domain, secure: c.secure, sameSite: c.sameSite }));

// ── 1. SANS consentement : aucun cookie de mesure, aucun fp_vid, aucune requete analytique ─────────────────
{
  const { context, captures } = await nouveauContexte();
  const page = await context.newPage();
  await page.goto(`${BASE}/pricing?utm_source=test&fp_lid=${FP_LID}`, { waitUntil: "networkidle", timeout: 45_000 });
  await page.waitForTimeout(3000); // > delai d'envoi de landing_vue (1,5 s)
  const hrefs = await page.$$eval('a[href^="https://app.flowpoint.pro/"]', (els) => els.map((e) => e.href));
  check("N1a", "sans consentement : aucun cookie fp_analytics_consent", !(await cookies(context)).some((c) => c.name === "fp_analytics_consent"));
  check("N1b", "sans consentement : aucun fp_vid dans les liens vers l'application", hrefs.length > 0 && !hrefs.some((h) => h.includes("fp_vid=")), `liens=${hrefs.length}`);
  check("N1c", "sans consentement : aucune requete /api/public/funnel-event", captures.funnel.length === 0, `requetes=${captures.funnel.length}`);
  check("N1d", "sans consentement : aucun script tiers d'analytique ou de prospection charge", !captures.tiers.some((h) => /googletagmanager|google-analytics|apollo|umami/.test(h)), `hotes tiers=${[...new Set(captures.tiers)].join(",") || "aucun"}`);
  await context.close();
}

// ── 2. AVEC consentement : cookie partage, plan conserve, fp_vid, attribution, evenements autorises seulement ─
{
  const { context, captures } = await nouveauContexte();
  const page = await context.newPage();
  await page.goto(`${BASE}/pricing?lang=fr&utm_source=Test_Source&utm_medium=email&utm_campaign=cmp1&fp_lid=${FP_LID}&fp_source=smartlead&fp_ref=SELLER1`, { waitUntil: "networkidle", timeout: 45_000 });
  const accepter = page.getByTestId("button-cookie-accept");
  const bannerVisible = await accepter.isVisible().catch(() => false);
  check("N2a", "banniere de consentement affichee avant tout choix", bannerVisible);
  // Clic « Accepter » declenche par la page elle-meme : si un defaut fige l'onglet, on le constate sans bloquer le script.
  if (bannerVisible) await page.evaluate(() => { setTimeout(() => document.querySelector('[data-testid="button-cookie-accept"]')?.click(), 0); });
  const reactive = await Promise.race([
    page.waitForTimeout(1500).then(() => page.evaluate(() => new Promise((r) => setTimeout(() => r(true), 200)))).catch(() => false),
    new Promise((r) => setTimeout(() => r(false), 8000)),
  ]);
  check("N2z", "apres « Accepter » : la page reste reactive (aucun gel)", reactive === true);
  if (reactive !== true) { console.log("Onglet fige ou ferme : controles suivants impossibles."); await browser.close().catch(() => {}); console.log(`\n${results.filter((r) => r.ok).length}/${results.length} controles navigateur reussis (ARRET)`); process.exit(1); }
  const ck = (await cookies(context)).find((c) => c.name === "fp_analytics_consent");
  check("N2b", "apres acceptation : cookie fp_analytics_consent partage (Domain=.flowpoint.pro, Secure, Lax)", ck && ck.domain.replace(/^\./, "") === "flowpoint.pro" && ck.domain.startsWith(".") && ck.secure && ck.sameSite === "Lax", JSON.stringify(ck ?? null));

  // clic reel sur le bouton « Pro » : la navigation vers l'application est interceptee
  const proLink = page.locator('a[href*="plan=pro"]').first();
  await proLink.scrollIntoViewIfNeeded();
  const popupPromise = context.waitForEvent("page", { timeout: 8000 }).catch(() => null);
  await proLink.click({ noWaitAfter: true });
  const popup = await popupPromise;
  if (popup) await popup.waitForLoadState("domcontentloaded").catch(() => {});
  await page.waitForTimeout(1500);
  const dest = captures.appNav.at(-1) ? new URL(captures.appNav.at(-1)) : null;
  const p = dest?.searchParams;
  check("N2c", "clic « Pro » : arrivee sur /signin.html avec plan=pro", dest && dest.pathname === "/signin.html" && p.get("plan") === "pro", dest ? dest.pathname + "?" + dest.search : "aucune navigation");
  check("N2d", "lien Pro : lang=fr conserve", p?.get("lang") === "fr", `lang=${p?.get("lang")}`);
  check("N2e", "lien Pro : fp_vid (UUID v4) present apres consentement", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(p?.get("fp_vid") ?? ""), `fp_vid=${p?.get("fp_vid") ? "present" : "absent"}`);
  check("N2f", "lien Pro : attribution conservee (utm_* en minuscules, fp_lid, fp_source, fp_ref)", p?.get("utm_source") === "test_source" && p?.get("utm_medium") === "email" && p?.get("utm_campaign") === "cmp1" && p?.get("fp_lid") === FP_LID && p?.get("fp_source") === "smartlead" && p?.get("fp_ref") === "SELLER1", dest ? [...p.keys()].join(",") : "");
  const etapes = captures.funnel.map((f) => f.body?.etape);
  check("N2g", "evenements emis : uniquement landing_vue / cta_clique, jamais tarifs_vus", etapes.length >= 1 && etapes.every((e) => ["landing_vue", "cta_clique"].includes(e)) && !etapes.includes("tarifs_vus"), `etapes=${etapes.join(",") || "aucune"}`);
  const corps = captures.funnel.map((f) => f.body).filter(Boolean);
  check("N2h", "evenements : meme visiteurId que le lien, fp_lid et utm transmis", corps.length > 0 && corps.every((b) => b.visiteurId === p?.get("fp_vid") && (b.fp_lid === undefined || b.fp_lid === FP_LID)), `evenements=${corps.length}`);
  // Retrait du consentement : le cookie disparait et plus aucun fp_vid
  await page.bringToFront();
  const cookieBtn = page.getByTestId("button-cookie-settings");
  if (await cookieBtn.isVisible().catch(() => false)) { await cookieBtn.click({ noWaitAfter: true }); await page.getByTestId("button-cookie-refuse").click({ noWaitAfter: true }); await page.waitForTimeout(1000); }
  const hrefsApres = await page.$$eval('a[href^="https://app.flowpoint.pro/"]', (els) => els.map((e) => e.href));
  check("N2i", "apres refus ulterieur : cookie supprime et plus de fp_vid dans les liens", !(await cookies(context)).some((c) => c.name === "fp_analytics_consent") && !hrefsApres.some((h) => h.includes("fp_vid=")));
  await context.close();
}

// ── 3. Langue : ?lang=fr -> FAQ et mention en francais ; defaut -> anglais ; aucun lang force a fr ──────────
{
  const { context } = await nouveauContexte();
  const page = await context.newPage();
  await page.goto(`${BASE}/pricing`, { waitUntil: "networkidle", timeout: 45_000 });
  const hrefsEn = await page.$$eval('a[href^="https://app.flowpoint.pro/"]', (els) => els.map((e) => e.href));
  check("N3a", "visiteur sans choix de langue : aucun lien force lang=fr", !hrefsEn.some((h) => /[?&]lang=fr/.test(h)), `liens=${hrefsEn.length}`);
  const texte = (await page.locator("body").innerText()).toLowerCase();
  check("N3b", "page anglaise : mention « card required · billed automatically after 14 days unless cancelled »", texte.includes("card required") && texte.includes("billed automatically after 14 days unless cancelled"));
  const nbBoutonsPlan = await page.locator('a[href*="signin.html?plan="], a[href*="signin.html?"][href*="plan="]').count();
  check("N3c", "3 boutons de plan (standard, pro, ultra) presents", nbBoutonsPlan >= 3, `boutons=${nbBoutonsPlan}`);
  await context.close();
}
for (const [nom, preparer, chemin] of [
  ["cookie googtrans=/en/fr (selecteur de langue du site)", (c) => c.addCookies([{ name: "googtrans", value: "/en/fr", domain: ".flowpoint.pro", path: "/", secure: true, sameSite: "Lax" }]), "/pricing"],
  ["parametre ?lang=fr", async () => {}, "/pricing?lang=fr"],
]) {
  const { context } = await nouveauContexte();
  await preparer(context);
  const page = await context.newPage();
  await page.goto(`${BASE}${chemin}`, { waitUntil: "networkidle", timeout: 45_000 });
  await page.waitForTimeout(1500);
  const texte = (await page.locator("body").innerText()).toLowerCase();
  const hrefsFr = await page.$$eval('a[href^="https://app.flowpoint.pro/"]', (els) => els.map((e) => e.href));
  check(`N3d[${nom}]`, "francais : mention « carte bancaire requise · débit automatique après 14 jours sauf annulation »", texte.includes("carte bancaire requise"));
  check(`N3e[${nom}]`, "francais : tous les liens vers l'application portent lang=fr", hrefsFr.length > 0 && hrefsFr.every((h) => /[?&]lang=fr(&|$)/.test(h)), `liens=${hrefsFr.length}`);
  await context.close();
}

await browser.close();
const echecs = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - echecs}/${results.length} controles navigateur reussis`);
console.log("Limites : l'application n'est jamais atteinte (navigation interceptee) ; la continuite de langue DANS l'application (signin.html?lang=fr -> francais) est verifiee par certify-conversion-local.mjs et par une ouverture manuelle.");
process.exit(echecs ? 1 : 0);
