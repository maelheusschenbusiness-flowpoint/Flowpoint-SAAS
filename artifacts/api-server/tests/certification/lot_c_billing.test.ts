/**
 * Lot C — Billing runtime integration tests T1-T10
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
  activeSubs?: boolean;        // subscriptions.list(status:'active') returns a sub
  trialingSubs?: boolean;      // subscriptions.list(status:'trialing') returns a sub
  subHistory?: boolean;        // subscriptions.list(status:'all') returns a sub
  addonActiveInSub?: boolean;  // addon price found in existing subscription items
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
      update: rec("subscriptions.update"),
      cancel: rec("subscriptions.cancel"),
    },

    checkout: {
      sessions: {
        create(params: unknown) {
          (log["checkout.sessions.create"] ??= []).push([params]);
          return Promise.resolve({
            url:  "https://checkout.stripe.com/c/pay/fake_session",
            id:   "cs_fake",
            client_secret: "cs_secret_fake",
          });
        },
        retrieve: rec("checkout.sessions.retrieve"),
      },
    },

    billingPortal: { sessions: { create: rec("billingPortal.sessions.create") } },
    webhooks:      { constructEvent: rec("webhooks.constructEvent") },
  };
}

// ─── test server ─────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
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
    console.log(` Lot C Billing — T1-T10 runtime results`);
    console.log("══════════════════════════════════════════");
    results.forEach(r => console.log(r));
    console.log(`\n  ${passed} passed / ${failed} failed / ${passed + failed} total`);
    if (failed > 0) process.exit(1);
  })
  .catch(err => {
    console.error("\n[FATAL] Test runner crashed:", err);
    process.exit(1);
  });
