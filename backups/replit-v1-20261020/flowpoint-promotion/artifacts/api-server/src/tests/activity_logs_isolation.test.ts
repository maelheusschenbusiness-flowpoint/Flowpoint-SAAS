/**
 * Certification — Commit 3: activity_logs org_id isolation
 *
 * Validates:
 * 1. Static source: ActivityLog interface has orgId field
 * 2. Static source: logActivity INSERT includes org_id column
 * 3. Static source: getFilteredActivity filters by org_id
 * 4. Static source: routes/activity.ts GET/POST pass orgId
 * 5. Runtime: org A cannot see org B's activity logs
 * 6. Runtime: org_id is correctly written on INSERT
 */

import fs from "fs";
import path from "path";
import { randomBytes } from "crypto";
import pg from "pg";
import assert from "assert";

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env["DATABASE_URL"] ?? "",
  max: 4,
});

// ── helpers ────────────────────────────────────────────────────────────────────

async function cleanup(orgId: string) {
  await pool.query("DELETE FROM activity_logs WHERE org_id = $1", [orgId]).catch(() => {});
}

// ── Static tests ──────────────────────────────────────────────────────────────

async function testActivityLogInterfaceHasOrgId() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/store.ts"),
    "utf8"
  );

  // ActivityLog interface must have orgId
  const ifaceMatch = src.match(/interface ActivityLog\s*\{[\s\S]*?\}/);
  assert.ok(ifaceMatch, "ActivityLog interface not found in store.ts");
  assert.ok(
    ifaceMatch[0].includes("orgId"),
    `ActivityLog interface must have orgId field. Got: ${ifaceMatch[0]}`
  );
  console.log("✅ Test 1: ActivityLog interface has orgId field");
}

async function testLogActivityInsertIncludesOrgId() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/store.ts"),
    "utf8"
  );

  // logActivity INSERT must include org_id
  const logMatch = src.match(/async logActivity[\s\S]*?(?=\n  async|\n  [A-Za-z]|\nclass|\nexport)/);
  assert.ok(logMatch, "logActivity method not found in store.ts");
  assert.ok(
    logMatch[0].includes("org_id"),
    `logActivity INSERT must include org_id column. Got: ${logMatch[0].slice(0, 400)}`
  );
  console.log("✅ Test 2: logActivity INSERT includes org_id column");
}

async function testGetFilteredActivityFiltersOrgId() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/services/store.ts"),
    "utf8"
  );

  const filterMatch = src.match(/async getFilteredActivity[\s\S]*?(?=\n  async|\n  [A-Za-z]|\nclass|\nexport)/);
  assert.ok(filterMatch, "getFilteredActivity method not found in store.ts");

  const fn = filterMatch[0];
  assert.ok(
    fn.includes("org_id"),
    "getFilteredActivity must filter by org_id in WHERE clause"
  );
  assert.ok(
    fn.includes("orgId"),
    "getFilteredActivity must accept orgId in opts"
  );
  console.log("✅ Test 3: getFilteredActivity filters by org_id");
}

async function testActivityRoutePassesOrgId() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/routes/activity.ts"),
    "utf8"
  );

  // GET /activity must pass orgId
  assert.ok(
    src.includes("orgId") && src.includes("getFilteredActivity"),
    "activity.ts GET must pass orgId to getFilteredActivity"
  );
  // POST /activity must pass orgId
  assert.ok(
    src.includes("store.logActivity") && src.includes("orgId"),
    "activity.ts POST must pass orgId to logActivity"
  );
  console.log("✅ Test 4: routes/activity.ts GET/POST pass orgId");
}

// ── Runtime isolation tests ────────────────────────────────────────────────────

async function testOrgIsolationAtRuntime() {
  const { store } = await import("../services/store.js");

  const orgA = `test_alo_a_${randomBytes(4).toString("hex")}`;
  const orgB = `test_alo_b_${randomBytes(4).toString("hex")}`;
  const labelA = `activity-for-${orgA}`;
  const labelB = `activity-for-${orgB}`;

  try {
    // Write one event per org
    await store.logActivity({ type: "audit", label: labelA, orgId: orgA });
    await store.logActivity({ type: "audit", label: labelB, orgId: orgB });

    // Read back as org A — must NOT see org B's event
    const eventsA = await store.getFilteredActivity({ limit: 50, offset: 0, orgId: orgA });
    const labelsA = eventsA.map(e => e.label);

    assert.ok(
      labelsA.includes(labelA),
      `Org A must see its own event "${labelA}"`
    );
    assert.ok(
      !labelsA.includes(labelB),
      `Org A must NOT see org B's event "${labelB}" — cross-tenant isolation failure!`
    );

    // Read back as org B — must NOT see org A's event
    const eventsB = await store.getFilteredActivity({ limit: 50, offset: 0, orgId: orgB });
    const labelsB = eventsB.map(e => e.label);

    assert.ok(
      labelsB.includes(labelB),
      `Org B must see its own event "${labelB}"`
    );
    assert.ok(
      !labelsB.includes(labelA),
      `Org B must NOT see org A's event "${labelA}" — cross-tenant isolation failure!`
    );

    console.log("✅ Test 5: org A cannot see org B's activity (runtime isolation verified)");
  } finally {
    await cleanup(orgA);
    await cleanup(orgB);
  }
}

async function testOrgIdWrittenOnInsert() {
  const { store } = await import("../services/store.js");

  const orgId = `test_alo_ins_${randomBytes(4).toString("hex")}`;
  const label = `insert-test-${orgId}`;

  try {
    await store.logActivity({ type: "monitor", label, orgId });

    const res = await pool.query(
      "SELECT org_id, label FROM activity_logs WHERE label = $1 LIMIT 1",
      [label]
    );
    assert.strictEqual(res.rowCount, 1, "Event must be persisted to DB");
    assert.strictEqual(
      res.rows[0].org_id,
      orgId,
      `org_id written to DB must be "${orgId}", got "${res.rows[0].org_id}"`
    );
    console.log("✅ Test 6: org_id correctly written to activity_logs on INSERT");
  } finally {
    await cleanup(orgId);
  }
}

// ── runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== Activity logs org_id isolation certification ===\n");
  try {
    await testActivityLogInterfaceHasOrgId();
    await testLogActivityInsertIncludesOrgId();
    await testGetFilteredActivityFiltersOrgId();
    await testActivityRoutePassesOrgId();
    await testOrgIsolationAtRuntime();
    await testOrgIdWrittenOnInsert();
    console.log("\n✅ ALL ACTIVITY LOGS ISOLATION TESTS PASSED");
  } catch (err) {
    console.error("\n❌ TEST FAILED:", (err as Error).message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
