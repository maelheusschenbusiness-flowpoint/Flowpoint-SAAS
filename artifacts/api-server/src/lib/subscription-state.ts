/**
 * subscription-state.ts — FlowPoint subscription state machine.
 *
 * LIFECYCLE:
 *  signup                → "pending_billing"         (no trial yet)
 *  Stripe webhook trialing → "trialing"              (real trial, trialConsumedAt set)
 *  Stripe webhook active   → "active"
 *  Stripe webhook canceled → "canceled"
 *  resource_missing        → "pending_billing" / "none" (reconciled, IDs cleared)
 *
 * STATUS RULES:
 *  "pending_billing" — account created, checkout not completed; NO premium access
 *  "trialing"        — real Stripe trial active (stripeSubscriptionId non-null OR trialConsumedAt set + trialActive)
 *  "active"          — paid subscription (stripeSubscriptionId required)
 *  "past_due"        — payment failed, subscription still alive (stripeSubscriptionId required)
 *                      acces complet pendant la grace PAST_DUE_GRACE_DAYS (past_due_since), puis lecture seule
 *  "canceled"        — subscription ended (stripeSubscriptionId existed at some point)
 *  "incomplete"      — stripeCustomerId exists, no live subscription
 *  "unpaid"          — requires stripeSubscriptionId
 *  "paused"          — requires stripeSubscriptionId
 *  "none"            — no customer, no subscription, no trial
 *
 * PREMIUM ACCESS:
 *  Only "active" and "trialing" grant paid-feature access.
 *  "pending_billing" does NOT grant access — dashboard shows billing completion page.
 *
 * ACCESS MODE (decision unique : resolveAccessMode, voir plus bas) :
 *  full / read_only / blocked — annulation = acces jusqu'a current_period_end puis
 *  lecture seule ; past_due = grace PAST_DUE_GRACE_DAYS (defaut 3) depuis
 *  organizations.past_due_since puis lecture seule.
 *
 * Dashboard access policy (single source of truth):
 *  - Dashboard shell:        all authenticated users (access gate is auth only)
 *  - Premium features/quota: requires statusGrantsAccess(status) === true
 *  - pending_billing:        dashboard shows only Billing / Pricing / Account pages
 *  - After trial expiry:     status normalises to "pending_billing" (DB not yet migrated)
 *                            or "incomplete" / "none" (DB up to date)
 */

export type SubscriptionStatus =
  | "pending_billing"
  | "none"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete"
  | "unpaid"
  | "paused";

export interface SubscriptionStateInput {
  /** Raw value from org_settings.subscription_status */
  rawStatus: string | null;
  /** From org_settings.stripe_subscription_id */
  stripeSubscriptionId: string | null;
  /** From org_settings.stripe_customer_id */
  stripeCustomerId: string | null;
  /** ISO string from org_settings.trial_ends_at */
  trialEndsAt: string | null;
  /**
   * ISO string from org_settings.trial_consumed_at.
   * Set by the Stripe webhook when the first trialing subscription is created.
   * NULL means no real Stripe trial was ever started (accounts before 2026-07-26
   * that were given a fake DB trial at signup).
   */
  trialConsumedAt?: string | null;
}

/**
 * Normalise raw DB state into a valid, consistent SubscriptionStatus.
 * This is the single source of truth — every endpoint that exposes a
 * subscription status MUST pass through this function.
 */
