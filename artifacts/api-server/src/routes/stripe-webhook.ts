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
import { getStripeKey } from "../services/stripe-factory.js";
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
    const result = await mailer.sendTrialStarted({
      to: opts.email, name: opts.name, plan: opts.plan, trialEndsAt: opts.trialEndsAt,
    });
    if (result.ok) {
      await client.query(
        `UPDATE organizations
         SET trial_started_email_sent_at = NOW(), trial_started_email_claimed_at = NULL
         WHERE id = $1`,
        [opts.orgId],
      );
      logger.info({ orgId: opts.orgId, email: opts.email, emailId: result.id }, "[Webhook] Trial-started email delivered");
      return;
    }
    await client.query(`UPDATE organizations SET trial_started_email_claimed_at = NULL WHERE id = $1`, [opts.orgId]);
    logger.error({ orgId: opts.orgId, email: opts.email, error: result.error }, "[Webhook] Trial-started email failed; claim released for retry");
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

    if (!addonKey) continue;

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
    for (const [key, val] of Object.entries(addons)) {
      if (val === true || (typeof val === "number" && val > 0)) {
        const qty = typeof val === "number" ? val : 1;
        await activateAddon(key, orgId, qty).catch(err =>
          logger.warn({ err, key, orgId }, "[Webhook] Failed to activate addon")
        );
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

      const stripeKey = getStripeKey();
      if (!stripeKey) {
        logger.warn({ orgId }, "[Webhook] reconcile: no Stripe API key — skipping deactivation (fail-open)");
        return;
      }

      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(stripeKey, { apiVersion: "2026-04-22.dahlia" });

      const allSubs = await stripe.subscriptions.list({
        customer: stripeCustomerId,
        status: "all",
        limit: 100,
      });

      // Filter to live subscriptions only
      const liveSubs = allSubs.data.filter(s =>
        s.status === "active" || s.status === "trialing" || s.status === "past_due"
      );

      aggregateAddonKeys = new Set<string>();
      for (const sub of liveSubs) {
        for (const item of sub.items.data) {
          const priceId = item.price?.id;
          if (!priceId) continue;
          const { getAddonForPriceId } = await import("../lib/plans.js");
          const addonKey = getAddonForPriceId(priceId);
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
  }

  // ── 3. Activate user + org + membership (transaction) ───────────────────
  const activateClient = await pgPool.connect();
  let newOrgId: string | null = null;
  try {
    await activateClient.query("BEGIN");

    const upsertUser = await activateClient.query<{ id: string }>(
      `INSERT INTO users (email, first_name, last_name, auth_provider, email_verified, status)
       VALUES ($1, $2, $3, 'magic_link', TRUE, 'active')
       ON CONFLICT (email) DO UPDATE
         SET status         = 'active',
             email_verified = TRUE,
             first_name     = COALESCE(EXCLUDED.first_name, users.first_name),
             last_name      = COALESCE(EXCLUDED.last_name, users.last_name),
             updated_at     = NOW()
       RETURNING id`,
      [email, firstName, signupRow["last_name"] ?? ""]
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

  // Welcome is emitted only after the transaction above committed and the
  // account is active. This is deliberately awaited/logged rather than
  // fire-and-forget: failed activation onboarding must be observable, and a
  // plain pre-registration must never receive it.
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

  // ── Idempotency guard — skip events already processed ────────────────────
  // Use resolved orgId when available; use '_system_' sentinel for unresolved events
  // (never 'default' — that would shadow real org data)
  const eventId = (event as unknown as { id?: string }).id;
  if (eventId) {
    try {
      const { pool: pgPool } = await import("@workspace/db");
      const idClient = await pgPool.connect();
      try {
        const idempotencyOrgId = orgId ?? "_system_";
        const { rowCount } = await idClient.query(
          `INSERT INTO billing_events (org_id, type, stripe_event_id, amount, currency, metadata)
           VALUES ($1, $2, $3, 0, 'eur', '{}')
           ON CONFLICT (stripe_event_id) DO NOTHING`,
          [idempotencyOrgId, event.type, eventId]
        );
        if ((rowCount ?? 0) === 0) {
          logger.info({ eventId, type: event.type }, "[Webhook] Duplicate event — already processed, skipping");
          res.json({ received: true, duplicate: true });
          return;
        }
      } finally {
        idClient.release();
      }
    } catch (e) {
      logger.warn({ e, eventId }, "[Webhook] Idempotency check failed — processing anyway");
    }
  }

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
      const plan     = meta["plan"] ?? "";
      const planNorm = plan.toLowerCase();

      if (!orgId) {
        logger.error({ plan: planNorm, sessionId: obj["id"] }, "[Webhook] checkout.session.completed: orgId unresolved — subscription state NOT persisted");
        break;
      }

      const customerId = obj["customer"] ? String(obj["customer"]) : undefined;

      // ── New signup flow: activate account + send magic link after Stripe validates ──
      const preRegToken  = meta["pre_register_token"] ?? "";
      const selectedPlan = meta["selected_plan"] ?? planNorm ?? "standard";
      const isTrial      = meta["trial_plan"] === "true";

      if (preRegToken && orgId) {
        activateNewSignup({ preRegToken, orgId, customerId, selectedPlan, isTrial })
          .catch(e => logger.error({ e, orgId }, "[Webhook] checkout.session.completed new-signup activation failed"));
      }

      // P0-1: pass explicit orgId — never defaults to "default"
      // Bug-1 fix: persist plan immediately from session.metadata.plan when valid,
      // rather than waiting for the subscription.created/updated webhook.
      const persistPayload: Parameters<typeof persistSubscriptionMeta>[0] = {
        orgId,
        subscriptionStatus: "active",
        stripeCustomerId: customerId,
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

      const piPreRegToken = piMeta["pre_register_token"] ?? "";

      if (!piPreRegToken) {
        // Not a new-signup intent — nothing to do here
        logger.info({ type: event.type }, "[Webhook] No pre_register_token — skipping activation");
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

      // The Stripe customer may not exist yet (created by finalize-checkout).
      // Pass undefined so organizations.stripe_customer_id is left NULL until
      // the customer.subscription.created webhook links it.
      activateNewSignup({
        preRegToken:  piPreRegToken,
        orgId:        piOrgId,
        customerId:   undefined,
        selectedPlan: piSelectedPlan,
        isTrial:      true,  // all new signups start with a trial
      }).catch(e => logger.error({ e, orgId: piOrgId, type: event.type }, "[Webhook] new-signup activation via intent failed"));

      logger.info({ type: event.type, orgId: piOrgId, plan: piSelectedPlan }, "[Webhook] New-signup activation queued from intent");
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
        logger.info({ newPlan, status, orgId }, "[Webhook] Subscription updated — broadcasting plan change");
        store.broadcastPlanUpdate(newPlan, orgId);
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
      logger.info({ orgId }, "[Webhook] Subscription deleted — downgrading to standard");

      if (!orgId) {
        logger.error("[Webhook] customer.subscription.deleted: orgId unresolved — plan NOT reset");
        break;
      }

      // P0-4: persist plan='standard' and status='canceled' to org_settings
      // P0-3: no store.me mutations
      await persistSubscriptionMeta({ orgId, subscriptionStatus: "canceled", plan: "standard" });

      // Disable all add-ons in org_addons table
      try {
        const { pool: pgPool } = await import("@workspace/db");
        const client = await pgPool.connect();
        try {
          await client.query(`UPDATE org_addons SET active = false, updated_at = NOW() WHERE org_id = $1`, [orgId]);
        } finally { client.release(); }
      } catch (err) {
        logger.warn({ err, orgId }, "[Webhook] Failed to deactivate addons after subscription deleted");
      }

      // Broadcast so connected clients know
      store.broadcastPlanUpdate("standard", orgId);
      store.broadcast({ type: "subscription_status", status: "canceled" }, orgId);

      logger.info({ orgId }, "[Webhook] Plan reset to standard, addons deactivated");
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
        const isBillingTrial = amountCents === 0;
        mailer.sendPlanChanged({
          to:        orgData.email,
          name:      recipientName,
          plan:      orgData.plan,
          amountEur: amountCents > 0 ? Math.round(amountCents / 100) : undefined,
          periodEnd,
          isTrial:   isBillingTrial,
        }).catch(err => logger.warn({ err, orgId }, "[Webhook] sendPlanChanged email failed"));
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

  res.json({ received: true });
}

// Canonical path + legacy path active in Stripe Dashboard
router.post("/webhooks/stripe", handleStripeWebhook);
router.post("/billing/webhook", handleStripeWebhook);

export default router;
