import { defineConfig, devices } from "@playwright/test";

/**
 * Certification du VRAI Stripe (mode TEST) : Payment Element reel, 3DS reel, webhooks reels.
 * Mode d'emploi : docs/CERTIFICATION-STRIPE-REEL.md
 *
 * Les fichiers sont nommes *.stripe.ts : ni collectes par vitest, ni comptes comme tests orphelins
 * (scripts/verifier-tests-orphelins.mjs ne regarde que *.test.* / *.spec.*).
 * Sans CERT_STRIPE_REEL=1 et sans les variables requises, chaque test se SAUTE avec la raison exacte ;
 * `tools/certification-stripe/bilan-rapport.ts` rend NO-GO si un test est saute : jamais de faux vert.
 */
const BASE_URL = (process.env.CERT_STRIPE_BASE_URL ?? "http://127.0.0.1:8080").replace(/\/$/, "");
const host = new URL(BASE_URL).hostname;
if (/(^|\.)flowpoint\.pro$/i.test(host)) throw new Error(`CIBLE REFUSEE : ${host} est la PRODUCTION.`);
if (!/^(127\.0\.0\.1|localhost|flowpoint-test\.onrender\.com)$/.test(host)) throw new Error(`CIBLE REFUSEE : ${host}.`);

const DIR = "artifacts/api-server/tests/browser/certification-stripe/.out";
const chromium = process.env.FP_CERT_CHROMIUM ? { launchOptions: { executablePath: process.env.FP_CERT_CHROMIUM } } : {};
const mobile = (d) => { const { defaultBrowserType: _ignore, ...rest } = d; return rest; };

export default defineConfig({
  testDir: "./artifacts/api-server/tests/browser/certification-stripe",
  testMatch: /.*\.stripe\.ts$/,
  outputDir: `${DIR}/resultats`,
  workers: 1, fullyParallel: false, retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["json", { outputFile: `${DIR}/rapport.json` }]],
  use: { baseURL: BASE_URL, trace: "off", video: "off", screenshot: "off", locale: "fr-FR", timezoneId: "Europe/Paris", ...chromium },
  projects: [
    { name: "bureau-1440", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, ...chromium } },
    { name: "iphone-13", use: { ...mobile(devices["iPhone 13"]), ...chromium } },
  ],
});
