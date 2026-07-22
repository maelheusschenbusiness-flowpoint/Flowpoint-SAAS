/**
 * ensure-stripe-customer.ts — P0 Stripe Customer Guarantee (v2)
 *
 * Guarantees every org always has exactly ONE valid Stripe Customer.
 *
 * Protections:
 *  1. Empty-string normalization  — stripe_customer_id='' treated as null (was causing duplicates)
 *  2. In-process concurrency lock — _inflight Map prevents duplicate creation within one Node process
 *  3. Postgres advisory lock      — pg_advisory_lock prevents duplicate creation across Render instances
 *  4. Re-read inside lock         — re-reads DB after acquiring lock to detect creation by another instance
 *  5. Stripe metadata search      — finds orphaned customers if DB write failed on previous attempt
 *  6. Stripe idempotency key      — belt-and-suspenders: Stripe rejects duplicate creates with same key
 *  7. Strict persistence          — throws (not swallows) if DB write cannot be confirmed by re-read
 *  8. Deleted-customer recovery   — detects deleted:true and resource_missing, creates replacement
 */

import { pool } from "@workspace/db";
import { loadOrgSettings, upsertOrgSettings } from "./org-settings.js";
import { store } from "./store.js";
import { logger } from "../lib/logger.js";

/** Subset of org data accepted as a performance hint (avoids a second DB read). */
export interface CustomerHint {
  stripeCustomerId: string | null;
  email: string | null;
  firstName: string | null;
  orgName: string | null;
}

// ── In-process concurrency lock ───────────────────────────────────────────────
// One Promise per orgId within the same Node.js process. A second concurrent
// request for the same org awaits the same Promise rather than starting its own.
const _inflight = new Map<string, Promise<string>>();

/**
 * Return a guaranteed-valid Stripe Customer ID for `orgId`.
 *
 * @param orgId     — org_settings primary key (user email in production)
 * @param hint      — optional pre-loaded billing context (performance shortcut only — DB is authoritative)
 * @param stripeKey — Stripe secret key (defaults to STRIPE_LIVE_API_KEY / STRIPE_SECRET_KEY)
 * @throws          — if Stripe is unreachable, key is missing, or DB write cannot be confirmed
 */
export async function ensureStripeCustomer(
  orgId: string,
  hint?: CustomerHint | null,
  stripeKey?: string,
): Promise<string> {
  // Fast path: another request for the same org is already in flight in this process.
  const inflight = _inflight.get(orgId);
  if (inflight) return inflight;

  const promise = _run(orgId, hint, stripeKey).finally(() => _inflight.delete(orgId));
  _inflight.set(orgId, promise);
  return promise;
}

// ── Core logic ────────────────────────────────────────────────────────────────

