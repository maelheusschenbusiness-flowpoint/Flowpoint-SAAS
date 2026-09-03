import { Router, type Request, type Response } from "express";
import { createHash } from "crypto";

function sha256hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
import { store } from "../services/store.js";
import { logger } from "../lib/logger.js";
import { getPlanForPriceId, getAddonForPriceId, FLAG_ADDONS, QTY_ADDONS } from "../lib/plans.js";
import { mailer } from "../services/mailer.js";
import { persistOrgData, loadOrgData, findOrgByStripeCustomer } from "../services/org-data.js";
import { getStripeKey, createStripeClient } from "../services/stripe-factory.js";
import { loadOrgSettings } from "../services/org-settings.js";

// ── P0-1: persistSubscriptionMeta requires explicit orgId — never defaults to "default"
// If orgId cannot be resolved, the caller must NOT invoke this function.
async function persistSubscriptionMeta(opts: {
  subscriptionStatus?: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  plan?: string;
  orgId: string;          // required — no default
  trialEndsAt?: string;
  /** ISO timestamp: set when the first real Stripe trialing subscription is confirmed */
  trialConsumedAt?: string;
  trialStartedAt?: string;
}): Promise<void> {
  const { orgId, subscriptionStatus, stripeCustomerId, stripeSubscriptionId, plan, trialEndsAt, trialConsumedAt, trialStartedAt } = opts;

  if (!subscriptionStatus && !stripeCustomerId && !stripeSubscriptionId && !plan) return;

  // Guard: refuse writes to "default" — they would corrupt or shadow other orgs
  if (!orgId || orgId === "default") {
    logger.error({ opts }, "[Webhook] persistSubscriptionMeta: orgId is unresolved — write aborted");
    return;
  }

  try {
    const fields: Parameters<typeof persistOrgData>[1] = {};
    if (subscriptionStatus)    fields.subscriptionStatus    = subscriptionStatus;
    if (stripeCustomerId)      fields.stripeCustomerId      = stripeCustomerId;
    if (stripeSubscriptionId)  fields.stripeSubscriptionId  = stripeSubscriptionId;
    if (plan)                  fields.plan                  = plan;
    if (trialEndsAt)           fields.trialEndsAt           = trialEndsAt;
    if (trialConsumedAt)       fields.trialConsumedAt       = trialConsumedAt;
    if (trialStartedAt)        fields.trialStartedAt        = trialStartedAt;

    await persistOrgData(orgId, fields);
    logger.info({ orgId, subscriptionStatus, stripeSubscriptionId, plan }, "[Webhook] Subscription meta persisted to organizations");
  } catch (err) {
    logger.error({ err, orgId }, "[Webhook] Failed to persist subscription meta");
    // A failed authoritative billing write must make this webhook retryable.
    // The outer handler records `failed` and returns 500, rather than turning
    // a paid entitlement into a silent false success.
    throw err;
  }
}

// ── P0-5: Load org email from organizations — never from store.me
async function loadOrgEmail(orgId: string): Promise<{ email: string | null; firstName: string | null; plan: string }> {
  try {
    const data = await loadOrgData(orgId);
    return {
      email:     data?.email     ?? null,
      firstName: data?.firstName ?? null,
      plan:      data?.plan      ?? "standard",
    };
  } catch (err) {
    logger.warn({ err, orgId }, "[Webhook] Failed to load org email from DB — email notification skipped");
    return { email: null, firstName: null, plan: "standard" };
  }
}

async function sendWelcomeOnce(orgId: string, email: string, name: string): Promise<void> {
  const { pool: pgPool } = await import("@workspace/db");
  const client = await pgPool.connect();
  try {
    // Claim only after activation. A failed provider call releases the claim,
    // so a later Stripe delivery or lifecycle retry can safely try again.
    const claim = await client.query(
      `UPDATE organizations SET welcome_email_claimed_at = NOW()
       WHERE id = $1 AND welcome_email_eligible_at IS NOT NULL
         AND welcome_email_sent_at IS NULL
         AND (welcome_email_claimed_at IS NULL OR welcome_email_claimed_at < NOW() - INTERVAL '15 minutes')
       RETURNING id`,
      [orgId],
    );
    if (!claim.rowCount) return;
    const result = await mailer.sendWelcome({ to: email, name });
    if (result.ok) {
      await client.query(
        `UPDATE organizations
         SET welcome_email_sent_at = NOW(), welcome_email_claimed_at = NULL
         WHERE id = $1`,
        [orgId],
      );
      logger.info({ orgId, email, emailId: result.id }, "[Webhook] Welcome email delivered");
      return;
    }
    await client.query(`UPDATE organizations SET welcome_email_claimed_at = NULL WHERE id = $1`, [orgId]);
    logger.error({ orgId, email, error: result.error }, "[Webhook] Welcome email failed; claim released for retry");
  } catch (err) {
    await client.query(`UPDATE organizations SET welcome_email_claimed_at = NULL WHERE id = $1`, [orgId]).catch(() => {});
    logger.error({ err, orgId, email }, "[Webhook] Welcome email lifecycle delivery failed");
  } finally {
    client.release();
  }
}

async function sendTrialStartedOnce(opts: {
  orgId: string; email: string; name: string; plan: string; trialEndsAt: string;
}): Promise<void> {
  const { pool: pgPool } = await import("@workspace/db");
  const client = await pgPool.connect();
  try {
    const claim = await client.query(
      `UPDATE organizations SET trial_started_email_claimed_at = NOW()
       WHERE id = $1 AND trial_started_email_eligible_at IS NOT NULL
         AND trial_started_email_sent_at IS NULL
         AND (trial_started_email_claimed_at IS NULL OR trial_started_email_claimed_at < NOW() - INTERVAL '15 minutes')
       RETURNING id`,
      [opts.orgId],
    );
    if (!claim.rowCount) return;

    // The activation magic-link email is now sent immediately by finalize-checkout
    // (ML-3/ML-4) for both trial and non-trial signups.  sendTrialStartedOnce no
    // longer needs to embed a magic link — it just marks the DB row so we don't
    // fire a duplicate.  Skipping the email send here keeps the 1-email-per-signup
    // promise and removes the webhook-timing dependency.
    await client.query(
      `UPDATE organizations
       SET trial_started_email_sent_at = NOW(), trial_started_email_claimed_at = NULL
       WHERE id = $1`,
      [opts.orgId],
    );
    logger.info({ orgId: opts.orgId, email: opts.email },
      "[Webhook] Trial-started: activation email already sent by finalize-checkout — marking sent_at only");
  } catch (err) {
    await client.query(`UPDATE organizations SET trial_started_email_claimed_at = NULL WHERE id = $1`, [opts.orgId]).catch(() => {});
    logger.error({ err, orgId: opts.orgId, email: opts.email }, "[Webhook] Trial-started lifecycle delivery failed");
  } finally {
    client.release();
  }
}

const router = Router();

function parsePlanFromSubscription(subscription: Record<string, unknown>): string | null {
  // ── P0: Check subscription-level metadata first.
  // All FlowPoint checkout sessions and direct API calls set metadata.plan on the subscription.
  // This is the most reliable signal and handles both test-mode and live-mode price IDs.
  const subMeta = subscription["metadata"] as Record<string, string> | undefined;
  if (subMeta?.["plan"] && ["standard","pro","ultra"].includes(subMeta["plan"].toLowerCase())) {
    return subMeta["plan"].toLowerCase();
  }

  // ── Fallback: derive plan from subscription items (price ID, price metadata, nickname)
  const items = subscription.items as { data?: Array<{ price?: { id?: string; nickname?: string; metadata?: Record<string, string> } }> } | undefined;
  if (!items?.data?.length) return null;

  for (const item of items.data) {
    const price = item?.price;
    if (!price) continue;
    if (price.metadata?.["plan"]) return price.metadata["plan"];
    if (price.id) {
      const found = getPlanForPriceId(price.id);
      if (found) return found;
    }
    if (price.nickname && ["standard","pro","ultra"].includes(price.nickname.toLowerCase())) {
      return price.nickname.toLowerCase();
    }
  }
  return null;
}

// ── P0-3: syncAddonsFromSubscription no longer mutates store.me
// Returns the addon key→value map parsed from subscription items.
function parseAddonsFromSubscription(subscription: Record<string, unknown>): Record<string, boolean | number> {
  const addons: Record<string, boolean | number> = {};
  const items = subscription.items as { data?: Array<{
    price?: { id?: string };
    quantity?: number;
    metadata?: Record<string, string>;
  }> } | undefined;
  if (!items?.data?.length) return addons;

  for (const item of items.data) {
    if (!item.price?.id) continue;

    // Primary: match by registered price ID in ADDON_PRICE_IDS
    let addonKey = getAddonForPriceId(item.price.id);

    // Fallback: item-level metadata.addonKey — set by addon-stripe-sync.ts and E2E tests.
    // Validates the key against known addon sets to prevent arbitrary key injection.
    if (!addonKey && item.metadata?.["addonKey"]) {
      const metaKey = item.metadata["addonKey"];
      if (FLAG_ADDONS.has(metaKey) || QTY_ADDONS.has(metaKey)) {
        addonKey = metaKey;
      }
    }

    if (!addonKey) {
      // ── P0 WARN: non-plan SubscriptionItem not recognised — would be silently skipped.
      // This is the root cause when a Stripe item is charged but org_addons never updated.
      // Log price ID + product so ops can add the mapping to ADDON_PRICE_IDS.
      logger.warn(
        { priceId: item.price?.id, productId: (item.price as { product?: string } | undefined)?.product,
          metadata: item.metadata },
        "[Webhook] parseAddonsFromSubscription: SubscriptionItem not recognised — no addon_key found. " +
        "Add this price ID to ADDON_PRICE_IDS or set item.metadata.addonKey on the Stripe object."
      );
      continue;
    }

    if (FLAG_ADDONS.has(addonKey) && addonKey !== "whiteLabel") {
      addons[addonKey] = true;
    } else if (QTY_ADDONS.has(addonKey)) {
      addons[addonKey] = Number(item.quantity ?? 1);
    }
  }
  return addons;
}

/**
 * persistAddonsFromSubscription
 *
 * @param subscription  - The Stripe subscription object from the webhook event.
 * @param orgId         - Resolved org UUID.
 * @param stripeCustomerId - Stripe customer ID, used to aggregate all live subs when deactivating.
 * @param reconcileDeactivations - When true (subscription.updated / deleted only) deactivate
 *   paid org_addons that are absent from the UNION of all live subscriptions for this customer.
 *   MUST be false for subscription.created to avoid wrongly revoking addons on other subs.
 */
