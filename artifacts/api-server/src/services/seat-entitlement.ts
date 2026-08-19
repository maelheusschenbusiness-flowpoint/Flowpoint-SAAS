/**
 * seat-entitlement.ts — Single authoritative server-side resolver for team seat
 * capacity.
 *
 * P0 ROOT-CAUSE FIX: the previous getOrgSeatLimit in team.ts kept its own
 * organizations+org_settings join and silently fell back to Standard/1 on any
 * failure. That let the dashboard show Ultra/10 (via billing-context) while
 * POST /team/invite rejected at Standard/1 (via the divergent join).
 *
 * This module establishes ONE resolution path:
 *   canonical organization/billing record (loadBillingContext, which reads the
 *   `organizations` source of truth + active `org_addons`)  +
 *   QTY_ADDON_GRANTS.extraSeats pack expansion (computeQtyAddonExtras).
 *
 * Both GET /team and POST /team/invite MUST call resolveSeatEntitlement so the
 * dashboard display and the invite gate can never disagree.
 *
 * Failure policy: if the entitlement cannot be resolved (billing context load
 * fails, plan unknown), this throws SeatEntitlementUnavailableError — an
 * explicit RETRYABLE server error. It NEVER silently degrades to Standard/1,
 * which would wrongly refuse invites for paying Pro/Ultra orgs.
 */

import { PLAN_LIMITS, computeQtyAddonExtras } from "../lib/plans.js";
import { loadBillingContext } from "./billing-context.js";
import { logger } from "../lib/logger.js";

/**
 * Thrown when seat capacity cannot be authoritatively resolved.
 * Callers should surface a 503 (retryable) — never fall back to Standard/1.
 */
export class SeatEntitlementUnavailableError extends Error {
  readonly code = "SEAT_ENTITLEMENT_UNAVAILABLE";
  readonly retryable = true;
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "SeatEntitlementUnavailableError";
  }
}

export interface SeatEntitlement {
  /** Total seat capacity = plan.teamMembers + extraSeats pack expansion. */
  limit: number;
  /** Canonical plan name (lowercased). */
  plan: string;
}

/**
 * Resolve the authoritative seat capacity for an org.
 *
 * @throws SeatEntitlementUnavailableError when resolution is unknown/unavailable.
 */
export async function resolveSeatEntitlement(orgId: string): Promise<SeatEntitlement> {
  if (!orgId || orgId === "default") {
    throw new SeatEntitlementUnavailableError(`Invalid orgId for seat resolution: ${orgId}`);
  }

  let ctx;
  try {
    ctx = await loadBillingContext(orgId);
  } catch (err) {
    logger.error({ err, orgId }, "[SeatEntitlement] loadBillingContext threw — cannot resolve seat capacity");
    throw new SeatEntitlementUnavailableError("Failed to load billing context for seat resolution", err);
  }

  if (!ctx) {
    throw new SeatEntitlementUnavailableError("Billing context unavailable for seat resolution");
  }

  const plan = (ctx.plan ?? "").toLowerCase();
  const basePlan = PLAN_LIMITS[plan];
  if (!basePlan) {
    // Unknown plan → cannot know real capacity. Retryable, never Standard/1.
    logger.error({ orgId, plan }, "[SeatEntitlement] Unknown plan — cannot resolve seat capacity");
    throw new SeatEntitlementUnavailableError(`Unknown plan '${plan}' for seat resolution`);
  }

  // Canonical per-pack expansion — QTY_ADDON_GRANTS.extraSeats grants teamMembers.
  const extras = computeQtyAddonExtras(ctx.addons ?? {});
  const extraSeats = extras["teamMembers"] ?? 0;
  const limit = basePlan.teamMembers + extraSeats;

  return { limit, plan };
}
