/**
 * ensure-stripe-customer.ts — P0 Stripe Customer Guarantee
 *
 * Single source of truth for getting/creating a valid Stripe Customer for any org.
 *
 * Handles:
 *  - org with no stripe_customer_id (new user via login-request, pre-Stripe account)
 *  - stripe_customer_id in DB but Customer deleted in Stripe (resource_missing / deleted:true)
 *  - process restart (store.me wiped — DB is the source of truth)
 *  - concurrent requests (per-orgId in-flight lock prevents duplicate creation)
 *  - DB write failure after Stripe creation (retry + metadata-search recovery)
 *  - rate-limit / network timeout (propagates to caller; billing routes handle 503)
 */

import { loadOrgSettings, upsertOrgSettings } from "./org-settings.js";
import { store } from "./store.js";
import { logger } from "../lib/logger.js";

/** Subset of org data needed for customer creation. */
export interface CustomerHint {
  stripeCustomerId: string | null;
  email: string | null;
  firstName: string | null;
  orgName: string | null;
}

// ── Per-orgId concurrency lock ────────────────────────────────────────────────
// If two requests arrive simultaneously for the same org, only one Stripe call
// is made; the second awaits the same Promise.
const _inflight = new Map<string, Promise<string>>();

/**
 * Return a guaranteed-valid Stripe Customer ID for `orgId`.
 *
 * @param orgId       — org_settings primary key (user email in production)
 * @param hint        — optional pre-loaded billing context to avoid redundant DB reads
 * @param stripeKey   — override Stripe key (defaults to env STRIPE_LIVE_API_KEY / STRIPE_SECRET_KEY)
 * @throws            — re-throws Stripe errors that are not resource_missing/deleted
 */
export async function ensureStripeCustomer(
  orgId: string,
  hint?: CustomerHint | null,
  stripeKey?: string,
): Promise<string> {
  const existing = _inflight.get(orgId);
  if (existing) return existing;

  const promise = _run(orgId, hint, stripeKey).finally(() => _inflight.delete(orgId));
  _inflight.set(orgId, promise);
  return promise;
}

// ── Internal implementation ───────────────────────────────────────────────────

async function _run(
  orgId: string,
  hint: CustomerHint | null | undefined,
  stripeKeyOverride: string | undefined,
): Promise<string> {
  const key = stripeKeyOverride ?? process.env["STRIPE_LIVE_API_KEY"] ?? process.env["STRIPE_SECRET_KEY"] ?? "";
  if (!key) throw new Error("[ensureStripeCustomer] No Stripe key configured");

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });

  // ── 1. DB is the source of truth ──────────────────────────────────────────
  // Always read from DB to survive process restarts; hint is a performance shortcut.
  const settings = await loadOrgSettings(orgId).catch(() => null);
  const candidateId: string | null =
    settings?.stripeCustomerId ?? hint?.stripeCustomerId ?? null;

  // ── 2. Validate existing customer in Stripe ───────────────────────────────
  if (candidateId) {
    try {
      const customer = await stripe.customers.retrieve(candidateId);
      if (!(customer as { deleted?: boolean }).deleted) {
        // Valid customer — sync store.me and return
        _syncStore(candidateId);
        return candidateId;
      }
      logger.warn(
        { orgId, candidateId },
        "[ensureStripeCustomer] Customer marked deleted in Stripe — recreating",
      );
    } catch (err: unknown) {
      const stripeErr = err as { code?: string };
      if (stripeErr?.code !== "resource_missing") throw err;
      logger.warn(
        { orgId, candidateId },
        "[ensureStripeCustomer] Customer not found (resource_missing) — recreating",
      );
    }
  }

  // ── 3. Search by orgId metadata before creating (duplicate prevention) ────
  // If a previous creation succeeded but the DB write failed, we find the
  // orphaned customer instead of creating a second one.
  try {
    const search = await stripe.customers.search({
      query: `metadata['orgId']:'${orgId}'`,
      limit: 3,
    });
    const live = search.data.find((c) => !(c as { deleted?: boolean }).deleted);
    if (live) {
      logger.info(
        { orgId, customerId: live.id },
        "[ensureStripeCustomer] Found existing customer via metadata search — reusing",
      );
      await _persist(orgId, live.id);
      return live.id;
    }
  } catch (searchErr) {
    logger.debug({ searchErr }, "[ensureStripeCustomer] Metadata search failed — continuing to create");
  }

  // ── 4. Resolve display name and email ────────────────────────────────────
  const rawEmail: string | null = settings?.email ?? hint?.email ?? null;
  const isValidEmail = rawEmail != null && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(rawEmail);

  const firstName = settings?.firstName ?? hint?.firstName ?? null;
  const orgName   = settings?.orgName   ?? hint?.orgName   ?? null;
  const displayName =
    [firstName, orgName].filter(Boolean).join(" ").trim() || "FlowPoint User";

  // ── 5. Create new Stripe Customer ────────────────────────────────────────
  const customer = await stripe.customers.create({
    ...(isValidEmail ? { email: rawEmail! } : {}),
    name: displayName,
    metadata: {
      orgId,
      flowpointUserId: orgId,
      environment: process.env["NODE_ENV"] ?? "development",
    },
  });

  logger.info(
    { orgId, customerId: customer.id, email: isValidEmail ? rawEmail : "(none)" },
    "[ensureStripeCustomer] New Stripe customer created",
  );

  // ── 6. Persist to DB (retry once) then sync store ─────────────────────────
  await _persist(orgId, customer.id);
  return customer.id;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Write customerId to DB with one retry; warn but never throw on failure. */
async function _persist(orgId: string, customerId: string): Promise<void> {
  _syncStore(customerId);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await upsertOrgSettings(orgId, { stripeCustomerId: customerId });
      return;
    } catch (err) {
      if (attempt === 2) {
        logger.error(
          { err, orgId, customerId },
          "[ensureStripeCustomer] DB persist failed after 2 attempts — " +
          "customer created in Stripe but not saved to DB. " +
          "Customer can be recovered via metadata search on next request.",
        );
        return;
      }
      logger.warn({ err, orgId }, "[ensureStripeCustomer] DB persist failed — retrying in 250ms");
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/** Keep store.me in sync (best-effort — never throw). */
function _syncStore(customerId: string): void {
  try { store.me.stripeCustomerId = customerId; } catch { /* non-fatal */ }
}
