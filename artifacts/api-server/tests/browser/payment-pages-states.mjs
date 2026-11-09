// Faux succes de paiement — test navigateur LOCAL (API mockee, Stripe.js simule).
// Usage : node artifacts/api-server/tests/browser/payment-pages-states.mjs [dossier-captures]
// Serveur local 127.0.0.1 uniquement ; AUCUN appel vers la production ni vers Stripe.
// Desktop + iPhone 13. Les routes /api/* sont mockees par scenario ; js.stripe.com est
// intercepte (absent = requete abandonnee, present = faux objet Stripe minimal).
import { createRequire } from "node:module";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { extname, resolve } from "node:path";
import http from "node:http";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../../../../", import.meta.url).pathname;
const exportDir = resolve(root, "artifacts/flowpoint-export");
const shots = process.argv[2] || "";
if (shots) mkdirSync(shots, { recursive: true });

const mime = { ".html": "text/html; charset=utf-8", ".js": "application/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
let api = {}; // "METHOD /chemin" -> { status, json }
const hits = [];
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    hits.push(req.method + " " + u.pathname);
    const r = api[req.method + " " + u.pathname] || { status: 404, json: { error: "unmocked" } };
    res.writeHead(r.status, { "content-type": "application/json" });
    res.end(JSON.stringify(r.json));
    return;
  }
  const f = resolve(exportDir, "." + (u.pathname === "/" ? "/pricing.html" : u.pathname));
  if (f.startsWith(exportDir) && existsSync(f)) {
    res.writeHead(200, { "content-type": mime[extname(f)] || "application/octet-stream" });
    res.end(readFileSync(f));
  } else { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = "http://127.0.0.1:" + server.address().port;

const FAKE_STRIPE = `window.Stripe = function () { return {
  elements: function () { return { create: function () { var h = {}; return { mount: function () { setTimeout(function () { h.ready && h.ready(); }, 10); }, on: function (e, f) { h[e] = f; } }; } }; },
  confirmPayment: function () { return Promise.resolve({}); }, confirmSetup: function () { return Promise.resolve({}); } }; };`;

const profiles = [
  { name: "desktop", ctx: { viewport: { width: 1280, height: 800 } } },
  { name: "iphone13", ctx: { ...devices["iPhone 13"] } },
];
const browser = await chromium.launch();
let failures = 0;
const ok = (c, m) => { try { assert.ok(c, m); console.log("  ok  " + m); } catch (e) { failures++; console.log("  FAIL " + m); } };

for (const prof of profiles) {
  console.log("== " + prof.name);
  const ctx = await browser.newContext({ ...prof.ctx, locale: "fr-FR" });
  await ctx.addInitScript(() => { try { localStorage.setItem("fp:language", "fr"); } catch {} });
  const text = (p) => p.evaluate(() => document.getElementById("fp-card")?.innerText || document.body.innerText);
  const shot = async (p, n) => { if (shots) await p.screenshot({ path: `${shots}/${prof.name}-${n}.png`, fullPage: true }); };
  const noOverflow = async (p, n) => ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `${n}: pas de scroll horizontal`);

  hits.length = 0;
  // 1. success.html sans paiement
  api = {};
  let p = await ctx.newPage();
  await p.goto(base + "/success.html");
  await p.waitForSelector('#fp-card[data-state="none"]');
  let t = await text(p);
  ok(/Aucun paiement à confirmer/.test(t) && !/Paiement confirmé/.test(t), "success.html nue : aucun paiement a confirmer");
  ok(hits.filter((h) => h.includes("verify") || h.includes("checkout-complete")).length === 0, "success.html nue : aucun appel de verification");
  await shot(p, "success-sans-paiement"); await noOverflow(p, "success sans paiement");

  // 2. session invalide (anonyme)
  api = { "POST /api/auth/session-restore": { status: 401, json: {} }, "GET /api/auth/checkout-complete": { status: 400, json: { error: "Session de paiement introuvable ou invalide." } } };
  await p.goto(base + "/success.html?session_id=cs_test_invalid");
  await p.waitForSelector('#fp-card[data-state="invalid"]');
  t = await text(p);
  ok(/introuvable ou expirée/.test(t) && !/Paiement confirmé/.test(t), "session invalide : etat explicite, pas de succes");
  await shot(p, "success-session-invalide"); await noOverflow(p, "session invalide");

  // 3. paiement confirme par le serveur
  api = { "POST /api/auth/session-restore": { status: 200, json: { token: "t" } }, "GET /api/billing/verify": { status: 200, json: { ok: true, plan: "pro", checkoutType: "subscription" } } };
  await p.goto(base + "/success.html?session_id=cs_test_ok123");
  await p.waitForSelector('#fp-card[data-state="confirmed"]');
  ok(/Paiement confirmé/.test(await text(p)), "serveur ok : ecran de succes");
  await shot(p, "success-confirme"); await noOverflow(p, "succes confirme");

  // 4. paiement non termine / en attente
  api = { "POST /api/auth/session-restore": { status: 200, json: { token: "t" } }, "GET /api/billing/verify": { status: 402, json: { error: "Payment not completed", status: "open" } } };
  await p.goto(base + "/success.html?session_id=cs_test_open1");
  await p.waitForSelector('#fp-card[data-state="failed"]');
  ok(/Paiement non finalisé/.test(await text(p)), "verify 402 : paiement non finalise");
  await shot(p, "success-paiement-non-finalise");

  // 5. checkout-return : echec avec 401
  api = { "POST /api/public/finalize-checkout": { status: 401, json: { error: "auth_required" } } };
  await p.goto(base + "/checkout-return.html?payment_intent=pi_invalid&redirect_status=failed");
  await p.waitForFunction(() => /Paiement échoué/.test(document.body.innerText));
  t = await p.evaluate(() => document.body.innerText);
  ok(!/enregistr/i.test(t) && /Réessayer le paiement/.test(t), "checkout-return failed : 'Paiement echoue' + reprise, jamais 'enregistre'");
  await shot(p, "return-paiement-echoue"); await noOverflow(p, "return echoue");

  api = { "POST /api/public/finalize-checkout": { status: 401, json: { error: "auth_required" } } };
  await p.goto(base + "/checkout-return.html?payment_intent=pi_x");
  await p.waitForFunction(() => /Connectez-vous pour vérifier/.test(document.body.innerText));
  ok(!/enregistr|conservé/i.test(await p.evaluate(() => document.body.innerText)), "checkout-return 401 : connexion requise, pas 'enregistre'");
  await shot(p, "return-connexion-requise");

  // 6. checkout-payment : Stripe.js absent puis present
  const cartInit = () => { localStorage.setItem("fp_cart", JSON.stringify({ plan: "pro", addons: {} })); localStorage.setItem("fp_pre_reg_token", JSON.stringify({ token: "pre", exp: Date.now() + 3600000 })); };
  api = { "POST /api/public/payment-intent": { status: 200, json: { clientSecret: "seti_secret_x", publishableKey: "pk_test_x", mode: "setup", quote: { plan: "pro", lines: [{ kind: "plan", name: "Pro", amountMinor: 7900 }], amountDueTodayMinor: 0, recurringAmountMinor: 7900, trialEligible: true, trialDays: 14, totalMinor: 0 } } } };
  let stripeMode = "absent";
  await ctx.route("https://js.stripe.com/**", (r) => stripeMode === "absent" ? r.abort("failed") : r.fulfill({ status: 200, contentType: "application/javascript", body: FAKE_STRIPE }));
  const pp = await ctx.newPage();
  await pp.addInitScript(cartInit);
  await pp.goto(base + "/checkout-payment.html");
  await pp.waitForSelector("#fp-alert.show");
  t = await pp.evaluate(() => document.getElementById("fp-alert").innerText);
  ok(/module de paiement Stripe n'a pas pu être chargé/.test(t) && /réseau|pare-feu/.test(t), "Stripe.js absent : message de chargement adapte");
  ok(!/bloqueur de publicités/.test(t), "Stripe.js absent : n'accuse pas un bloqueur");
  ok(await pp.locator("#fp-retry-load").count() === 1, "Stripe.js absent : bouton Reessayer");
  await shot(pp, "payment-stripe-absent"); await noOverflow(pp, "payment stripe absent");
  stripeMode = "present";
  await pp.click("#fp-retry-load");
  await pp.waitForFunction(() => !document.getElementById("fp-alert").classList.contains("show") && !document.getElementById("fp-pay-btn").disabled, null, { timeout: 15000 });
  ok(true, "Reessayer avec Stripe.js disponible : alerte levee, bouton de paiement actif");
  await shot(pp, "payment-stripe-present");
  await ctx.close();
}
await browser.close();
server.close();
console.log(failures ? failures + " ECHEC(S)" : "TOUT OK");
process.exit(failures ? 1 : 0);
