/**
 * org-data.ts — Source de vérité : table `organizations` (nouvelle architecture)
 *
 * Remplace org-settings pour toutes les décisions métier liées à :
 *   - le plan (standard / pro / ultra)
 *   - le statut d'abonnement
 *   - le stripe_customer_id / stripe_subscription_id
 *   - les données de facturation (trial, pending_plan, addons)
 *
 * Stratégie de migration :
 *   - LECTURES  → organizations (fallback org_settings si row absente)
 *   - ÉCRITURES → organizations EN PREMIER, puis miroir org_settings
 *     Le miroir sera supprimé lors du Jalon 7 (drop org_settings).
 *
 * IMPORTANT : organizations.id est un UUID en production (colonne UUID Supabase).
 * Ne jamais écrire un email ou une valeur non-UUID dans organizations.id.
 * Utiliser UUID_RE pour valider orgId avant toute requête sur organizations.id.
 */

import { pool } from "@workspace/db";
import { logger } from "../lib/logger.js";

/**
 * UUID v4 guard — organizations.id is a UUID column in production (Supabase).
 * Any query using a non-UUID orgId against organizations.id causes 22P02 → 503.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface OrgBillingData {
  /** Plan : 'standard' | 'pro' | 'ultra' */
  plan: string;
  /** Statut d'abonnement brut depuis organizations.subscription_status */
  subscriptionStatus: string | null;
  /** Stripe customer ID */
  stripeCustomerId: string | null;
  /** Stripe subscription ID */
  stripeSubscriptionId: string | null;
  /** ISO timestamp fin de trial */
  trialEndsAt: string | null;
  /** ISO timestamp quand le premier vrai trial Stripe a été consommé */
  trialConsumedAt: string | null;
  /** ISO timestamp quand le trial a démarré */
  trialStartedAt: string | null;
  /** Add-ons actifs (JSONB) */
  addons: Record<string, unknown>;
  /** Plan différé (scheduled downgrade) */
  pendingPlan: string | null;
  /** Date effective du plan différé */
  pendingPlanDate: string | null;
  /** Email du propriétaire (owner_email) */
  email: string | null;
  /** Prénom du propriétaire (owner_first_name) */
  firstName: string | null;
  /** Nom de l'organisation */
  orgName: string | null;
}

export type PersistOrgFields = {
  plan?: string;
  subscriptionStatus?: string | null;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  trialEndsAt?: string | null;
  trialConsumedAt?: string | null;
  trialStartedAt?: string | null;
  addons?: Record<string, unknown>;
  pendingPlan?: string | null;
  pendingPlanDate?: string | null;
  ownerEmail?: string | null;
  ownerFirstName?: string | null;
  orgName?: string | null;
  website?: string | null;
};

/**
 * Charge les données de facturation depuis `organizations` (source de vérité).
 * Fallback automatique sur `org_settings` si la row n'existe pas encore dans organizations.
 *
 * @returns null si aucun compte trouvé (ni organizations, ni org_settings)
 */
