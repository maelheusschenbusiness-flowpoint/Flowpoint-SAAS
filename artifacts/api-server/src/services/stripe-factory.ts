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
 */
export function setStripeForTesting(s: StripeAlike | null): void {
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
