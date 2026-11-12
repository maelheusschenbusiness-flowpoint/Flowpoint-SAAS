import { logger } from "../lib/logger.js";
/**
 * stripe-factory.ts — Stripe client factory with test injection support.
 *
 * All billing routes must obtain their Stripe client through createStripeClient()
 * so that integration tests can inject a fake recorder without modifying any
 * production logic and without network calls to api.stripe.com.
 *
 * Usage in tests:
 *   import { setStripeForTesting } from "../services/stripe-factory.js";
 *   setStripeForTesting(myFakeStripe);
 *   // ... make HTTP requests ...
 *   setStripeForTesting(null); // restore in finally
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type StripeAlike = any;

let _testInstance: StripeAlike | null = null;

/**
 * Inject a fake Stripe client for the current Node.js process.
 * Pass null to restore normal Stripe SDK behaviour.
 * Must only be called from test code — never from production paths.
 *
 * Throws immediately when NODE_ENV === "production" to prevent accidental
 * injection in live environments.
 */
export function setStripeForTesting(s: StripeAlike | null): void {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error(
      "[stripe-factory] setStripeForTesting() is disabled in NODE_ENV=production. " +
      "Never inject a test Stripe client in a live environment."
    );
  }
  _testInstance = s;
}

/**
 * Treat an explicit test-mode flag or a test Node environment as test-only.
 * NODE_ENV may be "production" in Replit workspaces, so it is not used to
 * infer test mode there; an explicit flag still selects the test key.
 */
export function isStripeTestMode(): boolean {
  return process.env["STRIPE_TEST_MODE"] === "true" || process.env["NODE_ENV"] === "test";
}

/**
 * Create (or return the injected test) Stripe client for the given secret key.
 * In production this returns `new Stripe(key, { apiVersion })`.
 * In tests it returns whatever was last passed to setStripeForTesting().
 */
export async function createStripeClient(key: string): Promise<StripeAlike> {
  if (_testInstance !== null) return _testInstance;
  const { default: Stripe } = await import("stripe");
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

/**
 * Returns the correct Stripe secret key for the current environment.
 *
 * When test mode is active AND the resolved key starts with sk_test_:
 *   • Uses STRIPE_TEST_KEY or STRIPE_TEST_SECRET_KEY — a completely isolated
 *     Stripe test account with its own webhook endpoint and signing secret.
 *   • The sk_test_ prefix is the safety gate: a live key can never be
 *     substituted as a test key even if STRIPE_TEST_MODE is mistakenly set.
 *
 * The startup guard in index.ts enforces an additional production rule:
 *   if NODE_ENV=production and the resolved key is sk_test_, the server
 *   refuses to start with a fatal log and process.exit(1).
 *
 * Otherwise: falls back to STRIPE_LIVE_API_KEY → STRIPE_SECRET_KEY (live mode).
 *
 * All billing routes must call getStripeKey() so that enabling/disabling test
 * mode requires only an env-var flip, not code changes.
 */
export function getStripeKey(): string {
  // A valid sk_test_ prefix is the safety gate — a live key can never be
  // substituted as a test key, including when STRIPE_TEST_MODE is omitted in
  // a NODE_ENV=test environment.
  if (isStripeTestMode()) {
    const testKey = process.env["STRIPE_TEST_KEY"] || process.env["STRIPE_TEST_SECRET_KEY"];
    if (testKey?.startsWith("sk_test_")) return testKey;
    // A test service with a missing/invalid test key must not silently use LIVE.
    return "";
  }
  return process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"] || "";
}

/** Temporary certification diagnostic; deliberately reveals no secret value. */
export function getStripeCheckoutModeLog(key: string): {
  stripeMode: "LIVE" | "TEST";
  stripeKeyType: "sk_live" | "sk_test" | "unknown";
  expectedSessionPrefix: "cs_live" | "cs_test" | "unknown";
} {
  const isTest = key.startsWith("sk_test_");
  const isLive = key.startsWith("sk_live_");
  return {
    stripeMode: isTest ? "TEST" : "LIVE",
    stripeKeyType: isTest ? "sk_test" : isLive ? "sk_live" : "unknown",
    expectedSessionPrefix: isTest ? "cs_test" : isLive ? "cs_live" : "unknown",
  };
}

/**
 * CLE PUBLIABLE renvoyee au navigateur — SELECTEUR UNIQUE.
 *
 * La cle publiable doit toujours appartenir au MEME compte et au MEME mode que
 * la cle secrete qui a cree l'intent. Une pk_live_ laisse Stripe.js se charger
 * mais empeche un SetupIntent de TEST de produire un Payment Element utilisable
 * (et inversement) : l'echec se produit dans le navigateur, loin de sa cause.
 *
 * Avant centralisation, trois routes lisaient
 * `STRIPE_PUBLISHABLE_KEY ?? PUBLIC_STRIPE_API_KEY` sans tenir compte du mode
 * (routes/index.ts, deux routes de billing.ts) tandis que le parcours public
 * avait son propre helper conscient du mode. Un operateur en mode test avec une
 * pk_live_ configuree pour la production livrait donc une cle live avec un
 * intent de test.
 *
 * GARANTIE : le prefixe de la cle rendue correspond toujours au mode actif.
 * En cas de desaccord, la fonction rend "" — le front a un garde explicite
 * pour la cle vide ("Configuration Stripe manquante") alors qu'une cle du
 * mauvais mode echouerait en silence dans Stripe.js.
 */
export function getPublishableKey(stripeKey?: string): string {
  const activeKey = stripeKey ?? getStripeKey();
  const isTest = isStripeTestMode() || activeKey.startsWith("sk_test_");

  if (isTest) {
    if (!activeKey.startsWith("sk_test_")) return "";
    const k = process.env["STRIPE_TEST_PUBLISHABLE_KEY"] || "";
    if (!k) return "";
    if (!k.startsWith("pk_test_")) {
      // Jamais de pk_live_ avec un intent de test.
      logger.error({ expected: "pk_test_", variable: "STRIPE_TEST_PUBLISHABLE_KEY" },
        "[Stripe] cle publiable de mauvais mode en mode TEST — ignoree");
      return "";
    }
    return k;
  }

  const k = process.env["STRIPE_PUBLISHABLE_KEY"] || process.env["PUBLIC_STRIPE_API_KEY"] || "";
  if (!k) return "";
  if (k.startsWith("pk_test_")) {
    // Jamais de pk_test_ avec un intent live.
    logger.error({ expected: "pk_live_", variable: "STRIPE_PUBLISHABLE_KEY | PUBLIC_STRIPE_API_KEY" },
      "[Stripe] cle publiable de mauvais mode en mode LIVE — ignoree");
    return "";
  }
  return k;
}

/** Diagnostic sans secret : le mode des deux cles concorde-t-il ? */
export function getStripeKeyPairMode(stripeKey?: string): {
  secretMode: "TEST" | "LIVE" | "UNKNOWN";
  publishableMode: "TEST" | "LIVE" | "MISSING";
  coherent: boolean;
} {
  const activeKey = stripeKey ?? getStripeKey();
  const secretMode = activeKey.startsWith("sk_test_") ? "TEST"
    : activeKey.startsWith("sk_live_") ? "LIVE" : "UNKNOWN";
  const pub = getPublishableKey(activeKey);
  const publishableMode = !pub ? "MISSING" : pub.startsWith("pk_test_") ? "TEST" : "LIVE";
  return { secretMode, publishableMode, coherent: publishableMode === secretMode };
}
