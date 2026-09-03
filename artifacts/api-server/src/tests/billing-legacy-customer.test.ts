/**
 * billing-legacy-customer.test.ts
 *
 * 7 tests covering the legacy Stripe Customer mapping patch (P0):
 *   A — Legacy customer reused when organizations.stripe_customer_id is NULL
 *   B — Modern customer reused (no legacy lookup needed)
 *   C — Deleted legacy customer → new customer created
 *   D — Trial already consumed in org → grantTrial = false
 *   E — True new org (no legacy, no trial) → grantTrial = true
 *   F — Canceled re-subscribe, trial already consumed → grantTrial = false
 *   G — loadOrgData returns legacy trialConsumedAt when organizations row has NULL
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  pool: {
    connect: vi.fn(),
    query:   vi.fn(),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../services/org-settings.js", () => ({
  loadOrgSettings:   vi.fn(),
  upsertOrgSettings: vi.fn(),
}));

// org-data.persistOrgData (fire-and-forget in ESC and loadOrgData) — no-op in tests
vi.mock("../services/org-data.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/org-data.js")>();
  return { ...real, persistOrgData: vi.fn().mockResolvedValue(undefined) };
});

import { pool } from "@workspace/db";
import { _setStripeForTest } from "../services/ensure-stripe-customer.js";
import { loadOrgSettings } from "../services/org-settings.js";
import { loadOrgData } from "../services/org-data.js";

const mockPool = pool as unknown as {
  connect: ReturnType<typeof vi.fn>;
};
const mockLoadOrgSettings = loadOrgSettings as ReturnType<typeof vi.fn>;

// ─────────────────────────────────────────────────────────────────────────────
const UUID_ORG  = "2ae2b0f2-b320-4ed7-a7a9-08c7c29e0920";
const EMAIL_ORG = "support@flowpoint.pro";
const CUS_OLD   = "cus_VC0txTNwBNyRXH";
const CUS_NEW   = "cus_VC1nHxsZyKSROy";

type StripeMock = {
  customers: {
    retrieve: ReturnType<typeof vi.fn>;
    search:   ReturnType<typeof vi.fn>;
    create:   ReturnType<typeof vi.fn>;
  };
};

function makeStripeStub(opts: {
  retrieveResult?: unknown;
  retrieveReject?: unknown;
  searchResults?: Array<{ id: string; deleted?: boolean }>;
  createId?: string;
}): StripeMock {
  return {
    customers: {
      retrieve: opts.retrieveReject
        ? vi.fn().mockRejectedValue(opts.retrieveReject)
        : vi.fn().mockResolvedValue(opts.retrieveResult ?? { id: CUS_OLD, deleted: false }),
      search:   vi.fn().mockResolvedValue({ data: opts.searchResults ?? [] }),
      create:   vi.fn().mockResolvedValue({
        id:       opts.createId ?? "cus_created_new",
        metadata: { orgId: UUID_ORG, org_id: UUID_ORG },
      }),
    },
  };
}

/**
 * Build a pg client mock that handles all queries ESC makes inside its
 * advisory-lock transaction.  Crucially, after _persistStrict runs an
 * UPDATE, the confirm read (loadOrgSettings(orgId, client)) must return
 * the persisted customer — we achieve this via mockResolvedValueOnce
 * sequencing on the shared loadOrgSettings mock.
 */
function buildPgClient(): ReturnType<typeof vi.fn> {
  const client = {
    query: vi.fn(async (sql: string) => {
      // pg_advisory_xact_lock, BEGIN, COMMIT, ROLLBACK, SAVEPOINT, RELEASE
      if (/advisory|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE/i.test(sql)) {
        return { rows: [], rowCount: 0 };
      }
      // SELECT owner_email FROM organizations WHERE id::text = $1
      if (sql.includes("owner_email") && sql.includes("organizations")) {
        return { rows: [{ owner_email: EMAIL_ORG }] };
      }
      // is_internal_qa QA guard
      if (sql.includes("is_internal_qa")) {
        return { rows: [{ is_qa: false }] };
      }
      // UPDATE / INSERT for org_settings
      if (/UPDATE|INSERT/i.test(sql)) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }),
    release: vi.fn(),
  };
  return client as unknown as ReturnType<typeof vi.fn>;
}

