/**
 * ensure-stripe-customer.ts — P0 Stripe Customer Guarantee (v4)
 *
 * Guarantees every org always has exactly ONE valid Stripe Customer,
 * regardless of connection pooler mode (direct / Session Pooler / Transaction Pooler)
 * and regardless of the number of concurrent server instances.
 *
 * ── Architecture: two-layer deduplication ────────────────────────────────────
 *
 *  Layer 1 — _inflight Map (in-process, O(1))
 *    Concurrent requests for the same orgId within a single Node.js process
 *    share one Promise.  The second-through-Nth callers never touch DB or Stripe.
 *    Fast path: ~0ms overhead.
 *
 *  Layer 2 — pg_advisory_xact_lock inside BEGIN/COMMIT (cross-process)
 *    The ENTIRE critical section runs on ONE PostgreSQL client connection
 *    inside an explicit transaction:
 *
 *      pool.connect()
 *        → BEGIN
 *        → pg_advisory_xact_lock(hash(orgId))   ← transaction-level lock
 *        → SELECT org_settings                   ← authoritative DB read
 *        → stripe.customers.retrieve / search / create
 *        → INSERT + UPDATE org_settings          ← atomic DB write
 *        → SELECT org_settings (confirm read)    ← same transaction, sees own write
 *        → COMMIT                                ← releases lock automatically
 *        → release()
 *
 *    Why this is compatible with every PostgreSQL connection mode:
 *    • Direct (port 5432):       one physical session per logical client → always worked
 *    • Session Pooler (port 5432): same as direct for the lock lifetime
 *    • Transaction Pooler (6543): BEGIN forces Supavisor to pin one physical backend
 *      for the full transaction; pg_advisory_xact_lock is released on COMMIT so no
 *      "unlock on wrong session" leak is possible. v3 used session-level advisory_lock
 *      which was broken by the pooler: the LOCK autocommit returned S1 to the pool,
 *      making S1 reentrant for concurrent requests (lock count 1→2 on same session).
 *
 *    Why pg_advisory_xact_lock over pg_advisory_lock:
 *    • Session-level (v3): must be manually unlocked; unlock can run on S2≠S1 with a
 *      transaction pooler → lock leaks on the original session.
 *    • Transaction-level (v4): released automatically when the transaction ends —
 *      no explicit UNLOCK needed, no session mismatch possible.
 *
 * ── v4 changes from v3 ────────────────────────────────────────────────────────
 *  1. _withPgLock: session-level pg_advisory_lock → transaction-level xact_lock in BEGIN/COMMIT
 *  2. ALL DB operations (load, write, confirm) share the SAME PoolClient — no sub-connections
 *  3. loadOrgSettings / upsertOrgSettings accept an optional PoolClient; pass it through
 *  4. catch(searchErr) bug fixed: _persistStrict errors no longer silently swallowed
 *  5. DEBUG instrumentation for every step with wall-clock timing
 *
 * ── Guarantees ────────────────────────────────────────────────────────────────
 *  1. Empty-string normalisation  — stripe_customer_id='' treated as null
 *  2. In-process lock             — _inflight Map deduplicates within one Node process
 *  3. Single-connection lock      — BEGIN/xact_lock serialises ALL instances for an org
 *  4. Re-read inside lock         — authoritative DB state read after lock acquired
 *  5. Stripe metadata search      — orphan recovery (Stripe 15-30s indexing lag handled)
 *  6. Stable idempotency key      — `fp-cust-<orgId>` stable across restarts
 *  7. Strict DB persistence       — throws if write cannot be confirmed; no orphan leak
 *  8. Deleted-customer recovery   — detects deleted:true / resource_missing, recreates
 *  9. Atomic transaction          — write + confirm inside same BEGIN/COMMIT
 */

import { pool } from "@workspace/db";
import { loadOrgSettings, upsertOrgSettings } from "./org-settings.js";
import { store } from "./store.js";
import { logger } from "../lib/logger.js";

