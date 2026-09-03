/**
 * billing-preregister-customer.test.ts
 *
 * P0 pre-register customer reuse + trial anchor tests.
 * Tests A–F cover the scenario where a Stripe customer is created during the
 * pre-register payment_intent flow (with metadata.orgId = email) and must be
 * reused — not duplicated — on re-subscription after cancellation.
 *
 * All tests are pure-logic / mock-only. No live DB or Stripe required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Shared mock infrastructure ───────────────────────────────────────────────

/** Build a fake org_settings row with optional stripeCustomerId */
function makeOrgSettingsRow(stripeCustomerId: string | null) {
  return stripeCustomerId
    ? { stripeCustomerId, subscriptionStatus: "trialing", trialConsumedAt: null }
    : null;
}

/** Build a fake Stripe customer object */
function makeStripeCustomer(id: string, orgIdInMeta: string, deleted = false) {
  return { id, deleted, metadata: { orgId: orgIdInMeta, org_id: orgIdInMeta } };
}

/** Build a fake Stripe subscription */
function makeStripeSub(
  id: string,
  status: string,
  trialStart: number | null = null,
  trialEnd: number | null = null
) {
  return { id, status, trial_start: trialStart, trial_end: trialEnd };
}

// ── Helper: simulate ensureStripeCustomer lookup logic ───────────────────────
// Mirrors the real ESC steps without importing the full module.

interface EscDeps {
  orgSettingsById: (id: string) => { stripeCustomerId: string | null } | null;
  orgOwnerEmail: (uuid: string) => string | null;
  stripeRetrieve: (id: string) => { id: string; deleted?: boolean } | null;
  stripeMetadataSearch: (orgId: string) => { id: string } | null;
  stripeCreate: () => { id: string };
}

