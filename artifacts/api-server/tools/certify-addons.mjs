#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  LOCAL_ADDON_CERT_DATABASE,
  LOCAL_ADDON_CERT_HOST,
  getLocalAddonCertDatabaseConfig,
} from "./addon-cert-db-guard.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const API_DIR = resolve(SCRIPT_DIR, "..");
const REPO_ROOT = resolve(API_DIR, "../..");
const E2E_SPEC = "e2e/parcours/10-addons-authorises.spec.mjs";
const SHARED_REPLACEMENT_ADDON_BROWSER_TITLE =
  "the four remaining replacement add-ons save, measure, and reload in one tenant-isolated session";
const SHARED_REPLACEMENT_ADDON_BROWSER_LABEL =
  "Shared browser flow: four remaining replacement add-ons";
const AGENCY_SCHEDULER_BROWSER_TITLE =
  "Agency Reporting Packs: cron delivery is captured and tenant-isolated";
const AGENCY_WEBHOOK_BROWSER_TITLE =
  "Agency Reporting Packs: valid Stripe TEST webhook is processed locally";
const CONVERSION_BROWSER_TITLE =
  "Conversion Opportunity Engine saves thresholds without fabricating GA4 data";

export const ADDON_REGISTRY = [
  {
    id: "ai-gbp-posting",
    label: "AI GBP Posting",
    historical: false,
    tests: [
      "src/services/gbp-posting-generation.test.ts",
      "src/services/gbp-posting-publish.test.ts",
      "src/services/gbp-location-quota.test.ts",
      "src/routes/gbp-posts.test.ts",
    ],
  },
  {
    id: "behavioral-ai",
    label: "Behavioral AI",
    historical: false,
    tests: [
      "src/services/behavioral-service.test.ts",
      "src/services/behavioral-session-id.test.ts",
    ],
  },
  {
    id: "revenue-leak-ai",
    label: "Revenue Leak AI",
    historical: false,
    tests: ["src/routes/revenue-leak-ownership.test.ts"],
  },
  {
    id: "ai-executive-reporting",
    label: "AI Executive Reporting",
    historical: false,
    tests: [
      "src/services/executive-report-facts.test.ts",
      "src/routes/agency-packs.test.ts",
    ],
  },
  {
    id: "ai-forecasting-engine",
    label: "AI Forecasting Engine",
    historical: false,
    tests: [
      "src/services/forecasting-service.test.ts",
      "src/services/forecasting-service.atomic.test.ts",
      "src/tests/forecast-growth-projections.test.ts",
    ],
  },
  {
    id: "ai-market-intelligence",
    label: "AI Market Intelligence",
    historical: false,
    tests: [
      "src/services/market-intel-service.test.ts",
      "src/services/market-intel-persistence-db.test.ts",
    ],
  },
  {
    id: "crm-integrations",
    label: "CRM Integrations",
    historical: false,
    tests: [
      "src/services/crm-service.test.ts",
      "src/routes/crm-readiness.test.ts",
      "src/services/integration-response.test.ts",
    ],
  },
  {
    id: "keyword-domination-engine",
    label: "Keyword Domination Engine",
    historical: false,
    tests: [
      "src/services/keyword-domination.test.ts",
      "src/routes/keyword-domination-postgres.test.ts",
      "src/services/keyword-engine-sync.test.ts",
    ],
  },
  {
    id: "advanced-seo-lab",
    label: "Advanced SEO Lab",
    historical: false,
    tests: [
      "src/routes/advanced-seo-lab.test.ts",
      "src/routes/seo-quota-gate.test.ts",
      "src/services/dataforseo-quota-db.test.ts",
    ],
    browserSpec: "e2e/parcours/advanced-seo-lab.spec.mjs",
    browserTitle: "Advanced SEO Lab exposes real actions, enforces access, and persists generated missions",
  },
  {
    id: "global-monitoring",
    label: "Global Monitoring",
    historical: false,
    tests: [
      "src/services/global-monitoring.test.ts",
      "src/services/global-monitoring-postgres.test.ts",
      "src/routes/betterstack-sla-route.test.ts",
    ],
    browserTitle: "Global Monitoring fails closed without provider data and shows no fabricated metrics",
  },
  {
    id: "sla-monitoring-avance",
    label: "SLA Monitoring Avancé",
    historical: false,
    tests: [
      "src/routes/sla-addon-gate.test.ts",
      "src/routes/betterstack-sla-route.test.ts",
    ],
  },
  {
    id: "ai-cro-strategist",
    label: "AI CRO Strategist",
    historical: false,
    tests: [
      "src/services/conversion-observations.test.ts",
      "src/services/ab-testing-suggestion.test.ts",
      "src/routes/ab-testing-suggest.test.ts",
      "src/routes/ab-testing-lifecycle.test.ts",
      "src/routes/ab-testing-postgres.test.ts",
    ],
  },
  {
    id: "ai-workspace-launch",
    label: "AI Workspace Launch",
    historical: false,
    tests: [
      "src/services/workspace-launch-output.test.ts",
      "src/routes/ai-workspace-launch.test.ts",
      "src/routes/ai-workspace-launch-postgres.test.ts",
      "src/tests/workspace-launch-frontend.test.ts",
    ],
    browserTitle: "AI Workspace Launch restores a persisted strategy through the browser UI",
  },
  {
    id: "seo-content-decay-radar",
    label: "SEO Content Decay Radar",
    historical: false,
    tests: [
      "src/services/content-decay.test.ts",
      "src/services/content-decay-strategy.test.ts",
      "src/routes/content-decay-routes.test.ts",
      "src/routes/content-decay-postgres.test.ts",
    ],
  },
  {
    id: "backlink-intelligence",
    label: "Backlink Intelligence",
    historical: false,
    tests: [
      "src/services/backlink-intel.test.ts",
      "src/services/dataforseo-backlinks.test.ts",
    ],
    browserSpec: "e2e/parcours/backlink-intelligence.spec.mjs",
    browserTitle: "Backlink Intelligence shows provider-unavailable states without synthetic metrics",
  },
  {
    id: "agency-reporting-packs",
    label: "Agency Reporting Packs",
    historical: false,
    tests: [
      "src/routes/agency-packs.test.ts",
      "src/routes/agency-packs-postgres.test.ts",
      "src/routes/agency-portal.test.ts",
      "src/services/agency-reporting.test.ts",
      "src/services/agency-report-scheduler.test.ts",
      "src/services/agency-report-mail-capture.test.ts",
      "src/services/pdf-agency-report.test.ts",
      "src/services/stripe-trial-history.test.ts",
      "src/tests/signup-token-over-stale-session.test.ts",
      "src/lib/addon-test-price-coverage.test.ts",
    ],
    browserTitles: [
      "Agency Reporting Packs quota is atomic and viewer access is denied",
      "Agency Reporting Packs: multi-site report, PDF, portal, and scheduled delivery",
      AGENCY_SCHEDULER_BROWSER_TITLE,
    ],
    stripeBrowserTitles: [
      "Agency Reporting Packs enforce the report quota atomically and deny viewers — Stripe TEST lifecycle",
      "Agency checkout CTA completes a new-customer Stripe TEST purchase",
      AGENCY_WEBHOOK_BROWSER_TITLE,
    ],
  },
  {
    id: "gbp-performance-leads",
    label: "GBP Performance & Leads",
    historical: true,
    tests: [
      "src/services/gbp-performance-addon.test.ts",
      "src/routes/gbp-performance.test.ts",
      "src/routes/gbp-performance-postgres.test.ts",
    ],
    browserTitle: "GBP settings save from the dashboard and survive reload without cross-tenant locations",
  },
  {
    id: "local-presence-optimizer",
    label: "Local Presence Optimizer",
    historical: true,
    tests: [
      "src/services/local-presence-optimizer.test.ts",
      "src/services/local-maps-summary.test.ts",
      "src/services/local-heatmap-grid.test.ts",
    ],
    browserTitle: "Local Presence Optimizer saves tracked GBP criteria and reloads them",
  },
  {
    id: "local-landing-opportunities",
    label: "Local Landing Opportunities",
    historical: true,
    tests: [
      "src/services/local-landing-opportunities.test.ts",
      "src/routes/local-landing-opportunities.test.ts",
    ],
    browserTitle: "Local Landing Opportunities saves filters and reloads tenant-scoped GSC signals",
  },
  {
    id: "conversion-opportunity-engine",
    label: "Conversion Opportunity Engine",
    historical: true,
    tests: [
      "src/services/conversion-opportunity-engine.test.ts",
      "src/routes/conversion-opportunity-engine.test.ts",
    ],
    browserTitle: CONVERSION_BROWSER_TITLE,
  },
  {
    id: "seo-change-impact",
    label: "SEO Change Impact",
    historical: true,
    tests: [
      "src/services/seo-change-impact.test.ts",
      "src/routes/seo-change-impact.test.ts",
    ],
    browserTitle: SHARED_REPLACEMENT_ADDON_BROWSER_TITLE,
    browserLabel: SHARED_REPLACEMENT_ADDON_BROWSER_LABEL,
  },
  {
    id: "agency-portfolio-priorities",
    label: "Agency Portfolio Priorities",
    historical: true,
    tests: [
      "src/services/agency-portfolio-priorities.test.ts",
      "src/routes/agency-portfolio-priorities.test.ts",
    ],
    browserTitle: SHARED_REPLACEMENT_ADDON_BROWSER_TITLE,
    browserLabel: SHARED_REPLACEMENT_ADDON_BROWSER_LABEL,
  },
  {
    id: "technical-seo-fix-verification",
    label: "Technical SEO Fix Verification",
    historical: true,
    tests: [
      "src/services/technical-seo-fix-verification.test.ts",
      "src/routes/technical-seo-fix-verification.test.ts",
    ],
    browserTitle: SHARED_REPLACEMENT_ADDON_BROWSER_TITLE,
    browserLabel: SHARED_REPLACEMENT_ADDON_BROWSER_LABEL,
  },
  {
    id: "organic-campaign-tracker",
    label: "Organic Campaign Tracker",
    historical: true,
    tests: [
      "src/services/organic-campaign-tracker.test.ts",
      "src/routes/organic-campaign-tracker.test.ts",
    ],
    browserTitle: SHARED_REPLACEMENT_ADDON_BROWSER_TITLE,
    browserLabel: SHARED_REPLACEMENT_ADDON_BROWSER_LABEL,
  },
];