export function normalizeSubscriptionStatus(input: SubscriptionStateInput): SubscriptionStatus {
  const { rawStatus, stripeSubscriptionId, stripeCustomerId, trialEndsAt, trialConsumedAt } = input;

  const hasSubscription = !!(stripeSubscriptionId && stripeSubscriptionId.trim());
  const hasCustomer     = !!(stripeCustomerId     && stripeCustomerId.trim());
  const trialActive     = !!(trialEndsAt && new Date(trialEndsAt) > new Date());
  const wasConsumed     = !!(trialConsumedAt);

  // ── pending_billing: explicit new-account state ──────────────────────────
  // Signup no longer grants a trial — accounts start here.
  // Only upgraded via Stripe webhook (subscription created/updated).
  if (rawStatus === "pending_billing") {
    if (hasSubscription) {
      // Webhook fired and set a subscriptionId — normalise based on real state
      if (trialActive)  return "trialing";
      return "active";
    }
    return "pending_billing";
  }

  // ── Statuses that require a real Stripe subscription ────────────────────
  const requiresSubscription = new Set(["active", "past_due", "unpaid", "paused"]);
  if (rawStatus && requiresSubscription.has(rawStatus)) {
    if (!hasSubscription) {
      // Impossible state: billing status but no subscription ID.
      if (trialActive && wasConsumed) return "trialing";
      if (trialActive)               return "pending_billing";
      if (hasCustomer)               return "incomplete";
      return "none";
    }
    return rawStatus as SubscriptionStatus;
  }

  // ── canceled: valid even without a live subscription ────────────────────
  if (rawStatus === "canceled") {
    return "canceled";
  }

  // ── trialing ─────────────────────────────────────────────────────────────
  if (rawStatus === "trialing") {
    if (hasSubscription) {
      // Stripe-backed trial
      if (trialActive)   return "trialing";
      return "active";   // trial period over but subscription continues
    }
    // No Stripe subscription:
    if (!wasConsumed) {
      // No trial_consumed_at → this was the OLD fake DB trial set at signup.
      // Treat as pending_billing (no real trial ever started).
      return "pending_billing";
    }
    // trial_consumed_at IS set → trial was real, but subscription is gone
    if (trialActive)   return "trialing"; // still within trial window
    if (hasCustomer)   return "incomplete";
    return "none";
  }

  // ── incomplete ───────────────────────────────────────────────────────────
  if (rawStatus === "incomplete") {
    return hasCustomer ? "incomplete" : "none";
  }

  // ── null / "none" / unknown raw status ──────────────────────────────────
  // DO NOT fall back to "trialing" based on trialEndsAt alone —
  // trialEndsAt is set by the old signup code and is not a reliable signal.
  if (hasCustomer)     return "incomplete";
  return "none";
}

/**
 * Returns true when the status grants access to paid-tier features.
 * Only "active" and "trialing" (real Stripe-backed) grant premium access.
 * "pending_billing" does NOT grant premium access.
 */
export function statusGrantsAccess(status: SubscriptionStatus): boolean {
  return status === "active" || status === "trialing";
}

/**
 * Statuts pour lesquels une periode deja payee peut encore couvrir l'acces.
 * Un abonnement interrompu n'annule pas la periode que le client a payee :
 * tant que `current_period_end` est dans le futur, l'acces reste du.
 */
const PAID_PERIOD_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  "past_due", "unpaid", "canceled", "paused",
]);

/** true quand la periode deja payee couvre encore l'instant present. */
export function paidPeriodStillValid(
  status: SubscriptionStatus,
  currentPeriodEnd: string | null,
  now: Date = new Date(),
): boolean {
  if (!PAID_PERIOD_STATUSES.has(status) || !currentPeriodEnd) return false;
  const end = new Date(currentPeriodEnd);
  if (Number.isNaN(end.getTime())) return false;
  return end > now;
}

/**
 * Regle d'acces aux fonctionnalites payantes — SOURCE UNIQUE.
 *
 * Politique produit :
 *  - essai valide (trialing)            → acces selon le plan
 *  - abonnement actif                   → acces selon le plan et ses quotas
 *  - essai expire sans abonnement       → bloque (normalise en incomplete/none)
 *  - expire / annule / suspendu         → bloque, SAUF si la periode deja
 *                                         payee reste valide
 *    (superseded par resolveAccessMode : lecture seule apres la periode payee)
 *
 * Toute route payante et tout affichage d'entitlement passent par ici : il n'y
 * a pas de second systeme de permissions.
 *
 * NB : cette fonction ne connait pas la grace past_due ni la lecture seule ;
 * la decision d'acces des middlewares est resolveAccessMode() (ci-dessous). Elle
 * reste pour les affichages qui ne portent que sur la periode payee.
 */
export function grantsPaidAccess(input: {
  status: SubscriptionStatus;
  currentPeriodEnd?: string | null;
  now?: Date;
}): boolean {
  if (statusGrantsAccess(input.status)) return true;
  return paidPeriodStillValid(input.status, input.currentPeriodEnd ?? null, input.now);
}