async function _run(
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

  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });

  // ── Step 1: DB is the authoritative source ─────────────────────────────────
  const settings = await loadOrgSettings(orgId).catch(() => null);

  // CRITICAL FIX: normalize empty string → null.
  // Some rows have stripe_customer_id='' (not NULL). The `??` operator does NOT
  // treat empty string as nullish, so `"" ?? null` returns "". Then `if ("")`
  // is falsy, skipping validation and always creating a new customer.
  const rawId =
    settings?.stripeCustomerId ??
    hint?.stripeCustomerId ??
    null;
  const candidateId: string | null =
    rawId && rawId.trim() ? rawId.trim() : null;

  // ── Step 2: Validate existing customer ────────────────────────────────────
  if (candidateId) {
    try {
      const customer = await stripe.customers.retrieve(candidateId);
      if (!(customer as { deleted?: boolean }).deleted) {
        // Customer is alive — return immediately without touching DB.
        _syncStore(candidateId);
        logger.debug({ orgId, customerId: candidateId }, "[ensureStripeCustomer] Valid customer found");
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

  // ── Step 3: Create needed — acquire Postgres advisory lock ─────────────────
  // Prevents duplicate creation across multiple Render/server instances.
  return _withPgLock(orgId, async () => {
    // Re-read DB inside the lock: another instance may have created while we waited.
    const freshSettings = await loadOrgSettings(orgId).catch(() => null);
    const freshRaw =
      freshSettings?.stripeCustomerId ??
      null;
    const freshId: string | null =
      freshRaw && freshRaw.trim() ? freshRaw.trim() : null;

    if (freshId && freshId !== candidateId) {
      // Another instance wrote a new customer — validate and use it.
      try {
        const cust = await stripe.customers.retrieve(freshId);
        if (!(cust as { deleted?: boolean }).deleted) {
          _syncStore(freshId);
          logger.info(
            { orgId, customerId: freshId },
            "[ensureStripeCustomer] Another instance created customer — reusing",
          );
          return freshId;
        }
      } catch (err: unknown) {
        const stripeErr = err as { code?: string };
        if (stripeErr?.code !== "resource_missing") throw err;
      }
    }

    // ── Step 4: Search Stripe by orgId metadata (recovers orphaned customers) ─
    // Stripe search has ~15-30s indexing lag, so this only helps on retry
    // after a previous DB-write failure, not on the first attempt.
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

    // ── Step 5: Create exactly one customer ────────────────────────────────────
    // Idempotency key strategy:
    //  • No prior customer  → `fp-cust-${orgId}`  (stable across process restarts)
    //  • Replacing deleted  → `fp-cust-${orgId}-rpl-${last12chars}` (unique per deletion event)
    // Stripe caches create responses for 24h by idempotency key, so concurrent
    // calls with the same key ACROSS instances return the identical customer.
    const idempotencyKey = candidateId
      ? `fp-cust-${orgId}-rpl-${candidateId.slice(-12)}`
      : `fp-cust-${orgId}`;

    const email: string | null = freshSettings?.email ?? hint?.email ?? null;
    const isValidEmail =
      email != null && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    const displayName =
      [freshSettings?.firstName, freshSettings?.orgName]
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

    // ── Step 6: Persist and confirm ───────────────────────────────────────────
    await _persistStrict(orgId, customer.id);
    return customer.id;
  });
}

// ── Postgres advisory lock ────────────────────────────────────────────────────

/**
 * Acquire a Postgres session-level advisory lock keyed on orgId, run `fn`,
 * then release. Blocks other instances/processes until the lock is released.
 */
async function _withPgLock<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const lockKey = _hashOrgId(orgId);
  const client = await pool.connect();
  try {
    // Session-level advisory lock — blocks until acquired.
    // Released explicitly in the inner finally (or implicitly when the session ends).
    await client.query("SELECT pg_advisory_lock($1)", [lockKey]);
    try {
      return await fn();
    } finally {
      // Always release on the same connection.
      await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch((err) =>
        logger.warn({ err, orgId }, "[ensureStripeCustomer] pg_advisory_unlock failed"),
      );
    }
  } finally {
    client.release();
  }
}

/**
 * Stable 32-bit signed integer hash of orgId for use as pg_advisory_lock key.
 * djb2 variant — fast and low-collision for email-like strings.
 */
function _hashOrgId(orgId: string): number {
  let h = 5381;
  for (let i = 0; i < orgId.length; i++) {
    // Math.imul avoids floating-point; `| 0` keeps it 32-bit signed
    h = (Math.imul(h, 31) + orgId.charCodeAt(i)) | 0;
  }
  return h;
}

// ── Strict persistence ────────────────────────────────────────────────────────

/**
 * Write customerId to DB and confirm with a re-read.
 * THROWS if the write cannot be confirmed after 2 attempts.
 * Caller (inside the advisory lock) must handle the error.
 */
async function _persistStrict(orgId: string, customerId: string): Promise<void> {
  _syncStore(customerId);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await upsertOrgSettings(orgId, { stripeCustomerId: customerId });

      // Confirm the write took effect (guards against silent RLS-UPDATE-0-rows).
      const confirm = await loadOrgSettings(orgId);
      if (confirm?.stripeCustomerId === customerId) {
        logger.debug(
          { orgId, customerId },
          "[ensureStripeCustomer] DB write confirmed",
        );
        return; // ✅ confirmed
      }

      const msg = `[ensureStripeCustomer] DB write NOT confirmed: expected ${customerId}, got ${confirm?.stripeCustomerId ?? "null"}`;
      logger.error({ orgId, expected: customerId, actual: confirm?.stripeCustomerId }, msg);

      if (attempt === 2) throw new Error(msg);
    } catch (err) {
      if (attempt === 2) {
        logger.error(
          { err, orgId, customerId },
          "[ensureStripeCustomer] DB persist failed after 2 attempts — throwing to prevent silent duplicate creation on next request",
        );
        throw err;
      }
      logger.warn({ err, orgId }, "[ensureStripeCustomer] DB persist attempt 1 failed — retrying in 250ms");
      await new Promise((r) => setTimeout(r, 250));
    }
  }
}

/** Best-effort sync of store.me (secondary cache — never the source of truth). */
function _syncStore(customerId: string): void {
  try {
    store.me.stripeCustomerId = customerId;
  } catch {
    /* non-fatal */
  }
}