// Structural interface covering the pg PoolClient operations used in this module.
// We cannot import PoolClient from "pg" directly (not hoisted) nor use
// Awaited<ReturnType<typeof pool.connect>> (picks the void callback overload).
interface DbClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query(queryText: string, values?: any[]): Promise<{ rows: any[]; rowCount: number | null }>;
  release(err?: boolean | Error): void;
}
type PoolClient = DbClient;

/** Subset of org data accepted as a performance hint (avoids an extra DB read for email/name). */
export interface CustomerHint {
  stripeCustomerId: string | null;
  email: string | null;
  firstName: string | null;
  orgName: string | null;
}

// ── Test injection ────────────────────────────────────────────────────────────
// vitest's vi.mock("stripe") does not reliably intercept dynamic import() calls
// when many concurrent async operations race to execute `await import("stripe")`
// simultaneously.  This setter lets unit tests inject a pre-built stub client
// directly, completely bypassing the module import path.
// Production code never calls _setStripeForTest — the variable stays undefined.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _stripeForTest: any = undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function _setStripeForTest(client: any): void { _stripeForTest = client; }

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

  // Resolve the Stripe client.  In tests _stripeForTest is injected via
  // _setStripeForTest() to bypass dynamic import() mocking unreliability.
  // Import BEFORE acquiring the advisory lock (module init only happens once).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stripe: any = _stripeForTest ?? await (async () => {
    const { default: Stripe } = await import("stripe");
    return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  })();

  // Layer 2: Postgres transaction-level advisory lock on ONE shared client.
  // All DB reads, writes, and confirm reads share this single connection so the
  // lock is never released mid-operation, regardless of the pooler mode.
  return _withPgLock(orgId, async (client) => {
    const t0 = Date.now();
    logger.debug({ orgId }, "[ESC][DEBUG] critical section entered — lock acquired");

    // ── Step 1: Authoritative DB read inside the lock ──────────────────────
    // Any customer created by a competing process that committed BEFORE we
    // acquired the lock will be visible here.
    const settings = await loadOrgSettings(orgId, client).catch(() => null);
    logger.debug(
      { orgId, dbCustomerId: settings?.stripeCustomerId ?? null, ms: Date.now() - t0 },
      "[ESC][DEBUG] Step 1 — DB read complete",
    );

    // CRITICAL: normalise empty-string → null.
    // Some rows have stripe_customer_id='' (not NULL); `??` does NOT treat '' as nullish.
    let rawId = settings?.stripeCustomerId ?? hint?.stripeCustomerId ?? null;

    // ── Step 1B: organizations.stripe_customer_id (resubscription invariant) ─
    // org_settings[UUID] may be absent or stale if the customer was written only
    // through the webhook path or a prior ESC run that updated organizations but
    // not org_settings. Reading organizations directly here ensures that an
    // existing customer is ALWAYS found and NEVER recreated — even if org_settings
    // is empty. This is the primary guard for the resubscription scenario:
    //
    //   existing org (UUID) → canceled subscription → user picks new plan
    //   → Checkout → ESC → must reuse organizations.stripe_customer_id
    //
    // Invariant: 1 org UUID = 1 Stripe Customer for life.
    if (!rawId?.trim()) {
      try {
        const orgRow = await client.query(
          `SELECT stripe_customer_id FROM organizations WHERE id::text = $1 LIMIT 1`,
          [orgId],
        );
        const orgCid = (orgRow.rows[0] as { stripe_customer_id?: string } | undefined)?.stripe_customer_id;
        if (orgCid && orgCid.trim()) {
          rawId = orgCid.trim();
          logger.info(
            { orgId, orgCid },
            "[ESC] Step 1B: found Customer in organizations.stripe_customer_id — will persist to org_settings to prevent future misses",
          );
          // Persist to org_settings immediately so Step 1 finds it next time
          // (fire-and-forget — non-fatal if this write fails)
          await upsertOrgSettings(orgId, { stripeCustomerId: rawId }, client).catch((e) =>
            logger.warn({ e, orgId }, "[ESC] Step 1B: org_settings mirror failed (non-fatal)"),
          );
        }
      } catch (step1bErr) {
        logger.warn({ step1bErr, orgId }, "[ESC] Step 1B: organizations lookup failed (non-fatal)");
      }
    }

    // ── UUID orgId fallback (auth-migration v2) ───────────────────────────
    // After migration, orgId is a UUID but org_settings PK is still the owner
    // email. If the candidate is still null here, try fetching the legacy
    // org_settings row keyed by owner_email — prevents creating a duplicate
    // Stripe customer when the original was stored under the email key.
    //
    // IMPORTANT: when the legacy customer is found and confirmed alive (Step 2),
    // _persistStrict MUST be called to anchor orgId→customer in org_settings[UUID]
    // AND mirror it to organizations.stripe_customer_id via persistOrgData.
    // Without this, every future call re-runs the fallback and, if org_settings
    // [email] is ever cleared, recreates the customer.
    let _fromLegacyFallback = false;
    let _fromPendingSignupsFallback = false;
    if (!rawId?.trim()) {
      try {
        const orgEmailRow = await client.query(
          `SELECT owner_email FROM organizations WHERE id::text = $1 LIMIT 1`,
          [orgId],
        );
        const ownerEmail = (orgEmailRow.rows[0] as { owner_email?: string } | undefined)?.owner_email;
        if (ownerEmail && ownerEmail !== orgId) {
          // ── A: legacy org_settings (original fallback) ────────────────────
          const emailSettings = await loadOrgSettings(ownerEmail, client).catch(() => null);
          const legacyId = emailSettings?.stripeCustomerId;
          if (legacyId && legacyId.trim()) {
            rawId = legacyId.trim();
            _fromLegacyFallback = true;
            logger.info(
              { orgId, ownerEmail, legacyId },
              "[ESC] UUID→email fallback: found customer in legacy org_settings — will persist to UUID key to prevent future duplicates",
            );
          }

          // ── B: pending_signups fallback (abandoned checkout recovery) ─────
          // Covers the ONE_CUSTOMER_INVARIANT scenario:
          //   1. pre-register → pending_signup created
          //   2. payment-intent → Stripe Customer created + persisted in pending_signups.stripe_customer_id
          //   3. checkout abandoned (consumed_at = NULL, session.completed never fires)
          //   4. org UUID created separately (magic link / Google OAuth)
          //   5. organizations.stripe_customer_id = NULL
          //   6. user relaunches checkout → ESC must NOT create a second Customer
          //
          // Strategy: deterministic — only reuse a pending_signup Customer when:
          //   (a) it matches by owner_email (same FlowPoint identity)
          //   (b) it is NOT already anchored to a DIFFERENT UUID org
          //   (c) it was created within 90 days (stale signups are excluded)
          // NB: consumed_at IS NOT filtered — a consumed signup may still carry
          //     a valid Customer that was never written to organizations.
          if (!rawId?.trim()) {
            const psRows = await client.query(
              `SELECT stripe_customer_id
               FROM   pending_signups
               WHERE  lower(email) = lower($1)
                 AND  stripe_customer_id IS NOT NULL
                 AND  created_at > NOW() - INTERVAL '90 days'
               ORDER BY created_at DESC
               LIMIT 5`,
              [ownerEmail],
            );
            for (const ps of psRows.rows) {
              const cid = String(ps.stripe_customer_id);
              // Safety gate: refuse to adopt a Customer already anchored to a different org.
              // This prevents cross-tenant contamination when multiple accounts share an email domain.
              const conflict = await client.query(
                `SELECT 1 FROM organizations
                 WHERE  stripe_customer_id = $1
                   AND  id != $2::uuid
                 LIMIT  1`,
                [cid, orgId],
              );
              if (conflict.rows.length > 0) {
                logger.warn(
                  { orgId, cid },
                  "[ESC] pending-signups fallback: Customer already anchored to a different org — skipping candidate",
                );
                continue;
              }
              rawId = cid;
              _fromPendingSignupsFallback = true;
              logger.info(
                { orgId, ownerEmail, cid },
                "[ESC] pending-signups fallback: found abandoned-checkout Customer — will persist to prevent duplicate creation",
              );
              break;
            }
          }
        }
      } catch (fallbackErr) {
        logger.warn({ fallbackErr, orgId }, "[ESC] UUID→email/pending-signups fallback lookup failed (non-fatal)");
      }
    }

    const candidateId: string | null = rawId && rawId.trim() ? rawId.trim() : null;

    // ── Step 2: Validate existing customer ────────────────────────────────
    if (candidateId) {
      const t2 = Date.now();
      try {
        const customer = await stripe.customers.retrieve(candidateId);
        const ms2 = Date.now() - t2;
        if (!(customer as { deleted?: boolean }).deleted) {
          _syncStore(candidateId);
          logger.debug(
            { orgId, customerId: candidateId, stripeMs: ms2, totalMs: Date.now() - t0 },
            "[ESC][DEBUG] Step 2 — retrieve OK, customer alive — reusing",
          );
          // Backfill company name on existing customers created before the org
          // name was known (signup happens before org settings are complete).
          const _existing = customer as { name?: string | null; description?: string | null; metadata?: Record<string, string> };
          const _company = settings?.orgName ?? hint?.orgName ?? null;
          // Only backfill with a real company name — never with an email address (Google signup placeholder)
          const _realCompany = _company && !_company.includes("@") ? _company : null;
          if (_realCompany && (!_existing.description || _existing.metadata?.["company"] !== _realCompany)) {
            const _bfFirstName = settings?.firstName ?? hint?.firstName;
            const _bfLastName  = (settings as Record<string, unknown> | null)?.["lastName"] as string | null ?? null;
            const _fullName = [_bfFirstName, _bfLastName].filter(Boolean).join(" ").trim() || null;
            stripe.customers.update(candidateId, {
              ...(_fullName ? { name: _fullName } : {}),
              description: _realCompany,
              metadata: { ..._existing.metadata, company: _realCompany },
            }).then(() => {
              logger.info({ orgId, customerId: candidateId, company: _company }, "[ESC] backfilled company on existing Stripe customer");
            }).catch((updErr: unknown) => {
              logger.warn({ orgId, customerId: candidateId, err: updErr instanceof Error ? updErr.message : String(updErr) }, "[ESC] company backfill failed (non-fatal)");
            });
          }
          // ── Legacy / pending-signups fallback persistence ─────────────────
          // When either fallback found this customer, org_settings[UUID] does
          // not yet have a stripe_customer_id row.  Persist now inside this transaction
          // so the next call reads it from Step 1 (no fallback, no risk of re-creation).
          // The dual-write inside _persistStrict also updates organizations.stripe_customer_id.
          if (_fromLegacyFallback || _fromPendingSignupsFallback) {
            try {
              await _persistStrict(orgId, candidateId, client, t0);
              logger.info(
                { orgId, customerId: candidateId },
                "[ESC] UUID→email fallback: persisted legacy customer to UUID org key — future calls skip fallback",
              );
            } catch (persistErr) {
              // Non-fatal: we can still return the correct customer. Log prominently.
              logger.error(
                { persistErr, orgId, customerId: candidateId },
                "[ESC] UUID→email fallback: persistence failed (non-fatal, customer still valid but may duplicate on next call)",
              );
            }
          }
          return candidateId;
        }
        logger.warn(
          { orgId, candidateId, stripeMs: ms2 },
          "[ESC][DEBUG] Step 2 — customer deleted in Stripe — will recreate",
        );
      } catch (err: unknown) {
        const stripeErr = err as { code?: string };
        const ms2 = Date.now() - t2;
        if (stripeErr?.code !== "resource_missing") throw err;
        logger.warn(
          { orgId, candidateId, stripeMs: ms2, code: "resource_missing" },
          "[ESC][DEBUG] Step 2 — resource_missing (test key in live mode, or wrong account) — will recreate",
        );
      }
    } else {
      logger.debug({ orgId }, "[ESC][DEBUG] Step 2 — no candidate in DB, skipping retrieve");
    }

    // ── Step 3: Metadata search (orphan recovery) ─────────────────────────
    // Stripe search has ~15-30s indexing lag; this recovers previously created
    // customers whose DB write failed.  On a fresh first-ever call it finds nothing
    // and we proceed to Step 4.
    //
    // FIX vs v3: the search and the _persistStrict call are separated so that
    // _persistStrict errors are NOT silently swallowed by catch(searchErr).
    const t3 = Date.now();
    let orphan: { id: string; deleted?: boolean } | null = null;
    try {
      const search = await stripe.customers.search({
        query: `metadata['orgId']:'${orgId}'`,
        limit: 5,
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      orphan = search.data.find((c: any) => !(c as { deleted?: boolean }).deleted) ?? null;
      logger.debug(
        { orgId, found: !!orphan, orphanId: orphan?.id ?? null, stripeMs: Date.now() - t3 },
        "[ESC][DEBUG] Step 3 — metadata search complete",
      );
    } catch (searchErr) {
      logger.debug(
        { orgId, searchErr, stripeMs: Date.now() - t3 },
        "[ESC][DEBUG] Step 3 — search failed (index lag or transient error) — proceeding to create",
      );
    }

    if (orphan) {
      logger.info(
        { orgId, customerId: orphan.id },
        "[ESC][DEBUG] Step 3 — orphaned customer found via metadata search — reusing",
      );
      // _persistStrict errors propagate correctly (not inside the search try-catch)
      await _persistStrict(orgId, orphan.id, client, t0);
      return orphan.id;
    }

    // ── QA / synthetic org guard (Phase 4) ───────────────────────────────
    // If the Stripe key is LIVE, block customer creation for internal QA orgs.
    // These orgs should never receive a live Stripe customer; they must use
    // test-mode keys or mocked billing.  Checked here (after all DB reads are
    // done inside the lock) so the advisory lock is already held — no TOCTOU.
    if (key.startsWith("sk_live_")) {
      try {
        const qaRow = await client.query(
          `SELECT COALESCE(is_internal_qa, false) AS is_qa FROM organizations WHERE id::text = $1 LIMIT 1`,
          [orgId],
        );
        const _isQaOrg = qaRow.rows[0]?.is_qa === true;
        if (_isQaOrg) {
          throw new Error(
            `[ESC] BLOCKED: org ${orgId} has is_internal_qa=true — live Stripe customer creation is prohibited for QA orgs. ` +
            `Call ensureStripeCustomer with STRIPE_TEST_KEY instead.`,
          );
        }
      } catch (qaErr) {
        // Re-throw if it's our own guard; suppress DB errors (missing column etc.) so existing orgs are unaffected.
        if (qaErr instanceof Error && qaErr.message.startsWith("[ESC] BLOCKED")) throw qaErr;
        logger.warn({ qaErr, orgId }, "[ESC] QA guard check failed (non-fatal, proceeding to create)");
      }
    }

    // ── Step 4: Create exactly one customer ───────────────────────────────
    // Idempotency key strategy:
    //   No prior customer:   `fp-cust-<orgId>`                    (stable across restarts)
    //   Replacing deleted:   `fp-cust-<orgId>-rpl-<last12chars>`  (unique per deletion event)
    // Stripe caches responses for 24h, so concurrent cross-instance calls with the
    // same idempotency key return the identical customer object — no duplicate is created.
    // With pg_advisory_xact_lock this code path is only reached by ONE instance at a time.
    const idempotencyKey = candidateId
      ? `fp-cust-${orgId}-rpl-${candidateId.slice(-12)}`
      : `fp-cust-${orgId}`;

    const email: string | null = settings?.email ?? hint?.email ?? null;
    const isValidEmail = email != null && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
    // Build display name from real name fields — never from orgName (which may be an email placeholder)
    const _escFirstName = settings?.firstName ?? hint?.firstName;
    const _escLastName  = (settings as Record<string, unknown> | null)?.["lastName"] as string | null ?? null;
    const displayName =
      [_escFirstName, _escLastName].filter(Boolean).join(" ").trim()
      || (isValidEmail && email ? email.split("@")[0] : null)
      || "FlowPoint User";

    logger.debug(
      { orgId, idempotencyKey, email: isValidEmail ? email : "(invalid)", displayName },
      "[ESC][DEBUG] Step 4 — creating Stripe customer",
    );

    // Collect additional fields from org settings for richer Stripe profile
    const orgCountry  = settings?.country  ?? null;
    const orgCity     = settings?.city     ?? null;
    const orgAddress  = settings?.address  ?? null;
    const orgCompany  = settings?.orgName  ?? hint?.orgName ?? null;
    // Only use orgCompany as description when it is a real company name, not an email address
    // (Google OAuth signup temporarily stores the user's email in orgName; don't leak it as description)
    const orgCompanyDisplay = orgCompany && !orgCompany.includes("@") ? orgCompany : null;
    const orgWebsite  = (settings as unknown as { primarySite?: string } | null)?.primarySite ?? null;

    const t4 = Date.now();
    const customer = await stripe.customers.create(
      {
        ...(isValidEmail ? { email } : {}),
        name: displayName,
        ...(orgCompanyDisplay ? { description: orgCompanyDisplay } : {}),
        ...(orgCountry || orgCity || orgAddress ? {
          address: {
            ...(orgCountry ? { country: orgCountry } : {}),
            ...(orgCity    ? { city:    orgCity    } : {}),
            ...(orgAddress ? { line1:   orgAddress } : {}),
          },
        } : {}),
        metadata: {
          orgId,
          flowpointUserId: orgId,
          flowpoint_org_id: orgId,
          company:         orgCompanyDisplay ?? "",
          website:         orgWebsite  ?? "",
          environment:     process.env["NODE_ENV"] ?? "development",
          signup_source:   "flowpoint_web",
        },
      },
      { idempotencyKey },
    );

    logger.info(
      { orgId, customerId: customer.id, idempotencyKey, stripeMs: Date.now() - t4 },
      "[ESC][DEBUG] Step 4 — Stripe customer created",
    );

    // ── Step 5: Persist and confirm (on same transaction client) ─────────
    // Throws if the write cannot be confirmed — caller receives 503.
    // This prevents returning a customer ID that isn't in the DB.
    await _persistStrict(orgId, customer.id, client, t0);
    return customer.id;
  });
}

// ── Postgres advisory lock (v4: transaction-level, single client) ─────────────

/**
 * Acquire a Postgres transaction-level advisory lock on a dedicated client,
 * run `fn(client)` with all DB operations using that same client, then COMMIT.
 *
 * Why BEGIN/COMMIT wrapper:
 *   pg_advisory_xact_lock is transaction-scoped — it is released automatically
 *   when the transaction ends (COMMIT or ROLLBACK).  No explicit UNLOCK is needed
 *   and no "unlock on wrong session" leak is possible with connection poolers.
 *
 * Why single client for all operations:
 *   With Supabase Transaction Pooler (port 6543), each autocommit query may be
 *   routed to a different physical backend.  By keeping one client open inside a
 *   transaction, Supavisor pins one physical backend for the full duration,
 *   making the lock exclusive and non-reentrant for competing requests.
 *
 * Compatibility:
 *   ✓ PostgreSQL direct (port 5432)
 *   ✓ Supabase Session Pooler (port 5432 or 6543 session mode)
 *   ✓ Supabase Transaction Pooler (port 6543 transaction mode)
 *   ✓ Multiple Render instances (DB-level lock, cross-process)
 */
async function _withPgLock<T>(
  orgId: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const lockKey = _hashOrgId(orgId);
  const client: PoolClient = await pool.connect() as unknown as PoolClient;
  try {
    logger.debug({ orgId, lockKey }, "[ESC][DEBUG] BEGIN — acquiring pg_advisory_xact_lock");
    await client.query("BEGIN");
    // pg_advisory_xact_lock blocks until no other session holds the same key.
    // It is released automatically on COMMIT or ROLLBACK — never requires manual unlock.
    await client.query("SELECT pg_advisory_xact_lock($1)", [lockKey]);
    logger.debug({ orgId, lockKey }, "[ESC][DEBUG] pg_advisory_xact_lock acquired");

    const result = await fn(client);

    await client.query("COMMIT");
    logger.debug({ orgId, lockKey }, "[ESC][DEBUG] COMMIT — lock released");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch((rbErr) =>
      logger.warn({ rbErr, orgId }, "[ESC][DEBUG] ROLLBACK failed"),
    );
    logger.debug({ orgId, lockKey, err }, "[ESC][DEBUG] ROLLBACK — lock released on error");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Stable 32-bit signed integer hash of orgId for pg_advisory_xact_lock key.
 * djb2 variant — fast and low-collision for email-like strings.
 */
function _hashOrgId(orgId: string): number {
  let h = 5381;
  for (let i = 0; i < orgId.length; i++) {
    h = (Math.imul(h, 31) + orgId.charCodeAt(i)) | 0;
  }
  return h;
}

// ── Strict persistence (single client, inside the lock transaction) ───────────

/**
 * Write stripe_customer_id directly to org_settings using the shared transaction
 * client, then confirm with a re-read on the same client.
 *
 * All queries execute on `client` — the same connection holding the advisory lock.
 * This means:
 *  - The INSERT and UPDATE are part of the advisory-lock transaction.
 *  - The confirm SELECT sees the uncommitted writes (same-connection visibility).
 *  - ROLLBACK (on any error) undoes the writes automatically.
 *  - No sub-connection is opened; no risk of acquiring a reentrant lock.
 *
 * THROWS after 2 attempts if the write cannot be confirmed.  The caller receives
 * a 503; the ROLLBACK removes any partial write.
 */
async function _persistStrict(
  orgId: string,
  customerId: string,
  client: PoolClient,
  t0: number,
): Promise<void> {
  _syncStore(customerId);

  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const t5 = Date.now();

      // Ensure the row exists (idempotent)
      await client.query(
        `INSERT INTO org_settings (org_id) VALUES ($1) ON CONFLICT (org_id) DO NOTHING`,
        [orgId],
      );

      // Write stripe_customer_id — capture rowCount for debug logging
      const updateResult = await client.query(
        `UPDATE org_settings
            SET stripe_customer_id = $1,
                updated_at         = NOW()
          WHERE org_id = $2`,
        [customerId, orgId],
      );
      const rowCount = updateResult.rowCount ?? 0;

      logger.debug(
        { orgId, customerId, rowCount, dbMs: Date.now() - t5 },
        "[ESC][DEBUG] Step 5 — UPDATE executed",
      );

      // Confirm read — same client sees the uncommitted write within this transaction
      const confirm = await loadOrgSettings(orgId, client);
      logger.debug(
        {
          orgId,
          customerId,
          confirmedId: confirm?.stripeCustomerId ?? null,
          match: confirm?.stripeCustomerId === customerId,
          totalMs: Date.now() - t0,
        },
        "[ESC][DEBUG] Step 5 — confirm read",
      );

      if (confirm?.stripeCustomerId === customerId) {
        logger.info(
          { orgId, customerId, rowCount, totalMs: Date.now() - t0 },
          "[ESC][DEBUG] Step 5 — DB write confirmed — customer persisted",
        );
        // Dual-write: mirror stripe_customer_id to organizations (fire-and-forget, non-fatal)
        // Uses a separate connection outside this transaction.
        import("../services/org-data.js").then(({ persistOrgData }) => {
          persistOrgData(orgId, { stripeCustomerId: customerId }).catch(mirrorErr => {
            logger.warn({ mirrorErr, orgId }, "[ESC] organizations stripe_customer_id mirror failed (non-fatal)");
          });
        }).catch(() => {/* non-fatal */});
        return;
      }

      const msg =
        `[ensureStripeCustomer] DB write NOT confirmed: expected ${customerId}, got ${confirm?.stripeCustomerId ?? "null"}`;
      logger.error(
        { orgId, expected: customerId, actual: confirm?.stripeCustomerId, attempt },
        msg,
      );

      if (attempt === 2) throw new Error(msg);
    } catch (err) {
      if (attempt === 2) {
        logger.error(
          { err, orgId, customerId },
          "[ensureStripeCustomer] DB persist failed after 2 attempts — will ROLLBACK",
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