const CHECKOUT_ABANDONMENT_SCENARIO = {
  id: "checkout-abandonment",
  label: "Signup checkout abandonment recovery",
  tests: [
    "src/tests/checkout-abandon-guards.test.ts",
    "src/services/pending-signup-stripe-customer.test.ts",
    "src/tests/conversion-b-fp-lid.test.ts",
    "src/tests/signup-token-over-stale-session.test.ts",
  ],
  browserSpec: "e2e/parcours/checkout-abandonment.spec.mjs",
  browserTitle: "Payment Element abandonment never activates an unconfirmed signup",
  stripeBrowserTitles: [
    "Hosted Stripe Checkout session remains unactivated until completion",
  ],
};

const BASE_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "PNPM_HOME",
  "COREPACK_HOME",
  "PLAYWRIGHT_BROWSERS_PATH",
  "SSL_CERT_FILE",
  "NIX_SSL_CERT_FILE",
  "LD_LIBRARY_PATH",
  "NIX_LD",
  "NIX_LD_LIBRARY_PATH",
];

function findSystemChromium() {
  const names = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    ...String(process.env.PATH ?? "").split(delimiter).flatMap(directory =>
      names.map(name => join(directory, name))
    ),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return undefined;
}

export function parseArgs(args) {
  const options = {
    selection: "pending",
    addons: [],
    help: false,
    checkoutAbandonment: false,
    stripeTest: false,
    stripeWebhookReplay: false,
    browserOnly: false,
    browserTitles: [],
    combinedCheckoutAgency: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--all") {
      options.selection = "all";
    } else if (arg === "--pending") {
      options.selection = "pending";
    } else if (arg === "--checkout-abandonment") {
      options.checkoutAbandonment = true;
    } else if (arg === "--stripe-test") {
      options.stripeTest = true;
    } else if (arg === "--stripe-webhook-replay") {
      options.stripeWebhookReplay = true;
    } else if (arg === "--browser-only") {
      options.browserOnly = true;
    } else if (arg === "--browser-title") {
      const value = args[index + 1];
      if (!value) throw new Error("--browser-title requires an exact test title.");
      options.browserTitles.push(value);
      index += 1;
    } else if (arg === "--combined-checkout-agency") {
      options.combinedCheckoutAgency = true;
    } else if (arg === "--addon") {
      const value = args[index + 1];
      if (!value) throw new Error("--addon requires an add-on name or id.");
      options.addons.push(value);
      index += 1;
    } else if (arg.startsWith("--addon=")) {
      options.addons.push(arg.slice("--addon=".length));
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  if (options.combinedCheckoutAgency && (
    options.checkoutAbandonment ||
    options.stripeTest ||
    options.addons.length ||
    options.selection === "all"
  )) {
    throw new Error("--combined-checkout-agency cannot be combined with other certification selections.");
  }
  if (options.checkoutAbandonment && (
    options.addons.length ||
    options.selection === "all" ||
    options.stripeTest ||
    options.stripeWebhookReplay
  )) {
    throw new Error("--checkout-abandonment cannot be combined with add-on selections or --stripe-test; use --combined-checkout-agency for both flows.");
  }
  if (options.browserOnly && (
    options.addons.length !== 1 ||
    options.browserTitles.length === 0 ||
    options.combinedCheckoutAgency ||
    options.checkoutAbandonment
  )) {
    throw new Error("--browser-only requires one --addon and at least one --browser-title.");
  }
  if (options.browserTitles.length && !options.browserOnly) {
    throw new Error("--browser-title requires --browser-only.");
  }
  if (options.stripeWebhookReplay && (
    options.stripeTest ||
    !options.browserOnly ||
    options.addons.length !== 1 ||
    options.addons[0].trim().toLowerCase() !== "agency-reporting-packs" ||
    options.browserTitles.length !== 1 ||
    options.browserTitles[0] !== AGENCY_WEBHOOK_BROWSER_TITLE ||
    options.combinedCheckoutAgency ||
    options.checkoutAbandonment
  )) {
    throw new Error("--stripe-webhook-replay requires only the Agency webhook browser test and never runs checkout.");
  }
  if (options.addons.length) options.selection = "explicit";
  return options;
}

export function selectAddons(options, registry = ADDON_REGISTRY) {
  let selected;
  if (options.selection === "all") {
    selected = [...registry];
  } else if (options.selection === "explicit") {
    const requested = options.addons.map(value => value.trim().toLowerCase());
    const matches = new Map(registry.flatMap(addon => [
      [addon.id.toLowerCase(), addon],
      [addon.label.toLowerCase(), addon],
    ]));
    const unknown = requested.filter(value => !matches.has(value));
    if (unknown.length) throw new Error(`Unknown add-on selection: ${unknown.join(", ")}.`);
    selected = [...new Set(requested.map(value => matches.get(value)))];
  } else {
    selected = registry.filter(addon => !addon.historical);
  }

  const priority = ["agency-reporting-packs", "global-monitoring"];
  return [
    ...priority.map(id => selected.find(addon => addon.id === id)).filter(Boolean),
    ...selected.filter(addon => !priority.includes(addon.id)),
  ];
}

async function resolveStandardTestPlanPriceId(stripeTestKey) {
  if (!stripeTestKey?.startsWith("sk_test_")) {
    throw new Error("--stripe-test requires a Stripe TEST key to verify the Standard plan price.");
  }
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeTestKey);
  const configuredId = process.env["STRIPE_TEST_PRICE_ID_STANDARD"];

  if (configuredId) {
    const price = await stripe.prices.retrieve(configuredId, { expand: ["product"] });
    const product = typeof price.product === "object" ? price.product : null;
    const isStandardProduct =
      product?.metadata?.plan?.toLowerCase() === "standard" ||
      product?.name?.trim().toLowerCase() === "flowpoint standard test";
    if (
      price.livemode ||
      price.currency !== "eur" ||
      price.recurring?.interval !== "month" ||
      !isStandardProduct
    ) {
      throw new Error("STRIPE_TEST_PRICE_ID_STANDARD must be a Standard monthly TEST price.");
    }
    return configuredId;
  }

  const matches = [];
  let startingAfter;
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const page = await stripe.prices.list({
      active: true,
      limit: 100,
      expand: ["data.product"],
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    });
    for (const price of page.data) {
      const product = typeof price.product === "object" ? price.product : null;
      const isStandardProduct =
        product?.metadata?.plan?.toLowerCase() === "standard" ||
        product?.name?.trim().toLowerCase() === "flowpoint standard test";
      if (
        !price.livemode &&
        price.currency === "eur" &&
        price.recurring?.interval === "month" &&
        isStandardProduct
      ) {
        matches.push(price);
      }
    }
    if (!page.has_more) break;
    const lastId = page.data.at(-1)?.id;
    if (!lastId || lastId === startingAfter || pageNumber === 9) {
      throw new Error("Could not finish reading the Stripe TEST price catalog safely.");
    }
    startingAfter = lastId;
  }

  if (matches.length !== 1) {
    throw new Error(`Expected one active Standard monthly TEST price; found ${matches.length}.`);
  }
  return matches[0].id;
}

