/**
 * me-entitlement.ts — Authoritative billing/entitlement loading for GET /api/me.
 *
 * ROOT CAUSE THIS FIXES:
 *   The GET /api/me handler used `loadOrgData(orgId).catch(() => null)` and
 *   `loadOrgSettings(orgId).catch(() => null)`, which collapse two distinct
 *   situations into a single `null`:
 *     1. The org genuinely has no billing row yet (legitimate absence).
 *     2. The billing store threw (transient DB failure / outage).
 *   Case (2) was silently treated like case (1) and the handler returned a
 *   200 response with a fabricated "Standard" plan and "unknown" status.
 *   A transient DB blip therefore downgraded a paying org's entitlement.
 *
 * FIX:
 *   This helper distinguishes the two cases. When any authoritative source
 *   THROWS, it raises `BillingDataUnavailableError` so the route can answer
 *   with a retryable, non-cacheable 503 instead of a fabricated entitlement.
 *   `org_addons` is loaded FAIL-CLOSED for the same reason: a swallowed error
 *   there would undercount quantity-addon limits, silently shrinking quota.
 *
 *   A genuine, valid org (row present, all reads succeed) is unaffected: the
 *   loaded data is returned exactly as before.
 */

import type { OrgBillingData } from "../services/org-data.js";
import type { OrgSettings } from "../services/org-settings.js";

/** Structured error code surfaced to the client on a 503. */
export const BILLING_DATA_UNAVAILABLE_CODE = "BILLING_DATA_UNAVAILABLE" as const;

/**
 * Raised when authoritative billing/entitlement data cannot be loaded because
 * a source threw (as opposed to legitimately returning no row). The route maps
 * this to a retryable 503 — never to a fabricated default plan.
 */
export class BillingDataUnavailableError extends Error {
  readonly code = BILLING_DATA_UNAVAILABLE_CODE;
  readonly retryable = true;
  constructor(message = "Billing/entitlement data is temporarily unavailable", options?: { cause?: unknown }) {
    super(message, options);
    this.name = "BillingDataUnavailableError";
  }
}

/** DB-row shape returned by an `org_addons` lookup. */
export type AddonRow = Record<string, unknown>;

/**
 * Dependency surface for {@link loadMeEntitlement}. Injected so the loader can
 * be unit-tested without an Express request or a live database.
 */
export interface MeEntitlementDeps {
  /** organizations (source of truth) → org_settings fallback. May throw on outage. */
  loadOrgData: (orgId: string) => Promise<OrgBillingData | null>;
  /** org_settings profile fields. May throw on outage. */
  loadOrgSettings: (orgId: string) => Promise<OrgSettings | null>;
  /** org_addons rows for this org. MUST fail closed — a throw becomes a 503. */
  loadAddons: (orgId: string) => Promise<AddonRow[]>;
}

export interface MeEntitlement {
  /** From organizations (source of truth). Null only when the row is genuinely absent. */
  billingData: OrgBillingData | null;
  /** From org_settings. Null only when the row is genuinely absent. */
  dbData: OrgSettings | null;
  /** Active org_addons rows (fail-closed — never a suppressed empty array). */
  addonRows: AddonRow[];
}

/**
 * Load authoritative billing + entitlement inputs for GET /api/me.
 *
 * Semantics (the whole point of this helper):
 *   - A source that RESOLVES to `null`  → legitimate absence, propagated as null.
 *   - A source that REJECTS (throws)    → {@link BillingDataUnavailableError}.
 *
 * `org_addons` is loaded fail-closed: a rejection throws rather than defaulting
 * to `[]`, so quantity-addon limits are never silently undercounted.
 *
 * @throws {BillingDataUnavailableError} when any source cannot be loaded.
 */
export async function loadMeEntitlement(
  orgId: string,
  deps: MeEntitlementDeps,
): Promise<MeEntitlement> {
  // Run the two billing reads together, then inspect settled outcomes so we can
  // tell "resolved to null" (absence) apart from "rejected" (outage).
  const [billingSettled, dbSettled] = await Promise.allSettled([
    deps.loadOrgData(orgId),
    deps.loadOrgSettings(orgId),
  ]);

  if (billingSettled.status === "rejected") {
    throw new BillingDataUnavailableError(
      "organizations/billing lookup failed",
      { cause: billingSettled.reason },
    );
  }
  if (dbSettled.status === "rejected") {
    throw new BillingDataUnavailableError(
      "org_settings lookup failed",
      { cause: dbSettled.reason },
    );
  }

  // Fail-closed addon load: a thrown error here would undercount qty-addon
  // limits, so it must produce a 503 rather than a suppressed empty array.
  let addonRows: AddonRow[];
  try {
    addonRows = await deps.loadAddons(orgId);
  } catch (err) {
    throw new BillingDataUnavailableError(
      "org_addons lookup failed",
      { cause: err },
    );
  }

  return {
    billingData: billingSettled.value,
    dbData: dbSettled.value,
    addonRows: Array.isArray(addonRows) ? addonRows : [],
  };
}
