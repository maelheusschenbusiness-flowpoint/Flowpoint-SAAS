// D-05 — test navigateur LOCAL (API mockee) : lien de partage de rapport.
// Usage : node artifacts/api-server/tests/browser/report-share-dom.mjs   (depuis la racine du depot)
// Serveur local 127.0.0.1 uniquement ; aucune requete vers la production.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import http from "node:http";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = new URL("../../../../", import.meta.url).pathname;
const dash = readFileSync(root + "src/frontend/dashboard.js", "utf8");
const reportView = readFileSync(root + "artifacts/flowpoint-export/report-view.html", "utf8");
const helpers = dash.slice(dash.indexOf("async function fpCreateReportShareLink("), dash.indexOf("function fullscreenPresent()"));

let shareMode = "ok";
const server = http.createServer((req, res) => {
  const u = req.url || "";
  if (u.startsWith("/api/reports/") && u.endsWith("/share") && req.method === "POST") {
    if (shareMode === "fail") { res.writeHead(500, { "content-type": "application/json" }); res.end('{"error":"x"}'); return; }
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ token: "tok123", expiresAt: new Date(Date.now() + 30 * 864e5).toISOString(), path: "/report/tok123" }));
    return;
  }
  if (u === "/api/reports/share/tok123") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ report: { name: "Rapport Test DOM", type: "PDF" }, branding: { agencyName: "Agence" }, audits: [], meetingNotes: [] }));
    return;
  }
  if (u.startsWith("/api/reports/share/")) { res.writeHead(404, { "content-type": "application/json" }); res.end('{"error":"Share link not found or has been revoked."}'); return; }
  const stat = u.match(/\/(fp-locale|fp-config)\.js/);
  if (stat) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(readFileSync(root + "artifacts/flowpoint-export/" + stat[1] + ".js")); return; }
  if (u.startsWith("/report/") || u.startsWith("/report-view.html")) { res.writeHead(200, { "content-type": "text/html" }); res.end(reportView); return; }
  if (u === "/harness") {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(`<!doctype html><body><div id="toast"></div><script>
      window.STATE={reports:[{id:'r_1',date:'2026-11-01'}]};
      window.fpT=function(s){return s};
      window.showToast=function(k,m){document.getElementById('toast').dataset.kind=k;document.getElementById('toast').textContent=m};
      window.apiAction=async function(m,p,b){var r=await fetch(p,{method:m,body:JSON.stringify(b||{})});if(!r.ok)throw new Error('HTTP '+r.status);return r.json()};
      ${helpers}
      window.__share=function(){return fpShareReportAndCopy('r_1',{})};
    </script></body>`);
    return;
  }
  res.writeHead(404); res.end();
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();

  // 1. Succes API : lien copie = URL servie par l'API, lisible par la page publique.
  await page.goto(base + "/harness");
  await page.evaluate(() => window.__share());
  assert.equal(await page.locator("#toast").getAttribute("data-kind"), "success");
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  assert.equal(clip, base + "/report/tok123");
  await page.goto(clip);
  await page.waitForSelector("#fp-report-content", { state: "visible", timeout: 5000 });
  assert.match(await page.locator("body").innerText(), /Rapport Test DOM/);

  // 2. Meme page via ?token= (liens historiques generes par le dashboard).
  await page.goto(base + "/report-view.html?token=tok123");
  await page.waitForSelector("#fp-report-content", { state: "visible", timeout: 5000 });

  // 3. Jeton inconnu : message d'erreur, pas de rapport.
  await page.goto(base + "/report/inconnu");
  await page.waitForSelector("#fp-error", { state: "visible", timeout: 5000 });

  // 4. Echec API : toast d'erreur explicite, presse-papiers inchange, aucun faux lien.
  shareMode = "fail";
  await page.goto(base + "/harness");
  await page.evaluate(() => navigator.clipboard.writeText("avant"));
  await page.evaluate(() => window.__share());
  assert.equal(await page.locator("#toast").getAttribute("data-kind"), "error");
  assert.match(await page.locator("#toast").innerText(), /Aucun lien/);
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), "avant");
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith("fp:share-")).length), 0);
  console.log("report-share-dom: OK (4 scenarios)");
} finally {
  await browser.close();
  server.close();
}