export function buildLocalEnvironment({
  databaseUrl,
  port,
  tempDir,
  mailDir = join(tempDir, "mail"),
  sessionSecret = randomBytes(32).toString("hex"),
  adminKey = randomBytes(32).toString("hex"),
  stripeTest = false,
  standardPlanTestPriceId,
  includeAgencyPacks = false,
}) {
  const env = {};
  for (const key of BASE_ENV_KEYS) {
    if (process.env[key]) env[key] = process.env[key];
  }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("NIX_") && process.env[key]) env[key] = process.env[key];
  }

  const expectedHost = LOCAL_ADDON_CERT_HOST;
  const expectedDatabase = LOCAL_ADDON_CERT_DATABASE;
  Object.assign(env, {
    NODE_ENV: "test",
    CI: "true",
    PORT: String(port),
    DATABASE_URL: databaseUrl,
    FLOWPOINT_ADDON_CERT_DATABASE_URL: databaseUrl,
    FLOWPOINT_ADDON_CERT_EXPECTED_DB: expectedDatabase,
    FLOWPOINT_ADDON_CERT_EXPECTED_HOST: expectedHost,
    FLOWPOINT_ADDON_CERT_LOCAL_ONLY: "1",
    DB_HOTE_ATTENDU: `${expectedHost}/${expectedDatabase}`,
    DB_UTILISATEUR_ATTENDU: "runner",
    PUBLIC_URL: `http://${expectedHost}:${port}`,
    AGENCY_REPORT_SCHEDULER_ENABLED: "true",
    PGSSLMODE: "disable",
    PGCONNECT_TIMEOUT: "5",
    ENABLE_TEST_MAILER: "true",
    TEST_MAIL_DIR: mailDir,
    E2E_BASE_URL: `http://${expectedHost}:${port}`,
    SESSION_SECRET: sessionSecret,
    ADMIN_KEY: adminKey,
    API_SECRET_KEY: randomBytes(32).toString("hex"),
    CRON_KEY: randomBytes(32).toString("hex"),
  });
  if (stripeTest) {
    const stripeTestKey = process.env["STRIPE_TEST_KEY"];
    const agencyPacksTestPrice = process.env["STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PACKS"];
    const stripeTestPublishableKey = process.env["STRIPE_TEST_PUBLISHABLE_KEY"];
    const stripeTestWebhookSecret = process.env["STRIPE_TEST_WEBHOOK_SECRET"];
    if (!stripeTestKey?.startsWith("sk_test_")) {
      throw new Error("Stripe certification requires STRIPE_TEST_KEY to be a Stripe TEST-mode key.");
    }
    if (!standardPlanTestPriceId?.startsWith("price_")) {
      throw new Error("Stripe certification requires an existing Standard monthly TEST price.");
    }
    if (includeAgencyPacks && !agencyPacksTestPrice?.startsWith("price_")) {
      throw new Error("Agency certification requires STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PACKS.");
    }
    if (!stripeTestPublishableKey?.startsWith("pk_test_")) {
      throw new Error("Stripe certification requires STRIPE_TEST_PUBLISHABLE_KEY.");
    }
    if (!stripeTestWebhookSecret?.startsWith("whsec_")) {
      throw new Error("Stripe certification requires STRIPE_TEST_WEBHOOK_SECRET.");
    }
    Object.assign(env, {
      STRIPE_TEST_KEY: stripeTestKey,
      STRIPE_TEST_MODE: "true",
      STRIPE_TEST_PRICE_ID_STANDARD: standardPlanTestPriceId,
      STRIPE_TEST_PUBLISHABLE_KEY: stripeTestPublishableKey,
      STRIPE_TEST_WEBHOOK_SECRET: stripeTestWebhookSecret,
      PUBLIC_URL: `http://${LOCAL_ADDON_CERT_HOST}:${port}`,
    });
    // Existing test-only plan references used by the pricing client; none are
    // created or changed by this runner.
    for (const key of ["STRIPE_TEST_PRICE_ID_PRO", "STRIPE_TEST_PRICE_ID_ULTRA"]) {
      if (process.env[key]?.startsWith("price_")) env[key] = process.env[key];
    }
    if (includeAgencyPacks) {
      env.STRIPE_TEST_PRICE_ID_ADDON_AGENCY_PACKS = agencyPacksTestPrice;
      env.FLOWPOINT_AGENCY_PACKS_STRIPE_TEST = "1";
    }
  }
  const chromium = findSystemChromium();
  if (chromium) env.PLAYWRIGHT_CHROMIUM_EXECUTABLE = chromium;
  return env;
}

