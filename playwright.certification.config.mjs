import { defineConfig, devices } from "@playwright/test";

/**
 * Certification navigateur du parcours visiteur -> abonnement.
 * Mode d'emploi : docs/CERTIFICATION-NAVIGATEUR.md
 *
 *   artifacts/api-server/tests/browser/certification/harness/run-local.sh up
 *   export DATABASE_URL=$(artifacts/api-server/tests/browser/certification/harness/pg-jetable.sh url)
 *   npx playwright test -c playwright.certification.config.mjs --trace off
 *
 * Trois profils : bureau 1440, iPhone 13 et Pixel 7 (emulation sous Chromium : seul navigateur
 * garanti dans la CI et dans les sessions). Trace et video DESACTIVEES par defaut.
 */
const BASE_URL = (process.env.CERT_BASE_URL ?? "http://127.0.0.1:4321").replace(/\/$/, "");
// Meme garde que support/cible.ts : jamais la production.
const host = new URL(BASE_URL).hostname;
if (/(^|\.)flowpoint\.pro$/i.test(host)) throw new Error(`CIBLE REFUSEE : ${host} est la PRODUCTION.`);
if (!/^(127\.0\.0\.1|localhost|flowpoint-test\.onrender\.com)$/.test(host)) throw new Error(`CIBLE REFUSEE : ${host}.`);

const DIR = "artifacts/api-server/tests/browser/certification/.out";
// Navigateur : celui de Playwright par defaut ; FP_CERT_CHROMIUM force un binaire (sessions dont la version differe).
const chromium = process.env.FP_CERT_CHROMIUM ? { launchOptions: { executablePath: process.env.FP_CERT_CHROMIUM } } : {};
const mobile = (d) => { const { defaultBrowserType: _ignore, ...rest } = d; return rest; };

export default defineConfig({
  testDir: "./artifacts/api-server/tests/browser/certification",
  testMatch: /.*\.cert\.ts$/,
  outputDir: `${DIR}/resultats`,
  // Les parcours partagent la base jetable et l'etat du faux Stripe : en serie, sans reprise.
  workers: 1, fullyParallel: false, retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: `${DIR}/rapport-html`, open: "never" }], ["json", { outputFile: `${DIR}/rapport.json` }]],
  use: {
    baseURL: BASE_URL,
    trace: "off", video: "off", screenshot: "off",
    locale: "fr-FR", timezoneId: "Europe/Paris",
    ...chromium,
  },
  projects: [
    { name: "bureau-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...chromium } },
    { name: "iphone-13", use: { ...mobile(devices["iPhone 13"]), ...chromium } },
    { name: "pixel-7", use: { ...mobile(devices["Pixel 7"]), ...chromium } },
  ],
});
