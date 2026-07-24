/**
 * ensure-stripe-customer.ts — P0 Stripe Customer Guarantee (v3)
 *
 * Guarantees every org always has exactly ONE valid Stripe Customer.
 *
 * Architecture (two-layer deduplication):
 *  Layer 1 — _inflight Map (in-process)
 *    Same-process concurrent requests for the same orgId share one Promise.
 *    Fast path: no DB/Stripe I/O for callers beyond the first.
 *
 *  Layer 2 — pg_advisory_lock (cross-process)
 *    The ENTIRE sequence (read → validate → create → persist → confirm) runs
 *    inside the advisory lock.  This serialises all server instances for a given
 *    org so that cross-process races cannot produce duplicate customers.
 *
 *    Previous v2 held the lock only around creation, leaving a window where two
 *    processes both passed Step 1 (DB read outside the lock) and both proceeded
 *    to create.  v3 closes that window by moving Step 1 inside the lock.
 *
 * Guarantees:
 *  1. Empty-string normalisation  — stripe_customer_id='' treated as null
 *  2. In-process lock             — _inflight Map deduplicates within one Node process
 *  3. Advisory lock around ALL    — DB read, Stripe validate, create, persist all atomic
 *  4. Re-read inside lock         — authoritative DB state read after lock acquired
 *  5. Stripe metadata search      — orphan recovery (works after Stripe indexing lag)
 *  6. Stable idempotency key      — `fp-cust-<orgId>` stable across restarts
 *  7. Strict DB persistence       — throws if write cannot be confirmed; no orphan leak
 *  8. Deleted-customer recovery   — detects deleted:true / resource_missing, recreates
 */

import { pool } from "@workspace/db";
import { loadOrgSettings, upsertOrgSettings } from "./org-settings.js";
import { store } from "./store.js";
import { logger } from "../lib/logger.js";

/** Subset of org data accepted as a performance hint (avoids an extra DB read for email/name). */
export interface CustomerHint {
  stripeCustomerId: string | null;
  email: string | null;
  firstName: string | null;
  orgName: string | null;
}

// ── In-process concurrency lock ───────────────────────────────────────────────
// One Promise per orgId within the same Node.js process.  Subsequent concurrent
// requests for the same org await the existing Promise instead of starting a new one.
const _inflight = new Map<string, Promise<string>>();

/**
 * Return a guaranteed-valid Stripe Customer ID for `orgId`.
 *
 * @param orgId     — org_settings primary key (user email in production)
 * @param hint      — optional pre-loaded billing context (used for email/name only)
 * @param stripeKey — Stripe secret key (defaults to STRIPE_LIVE_API_KEY / STRIPE_SECRET_KEY)
 * @throws          — if Stripe is unreachable, key is missing, or DB write cannot be confirmed
 */
export async function ensureStripeCustomer(
  orgId: string,
  hint?: CustomerHint | null,
  stripeKey?: string,
): Promise<string> {
  // Layer 1: another request for the same org is already in flight in this process.
  const inflight = _inflight.get(orgId);
  if (inflight) return inflight;

  const promise = _runWithLock(orgId, hint, stripeKey).finally(() => _inflight.delete(orgId));
  _inflight.set(orgId, promise);
  return promise;
}

// ── Core logic (runs inside advisory lock) ────────────────────────────────────