export async function loadOrgData(orgId: string): Promise<OrgBillingData | null> {
  if (!orgId || orgId === "default") return null;

  // Guard: non-UUID orgId cannot match organizations.id (UUID column in prod) — skip to fallback.
  if (UUID_RE.test(orgId)) {
    const client = await pool.connect();
    try {
      const r = await client.query<{
        plan: string;
        subscription_status: string | null;
        stripe_customer_id: string | null;
        stripe_subscription_id: string | null;
        trial_ends_at: string | null;
        trial_consumed_at: string | null;
        trial_started_at: string | null;
        addons: Record<string, unknown> | null;
        pending_plan: string | null;
        pending_plan_date: string | null;
        owner_email: string | null;
        owner_first_name: string | null;
        name: string | null;
      }>(
        `SELECT plan, subscription_status, stripe_customer_id, stripe_subscription_id,
                trial_ends_at, trial_consumed_at, trial_started_at,
                addons, pending_plan, pending_plan_date,
                owner_email, owner_first_name, name
         FROM organizations WHERE id = $1 LIMIT 1`,
        [orgId],
      );

      if (r.rows.length > 0) {
        const row = r.rows[0];
        return {
          plan:                 (row.plan || "standard").toLowerCase(),
          subscriptionStatus:   row.subscription_status ?? null,
          stripeCustomerId:     row.stripe_customer_id || null,
          stripeSubscriptionId: row.stripe_subscription_id || null,
          trialEndsAt:          row.trial_ends_at ? new Date(row.trial_ends_at).toISOString() : null,
          trialConsumedAt:      row.trial_consumed_at ? new Date(row.trial_consumed_at).toISOString() : null,
          trialStartedAt:       row.trial_started_at ? new Date(row.trial_started_at).toISOString() : null,
          addons:               (row.addons && typeof row.addons === "object") ? row.addons as Record<string, unknown> : {},
          pendingPlan:          row.pending_plan ?? null,
          pendingPlanDate:      row.pending_plan_date ?? null,
          email:                row.owner_email ?? null,
          firstName:            row.owner_first_name ?? null,
          orgName:              row.name ?? null,
        };
      }
    } finally {
      client.release();
    }
  } else {
    logger.debug({ orgIdShape: orgId.includes("@") ? "email" : "non-uuid" },
      "[OrgData] non-UUID orgId — skipping organizations table, using org_settings directly");
  }

  // Fallback : org_settings pour les comptes legacy pas encore dans organizations
  logger.debug({ orgId }, "[OrgData] organizations row not found — fallback to org_settings");
  try {
    const { loadOrgSettings } = await import("./org-settings.js");
    const legacy = await loadOrgSettings(orgId);
    if (!legacy) return null;
    return {
      plan:                 (legacy.plan || "standard").toLowerCase(),
      subscriptionStatus:   legacy.subscriptionStatus ?? null,
      stripeCustomerId:     legacy.stripeCustomerId ?? null,
      stripeSubscriptionId: legacy.stripeSubscriptionId ?? null,
      trialEndsAt:          legacy.trialEndsAt ?? null,
      trialConsumedAt:      legacy.trialConsumedAt ?? null,
      trialStartedAt:       null,
      addons:               (typeof legacy.addons === "object" && legacy.addons !== null) ? legacy.addons as Record<string, unknown> : {},
      pendingPlan:          legacy.pendingPlan ?? null,
      pendingPlanDate:      legacy.pendingPlanDate ?? null,
      email:                legacy.email ?? null,
      firstName:            legacy.firstName ?? null,
      orgName:              legacy.orgName ?? null,
    };
  } catch (legacyErr) {
    logger.error({ legacyErr, orgId }, "[OrgData] Both organizations and org_settings failed");
    return null;
  }
}

/**
 * Dual-write : écrit dans `organizations` (source de vérité) PUIS dans `org_settings` (miroir).
 * Le miroir sera supprimé lors du Jalon 7 (suppression d'org_settings).
 *
 * Guard : refuse toute écriture sur orgId vide ou "default".
 */