export function validateLocalDatabaseEnv(env) {
  const config = getLocalAddonCertDatabaseConfig(env);
  if (config.host !== LOCAL_ADDON_CERT_HOST || config.expectedDatabase !== LOCAL_ADDON_CERT_DATABASE) {
    throw new Error("Refusing local certification: database identity is not the expected disposable loopback target.");
  }
  return config;
}

export async function runProcess(command, args, {
  cwd = REPO_ROOT,
  env = process.env,
  signal,
  timeoutMs = 0,
  stdio = "inherit",
} = {}) {
  if (signal?.aborted) return { code: 130, interrupted: true };

  return await new Promise(resolvePromise => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio,
      detached: process.platform !== "win32",
    });
    let settled = false;
    let interrupted = false;
    let killTimer;
    let timeout;

    const settle = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearTimeout(killTimer);
      signal?.removeEventListener("abort", onAbort);
      resolvePromise(result);
    };
    const killGroup = sig => {
      if (!child.pid) return;
      try {
        if (process.platform !== "win32") process.kill(-child.pid, sig);
        else child.kill(sig);
      } catch {}
    };
    const onAbort = () => {
      interrupted = true;
      killGroup("SIGTERM");
      killTimer = setTimeout(() => killGroup("SIGKILL"), 4000);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    child.once("error", error => settle({ code: 127, error, interrupted }));
    child.once("exit", (code, childSignal) => settle({
      code: interrupted ? 130 : (code ?? 1),
      signal: childSignal,
      interrupted,
    }));
    if (timeoutMs > 0) {
      timeout = setTimeout(() => {
        killGroup("SIGTERM");
        killTimer = setTimeout(() => killGroup("SIGKILL"), 4000);
      }, timeoutMs);
    }
    if (signal?.aborted) onAbort();
  });
}

