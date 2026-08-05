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
 * When STRIPE_TEST_MODE=true (dev only):
 *   • Uses STRIPE_TEST_KEY or STRIPE_TEST_SECRET_KEY — a completely isolated
 *     Stripe test account with its own webhook endpoint and signing secret.
 *   • Never activates in NODE_ENV=production regardless of the flag value.
 *
 * Otherwise: falls back to STRIPE_LIVE_API_KEY → STRIPE_SECRET_KEY (live mode).
 *
 * All billing routes must call getStripeKey() so that enabling/disabling test
 * mode requires only an env-var flip, not code changes.
 */
export function getStripeKey(): string {
  // When STRIPE_TEST_MODE=true and a valid sk_test_ key is available,
  // use it regardless of NODE_ENV. The sk_test_ prefix is the safety gate —
  // a live key can never be substituted as a test key.
  if (process.env["STRIPE_TEST_MODE"] === "true") {
    const testKey = process.env["STRIPE_TEST_KEY"] || process.env["STRIPE_TEST_SECRET_KEY"];
    if (testKey?.startsWith("sk_test_")) return testKey;
  }
  return process.env["STRIPE_LIVE_API_KEY"] || process.env["STRIPE_SECRET_KEY"] || "";
}
