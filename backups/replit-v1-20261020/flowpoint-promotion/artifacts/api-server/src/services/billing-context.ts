/**
 * billing-context.ts — État de facturation par requête, chargé depuis `organizations`.
 *
 * Source de vérité (Jalon 1) : table `organizations`.
 * Fallback automatique sur `org_settings` via loadOrgData() pour les comptes legacy.
 *
 * Toutes les décisions de facturation (garde abonnement, trial, plan gate) doivent
 * utiliser ce contexte — jamais store.me (singleton global contaminé).
 */

import { pool } from "@workspace/db";
import { PLAN_INCLUDED_ADDONS, QTY_ADDONS } from "../lib/plans.js";
import { loadOrgData } from "./org-data.js";
import { normalizeSubscriptionStatus, statusGrantsAccess } from "../lib/subscription-state.js";
import { logger } from "../lib/logger.js";

export interface BillingContext {
  /** Statut d'abonnement normalisé (jamais "active" sans subscriptionId) */
  subscriptionStatus: string | null;
  /** Statut brut depuis organizations.subscription_status (pour debug/migration) */
  rawSubscriptionStatus: string | null;
  /** Plan courant depuis organizations.plan */
  plan: string;
  /** Stripe customer ID depuis organizations.stripe_customer_id */
  stripeCustomerId: string | null;
  /** Stripe subscription ID depuis organizations.stripe_subscription_id */
  stripeSubscriptionId: string | null;
  /** Fin de trial (ISO) depuis organizations.trial_ends_at */
  trialEndsAt: string | null;
  /**
   * Positionné par le webhook quand le premier vrai trial Stripe démarre.
   * NULL = aucun vrai trial Stripe n'a jamais été déclenché.
   */
  trialConsumedAt: string | null;
  /** Email de contact depuis organizations.owner_email */
  email: string | null;
  /** Prénom depuis organizations.owner_first_name */
  firstName: string | null;
  /** Nom de l'organisation depuis organizations.name */
  orgName: string | null;
  /** Add-ons actifs depuis org_addons table (clé = addon_key) */
  addons: Record<string, boolean | number>;
  /** Plan différé (downgrade schedulé, pas encore effectif) */
  pendingPlan: string | null;
  /** Date lisible quand pendingPlan devient effectif */
  pendingPlanDate: string | null;

  // ── Flags dérivés ────────────────────────────────────────────────────────
  /** true quand status est "active" ou "trialing" (vrai trial Stripe) */
  hasPremiumAccess: boolean;
  /**
   * true quand le compte n'a jamais consommé de trial ET n'a pas d'historique Stripe.
   * Calculé à partir de trialConsumedAt IS NULL AND stripeSubscriptionId IS NULL.
   */
  canStartTrial: boolean;
  /**
   * true quand le compte doit compléter sa facturation avant d'accéder aux features premium.
   */
  mustCompleteBilling: boolean;
}

/**
 * Authoritative billing data could not be read. Callers that enforce an
 * entitlement must surface a retryable failure, never invent Standard/empty
 * limits from an outage.
 */
export class BillingContextUnavailableError extends Error {
  readonly code = "BILLING_CONTEXT_UNAVAILABLE";
  readonly retryable = true;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "BillingContextUnavailableError";
  }
}

/**
 * Charge tous les champs de facturation pour l'org depuis `organizations` (source de vérité).
 * Toujours depuis la DB — jamais depuis le singleton store.me.
 * Sûr pour des requêtes concurrentes de différentes organisations.
 */