export async function withGuaranteedCleanup(work, cleanup) {
  let workError;
  try {
    return await work();
  } catch (error) {
    workError = error;
    throw error;
  } finally {
    try {
      await cleanup();
    } catch (cleanupError) {
      if (workError) {
        console.error(`Cleanup also failed: ${cleanupError.message}`);
      } else {
        throw cleanupError;
      }
    }
  }
}

async function requireSuccess(command, args, options = {}) {
  const result = await runProcess(command, args, options);
  if (result.code !== 0) {
    if (result.interrupted) throw new Error("Certification interrupted by the user.");
    throw new Error(`${command} failed with exit code ${result.code}.`);
  }
  return result;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, LOCAL_ADDON_CERT_HOST, resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise(resolvePromise => server.close(resolvePromise));
    throw new Error("Could not reserve a local TCP port.");
  }
  const { port } = address;
  await new Promise(resolvePromise => server.close(resolvePromise));
  return port;
}

async function runPgCtl(args, options = {}) {
  return requireSuccess("pg_ctl", args, options);
}

async function createTemporaryPostgres(tempDir, signal) {
  if (typeof process.getuid === "function" && process.getuid() === 0) {
    throw new Error("Refusing to run initdb as root.");
  }
  const dataDir = join(tempDir, "pgdata");
  const socketDir = join(tempDir, "socket");
  const logPath = join(tempDir, "postgres.log");
  const port = await reservePort();
  let serverStarted = false;

  try {
    await requireSuccess("initdb", [
      "-D", dataDir,
      "-U", "runner",
      "--auth-local=trust",
      "--auth-host=reject",
      "--no-instructions",
    ], { cwd: REPO_ROOT, signal });
    serverStarted = true;

    const pgHba = [
      "local all all trust",
      `host all all ${LOCAL_ADDON_CERT_HOST}/32 trust`,
      "host all all ::1/128 reject",
      "host all all 0.0.0.0/0 reject",
      "",
    ].join("\n");
    await writeFile(join(dataDir, "pg_hba.conf"), pgHba, { mode: 0o600 });
    await mkdir(socketDir, { mode: 0o700 });
    await writeFile(join(dataDir, "postgresql.auto.conf"), [
      `listen_addresses = '${LOCAL_ADDON_CERT_HOST}'`,
      `port = ${port}`,
      `unix_socket_directories = '${socketDir}'`,
      "max_connections = 30",
      "",
    ].join("\n"), { mode: 0o600 });

    await runPgCtl([
      "-D", dataDir,
      "-l", logPath,
      "-w",
      "-t", "30",
      "start",
    ], { cwd: REPO_ROOT, signal });

    const databaseUrl = `postgresql://runner@${LOCAL_ADDON_CERT_HOST}:${port}/${LOCAL_ADDON_CERT_DATABASE}`;
    const env = buildLocalEnvironment({ databaseUrl, port, tempDir });

    const config = validateLocalDatabaseEnv({
      FLOWPOINT_ADDON_CERT_DATABASE_URL: databaseUrl,
      FLOWPOINT_ADDON_CERT_EXPECTED_DB: LOCAL_ADDON_CERT_DATABASE,
      FLOWPOINT_ADDON_CERT_EXPECTED_HOST: LOCAL_ADDON_CERT_HOST,
      DATABASE_URL: databaseUrl,
    });
    if (config.port !== port) throw new Error("Local PostgreSQL port did not match its attestation.");

    await requireSuccess("createdb", [
      "--host", LOCAL_ADDON_CERT_HOST,
      "--port", String(port),
      "--username", "runner",
      LOCAL_ADDON_CERT_DATABASE,
    ], { cwd: REPO_ROOT, env, signal });
    await requireSuccess("psql", [
      databaseUrl,
      "-v", "ON_ERROR_STOP=1",
      "-c",
      `CREATE TABLE public.flowpoint_test_database_guard (
       purpose TEXT PRIMARY KEY,
       database_name TEXT NOT NULL,
       classification TEXT NOT NULL,
       created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
     )`,
      "-c",
      `INSERT INTO public.flowpoint_test_database_guard (purpose, database_name, classification)
     VALUES ('addon-cert', '${LOCAL_ADDON_CERT_DATABASE}', 'disposable')`,
    ], { cwd: REPO_ROOT, env, signal });

    return { dataDir, databaseUrl, port };
  } catch (error) {
    if (serverStarted) await stopPostgres(dataDir);
    throw error;
  }
}

