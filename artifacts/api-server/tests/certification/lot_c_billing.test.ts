/**
 * Lot C — Billing runtime integration tests T1-T23
 *
 * Runs an in-process Express server with the real billing router so that
 * setStripeForTesting() can inject a fake Stripe recorder.
 * Uses the real Supabase DB for org state and sessions.
 * ZERO calls to Stripe Live — the fake recorder fails loudly on unplanned calls.
 *
 * Run: cd artifacts/api-server && pnpm tsx tests/certification/lot_c_billing.test.ts
 */

import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express, { type Request, type Response, type NextFunction } from "express";
import cookieParser from "cookie-parser";
import { pool } from "@workspace/db";
import { orgContext } from "../../src/middlewares/orgContext.js";
import billingRouter from "../../src/routes/billing.js";
import { setStripeForTesting } from "../../src/services/stripe-factory.js";
import { upsertOrgSettings } from "../../src/services/org-settings.js";
import { createSession } from "../../src/services/sessions.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

const RUN_ID = `lc_${Date.now()}`;

function orgId(tag: string) { return `${RUN_ID}_${tag}`; }

async function makeSession(tag: string, role = "owner"): Promise<string> {
  const oid = orgId(tag);
  const uid = `usr_${tag}`;
  return createSession({ userId: uid, orgId: oid, email: `${tag}@test.invalid`, role });
}

/**
 * subscription_status is NOT NULL (DEFAULT 'trialing') in the DB.
 * 'canceled' is used here to represent "no active subscription" — it is the
 * only stock Stripe status that is (a) not null, (b) not 'active'/'trialing',
 * so it passes the checkout guard without a real Stripe subscription.
 */
async function createFreshOrg(tag: string, extraSql?: Record<string, unknown>) {
  const oid = orgId(tag);
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO org_settings (org_id, subscription_status, plan, trial_ends_at)
       VALUES ($1, 'canceled', 'standard', NULL)
       ON CONFLICT (org_id) DO UPDATE
         SET subscription_status = 'canceled',
             plan                = 'standard',
             trial_ends_at       = NULL`,
      [oid]
    );
    if (extraSql) {
      const cols = Object.keys(extraSql);
      const vals = Object.values(extraSql);
      const sets = cols.map((c, i) => `${c} = $${i + 2}`).join(", ");
      await client.query(
        `UPDATE org_settings SET ${sets} WHERE org_id = $1`,
        [oid, ...vals]
      );
    }
  } finally { client.release(); }
}

async function cleanup(tags: string[]) {
  const ids = tags.map(t => orgId(t));
  const client = await pool.connect();
  try {
    await client.query(`DELETE FROM org_settings  WHERE org_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM org_addons    WHERE org_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM user_sessions WHERE org_id = ANY($1)`, [ids]);
    await client.query(`DELETE FROM organizations WHERE id     = ANY($1)`, [ids]);
  } catch { /* non-fatal */ } finally { client.release(); }
}

// ─── fake Stripe builder ──────────────────────────────────────────────────────

interface StripeCallLog { [path: string]: unknown[][] }

interface FakeStripeOptions {
  activeSubs?: boolean;               // subscriptions.list(status:'active') returns a sub
  trialingSubs?: boolean;             // subscriptions.list(status:'trialing') returns a sub
  subHistory?: boolean;               // subscriptions.list(status:'all') returns a sub
  addonActiveInSub?: boolean;         // addon price found in existing subscription items
  openReactivationSession?: boolean;  // checkout.sessions.list returns an open reactivation session
  allowSubUpdate?: boolean;           // subscriptions.update resolves (for upgrade-path tests)
  orphanedCustomer?: boolean;         // checkout.sessions.list throws resource_missing (deleted customer)
}

function makeFakeStripe(opts: FakeStripeOptions = {}) {
  const log: StripeCallLog = {};
  const rec = (path: string) => (arg?: unknown) => {
    (log[path] ??= []).push([arg]);
    return Promise.reject(new Error(`[FakeStripe] Unexpected call to ${path} — add it to the planned fake`));
  };

  return {
    log,
    callCount(path: string) { return (log[path] ?? []).length; },
    lastCallArg(path: string) { return (log[path] ?? []).at(-1)?.[0]; },

    customers: {
      create(params: unknown) {
        (log["customers.create"] ??= []).push([params]);
        return Promise.resolve({ id: "cus_fake_test" });
      },
    },

    subscriptions: {
      list(params: Record<string, unknown>) {
        (log["subscriptions.list"] ??= []).push([params]);
        const { status } = params;
        if (status === "active" && opts.activeSubs) {
          return Promise.resolve({
            data: [{ id: "sub_active", items: { data: [] }, current_period_end: 9999999999, status: "active" }],
          });
        }
        if (status === "trialing" && opts.trialingSubs) {
          return Promise.resolve({ data: [{ id: "sub_trial", status: "trialing" }] });
        }
        if (status === "all" && opts.subHistory) {
          return Promise.resolve({ data: [{ id: "sub_old" }] });
        }
        return Promise.resolve({ data: [] });
      },
      update: opts.allowSubUpdate
        ? (params: unknown) => {
            (log["subscriptions.update"] ??= []).push([params]);
            return Promise.resolve({ id: "sub_updated", status: "active", items: { data: [] } });
          }
        : rec("subscriptions.update"),
      cancel: rec("subscriptions.cancel"),
    },

    checkout: {
      sessions: {
        create(params: unknown, opts?: unknown) {
          // Log both the session params and the Stripe request options (idempotencyKey lives here)
          (log["checkout.sessions.create"] ??= []).push([params, opts]);
          return Promise.resolve({
            url:  "https://checkout.stripe.com/c/pay/fake_session",
            id:   "cs_fake",
            client_secret: "cs_secret_fake",
          });
        },
        retrieve: rec("checkout.sessions.retrieve"),
        list(params: unknown) {
          (log["checkout.sessions.list"] ??= []).push([params]);
          if (opts.orphanedCustomer) {
            // Simulate Stripe resource_missing: customer was deleted from Stripe
            const err = Object.assign(new Error("No such customer: 'cus_orphan_test'"), {
              code:    "resource_missing",
              type:    "invalid_request_error",
              statusCode: 404,
            });
            return Promise.reject(err);
          }
          if (opts.openReactivationSession) {
            return Promise.resolve({
              data: [{
                id:  "cs_open_reactivation",
                url: "https://checkout.stripe.com/c/pay/existing_session",
                metadata: { reactivation: "true", targetPlan: "pro", plan: "pro" },
              }],
            });
          }
          return Promise.resolve({ data: [] });
        },
      },
    },

    billingPortal: { sessions: { create: rec("billingPortal.sessions.create") } },
    webhooks:      { constructEvent: rec("webhooks.constructEvent") },
  };
}

// ─── test server ─────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  // For the webhook endpoint the handler reads req.rawBody ?? req.body.
  // express.json() parses to an object whose .toString() is "[object Object]".
  // Using express.text() on that path makes req.body a string so JSON.parse works.
  app.use("/api/billing/webhook", express.text({ type: "application/json" }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(orgContext);
  // Stub req.orgDb so usage-details doesn't throw if accidentally hit
  app.use((_req: Request & { orgDb?: unknown }, _res: Response, next: NextFunction) => {
    (_req as Request & { orgDb: unknown }).orgDb = () => Promise.resolve({ rows: [] });
    next();
  });
  app.use("/api", billingRouter);
  return app;
}

async function startServer(): Promise<{ server: Server; base: string }> {
  const server = createServer(buildApp());
  server.listen(0);
  await once(server, "listening");
  const addr = server.address() as { port: number };
  return { server, base: `http://127.0.0.1:${addr.port}/api` };
}