export async function loadBillingContext(orgId: string): Promise<BillingContext> {
  const [orgData, addonsResult] = await Promise.all([
    loadOrgData(orgId),
    (async () => {
      const client = await pool.connect();
      try {
        return await client.query<{ addon_key: string; active: boolean; quantity: number | null }>(
          `SELECT addon_key, active, quantity FROM org_addons WHERE org_id = $1`,
          [orgId],
        );
      } finally {
        client.release();
      }
    })(),
  ]);
  if (!orgData) {
    throw new BillingContextUnavailableError(
      `No authoritative billing row for org '${orgId}'`,
    );
  }

  // Construire la map addons depuis org_addons (source principale)
  // Les add-ons quantité portent leur nombre de packs (quantity) pour que
  // l'expansion de quota soit multipliée par pack.
  const addons: Record<string, boolean | number> = {};
  for (const row of addonsResult.rows) {
    const qty = Number((row as { quantity?: number | null }).quantity ?? 1);
    addons[row.addon_key] = row.active && QTY_ADDONS.has(row.addon_key)
      ? Math.max(1, qty)
      : row.active;
  }

  // Supplément : addons JSONB depuis organizations (legacy supplement)
  if (orgData.addons && typeof orgData.addons === "object") {
    for (const [key, val] of Object.entries(orgData.addons)) {
      if (!(key in addons)) {
        addons[key] = val as boolean | number;
      }
    }
  }

  // Overlay plan-bundled addons so feature gates work without manual DB activation.
  // This is read-only — no writes to org_addons happen here.
  const planName = orgData.plan.toLowerCase();
  const planIncluded = PLAN_INCLUDED_ADDONS[planName] ?? new Set<string>();
  for (const key of planIncluded) {
    if (!(key in addons)) {
      addons[key] = true;
    }
  }

  const rawSubscriptionStatus = orgData.subscriptionStatus ?? null;
  const stripeSubscriptionId  = orgData.stripeSubscriptionId ?? null;
  const stripeCustomerId      = orgData.stripeCustomerId ?? null;
  const trialEndsAt           = orgData.trialEndsAt ?? null;
  const trialConsumedAt       = orgData.trialConsumedAt ?? null;

  // ── Internal QA bypass (single hardcoded org, double-locked) ─────────────
  // The QA org has no Stripe subscription, so normalizeSubscriptionStatus
  // would return 'none' → hasPremiumAccess=false → dashboard blocked.
  // We grant 'trialing' access only when BOTH conditions are true:
  //   1. The org UUID exactly matches the single fixed QA org UUID.
  //   2. The organizations.is_internal_qa flag is explicitly true.
  // This cannot be triggered for any real customer org.
  const QA_ORG_UUID = "10000000-0000-4000-8000-000000000002";
  const isQaOrg = orgId === QA_ORG_UUID && orgData.isInternalQa === true;

  // Normalisation — ne retourne jamais "active" sans stripeSubscriptionId
  const normalised = isQaOrg
    ? "trialing" as const
    : normalizeSubscriptionStatus({
        rawStatus:           rawSubscriptionStatus,
        stripeSubscriptionId,
        stripeCustomerId,
        trialEndsAt,
        trialConsumedAt,
      });

  if (!isQaOrg && normalised !== rawSubscriptionStatus && rawSubscriptionStatus !== null) {
    logger.warn(
      { orgId, rawSubscriptionStatus, normalizedTo: normalised, stripeSubscriptionId, trialConsumedAt },
      "[BillingContext] Subscription state normalisé à la lecture",
    );
  }

  const hasPremiumAccess    = statusGrantsAccess(normalised);
  const canStartTrial       = !isQaOrg && !trialConsumedAt && !stripeSubscriptionId;
  const mustCompleteBilling = !hasPremiumAccess;

  return {
    subscriptionStatus:    normalised,
    rawSubscriptionStatus,
    plan:                  orgData?.plan ?? "standard",
    stripeCustomerId,
    stripeSubscriptionId,
    trialEndsAt,
    trialConsumedAt,
    email:                 orgData?.email ?? null,
    firstName:             orgData?.firstName ?? null,
    orgName:               orgData?.orgName ?? null,
    addons,
    pendingPlan:           orgData?.pendingPlan     ?? null,
    pendingPlanDate:       orgData?.pendingPlanDate ?? null,
    hasPremiumAccess,
    canStartTrial,
    mustCompleteBilling,
  };
}

/**
 * Résolveur léger d'accès facturation — retourne un résumé de l'état.
 */
export async function resolveBillingAccess(orgId: string): Promise<{
  status: string;
  hasDashboardAccess: boolean;
  hasPremiumAccess: boolean;
  mustCompleteBilling: boolean;
  canStartTrial: boolean;
  currentPlan: string;
  trialEndsAt: string | null;
  currentPeriodEnd: string | null;
}> {
  const ctx = await loadBillingContext(orgId);
  return {
    status:              ctx.subscriptionStatus ?? "pending_billing",
    hasDashboardAccess:  true,
    hasPremiumAccess:    ctx.hasPremiumAccess,
    mustCompleteBilling: ctx.mustCompleteBilling,
    canStartTrial:       ctx.canStartTrial,
    currentPlan:         ctx.plan,
    trialEndsAt:         ctx.trialEndsAt,
    currentPeriodEnd:    null,
  };
}