async function persistAddonsFromSubscription(
  subscription: Record<string, unknown>,
  orgId: string,
  stripeCustomerId: string | null,
  reconcileDeactivations: boolean,
  /** When true (subscription.deleted) skip activation of the deleted sub's items —
   *  only reconcile deactivations against the customer's remaining live subs. */
  skipActivation = false,
): Promise<void> {
  if (!orgId || orgId === "default") return;
  const addons = parseAddonsFromSubscription(subscription);

  try {
    const { activateAddon, deactivateAddon } = await import("../services/addons-service.js");
    const { PLAN_INCLUDED_ADDONS: PIA, ADDON_PRICE_IDS: APIDS } = await import("../lib/plans.js");
    const { loadOrgData } = await import("../services/org-data.js");
    const orgInfo = await loadOrgData(orgId).catch(() => null);
    const planName = (orgInfo?.plan ?? "standard").toLowerCase();
    const planIncluded = PIA[planName] ?? new Set<string>();

    // ── 1. Activate addons present in this subscription's items ──────────────
    // Quantity add-ons persist their Stripe line-item quantity to org_addons.quantity
    // so entitlement surfaces expand per pack (e.g. 2× monitorsPack10 = +20 monitors).
    // Skipped on subscription.deleted: the deleted sub's items must not be re-activated.
    if (!skipActivation) {
      for (const [key, val] of Object.entries(addons)) {
        if (val === true || (typeof val === "number" && val > 0)) {
          const qty = typeof val === "number" ? val : 1;
          const activated = await activateAddon(key, orgId, qty);
          if (!activated) {
            throw new Error(`Failed to activate add-on '${key}' for org '${orgId}'`);
          }
        }
      }
    }

    // ── 2. Deactivate stale paid addons — only for subscription.updated / deleted ──
    // Never run on subscription.created: the newly-created add-on subscription
    // would only contain the new addon, causing all other valid addons to be revoked.
    if (!reconcileDeactivations) return;

    // Build the UNION of all addon keys across ALL live subscriptions for this customer.
    // "Live" = active | trialing | past_due (customer still has access).
    let aggregateAddonKeys: Set<string>;
    try {
      if (!stripeCustomerId) {
        // No customer ID available — cannot safely aggregate; skip deactivation (fail-open).
        logger.warn({ orgId }, "[Webhook] reconcile: no stripeCustomerId — skipping deactivation to avoid false revocations");
        return;
      }

      // Use the same mode (live vs test) as the incoming subscription to avoid
      // cross-mode customer-not-found errors when the environment runs test webhooks.
      const subLivemode = Boolean((subscription as Record<string, unknown>)?.livemode ?? true);
      const stripeKey = subLivemode
        ? getStripeKey()
        : (process.env["STRIPE_TEST_KEY"] ?? getStripeKey());
      if (!stripeKey) {
        logger.warn({ orgId }, "[Webhook] reconcile: no Stripe API key — skipping deactivation (fail-open)");
        return;
      }

      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

      // expand items.data.price so item.price is always an object with .id
      // Without expand, Stripe may return price as a bare string in list responses,
      // causing item.price?.id to be undefined and every addon to be wrongly deactivated.
      const allSubs = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: "all",
        limit: 100,
        expand: ["data.items.data.price"],
      });

      // Filter to live subscriptions only
      const liveSubs = allSubs.data.filter(s =>
        s.status === "active" || s.status === "trialing" || s.status === "past_due"
      );

      aggregateAddonKeys = new Set<string>();
      for (const sub of liveSubs) {
        for (const item of sub.items.data) {
          // Defensive: price may be an object OR a bare string depending on expand status
          const rawPrice = item.price as unknown;
          const priceId = typeof rawPrice === "string"
            ? rawPrice
            : (rawPrice as { id?: string } | null)?.id ?? "";
          // Primary: match by price ID in ADDON_PRICE_IDS
          let addonKey: string | null = null;
          if (priceId) {
            const { getAddonForPriceId: _gafp } = await import("../lib/plans.js");
            addonKey = _gafp(priceId);
          }
          // Fallback: item-level metadata.addonKey (set by addon-stripe-sync.ts and
          // E2E/test subscriptions). Same validation as parseAddonsFromSubscription.
          if (!addonKey) {
            const metaKey = (item as { metadata?: Record<string, string> }).metadata?.["addonKey"];
            if (metaKey && (FLAG_ADDONS.has(metaKey) || QTY_ADDONS.has(metaKey))) {
              addonKey = metaKey;
            }
          }
          if (addonKey) aggregateAddonKeys.add(addonKey);
        }
      }
      logger.info({ orgId, stripeCustomerId, liveSubCount: liveSubs.length, addonUnion: Array.from(aggregateAddonKeys) },
        "[Webhook] reconcile: built aggregate addon key union across all live subscriptions");
    } catch (stripeErr) {
      // Stripe API failure — fail-open: skip deactivation entirely, never revoke on incomplete data
      logger.error({ stripeErr, orgId, stripeCustomerId }, "[Webhook] reconcile: Stripe subscription list failed — skipping deactivation (fail-open)");
      return;
    }

    // ── 3. Deactivate paid addons absent from the aggregate union ────────────
    const { pool: pgPool } = await import("@workspace/db");
    const client = await pgPool.connect();
    try {
      const activeRows = await client.query<{ addon_key: string }>(
        `SELECT addon_key FROM org_addons WHERE org_id = $1 AND active = true`,
        [orgId]
      );
      for (const row of activeRows.rows) {
        const key = row.addon_key;
        // Never deactivate plan-included addons via subscription reconciliation
        if (planIncluded.has(key)) continue;
        // Only deactivate addons that have a Stripe price ID (paid add-ons)
        if (!APIDS[key]) continue;
        // If not found in ANY live subscription → deactivate
        if (!aggregateAddonKeys.has(key)) {
          await deactivateAddon(key, orgId).catch(err =>
            logger.warn({ err, key, orgId }, "[Webhook] reconcile: Failed to deactivate removed addon")
          );
          logger.info({ key, orgId }, "[Webhook] reconcile: deactivated addon absent from all live subscriptions");
        }
      }
    } finally {
      client.release();
    }
  } catch (err) {
    logger.warn({ err, orgId }, "[Webhook] persistAddonsFromSubscription: non-critical failure");
  }
}