function stopServer(server: Server): Promise<void> {
  return new Promise(resolve => server.close(() => resolve()));
}

function post(base: string, path: string, token: string, body: unknown) {
  return fetch(`${base}${path}`, {
    method:  "POST",
    headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
}

// ─── assertions ──────────────────────────────────────────────────────────────

let passed = 0; let failed = 0;
const results: string[] = [];

function assert(name: string, condition: boolean, detail = "") {
  if (condition) { passed++; results.push(`  ✅ ${name}`); }
  else           { failed++; results.push(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

// ─── TESTS ───────────────────────────────────────────────────────────────────

async function runTests() {
  const { server, base } = await startServer();
  const tags: string[] = [];

  // The production guard in setStripeForTesting() must not fire during the test
  // runner itself.  We save the current NODE_ENV (which may be "production" on
  // Render) and restore it after all tests.  T11 will temporarily override it
  // back to "production" to verify the guard, then restore to "test".
  const originalNodeEnv = process.env["NODE_ENV"];
  process.env["NODE_ENV"] = "test";

  try {
    // Set fake Stripe price IDs so buildLineItems returns a non-empty array
    // (prevents the early mock exit that happens when no price IDs are configured)
    process.env["STRIPE_PRICE_PRO"] = "price_fake_pro_lc";
    // Ensure stripeKey check sees a key (for T5/T6 where Stripe is involved)
    process.env["STRIPE_SECRET_KEY"] = process.env["STRIPE_SECRET_KEY"] || "sk_test_lc_fake";

    // ── T1: active subscription → checkout blocked ──────────────────────────
    console.log("\n[T1] Active sub → POST /billing/checkout → 409");
    {
      const tag = "t1"; tags.push(tag);
      await upsertOrgSettings(orgId(tag), { subscriptionStatus: "active" });
      const token = await makeSession(tag);

      setStripeForTesting(null); // no fake — guard must fire before any Stripe call

      const r = await post(base, "/billing/checkout", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T1 status 409", r.status === 409, `got ${r.status}`);
      assert("T1 error code", body["error"] === "subscription_already_active", String(body["error"]));
      assert("T1 redirectTo present", typeof body["redirectTo"] === "string");
    }

    // ── T2: trialing subscription → checkout blocked ────────────────────────
    console.log("[T2] Trialing sub → POST /billing/checkout → 409");
    {
      const tag = "t2"; tags.push(tag);
      await upsertOrgSettings(orgId(tag), { subscriptionStatus: "trialing" });
      const token = await makeSession(tag);

      setStripeForTesting(null);

      const r = await post(base, "/billing/checkout", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T2 status 409", r.status === 409, `got ${r.status}`);
      assert("T2 error code", body["error"] === "subscription_already_active", String(body["error"]));
    }

    // ── T3: same plan already active → upgrade blocked ──────────────────────
    console.log("[T3] Same plan active → POST /billing/upgrade → 409");
    {
      const tag = "t3"; tags.push(tag);
      await upsertOrgSettings(orgId(tag), { plan: "pro", subscriptionStatus: "active" });
      const token = await makeSession(tag, "owner");

      setStripeForTesting(null);

      const r = await post(base, "/billing/upgrade", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T3 status 409", r.status === 409, `got ${r.status}`);
      assert("T3 error code", body["error"] === "plan_already_active", String(body["error"]));
    }

    // ── T4: addon already active (DB state, no Stripe key/customerId) ────────
    console.log("[T4] Addon active in DB → POST /billing/addon-checkout → 409");
    {
      const tag = "t4"; tags.push(tag);
      await createFreshOrg(tag); // subscription_status=NULL, no stripeCustomerId → DB path
      // Insert addon as active in org_addons
      const client = await pool.connect();
      try {
        await client.query(
          `INSERT INTO org_addons (id, org_id, addon_key, active, created_at, updated_at)
           VALUES ($1, $2, 'whiteLabel', true, NOW(), NOW())
           ON CONFLICT (id) DO UPDATE SET active = true`,
          [`oa_${orgId(tag)}_wl`, orgId(tag)]
        );
      } finally { client.release(); }
      const token = await makeSession(tag);

      // Clear Stripe key to force DB-state check path
      const savedKey = process.env["STRIPE_LIVE_API_KEY"];
      const savedSkKey = process.env["STRIPE_SECRET_KEY"];
      delete process.env["STRIPE_LIVE_API_KEY"];
      delete process.env["STRIPE_SECRET_KEY"];
      setStripeForTesting(null);

      const r = await post(base, "/billing/addon-checkout", token, { addonKey: "whiteLabel", addonName: "White-Label" });
      const body = await r.json() as Record<string, unknown>;

      // Restore env
      if (savedKey) process.env["STRIPE_LIVE_API_KEY"] = savedKey;
      if (savedSkKey) process.env["STRIPE_SECRET_KEY"] = savedSkKey;

      assert("T4 status 409", r.status === 409, `got ${r.status}`);
      assert("T4 error code", body["error"] === "addon_already_active", String(body["error"]));
    }

    // ── T5: old trial → trial_period_days NOT sent to Stripe ────────────────
    console.log("[T5] Org has prior trial → trial_period_days must be absent");
    {
      const tag = "t5"; tags.push(tag);
      const pastTrialEnd = new Date(Date.now() - 30 * 86400_000).toISOString();
      await createFreshOrg(tag, { trial_ends_at: pastTrialEnd });
      const token = await makeSession(tag);

      const fakeStripe = makeFakeStripe({ activeSubs: false, trialingSubs: false, subHistory: true /* had one before */ });
      setStripeForTesting(fakeStripe);

      const r = await post(base, "/billing/checkout", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      const createCall = fakeStripe.lastCallArg("checkout.sessions.create") as Record<string, unknown> | undefined;
      const subData    = createCall?.["subscription_data"] as Record<string, unknown> | undefined;

      assert("T5 status 200",            r.status === 200, `got ${r.status}`);
      assert("T5 Stripe create called",   fakeStripe.callCount("checkout.sessions.create") === 1,
             `calls=${fakeStripe.callCount("checkout.sessions.create")}`);
      assert("T5 trial_period_days absent", !subData?.["trial_period_days"],
             `subData=${JSON.stringify(subData)}`);
      assert("T5 subscriptions.list called for 'all'",
             (fakeStripe.log["subscriptions.list"] ?? []).some(
               (c: unknown[]) => (c[0] as Record<string, unknown>)["status"] === "all"
             ));

      setStripeForTesting(null);
    }

    // ── T6: first-time subscriber → trial_period_days: 14 sent to Stripe ────
    console.log("[T6] First-time org → trial_period_days:14 must be present");
    {
      const tag = "t6"; tags.push(tag);
      // No trial_ends_at, no stripeCustomerId
      await createFreshOrg(tag);
      const token = await makeSession(tag);

      const fakeStripe = makeFakeStripe({ activeSubs: false, trialingSubs: false, subHistory: false });
      setStripeForTesting(fakeStripe);

      const r = await post(base, "/billing/checkout", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      const createCall = fakeStripe.lastCallArg("checkout.sessions.create") as Record<string, unknown> | undefined;
      const subData    = createCall?.["subscription_data"] as Record<string, unknown> | undefined;

      assert("T6 status 200",             r.status === 200, `got ${r.status}`);
      assert("T6 Stripe create called",    fakeStripe.callCount("checkout.sessions.create") === 1,
             `calls=${fakeStripe.callCount("checkout.sessions.create")}`);
      assert("T6 trial_period_days is 14", subData?.["trial_period_days"] === 14,
             `got ${subData?.["trial_period_days"]}`);
      assert("T6 customers.create called", fakeStripe.callCount("customers.create") === 1,
             `calls=${fakeStripe.callCount("customers.create")}`);

      setStripeForTesting(null);
    }

    // ── T7: isolation A→B — org A (active) blocked, org B (fresh) allowed ───
    console.log("[T7] Isolation: org A active → 409, org B fresh → 200");
    {
      const tagA = "t7a"; const tagB = "t7b";
      tags.push(tagA, tagB);
      await upsertOrgSettings(orgId(tagA), { subscriptionStatus: "active" });
      await createFreshOrg(tagB);
      const [tokenA, tokenB] = await Promise.all([makeSession(tagA), makeSession(tagB)]);

      setStripeForTesting(null);

      const [rA, rB] = await Promise.all([
        post(base, "/billing/checkout", tokenA, { plan: "pro" }),
        post(base, "/billing/checkout", tokenB, { plan: "pro" }),
      ]);

      assert("T7 orgA → 409", rA.status === 409, `got ${rA.status}`);
      assert("T7 orgB → 200", rB.status === 200, `got ${rB.status}`);
    }

    // ── T8: isolation B→A — reverse of T7 ───────────────────────────────────
    console.log("[T8] Isolation B→A — reverse verification");
    {
      const tagA = "t8a"; const tagB = "t8b";
      tags.push(tagA, tagB);
      await upsertOrgSettings(orgId(tagA), { subscriptionStatus: "active" });
      await createFreshOrg(tagB);
      const [tokenA, tokenB] = await Promise.all([makeSession(tagA), makeSession(tagB)]);

      setStripeForTesting(null);

      // B first, then A
      const rB = await post(base, "/billing/checkout", tokenB, { plan: "pro" });
      const rA = await post(base, "/billing/checkout", tokenA, { plan: "pro" });

      assert("T8 orgB → 200", rB.status === 200, `got ${rB.status}`);
      assert("T8 orgA → 409", rA.status === 409, `got ${rA.status}`);
    }

    // ── T9: concurrency — simultaneous requests from 3 orgs ─────────────────
    console.log("[T9] Concurrency: 3 concurrent requests, independent billing state");
    {
      const tagX = "t9x"; const tagY = "t9y"; const tagZ = "t9z";
      tags.push(tagX, tagY, tagZ);
      await Promise.all([
        upsertOrgSettings(orgId(tagX), { subscriptionStatus: "active" }),
        upsertOrgSettings(orgId(tagY), { subscriptionStatus: "trialing" }),
        createFreshOrg(tagZ),
      ]);
      const [tokX, tokY, tokZ] = await Promise.all([
        makeSession(tagX), makeSession(tagY), makeSession(tagZ),
      ]);

      setStripeForTesting(null);

      const [rX, rY, rZ] = await Promise.all([
        post(base, "/billing/checkout", tokX, { plan: "pro" }),
        post(base, "/billing/checkout", tokY, { plan: "pro" }),
        post(base, "/billing/checkout", tokZ, { plan: "pro" }),
      ]);

      assert("T9 orgX (active) → 409",    rX.status === 409, `got ${rX.status}`);
      assert("T9 orgY (trialing) → 409",  rY.status === 409, `got ${rY.status}`);
      assert("T9 orgZ (none) → 200",      rZ.status === 200, `got ${rZ.status}`);
    }

    // ── T10: role guard — member cannot call ownerOnly endpoint ──────────────
    console.log("[T10] Role guard: 'member' cannot call /billing/upgrade (ownerOnly)");
    {
      const tag = "t10"; tags.push(tag);
      await upsertOrgSettings(orgId(tag), { plan: "standard", subscriptionStatus: "active" });
      const memberToken = await makeSession(tag, "member");  // role = member, not owner

      setStripeForTesting(null);

      // If role guard fires, we get 403 before reaching any billing logic
      const r = await post(base, "/billing/upgrade", memberToken, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T10 status 403",         r.status === 403, `got ${r.status}`);
      assert("T10 forbidden error", String(body["error"]).includes("owner"), String(body["error"]));
    }

    // ── T11: production guard — setStripeForTesting throws in NODE_ENV=production
    console.log("[T11] Production guard: setStripeForTesting() must throw when NODE_ENV=production");
    {
      const prevEnv = process.env["NODE_ENV"];
      process.env["NODE_ENV"] = "production";
      try {
        let threw = false;
        let errMsg = "";
        try {
          // Call with null (restore) — must still throw in production before any assignment
          setStripeForTesting(null as unknown as Record<string, unknown>);
        } catch (e: unknown) {
          threw = true;
          errMsg = (e as Error).message ?? "";
        }
        assert("T11 throws in production", threw,
          "setStripeForTesting() must throw when NODE_ENV=production");
        assert("T11 error mentions production", errMsg.toLowerCase().includes("production"),
          `msg="${errMsg.slice(0, 80)}"`);
      } finally {
        // Must restore NODE_ENV before allowing setStripeForTesting to work again
        process.env["NODE_ENV"] = prevEnv;
        // Now safe to call (not production) — ensure clean state
        setStripeForTesting(null);
      }
    }

    // ── T12: fresh account (pending_billing, no stripeCustomerId) → noSubscription ─
    console.log("[T12] Fresh account, no stripeCustomerId → noSubscription: true");
    {
      const tag = "t12"; tags.push(tag);
      // Use upsertOrgSettings to set pending_billing status (not a valid Stripe status,
      // but represents "account created, never subscribed, no customer ID").
      await upsertOrgSettings(orgId(tag), { subscriptionStatus: "pending_billing", plan: "standard" });
      const token = await makeSession(tag, "owner");

      const fakeStripe = makeFakeStripe({});
      setStripeForTesting(fakeStripe);

      const r = await post(base, "/billing/upgrade", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T12 status 200",              r.status === 200, `got ${r.status}`);
      assert("T12 noSubscription true",     body["noSubscription"] === true, String(body["noSubscription"]));
      assert("T12 no reactivation key",     !("reactivation" in body), `body=${JSON.stringify(body).slice(0, 80)}`);
      assert("T12 no Stripe session create", fakeStripe.callCount("checkout.sessions.create") === 0,
             `calls=${fakeStripe.callCount("checkout.sessions.create")}`);

      setStripeForTesting(null);
    }

    // ── T13: active account → upgrade path taken, NOT the reactivation branch ────
    console.log("[T13] Active account → upgrade path, reactivation branch skipped");
    {
      const tag = "t13"; tags.push(tag);
      // Active subscription with stripe customer — reactivation requires "canceled",
      // so the active upgrade path must be taken instead.
      await createFreshOrg(tag, { subscription_status: "active", stripe_customer_id: "cus_t13_active" });
      const token = await makeSession(tag, "owner");

      // activeSubs=true → stripe.subscriptions.list returns a live sub → upgrade path
      const fakeStripe = makeFakeStripe({ activeSubs: true, allowSubUpdate: true });
      setStripeForTesting(fakeStripe);

      const r = await post(base, "/billing/upgrade", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T13 status 200",            r.status === 200, `got ${r.status}`);
      assert("T13 no reactivation key",   !body["reactivation"], `body=${JSON.stringify(body).slice(0, 80)}`);
      // Active path calls subscriptions.update, not checkout.sessions.create
      assert("T13 sub update called",     fakeStripe.callCount("subscriptions.update") === 1,
             `calls=${fakeStripe.callCount("subscriptions.update")}`);
      assert("T13 no session list call",  fakeStripe.callCount("checkout.sessions.list") === 0,
             `calls=${fakeStripe.callCount("checkout.sessions.list")}`);

      setStripeForTesting(null);
    }

    // ── T14: trialing account → reactivation branch NOT taken ───────────────────
    // "trialing" without a real stripeSubscriptionId normalises to "pending_billing".
    // The reactivation branch checks subscriptionStatus === "canceled" strictly, so
    // a pending_billing account with a stripeCustomerId falls through to noSubscription.
    console.log("[T14] Trialing account (→ pending_billing) → noSubscription, no reactivation");
    {
      const tag = "t14"; tags.push(tag);
      await createFreshOrg(tag, { subscription_status: "trialing", stripe_customer_id: "cus_t14_trial" });
      const token = await makeSession(tag, "owner");

      // Fake returns no active/trialing subs → no sub found → noSubscription path
      const fakeStripe = makeFakeStripe({ activeSubs: false, trialingSubs: false });
      setStripeForTesting(fakeStripe);

      const r = await post(base, "/billing/upgrade", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T14 status 200",          r.status === 200, `got ${r.status}`);
      assert("T14 noSubscription true", body["noSubscription"] === true, String(body["noSubscription"]));
      assert("T14 no reactivation key", !body["reactivation"], `body=${JSON.stringify(body).slice(0, 80)}`);

      setStripeForTesting(null);
    }

    // ── T15: canceled + stripeCustomerId → reactivation checkout created ─────────
    console.log("[T15] Canceled + stripeCustomerId → reactivation checkout");
    {
      const tag = "t15"; tags.push(tag);
      await createFreshOrg(tag, { stripe_customer_id: "cus_t15_canceled" });
      const token = await makeSession(tag, "owner");

      const fakeStripe = makeFakeStripe({ activeSubs: false, trialingSubs: false, openReactivationSession: false });
      setStripeForTesting(fakeStripe);

      const r = await post(base, "/billing/upgrade", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T15 status 200",             r.status === 200, `got ${r.status}`);
      assert("T15 reactivation true",      body["reactivation"] === true, String(body["reactivation"]));
      assert("T15 customerReused true",    body["customerReused"] === true, String(body["customerReused"]));
      assert("T15 checkoutUrl is https",   typeof body["checkoutUrl"] === "string" &&
             (body["checkoutUrl"] as string).startsWith("https://"), String(body["checkoutUrl"]));
      assert("T15 targetPlan is pro",      body["targetPlan"] === "pro", String(body["targetPlan"]));
      assert("T15 not idempotent",         !body["idempotent"], `idempotent=${body["idempotent"]}`);
      // Verify session was created and used the existing Stripe customer
      assert("T15 session create called",  fakeStripe.callCount("checkout.sessions.create") === 1,
             `calls=${fakeStripe.callCount("checkout.sessions.create")}`);
      const createArg = fakeStripe.lastCallArg("checkout.sessions.create") as Record<string, unknown> | undefined;
      assert("T15 customer reused",        createArg?.["customer"] === "cus_t15_canceled",
             `customer=${createArg?.["customer"]}`);
      assert("T15 mode subscription",      createArg?.["mode"] === "subscription", `mode=${createArg?.["mode"]}`);
      const meta = createArg?.["metadata"] as Record<string, string> | undefined;
      assert("T15 meta.plan is pro",       meta?.["plan"] === "pro", `meta.plan=${meta?.["plan"]}`);
      assert("T15 meta.targetPlan is pro", meta?.["targetPlan"] === "pro", `meta.targetPlan=${meta?.["targetPlan"]}`);
      assert("T15 meta.reactivation",      meta?.["reactivation"] === "true", `meta.reactivation=${meta?.["reactivation"]}`);
      assert("T15 no sub update",          fakeStripe.callCount("subscriptions.update") === 0,
             `calls=${fakeStripe.callCount("subscriptions.update")}`);

      setStripeForTesting(null);
    }

    // ── T16: canceled WITHOUT stripeCustomerId → noSubscription: true ───────────
    console.log("[T16] Canceled, no stripeCustomerId → noSubscription: true");
    {
      const tag = "t16"; tags.push(tag);
      await createFreshOrg(tag); // canceled, no stripe_customer_id
      const token = await makeSession(tag, "owner");

      const fakeStripe = makeFakeStripe({});
      setStripeForTesting(fakeStripe);

      const r = await post(base, "/billing/upgrade", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T16 status 200",              r.status === 200, `got ${r.status}`);
      assert("T16 noSubscription true",     body["noSubscription"] === true, String(body["noSubscription"]));
      assert("T16 no reactivation",         !body["reactivation"], `reactivation=${body["reactivation"]}`);
      assert("T16 no session create",       fakeStripe.callCount("checkout.sessions.create") === 0,
             `calls=${fakeStripe.callCount("checkout.sessions.create")}`);

      setStripeForTesting(null);
    }

    // ── T17: double reactivation call → idempotent (existing open session) ───────
    console.log("[T17] Double reactivation call → idempotent, existing session returned");
    {
      const tag = "t17"; tags.push(tag);
      await createFreshOrg(tag, { stripe_customer_id: "cus_t17_canceled" });
      const token = await makeSession(tag, "owner");

      // Fake has an open reactivation session already in Stripe
      const fakeStripe = makeFakeStripe({ openReactivationSession: true });
      setStripeForTesting(fakeStripe);

      const r = await post(base, "/billing/upgrade", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T17 status 200",            r.status === 200, `got ${r.status}`);
      assert("T17 reactivation true",     body["reactivation"] === true, String(body["reactivation"]));
      assert("T17 idempotent true",       body["idempotent"] === true, String(body["idempotent"]));
      assert("T17 url is existing",       body["checkoutUrl"] === "https://checkout.stripe.com/c/pay/existing_session",
             String(body["checkoutUrl"]));
      assert("T17 no new session create", fakeStripe.callCount("checkout.sessions.create") === 0,
             `calls=${fakeStripe.callCount("checkout.sessions.create")}`);
      assert("T17 session list called",   fakeStripe.callCount("checkout.sessions.list") === 1,
             `calls=${fakeStripe.callCount("checkout.sessions.list")}`);

      setStripeForTesting(null);
    }

    // ── T18: invalid plan string → 400 (parsePlan guard, before Stripe) ─────────
    console.log("[T18] Invalid plan → 400");
    {
      const tag = "t18"; tags.push(tag);
      await createFreshOrg(tag, { stripe_customer_id: "cus_t18_canceled" });
      const token = await makeSession(tag, "owner");

      // parsePlan() rejects before any Stripe call
      setStripeForTesting(null);

      const r = await post(base, "/billing/upgrade", token, { plan: "enterprise" });
      const body = await r.json() as Record<string, unknown>;

      assert("T18 status 400",           r.status === 400, `got ${r.status}`);
      assert("T18 error mentions plan",  String(body["error"]).toLowerCase().includes("plan"), String(body["error"]));
      assert("T18 no reactivation",      !body["reactivation"], `reactivation=${body["reactivation"]}`);
    }

    // ── T19: Stripe client throws → 500 ─────────────────────────────────────────
    console.log("[T19] Stripe client throws on sessions.list → 500");
    {
      const tag = "t19"; tags.push(tag);
      await createFreshOrg(tag, { stripe_customer_id: "cus_t19_canceled" });
      const token = await makeSession(tag, "owner");

      // A broken Stripe that always rejects
      const brokenStripe = {
        checkout: {
          sessions: {
            list:     () => Promise.reject(new Error("Stripe connection refused")),
            create:   () => Promise.reject(new Error("Stripe connection refused")),
            retrieve: () => Promise.reject(new Error("Stripe connection refused")),
          },
        },
        subscriptions: {
          list:   () => Promise.reject(new Error("Stripe connection refused")),
          update: () => Promise.reject(new Error("Stripe connection refused")),
          cancel: () => Promise.reject(new Error("Stripe connection refused")),
        },
        customers: { create: () => Promise.reject(new Error("Stripe connection refused")) },
        billingPortal: { sessions: { create: () => Promise.reject(new Error("Stripe connection refused")) } },
        webhooks: { constructEvent: () => { throw new Error("no"); } },
      };
      setStripeForTesting(brokenStripe as unknown as Record<string, unknown>);

      const r = await post(base, "/billing/upgrade", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      assert("T19 status 500",      r.status === 500, `got ${r.status}`);
      assert("T19 error present",   typeof body["error"] === "string", String(body["error"]));
      assert("T19 no reactivation", !body["reactivation"], `reactivation=${body["reactivation"]}`);

      setStripeForTesting(null);
    }

    // ── T20: webhook checkout.session.completed (reactivation) → DB updated ─────
    console.log("[T20] Webhook checkout.session.completed with reactivation metadata → DB active");
    {
      const tag = "t20"; tags.push(tag);
      const customerId = `cus_t20_${RUN_ID}`;
      await createFreshOrg(tag, { stripe_customer_id: customerId });

      // Clear webhook secret so the handler uses JSON.parse(body) path (dev mode)
      const savedWebhookSecret       = process.env["STRIPE_WEBHOOK_SECRET"];
      const savedWebhookSecretRender = process.env["STRIPE_WEBHOOK_SECRET_RENDER"];
      delete process.env["STRIPE_WEBHOOK_SECRET"];
      delete process.env["STRIPE_WEBHOOK_SECRET_RENDER"];

      const webhookEvent = {
        id:   "evt_t20_test",
        type: "checkout.session.completed",
        data: {
          object: {
            id:             "cs_t20_completed",
            customer:       customerId,
            metadata:       { plan: "pro", reactivation: "true", orgId: orgId(tag) },
            payment_status: "paid",
            status:         "complete",
          },
        },
      };

      const r = await fetch(`${base}/billing/webhook`, {
        method:  "POST",
        headers: {
          "Content-Type":     "application/json",
          "stripe-signature": "t=1,v1=test_placeholder",
        },
        body: JSON.stringify(webhookEvent),
      });

      // Restore env
      if (savedWebhookSecret)       process.env["STRIPE_WEBHOOK_SECRET"]        = savedWebhookSecret;
      if (savedWebhookSecretRender) process.env["STRIPE_WEBHOOK_SECRET_RENDER"]  = savedWebhookSecretRender;

      assert("T20 webhook 200", r.status === 200, `got ${r.status}`);

      // Allow async DB write to complete
      await new Promise(resolve => setTimeout(resolve, 300));

      const client20 = await pool.connect();
      let dbStatus = ""; let dbPlan = "";
      try {
        const result = await client20.query<{ subscription_status: string; plan: string }>(
          `SELECT subscription_status, plan FROM org_settings WHERE org_id = $1 LIMIT 1`,
          [orgId(tag)],
        );
        dbStatus = result.rows[0]?.subscription_status ?? "";
        dbPlan   = result.rows[0]?.plan ?? "";
      } finally { client20.release(); }

      assert("T20 DB status → active", dbStatus === "active", `dbStatus=${dbStatus}`);
      assert("T20 DB plan → pro",      dbPlan   === "pro",    `dbPlan=${dbPlan}`);
    }

    // ── T21: no local DB update before webhook ───────────────────────────────────
    console.log("[T21] POST /billing/upgrade (canceled) → DB status unchanged (webhook not fired)");
    {
      const tag = "t21"; tags.push(tag);
      await createFreshOrg(tag, { stripe_customer_id: "cus_t21_canceled" });
      const token = await makeSession(tag, "owner");

      const fakeStripe = makeFakeStripe({ openReactivationSession: false });
      setStripeForTesting(fakeStripe);

      // Call upgrade — should receive a reactivation checkout URL
      const r = await post(base, "/billing/upgrade", token, { plan: "pro" });
      assert("T21 status 200",        r.status === 200, `got ${r.status}`);
      const body = await r.json() as Record<string, unknown>;
      assert("T21 reactivation true", body["reactivation"] === true, String(body["reactivation"]));

      // Immediately query DB — status MUST still be "canceled" (webhook hasn't fired)
      const client21 = await pool.connect();
      let dbStatus21 = ""; let dbPlan21 = "";
      try {
        const result = await client21.query<{ subscription_status: string; plan: string }>(
          `SELECT subscription_status, plan FROM org_settings WHERE org_id = $1 LIMIT 1`,
          [orgId(tag)],
        );
        dbStatus21 = result.rows[0]?.subscription_status ?? "";
        dbPlan21   = result.rows[0]?.plan ?? "";
      } finally { client21.release(); }

      assert("T21 DB status still canceled", dbStatus21 === "canceled", `dbStatus=${dbStatus21}`);
      assert("T21 DB plan still standard",   dbPlan21   === "standard", `dbPlan=${dbPlan21}`);

      setStripeForTesting(null);
    }

    // ── T22: two concurrent calls → same idempotencyKey, same URL, no DB update ──
    // The 30-minute bucket produces a deterministic idempotencyKey for both requests.
    // In real Stripe the second create() with an identical key returns the cached session;
    // the fake records both calls so we can verify the keys match and the DB stays clean.
    console.log("[T22] Two concurrent reactivation calls → same idempotencyKey, same URL, no DB update");
    {
      const tag = "t22"; tags.push(tag);
      await createFreshOrg(tag, { stripe_customer_id: "cus_t22_concurrent" });
      const token = await makeSession(tag, "owner");

      const fakeStripe = makeFakeStripe({ openReactivationSession: false });
      setStripeForTesting(fakeStripe);

      // Fire both requests concurrently
      const [rA, rB] = await Promise.all([
        post(base, "/billing/upgrade", token, { plan: "pro" }),
        post(base, "/billing/upgrade", token, { plan: "pro" }),
      ]);
      const [bodyA, bodyB] = await Promise.all([
        rA.json() as Promise<Record<string, unknown>>,
        rB.json() as Promise<Record<string, unknown>>,
      ]);

      assert("T22 both status 200",           rA.status === 200 && rB.status === 200,
             `A=${rA.status} B=${rB.status}`);
      assert("T22 both reactivation true",    bodyA["reactivation"] === true && bodyB["reactivation"] === true,
             `A=${bodyA["reactivation"]} B=${bodyB["reactivation"]}`);
      assert("T22 both return same URL",      bodyA["checkoutUrl"] === bodyB["checkoutUrl"],
             `A=${bodyA["checkoutUrl"]} B=${bodyB["checkoutUrl"]}`);

      // Verify both create() calls used the same idempotencyKey
      const createCalls = fakeStripe.log["checkout.sessions.create"] ?? [];
      const keyA = (createCalls[0]?.[1] as Record<string, unknown> | undefined)?.["idempotencyKey"];
      const keyB = (createCalls[1]?.[1] as Record<string, unknown> | undefined)?.["idempotencyKey"];
      assert("T22 idempotencyKey present on call A",   typeof keyA === "string" && (keyA as string).startsWith("fp-reactivation-"),
             `keyA=${keyA}`);
      assert("T22 idempotencyKey A === B (same bucket)", keyA === keyB,
             `A="${keyA}" B="${keyB}"`);
      assert("T22 key includes orgId",  (keyA as string).includes(orgId(tag)),
             `key=${keyA}`);
      assert("T22 key includes plan",   (keyA as string).includes("pro"),
             `key=${keyA}`);

      // DB must be unchanged — no local activation before webhook
      const client22 = await pool.connect();
      let dbStatus22 = "";
      try {
        const result = await client22.query<{ subscription_status: string }>(
          `SELECT subscription_status FROM org_settings WHERE org_id = $1 LIMIT 1`,
          [orgId(tag)],
        );
        dbStatus22 = result.rows[0]?.subscription_status ?? "";
      } finally { client22.release(); }

      assert("T22 DB still canceled", dbStatus22 === "canceled", `dbStatus=${dbStatus22}`);

      setStripeForTesting(null);
    }

    // ── T23: orphaned stripeCustomerId (resource_missing on list) ─────────────────
    // checkout.sessions.list() throws resource_missing → customer deleted from Stripe.
    // Expected: 200 noSubscription (not 500), DB stripe_customer_id cleared, no create().
    console.log("[T23] Orphaned stripeCustomerId (resource_missing) → noSubscription, DB cleared, no create()");
    {
      const tag = "t23"; tags.push(tag);
      await createFreshOrg(tag, { stripe_customer_id: "cus_orphan_test" });
      const token = await makeSession(tag, "owner");

      const fakeStripe = makeFakeStripe({ orphanedCustomer: true });
      setStripeForTesting(fakeStripe);

      const r = await post(base, "/billing/upgrade", token, { plan: "pro" });
      const body = await r.json() as Record<string, unknown>;

      // Must return noSubscription — not 500, not reactivation
      assert("T23 status 200",             r.status === 200, `got ${r.status}`);
      assert("T23 noSubscription true",    body["noSubscription"] === true, String(body["noSubscription"]));
      assert("T23 no reactivation key",    !body["reactivation"], `reactivation=${body["reactivation"]}`);
      assert("T23 redirectTo checkout",    body["redirectTo"] === "/checkout.html",
             `redirectTo=${body["redirectTo"]}`);

      // checkout.sessions.list was called (the orphan check ran)
      assert("T23 list was called",        fakeStripe.callCount("checkout.sessions.list") === 1,
             `calls=${fakeStripe.callCount("checkout.sessions.list")}`);
      // checkout.sessions.create must NOT have been called
      assert("T23 no create() called",     fakeStripe.callCount("checkout.sessions.create") === 0,
             `calls=${fakeStripe.callCount("checkout.sessions.create")}`);

      // Allow async DB write (persistOrgData) to complete
      await new Promise(resolve => setTimeout(resolve, 300));

      // DB stripe_customer_id must be NULL — cleaned up by the handler
      const client23 = await pool.connect();
      let dbCustomerId: string | null = "NOT_QUERIED";
      try {
        const result = await client23.query<{ stripe_customer_id: string | null }>(
          `SELECT stripe_customer_id FROM org_settings WHERE org_id = $1 LIMIT 1`,
          [orgId(tag)],
        );
        dbCustomerId = result.rows[0]?.stripe_customer_id ?? null;
      } finally { client23.release(); }

      // org_settings has a NOT NULL constraint; the schema convention is NULLIF(col,'')
      // at read-time, so '' is the canonical "cleared" value.
      assert("T23 DB stripe_customer_id cleared",
             dbCustomerId === null || dbCustomerId === "",
             `stripe_customer_id=${dbCustomerId}`);

      setStripeForTesting(null);
    }

  } finally {
    // setStripeForTesting must be called while NODE_ENV is still "test"
    // (we set it at the top of runTests).  Restoring originalNodeEnv afterward
    // prevents the production guard from firing on this cleanup call.
    setStripeForTesting(null);
    process.env["NODE_ENV"] = originalNodeEnv;
    delete process.env["STRIPE_PRICE_PRO"];
    await cleanup(tags);
    await stopServer(server);
    await pool.end();
  }
}

// ─── runner ───────────────────────────────────────────────────────────────────

runTests()
  .then(() => {
    console.log("\n══════════════════════════════════════════");
    console.log(` Lot C Billing — T1-T23 runtime results`);
    console.log("══════════════════════════════════════════");
    results.forEach(r => console.log(r));
    console.log(`\n  ${passed} passed / ${failed} failed / ${passed + failed} total`);
    if (failed > 0) process.exit(1);
  })
  .catch(err => {
    console.error("\n[FATAL] Test runner crashed:", err);
    process.exit(1);
  });