export async function persistOrgData(orgId: string, fields: PersistOrgFields): Promise<void> {
  if (!orgId || orgId === "default") {
    logger.error({ orgId, fields }, "[OrgData] persistOrgData: orgId invalide — écriture annulée");
    return;
  }
  if (Object.keys(fields).length === 0) return;

  // Guard: non-UUID orgId (legacy email-as-orgId in surviving sessions) cannot be
  // used in organizations.id (UUID column in prod) — INSERT would throw 22P02.
  // Skip the organizations write; proceed to the org_settings mirror only.
  const orgIdIsUuid = UUID_RE.test(orgId);
  if (!orgIdIsUuid) {
    logger.warn({ orgIdShape: orgId.includes("@") ? "email" : "non-uuid" },
      "[OrgData] persistOrgData: non-UUID orgId — skipping organizations write, org_settings only");
  }

  // ── 1. Écriture principale → organizations (UUID orgId only) ───────────
  const sets: string[] = [];
  const vals: unknown[] = [];
  let n = 2; // $1 = orgId

  if (fields.plan !== undefined)                { sets.push(`plan = $${n++}`);                   vals.push(fields.plan ? fields.plan.toLowerCase() : "standard"); }
  if (fields.subscriptionStatus !== undefined)   { sets.push(`subscription_status = $${n++}`);    vals.push(fields.subscriptionStatus); }
  if (fields.stripeCustomerId !== undefined)      { sets.push(`stripe_customer_id = $${n++}`);     vals.push(fields.stripeCustomerId || null); }
  if (fields.stripeSubscriptionId !== undefined)  { sets.push(`stripe_subscription_id = $${n++}`); vals.push(fields.stripeSubscriptionId || null); }
  if (fields.trialEndsAt !== undefined)           { sets.push(`trial_ends_at = $${n++}`);          vals.push(fields.trialEndsAt); }
  if (fields.trialConsumedAt !== undefined)       { sets.push(`trial_consumed_at = $${n++}`);      vals.push(fields.trialConsumedAt); }
  if (fields.trialStartedAt !== undefined)        { sets.push(`trial_started_at = $${n++}`);       vals.push(fields.trialStartedAt); }
  if (fields.pendingPlan !== undefined)           { sets.push(`pending_plan = $${n++}`);            vals.push(fields.pendingPlan); }
  if (fields.pendingPlanDate !== undefined)       { sets.push(`pending_plan_date = $${n++}`);      vals.push(fields.pendingPlanDate); }
  if (fields.ownerEmail !== undefined)            { sets.push(`owner_email = $${n++}`);            vals.push(fields.ownerEmail); }
  if (fields.ownerFirstName !== undefined)        { sets.push(`owner_first_name = $${n++}`);       vals.push(fields.ownerFirstName); }
  if (fields.orgName !== undefined)               { sets.push(`name = $${n++}`);                   vals.push(fields.orgName); }
  if (fields.website !== undefined)               { sets.push(`website = $${n++}`);                vals.push(fields.website || null); }

  if (sets.length === 0) return;
  sets.push("updated_at = NOW()");

  if (orgIdIsUuid) {
    try {
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO organizations (id) VALUES ($1)
           ON CONFLICT (id) DO UPDATE SET ${sets.join(", ")}`,
          [orgId, ...vals],
        );
        logger.debug({ orgId, keys: Object.keys(fields) }, "[OrgData] organizations mis à jour");
      } finally {
        client.release();
      }
    } catch (primaryErr) {
      logger.error({ primaryErr, orgId, fields }, "[OrgData] Échec écriture organizations");
      throw primaryErr; // rethrow — caller should handle
    }
  }

  // ── 2. Miroir → org_settings (non-fatal) ───────────────────────────────
  try {
    const { upsertOrgSettings } = await import("./org-settings.js");
    const legacy: Record<string, unknown> = {};
    if (fields.plan !== undefined)                legacy["plan"]                = fields.plan;
    if (fields.subscriptionStatus !== undefined)   legacy["subscriptionStatus"]  = fields.subscriptionStatus;
    if (fields.stripeCustomerId !== undefined)      legacy["stripeCustomerId"]    = fields.stripeCustomerId;
    if (fields.stripeSubscriptionId !== undefined)  legacy["stripeSubscriptionId"] = fields.stripeSubscriptionId;
    if (fields.trialEndsAt !== undefined)           legacy["trialEndsAt"]         = fields.trialEndsAt;
    if (fields.trialConsumedAt !== undefined)       legacy["trialConsumedAt"]     = fields.trialConsumedAt;
    if (fields.trialStartedAt !== undefined)        legacy["trialStartedAt"]      = fields.trialStartedAt;
    if (fields.pendingPlan !== undefined)           legacy["pendingPlan"]         = fields.pendingPlan;
    if (fields.pendingPlanDate !== undefined)       legacy["pendingPlanDate"]     = fields.pendingPlanDate;
    if (fields.ownerEmail !== undefined)            legacy["email"]               = fields.ownerEmail;
    if (fields.orgName !== undefined)               legacy["orgName"]             = fields.orgName;
    if (Object.keys(legacy).length > 0) {
      await upsertOrgSettings(orgId, legacy as Parameters<typeof upsertOrgSettings>[1]);
    }
  } catch (mirrorErr) {
    // Non-fatal : organizations est la nouvelle source de vérité
    logger.warn({ mirrorErr, orgId }, "[OrgData] Miroir org_settings échoué (non-fatal)");
  }
}

/**
 * Résout un orgId depuis un stripe_customer_id.
 * Lit organizations EN PREMIER, puis org_settings en fallback.
 *
 * @returns orgId (= email) ou null si introuvable
 */
export async function findOrgByStripeCustomer(stripeCustomerId: string): Promise<string | null> {
  if (!stripeCustomerId) return null;

  const client = await pool.connect();
  try {
    // Lookup 1: organizations.stripe_customer_id (canonical)
    const r = await client.query<{ id: string }>(
      `SELECT id FROM organizations WHERE stripe_customer_id = $1 LIMIT 1`,
      [stripeCustomerId],
    );
    if (r.rows.length > 0) return r.rows[0].id;

    // Lookup 2: org_settings.stripe_customer_id (legacy email-keyed orgs)
    const legacy = await client.query<{ org_id: string }>(
      `SELECT org_id FROM org_settings WHERE stripe_customer_id = $1 LIMIT 1`,
      [stripeCustomerId],
    );
    if (legacy.rows[0]?.org_id) return legacy.rows[0].org_id;

    // Lookup 3: fetch customer from Stripe API, read customer.metadata.orgId.
    // This handles orgs where stripe_customer_id was never written back to the DB
    // (e.g. signup completed before the column existed, or a race condition at
    // checkout time). When we find the orgId this way, we self-heal the DB so
    // future lookups hit path 1.
    try {
      const { createStripeClient, getStripeKey } = await import("../services/stripe-factory.js");
      const _key = getStripeKey();
      const stripe = _key ? await createStripeClient(_key) : null;
      if (stripe) {
        const customer = await (stripe as unknown as { customers: { retrieve(id: string): Promise<{ deleted?: boolean; metadata?: Record<string, string>; email?: string | null }> } }).customers.retrieve(stripeCustomerId);
        if (customer && !customer.deleted) {
          const metaOrgId = (customer.metadata as Record<string, string>)?.["orgId"]
            ?? (customer.metadata as Record<string, string>)?.["org_id"]
            ?? null;
          if (metaOrgId && metaOrgId !== "default") {
            // Self-heal: write stripe_customer_id back to organizations so next
            // webhook skips the Stripe API round-trip.
            const healed = await client.query(
              `UPDATE organizations SET stripe_customer_id = $1
               WHERE id = $2 AND stripe_customer_id IS NULL
               RETURNING id`,
              [stripeCustomerId, metaOrgId],
            ).catch(() => null);
            if (healed?.rowCount && healed.rowCount > 0) {
              const { logger: log } = await import("../lib/logger.js");
              log.info({ stripeCustomerId, metaOrgId }, "[OrgData] findOrgByStripeCustomer: stripe_customer_id self-healed from Stripe metadata");
            }
            return metaOrgId;
          }
          // Also try by customer email
          const custEmail = (customer as { email?: string | null }).email;
          if (custEmail) {
            const byEmail = await client.query<{ id: string }>(
              `SELECT id FROM organizations WHERE lower(owner_email) = lower($1) ORDER BY created_at DESC LIMIT 1`,
              [custEmail],
            );
            if (byEmail.rows[0]?.id) {
              // Self-heal
              await client.query(
                `UPDATE organizations SET stripe_customer_id = $1
                 WHERE id = $2 AND stripe_customer_id IS NULL`,
                [stripeCustomerId, byEmail.rows[0].id],
              ).catch(() => null);
              return byEmail.rows[0].id;
            }
          }
        }
      }
    } catch {
      // Non-fatal: Stripe API unavailable or rate-limited — return null, webhook
      // will log the unresolved orgId warning and Stripe will retry.
    }

    return null;
  } finally {
    client.release();
  }
}