// ── Shared activation helper — called by checkout.session.completed AND
//    payment_intent.succeeded / setup_intent.succeeded (new checkout-payment.html flow).
//    Idempotent: all DB writes use ON CONFLICT DO NOTHING / DO UPDATE.
//    Exported for QA fixture endpoint (qa-fixtures.ts /qa/billing/activate-signup).
export async function activateNewSignup(opts: {
  preRegToken:  string;
  orgId:        string;   // email = orgId in FlowPoint
  customerId?:  string;   // Stripe customer ID (may be absent for SetupIntent path)
  selectedPlan: string;
  isTrial:      boolean;
}): Promise<void> {
  const { preRegToken, orgId, customerId, selectedPlan, isTrial } = opts;

  if (!preRegToken || !orgId || orgId === "default") {
    logger.error({ preRegToken, orgId }, "[Webhook/activate] Missing preRegToken or orgId — skipping");
    return;
  }

  const { pool: pgPool } = await import("@workspace/db");
  const { randomBytes, randomUUID: _wbRandUUID } = await import("crypto");

  // ── 1. Load pending_signups ──────────────────────────────────────────────
  const dbClient = await pgPool.connect();
  let signupRow: Record<string, string | null> | null = null;
  try {
    const r = await dbClient.query(
      `SELECT email, first_name, last_name, company_name, country, address, city, postal_code, phone, vat
       FROM pending_signups WHERE token = $1 AND consumed_at IS NULL AND expires_at > NOW() LIMIT 1`,
      [preRegToken]
    );
    if (r.rows.length > 0) signupRow = r.rows[0];
  } finally {
    dbClient.release();
  }

  if (!signupRow) {
    // If consumed_at is already set, the account was already activated (idempotent — not an error)
    const check = await pgPool.connect();
    try {
      const r = await check.query(
        `SELECT consumed_at FROM pending_signups WHERE token = $1 LIMIT 1`,
        [preRegToken]
      );
      if (r.rows[0]?.consumed_at) {
        logger.info({ preRegToken, orgId }, "[Webhook/activate] pending_signups already consumed — account already activated, skipping");
        return;
      }
    } finally { check.release(); }
    logger.warn({ preRegToken, orgId }, "[Webhook/activate] pending_signups row not found — skipping activation");
    return;
  }

  const email     = signupRow["email"] ?? orgId;
  const firstName = signupRow["first_name"] ?? "";

  // ── 1b. Guard: skip if the org already has an active subscription ─────────
  // Look up by owner_email (organizations.id is UUID — cannot query by email string).
  // Also capture the existing org UUID for idempotent re-runs.
  let _existingOrgUUID: string | null = null;
  {
    const orgCheck = await pgPool.connect();
    try {
      const r = await orgCheck.query<{ id: string; subscription_status: string }>(
        `SELECT id::text, subscription_status FROM organizations WHERE owner_email = $1 LIMIT 1`,
        [email]
      );
      const existingRow = r.rows[0] ?? null;
      if (existingRow) {
        _existingOrgUUID = existingRow.id;
        const existingStatus = existingRow.subscription_status ?? null;
        if (existingStatus && existingStatus !== "pending_billing" && existingStatus !== "incomplete") {
          logger.info({ orgId: _existingOrgUUID, existingStatus }, "[Webhook/activate] Org already active — skipping duplicate magic link");
          // Mark token consumed so it can't fire again
          await pgPool.connect().then(async c => {
            try {
              await c.query(`UPDATE pending_signups SET consumed_at = NOW() WHERE token = $1 AND consumed_at IS NULL`, [preRegToken]);
            } finally { c.release(); }
          }).catch(() => {});
          return;
        }
      }
    } finally { orgCheck.release(); }
  }
  // Use existing UUID for idempotency, or generate a fresh one for new orgs
  const orgUUID = _existingOrgUUID ?? _wbRandUUID();

  // ── 2. Upsert org_settings for profile data only ────────────────────────
  // IMPORTANT: org_settings is keyed by org_id. New-user signups have an email-shaped
  // orgId in session.metadata.orgId (no UUID yet), but me.ts reads org_settings by the
  // session UUID. We write TWICE — once under the email key (legacy compat) and once
  // under orgUUID — so the address is found regardless of which key is used.
  const { upsertOrgSettings, loadOrgSettings: _loadSettings } = await import("../services/org-settings.js");
  const _existing = await _loadSettings(orgId).catch(() => null);
  if (!_existing) {
    await upsertOrgSettings(orgId, {
      email,
      orgName:            (signupRow["company_name"] as string | undefined) ?? "",
      firstName,
      lastName:           (signupRow["last_name"] as string | undefined)    ?? "",
      country:            (signupRow["country"] as string | undefined)      ?? null,
      city:               (signupRow["city"] as string | undefined)         ?? null,
      address:            (signupRow["address"] as string | undefined)      ?? null,
      postalCode:         (signupRow["postal_code"] as string | undefined)  ?? null,
      phone:              (signupRow["phone"] as string | undefined)        ?? null,
      vat:                (signupRow["vat"] as string | undefined)          ?? null,
      locationConfigured: !!(signupRow["city"] || signupRow["address"]),
      locationSource:     "manual",
    });
    logger.info({ orgId }, "[Webhook/activate] org_settings profile row created");
    // Mirror address under the UUID key so me.ts (which reads by UUID session orgId)
    // can find the location data. The write above uses the email-shaped orgId from
    // session.metadata; after org creation the session will carry the UUID instead.
    if (orgUUID !== orgId && (signupRow["address"] || signupRow["city"])) {
      await upsertOrgSettings(orgUUID, {
        email,
        orgName:            (signupRow["company_name"] as string | undefined) ?? "",
        firstName,
        lastName:           (signupRow["last_name"] as string | undefined)    ?? "",
        country:            (signupRow["country"] as string | undefined)      ?? null,
        city:               (signupRow["city"] as string | undefined)         ?? null,
        address:            (signupRow["address"] as string | undefined)      ?? null,
        postalCode:         (signupRow["postal_code"] as string | undefined)  ?? null,
        phone:              (signupRow["phone"] as string | undefined)        ?? null,
        vat:                (signupRow["vat"] as string | undefined)          ?? null,
        locationConfigured: !!(signupRow["city"] || signupRow["address"]),
        locationSource:     "manual",
      }).catch((e) => logger.warn({ e, orgUUID }, "[Webhook/activate] UUID org_settings mirror failed (non-fatal)"));
      logger.info({ orgId, orgUUID }, "[Webhook/activate] org_settings address mirrored to UUID key");
    }
  } else if ((signupRow["address"] || signupRow["city"]) && !_existing.address && !_existing.city) {
    // Existing profile row without any address (e.g. created by an earlier
    // contact-only upsert) — fill the missing fields from the signup form so
    // Workspace/Settings/Localisation show the address entered at signup.
    await upsertOrgSettings(orgId, {
      country:            _existing.country    ?? (signupRow["country"] as string | undefined)     ?? null,
      city:               (signupRow["city"] as string | undefined)         ?? null,
      address:            (signupRow["address"] as string | undefined)      ?? null,
      postalCode:         _existing.postalCode ?? (signupRow["postal_code"] as string | undefined) ?? null,
      phone:              _existing.phone      ?? (signupRow["phone"] as string | undefined)       ?? null,
      locationConfigured: !!(signupRow["city"] || signupRow["address"]),
      locationSource:     "manual",
    }).catch((e) => logger.warn({ e, orgId }, "[Webhook/activate] org_settings address self-heal failed (non-fatal)"));
    logger.info({ orgId }, "[Webhook/activate] org_settings address self-healed from signup data");
  }

  // ── 3. Activate user + org + membership (transaction) ───────────────────
  const activateClient = await pgPool.connect();
  let newOrgId: string | null = null;
  try {
    await activateClient.query("BEGIN");

    // Supply an explicit UUID so activation never fails when users.id has no DEFAULT.
    const _wbNewUserId = _wbRandUUID();
    const upsertUser = await activateClient.query<{ id: string }>(
      `INSERT INTO users (id, email, first_name, last_name, auth_provider, email_verified, status)
       VALUES ($4, $1, $2, $3, 'magic_link', TRUE, 'active')
       ON CONFLICT (email) DO UPDATE
         SET status         = 'active',
             email_verified = TRUE,
             first_name     = COALESCE(EXCLUDED.first_name, users.first_name),
             last_name      = COALESCE(EXCLUDED.last_name, users.last_name),
             updated_at     = NOW()
       RETURNING id`,
      [email, firstName, signupRow["last_name"] ?? "", _wbNewUserId]
    );
    const userId = upsertUser.rows[0]?.id;
    if (!userId) throw new Error(`Failed to upsert user for email=${email}`);

    // orgUUID is a proper UUID — either the existing org's UUID or a freshly generated one.
    // Email (orgId) is stored only in owner_email; never used as the primary key.
    const newOrgSlug = (signupRow["company_name"] ?? email).replace(/[^a-z0-9]/gi, "-").toLowerCase().slice(0, 60);
    const orgInsert = await activateClient.query<{ id: string }>(
      `INSERT INTO organizations
         (id, name, slug, owner_user_id, status, plan, subscription_status,
          owner_email, stripe_customer_id, trial_ends_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9)
       ON CONFLICT (id) DO UPDATE
         SET status              = 'active',
             plan                = EXCLUDED.plan,
             subscription_status = EXCLUDED.subscription_status,
             stripe_customer_id  = COALESCE(EXCLUDED.stripe_customer_id, organizations.stripe_customer_id),
             updated_at          = NOW()
       RETURNING id`,
      [
        orgUUID,
        signupRow["company_name"] ?? email,
        newOrgSlug,
        userId,
        selectedPlan,
        isTrial ? "trialing" : "active",
        email,
        customerId ?? null,
        isTrial ? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() : null,
      ]
    );
    newOrgId = orgInsert.rows[0]?.id ?? orgUUID;

    await activateClient.query(
      `INSERT INTO organization_members (organization_id, user_id, role, status)
       VALUES ($1, $2, 'owner', 'active')
       ON CONFLICT (organization_id, user_id) DO UPDATE
         SET status = 'active', role = 'owner', updated_at = NOW()`,
      [newOrgId, userId]
    );

    await activateClient.query(
      `UPDATE pending_signups SET consumed_at = NOW()
       WHERE token = $1 AND consumed_at IS NULL`,
      [preRegToken]
    );

    await activateClient.query("COMMIT");
    logger.info({ orgId: newOrgId, userId, email }, "[Webhook/activate] User + org + membership activated");
  } catch (activateErr) {
    await activateClient.query("ROLLBACK").catch(() => {});
    logger.error({ activateErr, orgId, email }, "[Webhook/activate] Transaction rolled back");
    throw activateErr;
  } finally {
    activateClient.release();
  }

  // ── 3b. Normalize Stripe customer metadata to UUID (fire-and-forget) ──────
  // The pre-register flow stamps metadata.orgId = email at customer creation time
  // (before the UUID org exists). Now that we have orgUUID, update the metadata so
  // ESC Step 3 (metadata['orgId']:UUID search) can find this customer on re-subscription.
  if (customerId && orgUUID && orgUUID !== orgId) {
    const _stripeKeyForMeta = getStripeKey();
    if (_stripeKeyForMeta) {
      import("stripe").then(({ default: _StripeClass }) => {
        const _stripeMeta = new _StripeClass(_stripeKeyForMeta, { apiVersion: "2026-04-22.dahlia" });
        return _stripeMeta.customers.update(customerId!, {
          metadata: { orgId: orgUUID, org_id: orgUUID, flowpointOrgId: orgUUID },
        });
      }).then(() => {
        logger.info({ customerId, orgUUID }, "[Webhook/activate] Stripe customer metadata normalized to UUID");
      }).catch((_metaErr: unknown) => {
        logger.warn({ _metaErr, customerId, orgUUID }, "[Webhook/activate] Stripe customer metadata normalization failed (non-fatal)");
      });
    }
  }

  // ── 4. Generate magic link token (24h TTL) ───────────────────────────────
  const magicToken = randomBytes(32).toString("hex");
  const tokenClient = await pgPool.connect();
  try {
    await tokenClient.query(
      `INSERT INTO magic_link_tokens (token, email, expires_at, used)
       VALUES ($1, $2, NOW() + INTERVAL '24 hours', FALSE)
       ON CONFLICT (token) DO NOTHING`,
      [magicToken, email]
    );
  } finally {
    tokenClient.release();
  }

  // ── 5. Send activation magic link email ─────────────────────────────────
  const publicUrl    = process.env["PUBLIC_URL"] || "https://app.flowpoint.pro";
  const magicLinkUrl = `${publicUrl}/login-verify.html?token=${magicToken}`;

  const { mailer: _mailer } = await import("../services/mailer.js").catch((impErr: unknown) => {
    logger.error({ impErr }, "[Webhook/activate] mailer import failed — magic link NOT sent");
    return { mailer: null };
  });
  // Trial signups: skip the activation email and welcome email.
  // sendTrialStartedOnce (triggered by customer.subscription.created) reuses
  // the magic token created above and embeds it directly in
  // "Ton essai FlowPoint est lancé" — the single first-login email.
  if (isTrial) {
    logger.info({ email, orgId }, "[Webhook/activate] Trial signup — activation email skipped; trial-started email carries the magic link");
  } else {
    if (_mailer) {
      const mailResult = await _mailer.sendActivationMagicLink({
        to:          email,
        name:        firstName || email.split("@")[0],
        plan:        selectedPlan,
        magicLinkUrl,
        isTrial,
      }).catch((mailErr: unknown) => {
        logger.error({ mailErr, email }, "[Webhook/activate] Failed to send activation magic link email");
        return { ok: false as const, error: String(mailErr) };
      });
      if (mailResult && mailResult.ok) {
        logger.info({ email, orgId, id: (mailResult as { id?: string }).id }, "[Webhook/activate] Activation magic link email sent");
      } else {
        logger.error({ email, orgId, error: (mailResult as { error?: string })?.error ?? "unknown" }, "[Webhook/activate] Activation magic link email NOT delivered");
      }
    } else {
      logger.warn({ email }, "[Webhook/activate] Mailer not available — magic link NOT sent");
    }

    // Welcome email (non-trial only — trial email replaces the welcome for trial signups)
    if (_mailer && newOrgId) {
      const { pool: pgPool } = await import("@workspace/db");
      await pgPool.query(
        `UPDATE organizations
         SET welcome_email_eligible_at = COALESCE(welcome_email_eligible_at, NOW())
         WHERE id = $1`,
        [newOrgId],
      );
      const recipientName = firstName || email.split("@")[0] || "Utilisateur";
      await sendWelcomeOnce(newOrgId, email, recipientName);
    }
  }
}