async function stopPostgres(dataDir) {
  try {
    await runProcess("pg_ctl", ["-D", dataDir, "-m", "fast", "-w", "-t", "20", "stop"], {
      cwd: REPO_ROOT,
      env: process.env,
      timeoutMs: 25_000,
    });
  } catch {}
}

async function startApi(env, signal) {
  const child = spawn("pnpm", ["--filter", "@workspace/api-server", "run", "start"], {
    cwd: REPO_ROOT,
    env,
    stdio: "inherit",
    detached: process.platform !== "win32",
  });

  let spawnError;
  child.once("error", error => { spawnError = error; });
  try {
    const baseUrl = env.E2E_BASE_URL;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      if (signal.aborted) throw new Error("Certification interrupted by the user.");
      if (spawnError) throw new Error(`Could not start the local API: ${spawnError.message}`);
      if (child.exitCode !== null) throw new Error(`Local API exited during startup (${child.exitCode}).`);
      try {
        const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1500) });
        if (response.status < 500) return child;
      } catch {}
      await new Promise(resolvePromise => setTimeout(resolvePromise, 400));
    }
    throw new Error("Local API did not become ready within 120 seconds.");
  } catch (error) {
    await stopChild(child);
    throw error;
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const send = sig => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {}
  };
  send("SIGTERM");
  await Promise.race([
    new Promise(resolvePromise => child.once("exit", resolvePromise)),
    new Promise(resolvePromise => setTimeout(resolvePromise, 7000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    send("SIGKILL");
    await Promise.race([
      new Promise(resolvePromise => child.once("exit", resolvePromise)),
      new Promise(resolvePromise => setTimeout(resolvePromise, 2000)),
    ]);
  }
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function runUnitTests(addon, env, signal) {
  if (addon.tests.length === 0) {
    console.log(`  NO TARGETED TESTS — ${addon.label}`);
    return { status: "missing", files: [], missingFiles: [] };
  }
  const availableTests = [];
  const missingFiles = [];
  for (const file of addon.tests) {
    try {
      accessSync(resolve(API_DIR, file), constants.R_OK);
      availableTests.push(file);
    } catch {
      missingFiles.push(file);
    }
  }
  if (missingFiles.length) {
    console.log(`  MISSING TEST FILES — ${missingFiles.join(", ")}`);
  }
  if (availableTests.length === 0) {
    return { status: "missing", files: addon.tests, missingFiles };
  }
  const args = [
    "--filter", "@workspace/api-server",
    "exec", "vitest", "run",
    "--reporter=verbose",
    ...availableTests,
  ];
  console.log(`  TESTS — ${addon.label}`);
  const result = await runProcess("pnpm", args, { cwd: REPO_ROOT, env, signal });
  if (result.interrupted) return { status: "interrupted", files: addon.tests, missingFiles };
  return {
    status: result.code !== 0 ? "failed" : missingFiles.length ? "missing" : "passed",
    files: addon.tests,
    executedFiles: availableTests,
    missingFiles,
    code: result.code,
  };
}

async function runBrowserTests(titles, env, signal, spec = E2E_SPEC) {
  if (titles.length === 0) return { status: "skipped" };
  const grep = titles.map(escapeRegex).join("|");
  console.log(`  PLAYWRIGHT — ${titles.join(" | ")}`);
  const result = await runProcess("pnpm", [
    "exec", "playwright", "test",
    "--config=playwright.addon-cert.config.mjs",
    spec,
    "--grep", grep,
  ], { cwd: REPO_ROOT, env, signal, timeoutMs: 20 * 60_000 });
  if (result.interrupted) return { status: "interrupted", code: 130 };
  return { status: result.code === 0 ? "passed" : "failed", code: result.code };
}

function printHelp() {
  console.log(`Usage: node artifacts/api-server/tools/certify-addons.mjs [options]

Options:
  --pending              Run add-ons without historical certification attribution (default)
  --all                  Run the complete 24-add-on registry
  --addon <name-or-id>   Run one add-on (repeatable)
  --browser-only         Run only the selected add-on's focused browser test(s)
  --browser-title <name> Run one exact browser-test title (repeatable with --browser-only)
  --checkout-abandonment Run the isolated signup recovery E2E with Stripe TEST only
  --stripe-test          Run the isolated Agency Packs lifecycle against Stripe TEST only
  --stripe-webhook-replay Replay one Stripe TEST event locally; no checkout or public delivery
  --combined-checkout-agency Run both flows in one disposable Stripe TEST environment
  --help                 Show this help

This runner creates a disposable PostgreSQL cluster reachable only at 127.0.0.1,
starts the API on loopback, runs mapped Vitest and Playwright suites, then stops
the processes and removes all temporary files. Stripe TEST calls run only for
Stripe-specific options; live credentials are never copied into the test app.`);
}

async function runCertification(options, signal) {
  const agencyPacks = ADDON_REGISTRY.find(addon => addon.id === "agency-reporting-packs");
  const selected = options.combinedCheckoutAgency
    ? [CHECKOUT_ABANDONMENT_SCENARIO, agencyPacks].filter(Boolean)
    : options.checkoutAbandonment
      ? [CHECKOUT_ABANDONMENT_SCENARIO]
      : selectAddons(options);
  const includesAgencyPacks = selected.some(addon => addon.id === "agency-reporting-packs");
  if (options.stripeTest && (
    selected.length !== 1 ||
    !includesAgencyPacks
  )) {
    throw new Error("--stripe-test is restricted to --addon agency-reporting-packs.");
  }
  if (options.combinedCheckoutAgency && (!agencyPacks || selected.length !== 2)) {
    throw new Error("Combined checkout/Agency certification requires the Agency registry entry.");
  }
  const useStripeTest = options.checkoutAbandonment || options.stripeTest ||
    options.stripeWebhookReplay || options.combinedCheckoutAgency;
  const availableBrowserTitles = new Set(selected.flatMap(addon => [
    ...(addon.browserTitles ?? (addon.browserTitle ? [addon.browserTitle] : [])),
    ...(useStripeTest ? (addon.stripeBrowserTitles ?? []) : []),
  ]).filter(Boolean));
  const unavailableTitles = options.browserTitles.filter(title => !availableBrowserTitles.has(title));
  if (unavailableTitles.length) {
    throw new Error(`Browser title is not registered for the selected mode: ${unavailableTitles.join(", ")}.`);
  }
  const standardPlanTestPriceId = useStripeTest
    ? await resolveStandardTestPlanPriceId(process.env["STRIPE_TEST_KEY"])
    : undefined;
  let tempDir;
  let pg;
  let api;
  const summary = [];

  await withGuaranteedCleanup(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "flowpoint-addon-cert-"));
    console.log(`Selected ${selected.length} add-on(s); temporary services are loopback-only.`);
    const build = await runProcess(
      "pnpm",
      ["--filter", "@workspace/api-server", "run", "build"],
      { cwd: REPO_ROOT, env: buildLocalEnvironment({ databaseUrl: "postgresql://runner@127.0.0.1:1/flowpoint_ci", port: 1, tempDir }), signal },
    );
    if (build.code !== 0) throw new Error(build.interrupted ? "Certification interrupted by the user." : "API build failed.");

    pg = await createTemporaryPostgres(tempDir, signal);
    const port = await reservePort();
    const testEnv = buildLocalEnvironment({ databaseUrl: pg.databaseUrl, port, tempDir });
    const apiEnv = useStripeTest
      ? buildLocalEnvironment({
        databaseUrl: pg.databaseUrl,
        port,
        tempDir,
        stripeTest: true,
        standardPlanTestPriceId,
        includeAgencyPacks: (options.stripeTest || options.combinedCheckoutAgency) && includesAgencyPacks,
      })
      : testEnv;
    validateLocalDatabaseEnv(testEnv);

    api = await startApi(apiEnv, signal);
    console.log("Local API is listening on 127.0.0.1.");

    const previouslyRunFiles = new Set();
    const browserRuns = new Set();
    for (const addon of selected) {
      if (signal.aborted) break;
      console.log(`\nADD-ON: ${addon.label}${addon.historical ? " (historical attribution; not a new certification)" : ""}`);
      let unit;
      if (options.browserOnly) {
        unit = { status: "skipped", files: [] };
      } else {
        const freshTests = addon.tests.filter(file => !previouslyRunFiles.has(file));
        const reusedTests = addon.tests.length - freshTests.length;
        unit = { status: "reused", files: addon.tests };
        if (freshTests.length !== addon.tests.length) {
          if (freshTests.length) {
            unit = await runUnitTests({ ...addon, tests: freshTests }, testEnv, signal);
          } else if (addon.tests.length) {
            console.log(`  REUSED ${reusedTests} targeted test file(s) already executed in this run.`);
          }
        } else {
          unit = await runUnitTests(addon, testEnv, signal);
        }
        for (const file of freshTests) {
          if (!unit.missingFiles?.includes(file)) previouslyRunFiles.add(file);
        }
      }

      summary.push({ id: addon.id, label: addon.label, historical: addon.historical, unit: unit.status });
      if (unit.status === "interrupted") break;
      const browserSpec = addon.browserSpec ?? E2E_SPEC;
      const browserTitles = [
        ...(addon.browserTitles ?? (addon.browserTitle ? [addon.browserTitle] : [])),
        ...(useStripeTest ? (addon.stripeBrowserTitles ?? []) : []),
      ].filter(Boolean).filter(title => !options.browserTitles.length || options.browserTitles.includes(title));
      for (const browserTitle of browserTitles) {
        const browserRunKey = `${browserSpec}::${browserTitle}`;
        if (browserRuns.has(browserRunKey) || signal.aborted) continue;
        browserRuns.add(browserRunKey);
        const browser = await runBrowserTests([browserTitle], apiEnv, signal, browserSpec);
        summary.push({
          id: `browser:${addon.id}`,
          label: addon.browserLabel ?? addon.label,
          historical: addon.historical,
          unit: browser.status,
        });
        if (browser.status === "interrupted") break;
      }
    }

    console.log("\nRESULTS (test evidence only; not a claim of full commercial readiness):");
    for (const row of summary) {
      console.log(`  ${row.unit.toUpperCase().padEnd(12)} ${row.label}${row.historical ? " [historical attribution unchanged]" : ""}`);
    }
    const missing = summary.filter(row => row.unit === "missing");
    const failed = summary.filter(row => row.unit === "failed");
    if (signal.aborted || summary.some(row => row.unit === "interrupted")) process.exitCode = 130;
    else if (failed.length) process.exitCode = 1;
    else if (missing.length) process.exitCode = 2;
    else process.exitCode = 0;
  }, async () => {
    await stopChild(api);
    if (pg?.dataDir) await stopPostgres(pg.dataDir);
    if (tempDir) {
      try {
        await rm(tempDir, { recursive: true, force: true });
      } catch (error) {
        throw new Error(`Temporary directory cleanup failed: ${error.message}`);
      }
    }
    console.log("\nCleanup complete: API stopped, PostgreSQL stopped, temporary directory removed.");
  });
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    printHelp();
    return;
  }

  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  try {
    await runCertification(options, controller.signal);
  } catch (error) {
    console.error(`Certification stopped: ${error.message}`);
    if (controller.signal.aborted) process.exitCode = 130;
    else process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
