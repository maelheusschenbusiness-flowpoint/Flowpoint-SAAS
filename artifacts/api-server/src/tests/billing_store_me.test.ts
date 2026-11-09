/**
 * Certification — Commit 1: store.me elimination in billing
 *
 * Validates:
 * 1. Static source: billing-service.ts does NOT read store.me.plan / store.me.addons
 *    / store.me.subscriptionStatus / store.me.trialEndsAt
 * 2. Static source: startTrial does NOT mutate store.me.*
 * 3. Multi-org isolation: getSubscriptionAnalytics returns org-scoped data, not a shared singleton
 * 4. Multi-org isolation: PUT /api/me/addons reads current addons from DB (not store.me.addons)
 */

import { describe, it, afterAll, vi } from "vitest";

// vitest.setup.ts remplace @workspace/db par un faux pool pour toute la suite.
// Ce fichier verifie un comportement SQL REEL (isolation par organisation) :
// il reprend donc le vrai module, comme les autres tests *-db.test.ts.
vi.mock("@workspace/db", async (importOriginal) => importOriginal<typeof import("@workspace/db")>());
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import pg from "pg";
import assert from "assert";

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env["DATABASE_URL"] ?? "",
  max: 4,
});

// ── helpers ────────────────────────────────────────────────────────────────────

async function freshOrg(plan = "standard", addons: Record<string, unknown> = {}): Promise<string> {
  // organizations.id est un UUID (un identifiant texte plantait en 22P02).
  const orgId = randomUUID();
  await pool.query(
    `INSERT INTO organizations (id, name, owner_email, plan, subscription_status, addons, created_at, updated_at)
     VALUES ($1,$2,$3,$4,'active',$5::jsonb,NOW(),NOW())
     ON CONFLICT (id) DO NOTHING`,
    [orgId, `Test Org ${orgId}`, `owner_${orgId}@test.invalid`, plan, JSON.stringify(addons)]
  );
  return orgId;
}

async function cleanup(orgId: string) {
  await pool.query("DELETE FROM organizations WHERE id=$1", [orgId]).catch(() => {});
  await pool.query("DELETE FROM org_settings WHERE org_id=$1", [orgId]).catch(() => {});
}

// ── Test 1: static source checks ──────────────────────────────────────────────

async function testNoStoreMeInBillingService() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/billing-service.ts"),
    "utf8"
  );

  // Must not read singleton fields (non-comment lines only)
  const lines = src.split("\n");
  const badLines = lines
    .map((l, i) => ({ line: i + 1, text: l }))
    .filter(({ text }) => !text.trimStart().startsWith("//") && !text.trimStart().startsWith("*"))
    .filter(({ text }) =>
      /store\.me\.(plan|addons|subscriptionStatus|trialEndsAt|stripeCustomerId)\b/.test(text)
    );

  assert.deepStrictEqual(
    badLines,
    [],
    `billing-service.ts still reads store.me: ${JSON.stringify(badLines)}`
  );
  console.log("✅ Test 1: billing-service.ts has no store.me singleton reads");
}

async function testNoStoreMeMutationsInStartTrial() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/billing-service.ts"),
    "utf8"
  );
  // Within the startTrial function body, there must be no assignments to store.me.*
  const startTrialFnMatch = src.match(/export async function startTrial[\s\S]*?^}/m);
  if (!startTrialFnMatch) throw new Error("startTrial function not found in billing-service.ts");

  const fnSrc = startTrialFnMatch[0];
  const mutLines = fnSrc.split("\n")
    .filter(l => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .filter(l => /store\.me\.\w+\s*=/.test(l));

  assert.deepStrictEqual(
    mutLines,
    [],
    `startTrial still mutates store.me: ${JSON.stringify(mutLines)}`
  );
  console.log("✅ Test 2: startTrial does not mutate store.me.*");
}

async function testNoBroadcastPlanUpdateMutation() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/store.ts"),
    "utf8"
  );
  const match = src.match(/broadcastPlanUpdate[\s\S]*?(?=\n  \w)/);
  if (!match) throw new Error("broadcastPlanUpdate not found in store.ts");
  const fnSrc = match[0];

  const mutLines = fnSrc.split("\n")
    .filter(l => !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*"))
    .filter(l => /this\.me\.\w+\s*=/.test(l));

  assert.deepStrictEqual(
    mutLines,
    [],
    `broadcastPlanUpdate still mutates this.me: ${JSON.stringify(mutLines)}`
  );
  console.log("✅ Test 3: broadcastPlanUpdate does not mutate this.me.*");
}

// ── Test 2: multi-org isolation via DB ────────────────────────────────────────

async function testGetSubscriptionAnalyticsIsolation() {
  const { getSubscriptionAnalytics } = await import("../services/billing-service.js");

  const orgA = await freshOrg("pro",  { whiteLabel: true  });
  const orgB = await freshOrg("ultra", { whiteLabel: false });

  try {
    const [resA, resB] = await Promise.all([
      getSubscriptionAnalytics(orgA),
      getSubscriptionAnalytics(orgB),
    ]);

    assert.strictEqual(
      resA.plan.toLowerCase(),
      "pro",
      `Org A should have plan=pro, got ${resA.plan}`
    );
    assert.strictEqual(
      resB.plan.toLowerCase(),
      "ultra",
      `Org B should have plan=ultra, got ${resB.plan}`
    );
    assert.notStrictEqual(
      resA.plan,
      resB.plan,
      "Org A and Org B must NOT return the same plan (cross-tenant singleton leak)"
    );
    console.log("✅ Test 4: getSubscriptionAnalytics returns org-scoped plan (no singleton leak)");
  } finally {
    await cleanup(orgA);
    await cleanup(orgB);
  }
}

async function testPutAddonsReadsFromDB() {
  // Verify that PUT /api/me/addons uses loadOrgData (DB) not store.me.addons
  // by checking the source no longer references store.me.addons in that handler.
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/routes/me.ts"),
    "utf8"
  );

  // The store import must be absent from me.ts
  const storeImportLines = src.split("\n").filter(l =>
    /^import.*\bstore\b.*from.*store/.test(l)
  );
  assert.deepStrictEqual(
    storeImportLines,
    [],
    `me.ts still imports store: ${JSON.stringify(storeImportLines)}`
  );

  // The addons handler must read from loadOrgData, not store.me
  assert.ok(
    src.includes("loadOrgData(orgId)"),
    "me.ts PUT /api/me/addons must call loadOrgData(orgId)"
  );
  assert.ok(
    !src.includes("store.me.addons"),
    "me.ts must not reference store.me.addons"
  );
  console.log("✅ Test 5: PUT /api/me/addons reads addons from DB via loadOrgData (store import removed)");
}

// ── vitest runner (anciennement un script `main()` + process.exit) ──────────

describe("billing store.me elimination", () => {
  afterAll(async () => { await pool.end(); });
  it("billing-service.ts ne lit plus les champs du singleton store.me", async () => { await testNoStoreMeInBillingService(); }, 30_000);
  it("startTrial ne mute pas store.me", async () => { await testNoStoreMeMutationsInStartTrial(); }, 30_000);
  it("broadcastPlanUpdate ne mute pas this.me", async () => { await testNoBroadcastPlanUpdateMutation(); }, 30_000);
  it("getSubscriptionAnalytics est isole par organisation", async () => { await testGetSubscriptionAnalyticsIsolation(); }, 30_000);
  it("PUT /me/addons lit les add-ons en base via loadOrgData", async () => { await testPutAddonsReadsFromDB(); }, 30_000);
});