async function handleStripeWebhook(req: Request, res: Response): Promise<void> {
  const stripeKey = getStripeKey();
  const webhookSecret = process.env["STRIPE_WEBHOOK_SECRET"] || process.env["STRIPE_WEBHOOK_SECRET_RENDER"];

  let event: { type: string; data: { object: Record<string, unknown> } };

  if (stripeKey && webhookSecret) {
    const { default: Stripe } = await import("stripe");
    const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });
    const sig = req.headers["stripe-signature"] as string;
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) { res.status(400).json({ error: "Raw body required" }); return; }
    // Try live webhook secret first. If that fails and STRIPE_TEST_WEBHOOK_SECRET
    // is configured, try the isolated test endpoint secret.  The secret's presence
    // is the safety gate — it is a whsec_ issued by Stripe test mode and can only
    // validate test-mode events.  getStripeKey() ensures sk_test_ is the active key.
    const testWebhookSecret = process.env["STRIPE_TEST_WEBHOOK_SECRET"];
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret) as unknown as typeof event;
    } catch (liveErr) {
      if (testWebhookSecret) {
        try {
          event = stripe.webhooks.constructEvent(rawBody, sig, testWebhookSecret) as unknown as typeof event;
          logger.info("[Webhook] Verified with Stripe test webhook secret (isolated env)");
        } catch {
          logger.error({ err: liveErr }, "[Webhook] Signature verification failed (live + test secrets both rejected)");
          res.status(400).json({ error: "Webhook signature verification failed" });
          return;
        }
      } else {
        logger.error({ err: liveErr }, "[Webhook] Signature verification failed");
        res.status(400).json({ error: "Webhook signature verification failed" });
        return;
      }
    }
  } else {
    if (process.env["NODE_ENV"] === "production") {
      logger.error("[Webhook] Missing Stripe credentials in production — rejecting");
      res.status(503).json({ error: "Webhook verification unavailable" });
      return;
    }
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    try {
      event = rawBody ? JSON.parse(rawBody.toString("utf-8")) : req.body;
    } catch {
      event = req.body as typeof event;
    }
    logger.warn("[Webhook] Dev mode: processing without signature verification");
  }

  logger.info({ type: event.type }, "[Webhook] Received Stripe event");
  const obj = event.data.object;

  // ── Resolve orgId from Stripe customer ID → org_settings lookup ───────────
  // P0-1: If orgId cannot be resolved, we log an error and skip all DB writes.
  // We never fall back to "default" for billing-sensitive operations.
  let orgId: string | null = null;
  let resolvedVia = "none";

  try {
    const { pool: pgPool } = await import("@workspace/db");

    // Try 1: customer field → organizations lookup (source de vérité, fallback org_settings)
    const stripeCustomerId = (obj["customer"] as string | undefined) ?? (obj["id"] as string | undefined);
    if (stripeCustomerId && stripeCustomerId.startsWith("cus_")) {
      const resolved = await findOrgByStripeCustomer(stripeCustomerId);
      if (resolved) {
        orgId = resolved;
        resolvedVia = "stripe_customer_id";
      }
    }

    // Try 2: metadata.orgId (set by FlowPoint checkout sessions)
    if (!orgId) {
      const meta = (obj["metadata"] as Record<string, string>) ?? {};
      const metaOrgId = meta["orgId"] ?? meta["org_id"] ?? "";
      if (metaOrgId && metaOrgId !== "default") {
        orgId = metaOrgId;
        resolvedVia = "metadata";
      }
    }

    // Try 3: subscription metadata
    if (!orgId && obj["subscription"]) {
      const subMeta = (obj["subscription_details"] as Record<string, unknown>)?.["metadata"] as Record<string, string> | undefined;
      const subOrgId = subMeta?.["orgId"] ?? subMeta?.["org_id"] ?? "";
      if (subOrgId && subOrgId !== "default") {
        orgId = subOrgId;
        resolvedVia = "subscription_metadata";
      }
    }

    // Try 4: pre_register_token in metadata → lookup pending_signups (email = orgId for pre-reg users)
    if (!orgId) {
      const meta4 = (obj["metadata"] as Record<string, string>) ?? {};
      const preRegTok = meta4["pre_register_token"] ?? "";
      if (preRegTok) {
        try {
          const { pool: pgPool4 } = await import("@workspace/db");
          const c4 = await pgPool4.connect();
          try {
            const r4 = await c4.query(
              `SELECT email FROM pending_signups WHERE token = $1 LIMIT 1`,
              [preRegTok]
            );
            if (r4.rows[0]?.email) {
              orgId = r4.rows[0].email;
              resolvedVia = "pre_register_token";
            }
          } finally { c4.release(); }
        } catch { /* non-fatal */ }
      }
    }
  } catch (e) {
    logger.warn({ e }, "[Webhook] org lookup failed");
  }

  // ── Canonicalize: legacy email-shaped orgId → UUID organizations.id ──────
  // Metadata written at checkout time may carry the email as orgId while the
  // activation created a UUID org. Writing plan/status with the email key lands
  // in org_settings only, leaving canonical organizations.plan stale (dashboard
  // then shows the wrong plan). Resolve email → organizations.id here.
  const UUID_RE_WH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (orgId && !UUID_RE_WH.test(orgId)) {
    try {
      const { pool: pgPoolC } = await import("@workspace/db");
      const cc = await pgPoolC.connect();
      try {
        const rc = await cc.query(
          `SELECT id FROM organizations WHERE lower(owner_email) = lower($1) ORDER BY created_at DESC LIMIT 1`,
          [orgId]
        );
        if (rc.rows[0]?.id) {
          logger.info({ from: orgId.includes("@") ? "email" : "non-uuid", to: rc.rows[0].id, resolvedVia }, "[Webhook] orgId canonicalized to organizations.id");
          orgId = String(rc.rows[0].id);
          resolvedVia += "+owner_email_canonicalized";
        }
      } finally { cc.release(); }
    } catch (canonErr) {
      logger.warn({ canonErr }, "[Webhook] orgId canonicalization failed — using raw orgId");
    }
  }

  if (!orgId) {
    logger.error(
      { type: event.type, obj: { id: obj["id"], customer: obj["customer"] } },
      "[Webhook] Could not resolve orgId — no DB writes performed, event treated as unresolved"
    );
  } else {
    logger.info({ orgId, resolvedVia, type: event.type }, "[Webhook] orgId resolved");
  }

  // ── Idempotency guard — claim-then-finalize, retry-safe ──────────────────
  // Root cause #3 fix: the previous implementation marked an event as processed
  // (INSERT ON CONFLICT DO NOTHING) BEFORE running its entitlement mutations. If a
  // mutation then failed, the row already existed and every Stripe retry was
  // suppressed as a "duplicate", permanently losing the entitlement.
  //
  // New protocol:
  //   1. Claim the event by upserting a row with metadata.status = "processing".
  //      - Fresh event  → status becomes "processing", we proceed.
  //      - Row exists & status = "processed" → a genuinely completed replay:
  //        respond idempotently (no re-mutation), skip the switch.
  //      - Row exists with failed/legacy state → re-claim and reprocess.
  //      - Row exists with a fresh processing lease → do not double-mutate.
  //   2. Run the handler. On success → mark status = "processed".
  //      On throw → mark status = "failed" and return 500 so Stripe retries.
  // Status is recorded WITHOUT any secrets (only status/type/timestamp).
  // Use resolved orgId when available; use '_system_' sentinel for unresolved events
  // (never 'default' — that would shadow real org data)
  const eventId = (event as unknown as { id?: string }).id;
  const idempotencyOrgId = orgId ?? "_system_";
  let idempotencyTracked = false;

  const markEventStatus = async (status: "processed" | "failed"): Promise<void> => {
    if (!eventId || !idempotencyTracked) return;
    try {
      const { pool: pgPool } = await import("@workspace/db");
      const c = await pgPool.connect();
      try {
        await c.query(
          `UPDATE billing_events
           SET metadata = jsonb_set(
             COALESCE(metadata, '{}'::jsonb),
             '{status}', to_jsonb($2::text)
           ) || jsonb_build_object('processedAt', to_jsonb(NOW()::text))
           WHERE stripe_event_id = $1`,
          [eventId, status]
        );
      } finally { c.release(); }
    } catch (e) {
      logger.warn({ e, eventId, status }, "[Webhook] Failed to record event status (non-fatal)");
    }
  };

  if (eventId) {
    try {
      const { pool: pgPool } = await import("@workspace/db");
      const idClient = await pgPool.connect();
      try {
        // Claim fresh events, failed attempts, and expired five-minute leases.
        // A live processing lease is deliberately NOT claimed by another
        // delivery: Stripe can send the same event concurrently.
        const claim = await idClient.query<{ status: string | null }>(
          `INSERT INTO billing_events (org_id, type, stripe_event_id, amount, currency, metadata)
           VALUES ($1, $2, $3, 0, 'eur',
             jsonb_build_object('status','processing', 'processingStartedAt', NOW()::text))
           ON CONFLICT (stripe_event_id) DO UPDATE
             SET metadata = COALESCE(billing_events.metadata, '{}'::jsonb)
               || jsonb_build_object('status','processing', 'processingStartedAt', NOW()::text)
             WHERE COALESCE(billing_events.metadata->>'status', '') IN ('', 'failed')
                OR (
                  COALESCE(billing_events.metadata->>'status', '') = 'processing'
                  AND CASE
                    WHEN billing_events.metadata->>'processingStartedAt'
                      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                    THEN (billing_events.metadata->>'processingStartedAt')::timestamptz
                    ELSE 'epoch'::timestamptz
                  END < NOW() - INTERVAL '5 minutes'
                )
           RETURNING metadata->>'status' AS status`,
          [idempotencyOrgId, event.type, eventId]
        );
        if (claim.rowCount === 0) {
          // A completed event, or a concurrent delivery with a fresh lease.
          // Either way, never run entitlement mutations twice.
          logger.info({ eventId, type: event.type }, "[Webhook] Duplicate or concurrently-processing event — skipping");
          res.json({ received: true, duplicate: true });
          return;
        }
        idempotencyTracked = true;
      } finally {
        idClient.release();
      }
    } catch (e) {
      const pgCode = (e as { code?: string }).code;
      if (pgCode === "42P01") {
        // billing_events table doesn't exist yet (schema gap in production).
        // Fail-open: proceed without idempotency tracking rather than blocking
        // ALL webhooks. The table will be created by the next server restart
        // via init-data-tables self-heal. idempotencyTracked stays false so
        // markEventStatus() no-ops as well.
        logger.warn({ eventId }, "[Webhook] billing_events table missing — proceeding without idempotency (self-heal pending)");
      } else {
        // Without a durable claim, processing could race another webhook worker.
        // Return a retryable error instead of applying a paid entitlement twice.
        logger.error({ e, eventId }, "[Webhook] Idempotency claim failed — returning 500 for safe retry");
        res.status(500).json({ received: false, error: "Webhook idempotency unavailable" });
        return;
      }
    }
  }

  try {
  switch (event.type) {

    case "checkout.session.completed": {
      const meta = (obj["metadata"] as Record<string,string>) ?? {};

      // ── One-time AI credit pack purchase ──────────────────────────────────
      // Matches sessions from /billing/checkout-ai-credits (type=ai_credits) AND
      // from /public/checkout-session for ai_credits_only checkout type.
      if (meta["type"] === "ai_credits" || meta["flowpoint_checkout_type"] === "ai_credits_only") {
        // For ai_credits_only (public checkout), parse pack key from ai_credits field.
        const rawAiCreditsField = meta["ai_credits"] ?? "";
        const packFromField = rawAiCreditsField.split(",").find(k => k.startsWith("aiCreditsPack"));
        const AI_CREDITS_FROM_PACK: Record<string, number> = {
          aiCreditsPack50k:  50000,
          aiCreditsPack200k: 200000,
          aiCreditsPack500k: 500000,
        };
        const pack    = meta["pack"] || packFromField || "";
        const credits = parseInt(meta["credits"] ?? "0", 10) || (packFromField ? (AI_CREDITS_FROM_PACK[packFromField] ?? 0) : 0);
        const amountEurCents = parseInt(meta["amountEurCents"] ?? "0", 10);
        const sessionId      = String(obj["id"] ?? "");
        const paymentIntent  = String(obj["payment_intent"] ?? "");

        // P0-3: removed store.me.stripeCustomerId mutation

        if (credits > 0 && orgId) {
          try {
            const { pool: pgPool } = await import("@workspace/db");
            const client = await pgPool.connect();
            const month = (() => {
              const d = new Date();
              return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
            })();
            try {
              // Deterministic id keyed on the Stripe session → idempotent on webhook replays
              const purchaseId = `acp_${sessionId}`;
              await client.query(
                `INSERT INTO ai_credit_purchases
                   (id, org_id, pack, credits, amount_eur_cents, stripe_session_id, stripe_payment_intent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (id) DO NOTHING`,
                [purchaseId, orgId, pack, credits, amountEurCents, sessionId, paymentIntent]
              );
            } finally {
              client.release();
            }
            store.broadcast({ type: "ai:credits_added", pack, credits }, orgId);
            logger.info({ pack, credits, orgId }, "[Webhook] AI credits credited to org");
          } catch (e) {
            logger.error({ e, orgId }, "[Webhook] Failed to credit AI credits to org");
          }
        } else if (credits > 0 && !orgId) {
          logger.error({ pack, credits }, "[Webhook] AI credits purchase: orgId unresolved — credits NOT credited");
        }
        break;
      }

      // ── Subscription checkout ──────────────────────────────────────────────
      // Hosted public Checkout writes `selected_plan`; `plan` is retained for
      // legacy sessions. Honor the current key first.
      const plan     = meta["selected_plan"] || meta["plan"] || "";
      const planNorm = plan.toLowerCase();

      if (!orgId) {
        logger.error({ plan: planNorm, sessionId: obj["id"] }, "[Webhook] checkout.session.completed: orgId unresolved — subscription state NOT persisted");
        break;
      }

      const customerId = obj["customer"] ? String(obj["customer"]) : undefined;

      // ── Safety net: eagerly link stripe_customer_id so findOrgByStripeCustomer ──
      // works on subsequent webhook events even if this handler errors later.
      // Fire-and-forget; never blocks the main flow.
      if (customerId && orgId && UUID_RE_WH.test(orgId)) {
        persistOrgData(orgId, { stripeCustomerId: customerId }).catch(e =>
          logger.warn({ e, orgId, customerId }, "[Webhook] Safety stripe_customer_id link failed (non-blocking)")
        );
      }

      // ── New signup flow: activate account + send magic link after Stripe validates ──
      const preRegToken  = meta["pre_register_token"] ?? "";
      const selectedPlan = meta["selected_plan"] || planNorm || "standard";
      const isTrial      = meta["trial_plan"] === "true";

      // ── P0 backstop: detect and auto-cancel duplicate subscriptions ──────────
      // Fires when finalize-checkout's guard missed a race (e.g., two checkout
      // sessions created before either subscription existed, both completing later).
      //
      // PLAN-TIER DECISION (fixes scenario L — reversed event order):
      //   • If the new sub is a HIGHER plan than all conflicts → the new checkout is
      //     the intentional one (user moved to a better plan); cancel the lower-plan
      //     conflicts and let activation run for the new sub.
      //   • Otherwise → cancel the new sub (conservative: first-to-activate wins).
      //
      // Upgrade/downgrade path (billing/upgrade) uses stripe.subscriptions.update()
      // and never triggers checkout.session.completed, so this backstop cannot
      // interfere with dashboard plan changes.
      const _newSubId = obj["subscription"] ? String(obj["subscription"]) : undefined;
      let _isDuplicateSub = false;
      if (_newSubId && customerId && stripeKey) {
        try {
          const _bsStripe  = await createStripeClient(stripeKey);
          const _bsAllSubs = await _bsStripe.subscriptions.list({ customer: customerId, status: "all", limit: 10 });
          type _BsSub = { id: string; status: string; cancel_at_period_end: boolean; metadata?: Record<string, string> };
          const _bsConflicts = (_bsAllSubs.data as _BsSub[]).filter(
            (s) => s.id !== _newSubId && (s.status === "active" || s.status === "trialing") && !s.cancel_at_period_end
          );
          if (_bsConflicts.length > 0) {
            // Plan-tier map: higher number = higher plan
            const _BS_TIER: Record<string, number> = { standard: 1, pro: 2, ultra: 3 };
            const _bsNewTier       = _BS_TIER[planNorm] ?? 0;
            const _bsMaxConflTier  = Math.max(..._bsConflicts.map(s => _BS_TIER[(s.metadata?.["plan"] ?? "").toLowerCase()] ?? 0), 0);
            // If new sub is strictly higher plan → it is the legitimate one, cancel conflicts
            // Otherwise → new sub is duplicate, cancel it
            const _bsCancelNew    = _bsNewTier <= _bsMaxConflTier;
            const _bsSubsToCancel = _bsCancelNew ? [_newSubId] : _bsConflicts.map(s => s.id);
            logger.error(
              {
                newSubId:        _newSubId,
                newPlan:         planNorm,
                newTier:         _bsNewTier,
                conflictSubIds:  _bsConflicts.map(s => s.id),
                maxConflTier:    _bsMaxConflTier,
                decision:        _bsCancelNew ? "cancel_new_sub" : "cancel_conflicts",
                customerId,
                orgId,
              },
              "[Webhook][P0] DUPLICATE SUBSCRIPTION DETECTED"
            );
            // Helper: cancel a subscription and refund its first paid invoice
            const _bsCancelAndRefund = async (subId: string): Promise<void> => {
              await _bsStripe.subscriptions.cancel(subId, { prorate: false });
              type _BsInv = { id: string; amount_paid: number; payment_intent?: unknown; charge?: unknown };
              const _bsInvs = await _bsStripe.invoices.list({ subscription: subId, limit: 3 });
              for (const _bsInv of (_bsInvs.data as _BsInv[])) {
                if (_bsInv.amount_paid <= 0) continue;
                const _bsPiId = typeof _bsInv.payment_intent === "string" ? _bsInv.payment_intent : null;
                const _bsChId = !_bsPiId && typeof _bsInv.charge === "string" ? _bsInv.charge : null;
                if (_bsPiId) {
                  await _bsStripe.refunds.create({ payment_intent: _bsPiId });
                  logger.info({ subId, invoiceId: _bsInv.id, piId: _bsPiId, amount: _bsInv.amount_paid },
                    "[Webhook][P0] Refund issued (via payment_intent)");
                } else if (_bsChId) {
                  await _bsStripe.refunds.create({ charge: _bsChId });
                  logger.info({ subId, invoiceId: _bsInv.id, chargeId: _bsChId, amount: _bsInv.amount_paid },
                    "[Webhook][P0] Refund issued (via charge)");
                } else {
                  logger.error({ subId, invoiceId: _bsInv.id, amount: _bsInv.amount_paid },
                    "[Webhook][P0] Could not auto-refund — no payment_intent or charge on invoice");
                }
                break;
              }
            };
            for (const _subToCancel of _bsSubsToCancel) {
              await _bsCancelAndRefund(_subToCancel).catch(err =>
                logger.error({ err, _subToCancel }, "[Webhook][P0] cancel+refund threw")
              );
            }
            // If we canceled the new sub → it's a duplicate, skip activation.
            // If we canceled the conflicts → new sub is legitimate, let activation run.
            _isDuplicateSub = _bsCancelNew;
          }
        } catch (_bsErr) {
          logger.error({ _bsErr, customerId, _newSubId },
            "[Webhook][P0] Duplicate sub backstop guard threw — proceeding with activation anyway");
        }
      }

      if (!_isDuplicateSub && preRegToken && orgId) {
        activateNewSignup({ preRegToken, orgId, customerId, selectedPlan, isTrial })
          .catch(e => logger.error({ e, orgId }, "[Webhook] checkout.session.completed new-signup activation failed"));
      }

      // P0-1: pass explicit orgId — never defaults to "default"
      // Bug-1 fix: persist plan immediately from session.metadata.plan when valid,
      // rather than waiting for the subscription.created/updated webhook.
      // ── P0-8: write all four coherent fields — customer, subscription, status, plan ──
      // stripeSubscriptionId MUST be persisted here (from session.subscription) so
      // organizations never holds an old canceled sub ID after a new checkout completes.
      // Without this, a delayed subscription.created webhook for an older sub could
      // overwrite the correct subscription ID before the new one arrives.
      const persistPayload: Parameters<typeof persistSubscriptionMeta>[0] = {
        orgId,
        subscriptionStatus: "active",
        stripeCustomerId: customerId,
        ...(_newSubId ? { stripeSubscriptionId: _newSubId } : {}),
      };
      if (["standard","pro","ultra"].includes(planNorm)) {
        persistPayload.plan = planNorm;
      }
      await persistSubscriptionMeta(persistPayload);

      if (["standard","pro","ultra"].includes(planNorm)) {
        store.broadcastPlanUpdate(planNorm, orgId);
        // Provision plan-bundled add-ons immediately at checkout so the subscriber
        // can access their features without waiting for the subscription.created event.
        const { provisionPlanAddons } = await import("../services/addons-service.js");
        provisionPlanAddons(planNorm, orgId).catch(err =>
          logger.warn({ err, planNorm, orgId }, "[Webhook] provisionPlanAddons failed on checkout.session.completed")
        );
      }

      // ── Root cause #2 fix: authoritative add-on activation on paid checkout ──
      // public-billing records the recurring add-ons the customer selected and is
      // billed for now in metadata.immediate_addons (comma-separated add-on keys;
      // AI-credit packs and plan-bundled add-ons are intentionally excluded there).
      // Previously these were only activated later by customer.subscription.created,
      // so a missed/late subscription event left a paid add-on inactive. Activate
      // them here — but only after Stripe confirms this is a *completed & paid*
      // Checkout (status=complete AND payment_status in paid/no_payment_required)
      // so we never grant entitlement for an unpaid session. Idempotent: activateAddon
      // upserts, and the reconcile path never revokes what a live subscription still has.
      {
        const sessionStatus  = String(obj["status"] ?? "");
        const paymentStatus  = String(obj["payment_status"] ?? "");
        const paidOrTrial    = paymentStatus === "paid" || paymentStatus === "no_payment_required";
        const completed      = sessionStatus === "" || sessionStatus === "complete"; // "" tolerates minimal test fixtures
        const immediateAddonKeys = (meta["immediate_addons"] ?? "")
          .split(",")
          .map(k => k.trim())
          .filter(Boolean)
          // Only recurring flag/qty add-ons that carry a Stripe price ID.
          .filter(k => (FLAG_ADDONS.has(k) || QTY_ADDONS.has(k)));

        if (immediateAddonKeys.length > 0 && completed && paidOrTrial) {
          const { activateAddon } = await import("../services/addons-service.js");
          for (const key of immediateAddonKeys) {
            const activated = await activateAddon(key, orgId);
            if (!activated) {
              throw new Error(`Failed to activate immediate add-on '${key}' for org '${orgId}'`);
            }
          }
          logger.info({ orgId, immediateAddonKeys, paymentStatus, sessionStatus },
            "[Webhook] Immediate recurring add-ons activated from completed paid checkout");
        } else if (immediateAddonKeys.length > 0) {
          logger.info({ orgId, immediateAddonKeys, paymentStatus, sessionStatus },
            "[Webhook] Immediate add-ons NOT activated — checkout not completed/paid");
        }
      }

      // ── Direct /billing/addon-checkout path ──────────────────────────────────
      // These sessions store addonKey + quantity in session-level metadata (not
      // in immediate_addons) and always use mode=subscription.  The
      // customer.subscription.created event also activates via
      // persistAddonsFromSubscription, but only if getAddonForPriceId() can map
      // the price ID.  Activate here too (idempotent upsert) so a missing
      // env-var price mapping never silently drops a paid add-on.
      {
        const directAddonKey  = String(meta["addonKey"]  ?? "").trim();
        const directAddonQty  = Math.max(1, parseInt(String(meta["quantity"] ?? "1"), 10));
        const sessionComplete = (String(obj["status"] ?? "") === "complete" || String(obj["status"] ?? "") === "");
        const paymentOk       = (String(obj["payment_status"] ?? "") === "paid" ||
                                 String(obj["payment_status"] ?? "") === "no_payment_required");
        if (directAddonKey && (FLAG_ADDONS.has(directAddonKey) || QTY_ADDONS.has(directAddonKey))
            && sessionComplete && paymentOk) {
          try {
            const { activateAddon } = await import("../services/addons-service.js");
            const activated = await activateAddon(directAddonKey, orgId, directAddonQty);
            if (!activated) {
              logger.warn({ directAddonKey, orgId, directAddonQty },
                "[Webhook] Direct addon-checkout activation returned false — addon may already be active or unknown");
            } else {
              logger.info({ directAddonKey, orgId, directAddonQty },
                "[Webhook] Direct addon-checkout: add-on activated from checkout.session.completed");
            }
          } catch (dErr) {
            logger.error({ dErr, directAddonKey, orgId },
              "[Webhook] Direct addon-checkout activation threw — add-on activation will be retried by subscription.created");
          }
        }
      }

      logger.info({ plan: planNorm, orgId }, "[Webhook] Checkout session completed");
      break;
    }

    // ── New checkout-payment.html flow ────────────────────────────────────────
    // The PaymentElement flow fires payment_intent.succeeded (add-ons charged today)
    // or setup_intent.succeeded (plan-only trial, 0€ today).
    // Either can carry pre_register_token in metadata — activate the org when present.
    // orgId is not resolvable via the standard customer lookup (customer is created
    // later by finalize-checkout), so we derive it from pending_signups via the token.
    case "payment_intent.succeeded":
    case "setup_intent.succeeded": {
      const piMeta = (obj["metadata"] as Record<string, string>) ?? {};

      // ── In-app AI credit pack purchase (PaymentElement modal, no redirect) ──
      if (piMeta["type"] === "ai_credits") {
        const pack    = piMeta["pack"]    ?? "";
        const credits = parseInt(piMeta["credits"] ?? "0", 10);
        const amountEurCents = parseInt(piMeta["amountEurCents"] ?? "0", 10);
        const piId    = String(obj["id"] ?? "");
        const aiOrgId = orgId ?? piMeta["orgId"] ?? null;

        if (credits > 0 && aiOrgId && piId) {
          try {
            const { pool: pgPool } = await import("@workspace/db");
            const client = await pgPool.connect();
            try {
              // Deterministic id keyed on the PaymentIntent → idempotent on retries
              await client.query(
                `INSERT INTO ai_credit_purchases
                   (id, org_id, pack, credits, amount_eur_cents, stripe_session_id, stripe_payment_intent)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 ON CONFLICT (id) DO NOTHING`,
                [`acp_pi_${piId}`, aiOrgId, pack, credits, amountEurCents, "", piId]
              );
            } finally { client.release(); }
            store.broadcast({ type: "ai:credits_added", pack, credits }, aiOrgId);
            logger.info({ pack, credits, orgId: aiOrgId }, "[Webhook] AI credits credited (payment_intent flow)");
          } catch (e) {
            logger.error({ e, orgId: aiOrgId }, "[Webhook] Failed to credit AI credits (payment_intent flow)");
          }
        } else {
          logger.error({ pack, credits, piId }, "[Webhook] AI credits intent: orgId unresolved — credits NOT credited");
        }
        break;
      }

      // A0 — Closed-tab addon recovery: activate recurring add-ons for authenticated
      // users who paid but never reached finalize-checkout (browser closed, 3DS in
      // another tab, connection lost). The PaymentIntent carries orgId + addons in
      // metadata so we can attribute and activate without a browser callback.
      const piAddonsRaw  = piMeta["addons"]  ?? "";
      const piMetaOrgId  = piMeta["orgId"]   ?? piMeta["org_id"] ?? orgId ?? null;
      const piPreRegToken = piMeta["pre_register_token"] ?? "";

      if (!piPreRegToken && piMetaOrgId && piAddonsRaw && piAddonsRaw !== "{}" && piAddonsRaw !== "null") {
        try {
          const piAddons = JSON.parse(piAddonsRaw) as Record<string, unknown>;
          const addonEntries = Object.entries(piAddons).filter(([, v]) => v === true || (typeof v === "number" && v > 0));
          const AI_CR_KEYS = new Set(["aiCreditsPack50k", "aiCreditsPack200k", "aiCreditsPack500k"]);
          const recurringEntries = addonEntries.filter(([k]) => !AI_CR_KEYS.has(k));

          if (recurringEntries.length > 0) {
            const piId = String(obj["id"] ?? "");
            // Idempotency: use a DB flag keyed on the PI id to prevent double-activation
            const { pool: pgPool } = await import("@workspace/db");
            // Idempotency: check a dedicated table or a known webhook event key.
            // We use the activity_log pattern: if this PI id already appears as
            // a webhook-sourced activation, skip. Use pool query for raw SQL.
            const idempClient = await pgPool.connect();
            let alreadyActivated = false;
            try {
              // Use a simple approach: check if the PI id is stored in activity_log
              const idempCheck = await idempClient.query<{ count: string }>(
                `SELECT COUNT(*) as count FROM activity_log WHERE org_id = $1 AND metadata->>'pi_id' = $2 AND action_key = 'addon.webhook_activated' LIMIT 1`,
                [piMetaOrgId, piId]
              );
              alreadyActivated = parseInt(idempCheck.rows[0]?.count ?? "0", 10) > 0;
            } catch (_) { /* table may not exist — proceed without idempotency check */ }
            finally { idempClient.release(); }

            if (!alreadyActivated) {
              // ── Tenant binding verification ──────────────────────────────────────
              // The PI metadata.orgId must map to a canonical org in organizations.
              // Never upsert an org just to satisfy the FK — fail loudly so Stripe retries.
              const { pool: _pgPool_a0 } = await import("@workspace/db");
              const _a0c = await _pgPool_a0.connect();
              const _UUID_RE_A0 = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
              let _canonicalOrgId: string | null = null;
              try {
                if (_UUID_RE_A0.test(piMetaOrgId)) {
                  const _r = await _a0c.query<{ id: string }>(
                    `SELECT id::text FROM organizations WHERE id = $1::uuid LIMIT 1`,
                    [piMetaOrgId]
                  );
                  _canonicalOrgId = _r.rows[0]?.id ?? null;
                } else {
                  const _r = await _a0c.query<{ id: string }>(
                    `SELECT id::text FROM organizations WHERE owner_email = $1 LIMIT 1`,
                    [piMetaOrgId]
                  );
                  _canonicalOrgId = _r.rows[0]?.id ?? null;
                }
              } finally { _a0c.release(); }

              const _evtId_a0 = (event as unknown as { id?: string }).id ?? "unknown";
              if (!_canonicalOrgId) {
                logger.error({
                  ADDON_ACTIVATION_FAILED: true,
                  eventId: _evtId_a0,
                  piId,
                  orgId: piMetaOrgId,
                  addonKeys: recurringEntries.map(([k]) => k),
                  reason: "org_not_in_organizations",
                }, "[Webhook] ADDON_ACTIVATION_FAILED — orgId not found in organizations; will retry");
                throw new Error(`ADDON_ACTIVATION_FAILED: org ${piMetaOrgId} not in organizations`);
              }

              const { activateAddon } = await import("../services/addons-service.js");
              const _failedKeys: string[] = [];
              for (const [key, val] of recurringEntries) {
                const qty = typeof val === "number" ? val : 1;
                try {
                  await activateAddon(key, _canonicalOrgId, qty);
                  logger.info({ key, qty, orgId: _canonicalOrgId, piId }, "[Webhook] Recurring add-on activated from PI metadata (closed-tab recovery)");
                } catch (activateErr) {
                  _failedKeys.push(key);
                  logger.error({
                    ADDON_ACTIVATION_FAILED: true,
                    eventId: _evtId_a0,
                    piId,
                    orgId: _canonicalOrgId,
                    addonKey: key,
                    qty,
                    err: activateErr instanceof Error ? activateErr.message : String(activateErr),
                  }, "[Webhook] ADDON_ACTIVATION_FAILED — DB error during activateAddon");
                }
              }
              if (_failedKeys.length > 0) {
                throw new Error(`ADDON_ACTIVATION_FAILED: [${_failedKeys.join(",")}] for org ${_canonicalOrgId}`);
              }
              store.broadcast({ type: "billing:addons_updated" }, _canonicalOrgId);
            } else {
              logger.info({ orgId: piMetaOrgId, piId }, "[Webhook] PI addon activation already done — skipping");
            }
          }
        } catch (piAddonErr) {
          const _isActivationFail = piAddonErr instanceof Error && piAddonErr.message.startsWith("ADDON_ACTIVATION_FAILED");
          if (_isActivationFail) {
            throw piAddonErr;
          }
          logger.error({ piAddonErr, orgId: piMetaOrgId }, "[Webhook] Failed to parse/activate add-ons from PI metadata");
        }
        // Fall through to handle pre_register_token if present (new signup may also buy addons)
      }

      if (!piPreRegToken) {
        // Not a new-signup intent and addons already handled above — nothing more to do
        logger.info({ type: event.type, orgId: piMetaOrgId }, "[Webhook] PI processed (no pre_register_token)");
        break;
      }

      // Derive orgId from pending_signups (email = orgId in FlowPoint)
      let piOrgId: string | null = orgId; // may already be set if customer was linked
      if (!piOrgId) {
        try {
          const { pool: pgPool } = await import("@workspace/db");
          const lookupClient = await pgPool.connect();
          try {
            const r = await lookupClient.query<{ email: string }>(
              `SELECT email FROM pending_signups WHERE token = $1 AND expires_at > NOW() LIMIT 1`,
              [piPreRegToken]
            );
            if (r.rows[0]?.email) piOrgId = r.rows[0].email;
          } finally { lookupClient.release(); }
        } catch (e) {
          logger.warn({ e, type: event.type }, "[Webhook] Failed to look up orgId from pending_signups");
        }
      }

      if (!piOrgId) {
        logger.error({ type: event.type, piPreRegToken }, "[Webhook] Could not resolve orgId for new-signup intent — activation skipped");
        break;
      }

      const piPlan    = piMeta["plan"] ?? "standard";
      const piIsTrial = !piMeta["addons"] || piMeta["addons"] === "{}" || piMeta["addons"] === "null";
      // For setup_intent (0€ plan-only) always trial; for payment_intent also trial (add-ons don't count)
      const piSelectedPlan = piPlan || "standard";

      // Pass the actual Stripe customer ID so activateNewSignup can anchor it to
      // organizations.stripe_customer_id immediately. Previously this was undefined,
      // which left the column NULL and forced ESC to create a duplicate customer on
      // re-subscription (P0 pre-register customer reuse bug).
      const _piCustomerId = obj["customer"] ? String(obj["customer"]) : undefined;
      activateNewSignup({
        preRegToken:  piPreRegToken,
        orgId:        piOrgId,
        customerId:   _piCustomerId,
        selectedPlan: piSelectedPlan,
        isTrial:      true,  // all new signups start with a trial
      }).catch(e => logger.error({ e, orgId: piOrgId, type: event.type }, "[Webhook] new-signup activation via intent failed"));

      // Safety net: also persist stripe_customer_id to org_settings[email] so ESC
      // legacy fallback (Step 2) finds it even if finalize-checkout was never called
      // (e.g. user abandoned checkout after payment authorisation).
      if (_piCustomerId && piOrgId) {
        import("../services/org-data.js").then(({ persistOrgData: _piPod }) =>
          _piPod(piOrgId, { stripeCustomerId: _piCustomerId })
        ).catch(_piPodErr =>
          logger.warn({ _piPodErr, piOrgId }, "[Webhook] PI.succeeded: persistOrgData safety net failed (non-fatal)")
        );
      }

      logger.info({ type: event.type, orgId: piOrgId, customerId: _piCustomerId, plan: piSelectedPlan }, "[Webhook] New-signup activation queued from intent");
      break;
    }

    case "customer.subscription.created":
    case "customer.subscription.updated": {
      const newPlan = parsePlanFromSubscription(obj);
      const status = String(obj["status"] || "active");

      if (!orgId) {
        logger.error({ type: event.type, status, plan: newPlan }, "[Webhook] subscription event: orgId unresolved — state NOT persisted");
        break;
      }

      // ── Plan-sync diagnostic logging ──────────────────────────────────────
      const _eventId_ps = (event as unknown as { id?: string }).id ?? "unknown";
      const _subId_ps   = obj["id"]       ? String(obj["id"])       : "unknown";
      const _custId_ps  = obj["customer"] ? String(obj["customer"]) : "unknown";
      let _dbPlanBefore: string | null = null;
      try {
        const { pool: _pgPool_ps } = await import("@workspace/db");
        const _psc = await _pgPool_ps.connect();
        const _UUID_RE_PS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        try {
          if (_UUID_RE_PS.test(orgId)) {
            const _pr = await _psc.query<{ plan: string }>(`SELECT plan FROM organizations WHERE id = $1`, [orgId]);
            _dbPlanBefore = _pr.rows[0]?.plan ?? null;
          } else {
            const _pr = await _psc.query<{ plan: string }>(`SELECT plan FROM org_settings WHERE org_id = $1`, [orgId]);
            _dbPlanBefore = _pr.rows[0]?.plan ?? null;
          }
        } finally { _psc.release(); }
      } catch { /* non-fatal */ }
      logger.info({ eventId: _eventId_ps, subscriptionId: _subId_ps, customerId: _custId_ps, oldPlan: _dbPlanBefore, newPlan, stripeStatus: status, orgId },
        "[Webhook][plan-sync] customer.subscription event received");

      // P0-1: explicit orgId
      // P0-3: no store.me mutation
      const subscriptionId = obj["id"] ? String(obj["id"]) : undefined;
      const updatePayload: Parameters<typeof persistSubscriptionMeta>[0] = {
        orgId,
        subscriptionStatus: status,
        ...(subscriptionId ? { stripeSubscriptionId: subscriptionId } : {}),
      };
      if (newPlan) updatePayload.plan = newPlan;

      // Set trial_consumed_at when a real Stripe trialing subscription is first created.
      // This distinguishes real Stripe trials from old fake DB trials set at signup.
      // Only set once (idempotent: skip if already consumed).
      if (status === "trialing" && event.type === "customer.subscription.created") {
        try {
          const existingSettings = await loadOrgSettings(orgId).catch(() => null);
          if (!existingSettings?.trialConsumedAt) {
            const now = new Date().toISOString();
            updatePayload.trialConsumedAt = now;
            updatePayload.trialStartedAt  = now;
            // Persist the Stripe trial_end date
            if (obj["trial_end"] && typeof obj["trial_end"] === "number") {
              updatePayload.trialEndsAt = new Date(obj["trial_end"] * 1000).toISOString();
            }
            logger.info({ orgId, subscriptionId }, "[Webhook] First real Stripe trial — trial_consumed_at set");
          }
        } catch (trialErr) {
          logger.warn({ trialErr, orgId }, "[Webhook] trial_consumed_at check failed (non-fatal)");
        }
      }

      await persistSubscriptionMeta(updatePayload);

      // ── Verify DB plan after persist ─────────────────────────────────────
      if (newPlan) {
        let _dbPlanAfter: string | null = null;
        const _UUID_RE_PA = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        try {
          const { pool: _pgPool_pa } = await import("@workspace/db");
          const _pac = await _pgPool_pa.connect();
          try {
            if (_UUID_RE_PA.test(orgId)) {
              const _ar = await _pac.query<{ plan: string }>(`SELECT plan FROM organizations WHERE id = $1`, [orgId]);
              _dbPlanAfter = _ar.rows[0]?.plan ?? null;
            } else {
              const _ar = await _pac.query<{ plan: string }>(`SELECT plan FROM org_settings WHERE org_id = $1`, [orgId]);
              _dbPlanAfter = _ar.rows[0]?.plan ?? null;
            }
          } finally { _pac.release(); }
        } catch { /* non-fatal */ }
        logger.info({ eventId: _eventId_ps, subscriptionId: _subId_ps, customerId: _custId_ps, oldPlan: _dbPlanBefore, newPlan, stripeStatus: status, orgId, dbPlanAfter: _dbPlanAfter, synced: _dbPlanAfter === newPlan },
          "[Webhook][plan-sync] customer.subscription.updated DB state after persist");

        // ── OVER_LIMIT state: if Stripe forces a downgrade and usage exceeds new limits,
        //    set organizations.status='over_limit' so the UI can warn the user.
        //    Existing data is never deleted — only new creations are blocked by checkQuota.
        if (_dbPlanBefore && _dbPlanBefore !== newPlan && _UUID_RE_PA.test(orgId)) {
          try {
            const { checkQuota } = await import("../services/billing-service.js");
            const { PLAN_LIMITS } = await import("../lib/plans.js");
            const newLimits = PLAN_LIMITS[newPlan] ?? PLAN_LIMITS["standard"];
            const [_auQ, _moQ, _reQ, _seQ] = await Promise.all([
              checkQuota("audits",   orgId),
              checkQuota("monitors", orgId),
              checkQuota("reports",  orgId),
              checkQuota("seats",    orgId),
            ]);
            const _overLimit = (
              _auQ.used > newLimits.audits ||
              _moQ.used > newLimits.monitors ||
              _reQ.used > newLimits.reports ||
              _seQ.used > newLimits.teamMembers
            );
            if (_overLimit) {
              const { pool: _olPool } = await import("@workspace/db");
              await _olPool.query(
                `UPDATE organizations SET status='over_limit', updated_at=NOW() WHERE id=$1`,
                [orgId]
              );
              logger.warn({ orgId, oldPlan: _dbPlanBefore, newPlan, audits: _auQ.used, monitors: _moQ.used, reports: _reQ.used, seats: _seQ.used },
                "[Webhook][over-limit] org set to over_limit after forced downgrade");
            }
          } catch (_olErr) {
            logger.warn({ err: _olErr, orgId }, "[Webhook][over-limit] check failed — non-fatal");
          }
        }
      }

      // The Stripe subscription event is the single authoritative point for
      // the trial-start notice. The webhook event guard above makes this
      // idempotent across Stripe retries.
      if (status === "trialing" && event.type === "customer.subscription.created") {
        const { pool: pgPool } = await import("@workspace/db");
        await pgPool.query(
          `UPDATE organizations
           SET trial_started_email_eligible_at = COALESCE(trial_started_email_eligible_at, NOW())
           WHERE id = $1`,
          [orgId],
        );
        const recipient = await loadOrgEmail(orgId);
        if (recipient.email && updatePayload.trialStartedAt) {
          const trialEnd = updatePayload.trialEndsAt;
          if (trialEnd) {
            await sendTrialStartedOnce({
              orgId,
              email: recipient.email,
              name: recipient.firstName || recipient.email.split("@")[0] || "Utilisateur",
              plan: newPlan || recipient.plan,
              trialEndsAt: trialEnd,
            });
          } else {
            logger.warn({ orgId, subscriptionId }, "[Webhook] Trial-started email skipped — Stripe did not supply trial_end");
          }
        }
      }

      if (newPlan) {
        // Only broadcast when the plan actually changed — a subscription.updated fired for
        // unrelated reasons (e.g. payment method update after an add-on PI) must NOT produce
        // a spurious "Plan mis à jour" toast.
        const _planActuallyChanged = !_dbPlanBefore || _dbPlanBefore.toLowerCase() !== newPlan.toLowerCase();
        if (_planActuallyChanged) {
          logger.info({ newPlan, oldPlan: _dbPlanBefore, status, orgId }, "[Webhook] Subscription updated — plan changed, broadcasting");
          store.broadcastPlanUpdate(newPlan, orgId);
        } else {
          logger.info({ newPlan, oldPlan: _dbPlanBefore, status, orgId }, "[Webhook] Subscription updated — plan unchanged, skipping broadcast");
        }
      }

      // Persist activated add-ons to DB using the resolved orgId.
      // Only reconcile deactivations on subscription.updated — never on subscription.created,
      // because an add-on checkout creates a separate subscription whose item list only contains
      // the new add-on; running deactivation on that event would wrongly revoke addons on
      // the customer's base or other add-on subscriptions.
      {
        const subCustomerId = obj["customer"] ? String(obj["customer"]) : null;
        const isCreated = event.type === "customer.subscription.created";
        await persistAddonsFromSubscription(obj, orgId, subCustomerId, /* reconcileDeactivations */ !isCreated);
      }

      // Provision plan-bundled add-ons (whiteLabel for Pro, customDomain for Ultra, etc.)
      // These are never Stripe subscription items because they are included at no extra charge.
      // provisionPlanAddons is idempotent (ON CONFLICT DO NOTHING under the hood).
      if (newPlan && (status === "active" || status === "trialing")) {
        const { provisionPlanAddons } = await import("../services/addons-service.js");
        provisionPlanAddons(newPlan, orgId).catch(err =>
          logger.warn({ err, newPlan, orgId }, "[Webhook] provisionPlanAddons failed on subscription event")
        );
      }

      if (status === "past_due" || status === "unpaid" || status === "canceled") {
        store.broadcast({ type: "subscription_status", status }, orgId);
      }
      break;
    }

    case "customer.subscription.deleted": {
      if (!orgId) {
        logger.error("[Webhook] customer.subscription.deleted: orgId unresolved — plan NOT reset");
        break;
      }

      // ── Root cause #4 fix: distinguish plan subscription from add-on-only sub ──
      // A FlowPoint customer can hold multiple subscriptions: one carrying the base
      // plan, plus separate add-on-only subscriptions. The previous handler blindly
      // reset the plan to Standard and deactivated ALL add-ons on ANY deletion, so
      // cancelling one add-on subscription wrongly downgraded the base plan and
      // revoked every unrelated live add-on.
      //
      // The deleted subscription is a PLAN subscription only if one of its items
      // resolves to a plan price ID. If it contains no plan item (add-on-only sub),
      // we do NOT touch the base plan and we only reconcile add-ons against the
      // customer's remaining live subscriptions (fail-open on Stripe errors).
      const deletedIsPlanSub = parsePlanFromSubscription(obj) !== null;
      const delCustomerId = obj["customer"] ? String(obj["customer"]) : null;

      if (deletedIsPlanSub) {
        logger.info({ orgId }, "[Webhook] Plan subscription deleted — downgrading to standard");

        // P0-4: persist plan='standard' and status='canceled'
        await persistSubscriptionMeta({ orgId, subscriptionStatus: "canceled", plan: "standard" });

        // Disable all add-ons in org_addons table (base subscription is gone)
        try {
          const { pool: pgPool } = await import("@workspace/db");
          const client = await pgPool.connect();
          try {
            await client.query(`UPDATE org_addons SET active = false, updated_at = NOW() WHERE org_id = $1`, [orgId]);
          } finally { client.release(); }
        } catch (err) {
          logger.warn({ err, orgId }, "[Webhook] Failed to deactivate addons after plan subscription deleted");
        }

        store.broadcastPlanUpdate("standard", orgId);
        store.broadcast({ type: "subscription_status", status: "canceled" }, orgId);
        logger.info({ orgId }, "[Webhook] Plan reset to standard, addons deactivated");
      } else {
        // Add-on-only subscription cancelled: preserve the base plan entitlement.
        // Deactivate only the add-ons that are no longer present on ANY live
        // subscription — persistAddonsFromSubscription(reconcileDeactivations=true)
        // aggregates all remaining live subs and fails open if Stripe is unreachable.
        logger.info({ orgId, subId: obj["id"] },
          "[Webhook] Add-on-only subscription deleted — base plan preserved, reconciling add-ons only");
        await persistAddonsFromSubscription(
          obj,
          orgId,
          delCustomerId,
          /* reconcileDeactivations */ true,
          /* skipActivation */ true,
        );
        store.broadcast({ type: "subscription_status", status: "addon_canceled" }, orgId);
      }
      break;
    }

    case "invoice.payment_succeeded": {
      logger.info({ orgId }, "[Webhook] Payment succeeded");

      if (!orgId) {
        logger.error("[Webhook] invoice.payment_succeeded: orgId unresolved — status NOT persisted, email NOT sent");
        break;
      }

      // P0-1 + P0-3: persist to DB, no store.me mutation
      await persistSubscriptionMeta({ orgId, subscriptionStatus: "active" });
      store.broadcast({ type: "payment_succeeded" }, orgId);

      // Persist active add-ons from subscription (if subscription is in the event).
      // Invoice events are additive-only (no deactivation reconciliation here).
      if (obj["lines"]) {
        const invCustomerId = obj["customer"] ? String(obj["customer"]) : null;
        await persistAddonsFromSubscription(obj, orgId, invCustomerId, /* reconcileDeactivations */ false).catch(() => {});
      }

      // ── Email routing based on billing_reason ─────────────────────────────
      // "subscription_create" → the activation magic link was already sent by
      //   checkout.session.completed / activateNewSignup. Do NOT send a second email.
      // "subscription_update" → plan change email (not "payment confirmed").
      // "subscription_cycle" → recurring renewal → send payment-confirmed.
      // Anything else (manual, add-on, one-off) → send add-on confirmation.
      const billingReason = String(obj["billing_reason"] || "");
      if (billingReason === "subscription_create") {
        logger.info({ orgId, billingReason }, "[Webhook] invoice.payment_succeeded: subscription_create — activation email already sent, skipping duplicate");
        break;
      }

      // P0-5: load email from DB — never from store.me
      const orgData = await loadOrgEmail(orgId);
      if (!orgData.email) {
        logger.warn({ orgId }, "[Webhook] invoice.payment_succeeded: no email found in org_settings — email NOT sent");
        break;
      }

      const amountCents = Number(obj["amount_paid"] || 0);
      const periodEnd = (() => {
        try {
          const l = obj["lines"] as Record<string, unknown>;
          const d = (l["data"] as Array<Record<string, unknown>>)?.[0];
          return d ? new Date(Number((d["period"] as Record<string, unknown>)?.["end"] ?? 0) * 1000).toISOString() : undefined;
        } catch { return undefined; }
      })();
      const recipientName = orgData.firstName || orgData.email.split("@")[0] || "Utilisateur";

      if (billingReason === "subscription_update") {
        // Plan changed → send plan-change specific email, not generic "payment confirmed".
        // If amount_paid = 0 the user is on a trial — adjust message accordingly.
        //
        // GUARD 1: dedicated add-on subscriptions (metadata.addonSub="true") also fire
        // subscription_update invoices — route them to the addon email, not plan-change.
        //
        // GUARD 2: subscriptionItems.create on the PLAN subscription (to add a paid
        // add-on pack such as monitorsPack10) also fires billing_reason="subscription_update"
        // on the plan sub — which does NOT have addonSub metadata.  We detect this by
        // checking whether any invoice line item's price ID matches a known plan-tier
        // price (Standard / Pro / Ultra).  If NONE match → add-on-only mutation →
        // send addon confirmation, never sendPlanChanged.
        const _subDetails = obj["subscription_details"] as Record<string, unknown> | undefined;
        const _subMeta = (_subDetails?.["metadata"] as Record<string, string>) ?? {};
        const _isAddonSub = _subMeta["addonSub"] === "true";

        let _isAddonOnlyInvoice = false;
        if (!_isAddonSub) {
          try {
            const _lineData = ((obj["lines"] as Record<string, unknown>)?.["data"] as Array<Record<string, unknown>>) ?? [];
            // Use getPlanForPriceId() (already imported) so both live AND test-mode
            // plan price IDs are recognised — GUARD 2 previously used PLAN_PRICE_IDS
            // (live only) which caused test-mode plan changes to be misclassified as
            // addon-only and trigger the wrong email.
            const _hasPlanLine = _lineData.some(l => {
              const priceId = (l["price"] as Record<string, unknown> | null)?.["id"];
              return priceId && getPlanForPriceId(String(priceId)) !== null;
            });
            // Add-on-only if there are lines but none is a plan price
            _isAddonOnlyInvoice = _lineData.length > 0 && !_hasPlanLine;
            if (_isAddonOnlyInvoice) {
              logger.info({ orgId, billingReason, lineCount: _lineData.length },
                "[Webhook] invoice.payment_succeeded: subscription_update — no plan price in lines, routing to sendPaymentSucceeded(isAddon)");
            }
          } catch (_planCheckErr) {
            // Fail-open: if we can't load plan prices, assume it IS a plan change
            // (safer than suppressing a real plan-upgrade email)
            logger.warn({ err: _planCheckErr }, "[Webhook] Failed to check plan prices — treating subscription_update as plan change");
          }
        }

        if (_isAddonSub || _isAddonOnlyInvoice) {
          // Add-on subscription update — treat as an add-on confirmation email.
          logger.info({ orgId, billingReason, _isAddonSub, _isAddonOnlyInvoice },
            "[Webhook] invoice.payment_succeeded: subscription_update on addon — routing to sendPaymentSucceeded(isAddon)");
          mailer.sendPaymentSucceeded({
            to:        orgData.email,
            name:      recipientName,
            plan:      orgData.plan,
            amountEur: amountCents > 0 ? Math.round(amountCents / 100) : undefined,
            periodEnd,
            isAddon:   true,
          }).catch(err => logger.warn({ err, orgId }, "[Webhook] sendPaymentSucceeded(addon) email failed"));
        } else {
          const isBillingTrial = amountCents === 0;
          logger.info({ orgId, billingReason, isBillingTrial },
            "[Webhook] invoice.payment_succeeded: subscription_update with plan price line — sending sendPlanChanged");
          mailer.sendPlanChanged({
            to:        orgData.email,
            name:      recipientName,
            plan:      orgData.plan,
            amountEur: amountCents > 0 ? Math.round(amountCents / 100) : undefined,
            periodEnd,
            isTrial:   isBillingTrial,
          }).catch(err => logger.warn({ err, orgId }, "[Webhook] sendPlanChanged email failed"));
        }
      } else {
        // subscription_cycle (renewal) or manual (add-on) → standard payment confirmed
        mailer.sendPaymentSucceeded({
          to:        orgData.email,
          name:      recipientName,
          plan:      orgData.plan,
          amountEur: amountCents > 0 ? Math.round(amountCents / 100) : undefined,
          periodEnd,
          isAddon:   billingReason !== "subscription_cycle",
        }).catch(err => logger.warn({ err, orgId }, "[Webhook] sendPaymentSucceeded email failed"));
      }
      break;
    }

    case "invoice.payment_failed": {
      const attemptCount = Number(obj["attempt_count"] || 1);
      logger.warn({ attemptCount, orgId }, "[Webhook] Payment failed");

      if (!orgId) {
        logger.error("[Webhook] invoice.payment_failed: orgId unresolved — status NOT persisted, email NOT sent");
        break;
      }

      // P0-1 + P0-3: persist to DB, no store.me mutation
      await persistSubscriptionMeta({ orgId, subscriptionStatus: "past_due" });
      store.broadcast({ type: "payment_failed", attemptCount }, orgId);

      // P0-5: load email from DB — never from store.me
      const orgDataFailed = await loadOrgEmail(orgId);
      if (orgDataFailed.email) {
        const nextAttempt = obj["next_payment_attempt"]
          ? new Date(Number(obj["next_payment_attempt"]) * 1000).toISOString()
          : undefined;
        mailer.sendPaymentFailed({
          to:          orgDataFailed.email,
          name:        orgDataFailed.firstName || orgDataFailed.email.split("@")[0] || "Utilisateur",
          plan:        orgDataFailed.plan,
          attemptCount,
          retryDate:   nextAttempt,
        }).catch(err => logger.warn({ err, orgId }, "[Webhook] sendPaymentFailed email failed"));
      } else {
        logger.warn({ orgId }, "[Webhook] invoice.payment_failed: no email found in org_settings — email NOT sent");
      }
      break;
    }

    case "customer.deleted": {
      // Customer hard-deleted in Stripe (e.g. via dashboard or API) — clear billing refs in DB.
      const deletedCustomerId = String(obj["id"] ?? "");
      if (deletedCustomerId) {
        try {
          const { pool: pgPool } = await import("@workspace/db");
          const dbCl = await pgPool.connect();
          try {
            // Jalon 7: clear billing refs in organizations (source of truth)
            const upd = await dbCl.query(
              `UPDATE organizations
               SET stripe_customer_id     = NULL,
                   stripe_subscription_id = NULL,
                   subscription_status    = 'none',
                   plan                   = 'standard',
                   updated_at             = NOW()
               WHERE stripe_customer_id = $1
               RETURNING id AS org_id`,
              [deletedCustomerId],
            );
            if (upd.rowCount && upd.rowCount > 0) {
              const affected = upd.rows[0]?.org_id;
              logger.info({ customerId: deletedCustomerId, affected }, "[Webhook] customer.deleted — billing refs cleared in organizations");
              store.broadcastPlanUpdate("standard", affected ?? orgId ?? "");
            } else {
              logger.warn({ customerId: deletedCustomerId }, "[Webhook] customer.deleted — no org matched this customer in organizations");
            }
          } finally { dbCl.release(); }
        } catch (err) {
          logger.error({ err, customerId: deletedCustomerId }, "[Webhook] customer.deleted — DB update failed");
        }
      }
      break;
    }

    case "customer.updated": {
      // P0-3: removed store.me.stripeCustomerId mutation
      // If we resolved an orgId, persist the customer ID update
      if (orgId && obj["id"]) {
        await persistSubscriptionMeta({ orgId, stripeCustomerId: String(obj["id"]) });
      }
      break;
    }

    default:
      logger.info({ type: event.type }, "[Webhook] Unhandled Stripe event type");
  }
  } catch (handlerErr) {
    // A mutation failed. Mark the event 'failed' so a Stripe retry can heal it
    // (the claim guard above will re-process a non-'processed' event), and return
    // 500 so Stripe schedules that retry. No secrets are logged.
    logger.error({ handlerErr, eventId, type: event.type }, "[Webhook] Handler failed — returning 500 for Stripe retry");
    await markEventStatus("failed");
    res.status(500).json({ received: false, error: "Webhook processing failed" });
    return;
  }

  // Handler completed successfully — record processed so future replays no-op.
  await markEventStatus("processed");
  res.json({ received: true });
}

// Canonical path + legacy path active in Stripe Dashboard
router.post("/webhooks/stripe", handleStripeWebhook);
router.post("/billing/webhook", handleStripeWebhook);

export default router;