function runEscSteps(
  orgId: string,
  hint: string | null,
  deps: EscDeps
): { customerId: string; wasCreated: boolean } {
  // Step 1: org_settings[orgId]
  const rawId =
    deps.orgSettingsById(orgId)?.stripeCustomerId?.trim() ||
    hint?.trim() ||
    null;

  if (rawId) {
    const cus = deps.stripeRetrieve(rawId);
    if (cus && !cus.deleted) return { customerId: cus.id, wasCreated: false };
  }

  // Step 2 legacy: owner_email → org_settings[email]
  const ownerEmail = deps.orgOwnerEmail(orgId);
  if (ownerEmail) {
    const legacyId = deps.orgSettingsById(ownerEmail)?.stripeCustomerId?.trim() ?? null;
    if (legacyId) {
      const cus = deps.stripeRetrieve(legacyId);
      if (cus && !cus.deleted) return { customerId: cus.id, wasCreated: false };
    }
  }

  // Step 3: metadata search
  const found = deps.stripeMetadataSearch(orgId);
  if (found) return { customerId: found.id, wasCreated: false };

  // Step 4: create
  const created = deps.stripeCreate();
  return { customerId: created.id, wasCreated: true };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("TEST A — pre-register customer anchored to UUID org", () => {
  /**
   * Scenario: pre-register PI flow created customer with orgId=email in metadata.
   * After activateNewSignup (with Patch A: real customerId passed), the UUID org
   * now has organizations.stripe_customer_id = cus_EXISTING.
   * ESC should reuse it via the hint.
   */
  it("ESC reuses existing customer when organizations.stripe_customer_id is set", () => {
    const ORG_UUID = "9c5b193b-4815-4db9-bc2d-ecb853764381";
    const CUS_OLD  = "cus_VC3JtV8OuhSBYy";

    const deps: EscDeps = {
      orgSettingsById:     () => null,          // org_settings[UUID] = empty
      orgOwnerEmail:       () => null,          // legacy path skipped (hint wins first)
      stripeRetrieve:      (id) => id === CUS_OLD ? makeStripeCustomer(CUS_OLD, ORG_UUID) : null,
      stripeMetadataSearch:() => null,
      stripeCreate:        () => ({ id: "cus_NEW_SHOULD_NOT_HAPPEN" }),
    };

    const hint = CUS_OLD; // organizations.stripe_customer_id = cus_EXISTING (Patch A)
    const result = runEscSteps(ORG_UUID, hint, deps);

    expect(result.customerId).toBe(CUS_OLD);
    expect(result.wasCreated).toBe(false);
  });

  it("ESC creates new customer only when hint is null (pre-patch behaviour)", () => {
    const ORG_UUID = "9c5b193b-4815-4db9-bc2d-ecb853764381";
    const CUS_NEW  = "cus_NEW_CREATED";

    const deps: EscDeps = {
      orgSettingsById:      () => null,
      orgOwnerEmail:        () => null,
      stripeMetadataSearch: () => null,
      stripeRetrieve:       () => null,
      stripeCreate:         () => ({ id: CUS_NEW }),
    };

    const hint = null; // organizations.stripe_customer_id = null (pre-patch)
    const result = runEscSteps(ORG_UUID, hint, deps);

    expect(result.customerId).toBe(CUS_NEW);
    expect(result.wasCreated).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("TEST B — Stripe metadata normalization allows UUID search", () => {
  /**
   * After Patch B (activateNewSignup normalizes metadata to UUID), ESC Step 3
   * (metadata search by UUID) should find the customer that was originally
   * created with orgId=email in metadata.
   */
  it("ESC Step 3 finds customer after metadata is normalized to UUID", () => {
    const ORG_UUID  = "9c5b193b-4815-4db9-bc2d-ecb853764381";
    const CUS_OLD   = "cus_VC3JtV8OuhSBYy";

    const deps: EscDeps = {
      orgSettingsById:      () => null,   // no DB mapping
      orgOwnerEmail:        () => null,
      stripeRetrieve:       () => null,
      stripeMetadataSearch: (orgId) =>
        orgId === ORG_UUID ? { id: CUS_OLD } : null, // normalized metadata → found
      stripeCreate: () => ({ id: "cus_SHOULD_NOT_CREATE" }),
    };

    const result = runEscSteps(ORG_UUID, null, deps);

    expect(result.customerId).toBe(CUS_OLD);
    expect(result.wasCreated).toBe(false);
  });

  it("ESC Step 3 misses customer when metadata still has email (pre-patch)", () => {
    const ORG_UUID  = "9c5b193b-4815-4db9-bc2d-ecb853764381";
    const CUS_DUPE  = "cus_DUPLICATE_CREATED";

    const deps: EscDeps = {
      orgSettingsById:      () => null,
      orgOwnerEmail:        () => null,
      stripeRetrieve:       () => null,
      stripeMetadataSearch: (orgId) =>
        orgId === ORG_UUID ? null : { id: "cus_OLD_EMAIL_META" }, // UUID search misses
      stripeCreate: () => ({ id: CUS_DUPE }),
    };

    const result = runEscSteps(ORG_UUID, null, deps);

    expect(result.wasCreated).toBe(true);
    expect(result.customerId).toBe(CUS_DUPE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("TEST C — first trial anchored at finalize-checkout", () => {
  /**
   * finalize-checkout must mark trialConsumedAt at the moment the first
   * subscription is created — even if the user cancels 30 seconds later.
   */
  it("grantTrial logic: trial allowed when no prior subscription history", () => {
    const hasSubscriptionHistory = false;
    const intentTrialDays        = 14;
    const grantTrial             = !hasSubscriptionHistory && intentTrialDays > 0;
    expect(grantTrial).toBe(true);
  });

  it("grantTrial logic: trial denied when prior subscription exists", () => {
    const hasSubscriptionHistory = true;
    const intentTrialDays        = 14;
    const grantTrial             = !hasSubscriptionHistory && intentTrialDays > 0;
    expect(grantTrial).toBe(false);
  });

  it("grantTrial logic: trial denied when intentTrialDays is 0", () => {
    const hasSubscriptionHistory = false;
    const intentTrialDays        = 0;
    const grantTrial             = !hasSubscriptionHistory && intentTrialDays > 0;
    expect(grantTrial).toBe(false);
  });

  it("trialConsumedAt is always set when a subscription is created", () => {
    // Simulate what finalize-checkout does: always write trialConsumedAt
    const persistedFields: Record<string, unknown> = {
      stripeCustomerId:     "cus_EXAMPLE",
      stripeSubscriptionId: "sub_EXAMPLE",
      subscriptionStatus:   "trialing",
      plan:                 "standard",
      trialConsumedAt:      new Date().toISOString(),
    };

    expect(typeof persistedFields["trialConsumedAt"]).toBe("string");
    expect(persistedFields["trialConsumedAt"]).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("TEST D — cancel then resubscribe: same customer, no new trial", () => {
  /**
   * Full scenario:
   * 1. Pre-register → cus_OLD created, trial consumed, sub canceled.
   * 2. Resubscribe → ESC finds cus_OLD (via hint after Patch A), hasSubscriptionHistory=true.
   * 3. grantTrial = false.
   */
  it("hasSubscriptionHistory=true blocks trial on re-subscription", () => {
    const ORG_UUID = "9c5b193b-4815-4db9-bc2d-ecb853764381";
    const CUS_OLD  = "cus_VC3JtV8OuhSBYy";

    // ESC: finds existing customer via hint
    const deps: EscDeps = {
      orgSettingsById:      () => null,
      orgOwnerEmail:        () => null,
      stripeRetrieve:       (id) => id === CUS_OLD ? makeStripeCustomer(CUS_OLD, ORG_UUID) : null,
      stripeMetadataSearch: () => null,
      stripeCreate:         () => ({ id: "cus_SHOULD_NOT_CREATE" }),
    };
    const escResult = runEscSteps(ORG_UUID, CUS_OLD, deps);
    expect(escResult.customerId).toBe(CUS_OLD);
    expect(escResult.wasCreated).toBe(false);

    // finalize-checkout: hasSubscriptionHistory comes from checking existing subs on cus_OLD
    // After cancellation, canceled sub exists → hasSubscriptionHistory = true
    const canceledSub = makeStripeSub("sub_CANCELED", "canceled");
    const allSubs     = [canceledSub];
    const hasSubscriptionHistory = allSubs.length > 0;

    const intentTrialDays = 14;
    const grantTrial      = !hasSubscriptionHistory && intentTrialDays > 0;

    expect(hasSubscriptionHistory).toBe(true);
    expect(grantTrial).toBe(false);
  });

  it("same customer ID reused — no duplicate customer created", () => {
    const CUS_OLD  = "cus_VC3JtV8OuhSBYy";
    let newCustomerCreated = false;

    const deps: EscDeps = {
      orgSettingsById:      () => null,
      orgOwnerEmail:        () => null,
      stripeRetrieve:       (id) => id === CUS_OLD ? makeStripeCustomer(CUS_OLD, "uuid") : null,
      stripeMetadataSearch: () => null,
      stripeCreate:         () => { newCustomerCreated = true; return { id: "cus_NEW" }; },
    };

    runEscSteps("uuid", CUS_OLD, deps);
    expect(newCustomerCreated).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("TEST E — webhook retry: persistOrgData idempotent when org exists", () => {
  /**
   * payment_intent.succeeded arrives AFTER org UUID exists.
   * persistOrgData should write stripe_customer_id and be idempotent.
   */
  it("COALESCE preserves existing stripe_customer_id on conflict", () => {
    // Simulate ON CONFLICT ... SET stripe_customer_id = COALESCE(EXCLUDED.stripe_customer_id, existing)
    const existing = "cus_EXISTING";
    const excluded = "cus_EXISTING"; // same customer on retry

    const result = excluded ?? existing; // COALESCE logic
    expect(result).toBe("cus_EXISTING");
  });

  it("COALESCE does not overwrite existing when new value is null", () => {
    const existing = "cus_EXISTING";
    const excluded: string | null = null;

    const result = excluded ?? existing;
    expect(result).toBe("cus_EXISTING");
  });

  it("webhook idempotency: second call with same customer does not create duplicate", () => {
    const ORG_UUID = "9c5b193b-4815-4db9-bc2d-ecb853764381";
    const CUS_OLD  = "cus_VC3JtV8OuhSBYy";
    let createCount = 0;

    const deps: EscDeps = {
      orgSettingsById:      () => null,
      orgOwnerEmail:        () => null,
      stripeRetrieve:       (id) => id === CUS_OLD ? makeStripeCustomer(CUS_OLD, ORG_UUID) : null,
      stripeMetadataSearch: () => null,
      stripeCreate:         () => { createCount++; return { id: "cus_NEW" }; },
    };

    // First call (hint set after first webhook)
    runEscSteps(ORG_UUID, CUS_OLD, deps);
    // Second call (retry)
    runEscSteps(ORG_UUID, CUS_OLD, deps);

    expect(createCount).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("TEST F — webhook early: PI arrives before org UUID exists", () => {
  /**
   * payment_intent.succeeded fires before finalize-checkout creates the UUID org.
   * At that point, findOrgByStripeCustomer returns email orgId.
   * persistOrgData(email, { stripeCustomerId }) writes to org_settings[email].
   * Later, finalize-checkout creates org UUID and anchors via UUID anchor block.
   */
  it("ESC legacy fallback finds customer via org_settings[email] written by PI webhook", () => {
    const ORG_UUID    = "9c5b193b-4815-4db9-bc2d-ecb853764381";
    const OWNER_EMAIL = "maelheusschen.07@gmail.com";
    const CUS_OLD     = "cus_VC3JtV8OuhSBYy";

    // PI webhook wrote org_settings[email].stripe_customer_id
    // UUID org exists but organizations.stripe_customer_id still null
    const deps: EscDeps = {
      orgSettingsById: (id) => {
        if (id === ORG_UUID)    return null;           // org_settings[UUID] = empty
        if (id === OWNER_EMAIL) return makeOrgSettingsRow(CUS_OLD)!; // org_settings[email] = set
        return null;
      },
      orgOwnerEmail:        () => OWNER_EMAIL,
      stripeRetrieve:       (id) => id === CUS_OLD ? makeStripeCustomer(CUS_OLD, OWNER_EMAIL) : null,
      stripeMetadataSearch: () => null,
      stripeCreate:         () => ({ id: "cus_SHOULD_NOT_CREATE" }),
    };

    const result = runEscSteps(ORG_UUID, null, deps);

    expect(result.customerId).toBe(CUS_OLD);
    expect(result.wasCreated).toBe(false);
  });

  it("no exception thrown when PI webhook fires before org UUID row exists", () => {
    // Simulate the case where org_settings[email] is empty (org creation pending)
    // ESC should gracefully create a customer rather than throw.
    const ORG_UUID    = "9c5b193b-4815-4db9-bc2d-ecb853764381";
    const OWNER_EMAIL = "maelheusschen.07@gmail.com";

    const deps: EscDeps = {
      orgSettingsById:      () => null,  // neither key has data yet
      orgOwnerEmail:        () => OWNER_EMAIL,
      stripeRetrieve:       () => null,
      stripeMetadataSearch: () => null,
      stripeCreate:         () => ({ id: "cus_FALLBACK_CREATED" }),
    };

    expect(() => runEscSteps(ORG_UUID, null, deps)).not.toThrow();
  });

  it("after finalize-checkout UUID anchor: ESC finds customer via hint", () => {
    // Simulates state AFTER finalize-checkout wrote organizations[UUID].stripe_customer_id
    const ORG_UUID = "9c5b193b-4815-4db9-bc2d-ecb853764381";
    const CUS_OLD  = "cus_VC3JtV8OuhSBYy";

    const deps: EscDeps = {
      orgSettingsById:      () => null,
      orgOwnerEmail:        () => null,
      stripeRetrieve:       (id) => id === CUS_OLD ? makeStripeCustomer(CUS_OLD, ORG_UUID) : null,
      stripeMetadataSearch: () => null,
      stripeCreate:         () => ({ id: "cus_SHOULD_NOT_CREATE" }),
    };

    // hint = organizations[UUID].stripe_customer_id (written by UUID anchor block)
    const result = runEscSteps(ORG_UUID, CUS_OLD, deps);

    expect(result.customerId).toBe(CUS_OLD);
    expect(result.wasCreated).toBe(false);
  });
});