// ───────────────────────────────────────────────────────────────────────────
// MODE D'ACCES — SOURCE UNIQUE de la decision (regle commerciale validee)
// ───────────────────────────────────────────────────────────────────────────
//
//  full       acces complet (lecture + ecriture + actions premium)
//  read_only  lecture seule : GET/HEAD/OPTIONS passent, toute ecriture, action
//             premium, consommation de credits ou generation couteuse est
//             refusee en 402 SUBSCRIPTION_READ_ONLY. Aucune donnee supprimee.
//             Facturation (portail, reactivation, nouvelle souscription) et
//             exports de ses propres donnees (GET) restent possibles.
//  blocked    compte jamais finalise / essai expire sans abonnement : 402
//             SUBSCRIPTION_REQUIRED, comme avant.
//
// (A) ANNULATION : `canceled` garde l'acces complet jusqu'a current_period_end,
//     puis lecture seule. `cancel_at_period_end=true` sur un abonnement encore
//     actif = acces normal jusqu'a la fin ; si la fin de periode est depassee
//     sans que Stripe ait encore notifie la suppression, lecture seule (on ne
//     laisse pas un acces illimite dependre d'un webhook manquant).
// (B) PAST_DUE : grace de PAST_DUE_GRACE_DAYS (defaut 3) mesuree depuis
//     `past_due_since` (pose une fois par invoice.payment_failed). On
//     N'UTILISE PAS current_period_end : a un renouvellement, Stripe avance deja
//     la periode quand la facture est creee, donc current_period_end est dans
//     le futur alors que la periode n'est PAS payee (c'etait la faille d'audit :
//     grace bornee seulement par current_period_end = jusqu'a un mois gratuit).
//     Apres la grace : lecture seule.
//     `unpaid` (Stripe a epuise ses relances) et `paused` : lecture seule
//     immediate, sans grace supplementaire.
//     Organisation deja past_due SANS horodatage (anterieure a la regle) :
//     ancre = instant d'activation de la regle (config.legacyPastDueAnchor),
//     jamais un basculement brutal le jour du deploiement.
// Statuts sans abonnement paye (pending_billing, incomplete, incomplete_expired,
// expired, none, plan/statut inconnu) : blocked.

export type AccessMode = "full" | "read_only" | "blocked";

export type AccessReason =
  | "active"
  | "trialing"
  | "active_cancel_scheduled"
  | "canceled_paid_period"
  | "past_due_grace"
  | "canceled_period_ended"
  | "cancel_scheduled_period_ended"
  | "past_due_grace_expired"
  | "unpaid"
  | "paused"
  | "no_subscription"
  | "unknown_status";

export interface AccessConfig {
  /** Jours de grace apres le debut du past_due (entier >= 0). */
  pastDueGraceDays: number;
  /** Ancre de grace pour les past_due sans past_due_since (date d'activation de la regle). */
  legacyPastDueAnchor: Date;
}

export const DEFAULT_PAST_DUE_GRACE_DAYS = 3;
export const MAX_PAST_DUE_GRACE_DAYS = 30;

export interface AccessState {
  /** Statut DEJA normalise par normalizeSubscriptionStatus. */
  status: SubscriptionStatus | string | null;
  currentPeriodEnd?: string | null;
  cancelAtPeriodEnd?: boolean;
  /** organizations.past_due_since (ISO) ; null = inconnu / pas past_due */
  pastDueSince?: string | null;
}

export interface AccessDecision {
  mode: AccessMode;
  reason: AccessReason;
  /** Fin de grace (ISO) quand le compte est en past_due. */
  graceEndsAt?: string | null;
  /** Fin de periode payee (ISO) quand elle conditionne l'acces. */
  accessEndsAt?: string | null;
}

const MS_DAY = 86_400_000;

function parseDate(v: string | null | undefined): Date | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Fonction PURE : aucune horloge, aucun env, aucune base. `now` et `config`
 * sont toujours fournis par l'appelant (billing-context + lib/access-config).
 */