async function _runWithLock(
  orgId: string,
  hint: CustomerHint | null | undefined,
  stripeKeyOverride: string | undefined,
): Promise<string> {
  const key =
    stripeKeyOverride ??
    process.env["STRIPE_LIVE_API_KEY"] ??
    process.env["STRIPE_SECRET_KEY"] ??
    "";
  if (!key) throw new Error("[ensureStripeCustomer] No Stripe key configured");

  // Import Stripe BEFORE acquiring the advisory lock to avoid holding the lock
  // during module initialisation (which only happens once per process lifetime).
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });

  // Layer 2: Postgres advisory lock — serialises ALL instances for this orgId.
  // The lock encompasses the entire sequence:
  //   read DB → validate Stripe → create → persist → confirm
  return _withPgLock(orgId, async () => {
    // ── Step 1: Read DB inside the lock (authoritative source) ─────────────
    // Any customer created by a competing process will be visible here.
    const settings = await loadOrgSettings(orgId).catch(() => null);

    // CRITICAL: normalise empty-string → null.
    // Some rows have stripe_customer_id='' (not NULL); `??` does NOT treat '' as nullish.
    const rawId =
      settings?.stripeCustomerId ??
      hint?.stripeCustomerId ??
      null;
    const candidateId: string | null =
      rawId && rawId.trim() ? rawId.trim() : null;

    // ── Step 2: Validate existing customer ─────────────────────────────────
    if (candidateId) {
      try {
        const customer = await stripe.customers.retrieve(candidateId);
        if (!(customer as { deleted?: boolean }).deleted) {
          // Customer is alive — reuse without touching DB.
          _syncStore(candidateId);
          logger.debug(
            { orgId, customerId: candidateId },
            "[ensureStripeCustomer] Valid customer found in DB — reusing",
          );
          return candidateId;
        }
        logger.warn(
          { orgId, candidateId },
          "[ensureStripeCustomer] Customer deleted in Stripe — will recreate",
        );
      } catch (err: unknown) {
        const stripeErr = err as { code?: string };
        if (stripeErr?.code !== "resource_missing") throw err;
        logger.warn(
          { orgId, candidateId },
          "[ensureStripeCustomer] Customer not found (resource_missing) — will recreate",
        );
      }
    }

    // ── Step 3: Search Stripe by orgId metadata (orphan recovery) ──────────
    // Stripe search has ~15-30s indexing lag; this recovers previously created
    // customers whose DB write failed.  On a fresh first-ever call it finds nothing
    // and we proceed to Step 4.
    try {
      const search = await stripe.customers.search({
        query: `metadata['orgId']:'${orgId}'`,
        limit: 5,
      });
      const live = search.data.find((c) => !(c as { deleted?: boolean }).deleted);
      if (live) {
        logger.info(
          { orgId, customerId: live.id },
          "[ensureStripeCustomer] Found orphaned customer via metadata search — reusing",
        );
        await _persistStrict(orgId, live.id);
        return live.id;
      }
    } catch (searchErr) {
      logger.debug(
        { searchErr },
        "[ensureStripeCustomer] Metadata search failed (Stripe index lag) — proceeding to create",
      );
    }

    // ── Step 4: Create exactly one customer ────────────────────────────────
    // Idempotency key strategy:
    //   No prior customer:   `fp-cust-<orgId>`                    (stable across restarts)
    //   Replacing deleted:   `fp-cust-<orgId>-rpl-<last12chars>`  (unique per deletion event)
    // Stripe caches responses for 24h, so concurrent cross-instance calls with the
    // same key return the identical customer object — no duplicate is created.
    const idempotencyKey = candidateId
      ? `fp-cust-${orgId}-rpl-${candidateId.slice(-12)}`
      : `fp-cust-${orgId}`;

    const email: string | null =
      settings?.email ?? hint?.email ?? null;
    const isValidEmail =
      email != null && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    const displayName =
      [settings?.firstName ?? hint?.firstName, settings?.orgName ?? hint?.orgName]
        .filter(Boolean)
        .join(" ")
        .trim() || "FlowPoint User";

    const customer = await stripe.customers.create(
      {
        ...(isValidEmail ? { email } : {}),
        name: displayName,
        metadata: {
          orgId,
          flowpointUserId: orgId,
          environment: process.env["NODE_ENV"] ?? "development",
        },
      },
      { idempotencyKey },
    );

    logger.info(
      { orgId, customerId: customer.id, idempotencyKey },
      "[ensureStripeCustomer] New Stripe customer created",
    );

    // ── Step 5: Persist and confirm ────────────────────────────────────────
    // Throws if the write cannot be confirmed — caller receives 503.
    // This prevents returning a customer ID that isn't in the DB.
    await _persistStrict(orgId, customer.id);
    return customer.id;
  });
}

// ── Postgres advisory lock ────────────────────────────────────────────────────

/**
 * Acquire a Postgres session-level advisory lock keyed on orgId, run `fn`,
 * then release.  Blocks other instances/processes until the lock is released.
 *
 * The lock is held for the duration of fn() including Stripe API calls (~1-3s).
 * This is intentional: it prevents cross-process customer duplication at the
 * cost of serialising portal/checkout calls for a given org.
 */
async function _withPgLock<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = _hashOrgId(orgId);
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
    try {
      return await fn();
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch((err) =>
        logger.warn({ err, orgId }, "[ensureStripeCustomer] pg_advisory_unlock failed"),
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Stable 32-bit signed integer hash of orgId for pg_advisory_lock key.
 * djb2 variant — fast and low-collision for email-like strings.
 */
function _hashOrgId(orgId: string): number {
  let h = 5381;
  for (let i = 0; i < orgId.length; i++) {
    h = (Math.imul(h, 31) + orgId.charCodeAt(i)) | 0;
  }
  return h;
}

// ── Strict persistence ────────────────────────────────────────────────────────

/**
 * Write customerId to DB and confirm with a re-read.
 * THROWS (after 2 attempts) if the write cannot be confirmed.
 * Called inside the advisory lock — a throw here releases the lock and
 * propagates to the portal/checkout handler which returns 503.
 */
async function _persistStrict(orgId: string, customerId: string): Promise<void> {
  _syncStore(customerId);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await upsertOrgSettings(orgId, { stripeCustomerId: customerId });

      const confirm = await loadOrgSettings(orgId);
      if (confirm?.stripeCustomerId === customerId) {
        logger.debug(
          { orgId, customerId },
          "[ensureStripeCustomer] DB write confirmed",
        );
        return;
      }

      const msg =
        `[ensureStripeCustomer] DB write NOT confirmed: expected ${customerId}, got ${confirm?.stripeCustomerId ?? "null"}`;
      logger.error(
        { orgId, expected: customerId, actual: confirm?.stripeCustomerId },
        msg,
      );

      if (attempt === 2) throw new Error(msg);
    } catch (err) {
      if (attempt === 2) {
        logger.error(
          { err, orgId, customerId },
          "[ensureStripeCustomer] DB persist failed after 2 attempts — throwing to prevent orphan customer",
        );
        throw err;
      }
      logger.warn(
        { err, orgId },
        "[ensureStripeCustomer] DB persist attempt 1 failed — retrying in 250ms",
      );
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/** Best-effort sync to store.me (SSE cache only — never the source of truth). */
function _syncStore(customerId: string): void {
  try {
    store.me.stripeCustomerId = customerId;
  } catch {
    /* non-fatal */
  }
}