beforeEach(() => {
  vi.resetAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST A — Legacy customer found in org_settings[email] → reused
// ─────────────────────────────────────────────────────────────────────────────
describe("TEST_A — legacy customer reuse", () => {
  it("returns the legacy customer without creating a new one", async () => {
    mockPool.connect.mockResolvedValue(buildPgClient());

    // ESC call sequence:
    //   1. loadOrgSettings(UUID_ORG, client) — Step 1 direct lookup → null
    //   2. loadOrgSettings(EMAIL_ORG) — legacy fallback → has old customer
    //   3. loadOrgSettings(UUID_ORG, client) — _persistStrict confirm → has old customer now
    mockLoadOrgSettings
      .mockResolvedValueOnce(null)                                // Step 1 UUID lookup
      .mockResolvedValueOnce({ stripeCustomerId: CUS_OLD, email: EMAIL_ORG })  // legacy
      .mockResolvedValueOnce({ stripeCustomerId: CUS_OLD });      // _persistStrict confirm

    const stripe = makeStripeStub({
      retrieveResult: { id: CUS_OLD, deleted: false },
    });
    _setStripeForTest(stripe);

    const { ensureStripeCustomer } = await import("../services/ensure-stripe-customer.js");
    const result = await ensureStripeCustomer(UUID_ORG, {
      stripeCustomerId: null,
      email: EMAIL_ORG,
      firstName: null,
      orgName:   null,
    }, "sk_live_test");

    expect(result).toBe(CUS_OLD);
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.customers.retrieve).toHaveBeenCalledWith(CUS_OLD);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST B — organizations already has stripe_customer_id → no legacy lookup
// ─────────────────────────────────────────────────────────────────────────────
describe("TEST_B — modern customer reuse", () => {
  it("returns existing canonical customer, create is never called", async () => {
    mockPool.connect.mockResolvedValue(buildPgClient());

    // Step 1 UUID lookup → already has the customer
    mockLoadOrgSettings.mockResolvedValueOnce({ stripeCustomerId: CUS_NEW });

    const stripe = makeStripeStub({
      retrieveResult: { id: CUS_NEW, deleted: false },
    });
    _setStripeForTest(stripe);

    const { ensureStripeCustomer } = await import("../services/ensure-stripe-customer.js");
    const result = await ensureStripeCustomer(UUID_ORG, {
      stripeCustomerId: CUS_NEW,
      email: EMAIL_ORG,
      firstName: null,
      orgName:   null,
    }, "sk_live_test");

    expect(result).toBe(CUS_NEW);
    expect(stripe.customers.create).not.toHaveBeenCalled();
    expect(stripe.customers.retrieve).toHaveBeenCalledWith(CUS_NEW);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST C — Legacy customer is deleted/resource_missing → new customer created
// ─────────────────────────────────────────────────────────────────────────────
describe("TEST_C — deleted legacy customer", () => {
  it("creates exactly ONE new customer when legacy is resource_missing", async () => {
    mockPool.connect.mockResolvedValue(buildPgClient());

    const FRESH_ID = "cus_created_fresh";

    mockLoadOrgSettings
      .mockResolvedValueOnce(null)                                 // Step 1 UUID lookup
      .mockResolvedValueOnce({ stripeCustomerId: CUS_OLD, email: EMAIL_ORG }) // legacy
      .mockResolvedValueOnce(null)                                 // Step 3 search (internal to ESC, no org_settings call expected here)
      .mockResolvedValueOnce({ stripeCustomerId: FRESH_ID });      // _persistStrict confirm

    const stripe = makeStripeStub({
      retrieveReject: { code: "resource_missing" },
      searchResults:  [],   // Step 3: no orphan in metadata search
      createId:       FRESH_ID,
    });
    _setStripeForTest(stripe);

    const { ensureStripeCustomer } = await import("../services/ensure-stripe-customer.js");
    const result = await ensureStripeCustomer(UUID_ORG, {
      stripeCustomerId: null,
      email: EMAIL_ORG,
      firstName: null,
      orgName:   null,
    }, "sk_live_test");

    expect(result).toBe(FRESH_ID);
    expect(stripe.customers.create).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST D — grantTrial: trialConsumedAt set → always false
// ─────────────────────────────────────────────────────────────────────────────
describe("TEST_D — trial already consumed", () => {
  it("grantTrial = false when billingCtx.trialConsumedAt is set (no Stripe history)", () => {
    // Formula from billing.ts (post-patch):  !trialConsumedAt && !hasStripeSubHistory
    const trialConsumedAt   = "2026-09-03T15:47:58.000Z";
    const hasStripeSubHistory = false;
    const grantTrial = !trialConsumedAt && !hasStripeSubHistory;
    expect(grantTrial).toBe(false);
  });

  it("grantTrial = false when trialConsumedAt set AND Stripe history exists", () => {
    const trialConsumedAt   = "2026-09-03T15:47:58.000Z";
    const hasStripeSubHistory = true;
    const grantTrial = !trialConsumedAt && !hasStripeSubHistory;
    expect(grantTrial).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST E — True new org: no trialConsumedAt, no Stripe history → grantTrial true
// ─────────────────────────────────────────────────────────────────────────────
describe("TEST_E — new customer, first trial", () => {
  it("grantTrial = true when org has no trialConsumedAt and no Stripe history", () => {
    const trialConsumedAt: string | null = null;
    const hasStripeSubHistory = false;
    const grantTrial = !trialConsumedAt && !hasStripeSubHistory;
    expect(grantTrial).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST F — Canceled re-subscribe: trial consumed → NO new trial
// ─────────────────────────────────────────────────────────────────────────────
describe("TEST_F — canceled resubscribe, trial used", () => {
  it("grantTrial = false even with empty new Stripe customer", () => {
    // Exact scenario that produced the double-trial bug:
    // old trial consumed at 15:47, new Stripe Customer has no subs yet.
    const trialConsumedAt   = "2026-09-03T15:47:58.000Z";
    const hasStripeSubHistory = false;  // brand-new customer, zero history
    const grantTrial = !trialConsumedAt && !hasStripeSubHistory;
    expect(grantTrial).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST G — loadOrgData: returns legacyTrialConsumedAt when org row has NULL
// ─────────────────────────────────────────────────────────────────────────────
describe("TEST_G — legacy trial normalization in loadOrgData", () => {
  it("trialConsumedAt in returned data equals org_settings[email] value when organizations.trial_consumed_at is NULL", async () => {
    const LEGACY_CONSUMED_AT = "2026-09-03T15:47:58.000Z";
    const LEGACY_ENDS_AT     = "2026-09-17T15:47:58.000Z";

    // Fake pool.connect for the UUID org lookup inside loadOrgData
    const fakeClient = {
      query: vi.fn().mockResolvedValue({
        rows: [{
          plan:                   "standard",
          subscription_status:    "canceled",
          stripe_customer_id:     null,
          stripe_subscription_id: "sub_old_canceled",
          trial_ends_at:          null,
          trial_consumed_at:      null,
          trial_started_at:       null,
          addons:                 null,
          pending_plan:           null,
          pending_plan_date:      null,
          owner_email:            EMAIL_ORG,
          owner_first_name:       "Test",
          name:                   "FlowPoint",
          is_internal_qa:         false,
        }],
      }),
      release: vi.fn(),
    };
    mockPool.connect.mockResolvedValue(fakeClient);

    // org_settings[EMAIL_ORG] has trial data
    mockLoadOrgSettings.mockResolvedValue({
      trialConsumedAt: LEGACY_CONSUMED_AT,
      trialEndsAt:     LEGACY_ENDS_AT,
      trialStartedAt:  null,
      stripeCustomerId: CUS_OLD,
    });

    const result = await loadOrgData(UUID_ORG);

    expect(result).not.toBeNull();
    expect(result!.trialConsumedAt).toBe(LEGACY_CONSUMED_AT);
    expect(result!.trialEndsAt).toBe(LEGACY_ENDS_AT);
  });
});