export function resolveAccessMode(state: AccessState, now: Date, config: AccessConfig): AccessDecision {
  const status = state.status ?? "none";
  const periodEnd = parseDate(state.currentPeriodEnd);

  switch (status) {
    case "active":
    case "trialing": {
      if (state.cancelAtPeriodEnd === true && periodEnd && periodEnd <= now) {
        return { mode: "read_only", reason: "cancel_scheduled_period_ended", accessEndsAt: periodEnd.toISOString() };
      }
      if (state.cancelAtPeriodEnd === true) {
        return { mode: "full", reason: "active_cancel_scheduled", accessEndsAt: periodEnd ? periodEnd.toISOString() : null };
      }
      return { mode: "full", reason: status };
    }
    case "canceled": {
      if (periodEnd && periodEnd > now) {
        return { mode: "full", reason: "canceled_paid_period", accessEndsAt: periodEnd.toISOString() };
      }
      return { mode: "read_only", reason: "canceled_period_ended", accessEndsAt: periodEnd ? periodEnd.toISOString() : null };
    }
    case "past_due": {
      const since = parseDate(state.pastDueSince) ?? config.legacyPastDueAnchor;
      const graceEnd = new Date(since.getTime() + Math.max(0, config.pastDueGraceDays) * MS_DAY);
      if (now < graceEnd) return { mode: "full", reason: "past_due_grace", graceEndsAt: graceEnd.toISOString() };
      return { mode: "read_only", reason: "past_due_grace_expired", graceEndsAt: graceEnd.toISOString() };
    }
    case "unpaid":
      return { mode: "read_only", reason: "unpaid" };
    case "paused":
      return { mode: "read_only", reason: "paused" };
    case "pending_billing":
    case "none":
    case "incomplete":
    case "incomplete_expired":
    case "expired":
      return { mode: "blocked", reason: "no_subscription" };
    default:
      return { mode: "blocked", reason: "unknown_status" };
  }
}

/** Parse PAST_DUE_GRACE_DAYS : entier 0..30 ; toute autre valeur → defaut 3 (valid=false). */
export function parsePastDueGraceDays(raw: string | undefined | null): { days: number; valid: boolean } {
  if (raw === undefined || raw === null || String(raw).trim() === "") return { days: DEFAULT_PAST_DUE_GRACE_DAYS, valid: true };
  const t = String(raw).trim();
  if (!/^\d+$/.test(t)) return { days: DEFAULT_PAST_DUE_GRACE_DAYS, valid: false };
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n > MAX_PAST_DUE_GRACE_DAYS) return { days: DEFAULT_PAST_DUE_GRACE_DAYS, valid: false };
  return { days: n, valid: true };
}

/**
 * SQL to normalise:
 * 1. Active without subscription (impossible state from old DEFAULT 'active' bug)
 * 2. Trialing without subscription AND without trial_consumed_at (old fake DB trial)
 *
 * Safe to run repeatedly (only touches invalid rows). Does NOT delete Stripe data.
 */
export const NORMALIZE_IMPOSSIBLE_STATES_SQL = `
-- Fix 1: active without subscription
UPDATE org_settings
SET    subscription_status =
         CASE
           WHEN trial_ends_at IS NOT NULL
                AND trial_ends_at > NOW()
                AND trial_consumed_at IS NOT NULL  THEN 'trialing'
           WHEN stripe_customer_id IS NOT NULL
                AND stripe_customer_id <> ''        THEN 'incomplete'
           ELSE                                          'none'
         END,
       updated_at = NOW()
WHERE  subscription_status = 'active'
  AND  (stripe_subscription_id IS NULL OR stripe_subscription_id = '');

-- Fix 2: trialing without subscription AND without trial_consumed_at = fake DB trial
UPDATE org_settings
SET    subscription_status = 'pending_billing',
       updated_at = NOW()
WHERE  subscription_status = 'trialing'
  AND  (stripe_subscription_id IS NULL OR stripe_subscription_id = '')
  AND  trial_consumed_at IS NULL;
`;

/** Keep for backward compat — callers can switch to NORMALIZE_IMPOSSIBLE_STATES_SQL */
export const NORMALIZE_ACTIVE_WITHOUT_SUBSCRIPTION_SQL = NORMALIZE_IMPOSSIBLE_STATES_SQL;

/**
 * Returns an object suitable for a structured log entry summarising the
 * normalisation of an impossible state.
 */
export function impossibleStateReport(input: SubscriptionStateInput, resolved: SubscriptionStatus) {
  return {
    rawStatus:            input.rawStatus,
    stripeSubscriptionId: input.stripeSubscriptionId,
    stripeCustomerId:     input.stripeCustomerId,
    trialEndsAt:          input.trialEndsAt,
    trialConsumedAt:      input.trialConsumedAt,
    normalizedTo:         resolved,
    wasImpossible:        resolved !== input.rawStatus,
  };
}
