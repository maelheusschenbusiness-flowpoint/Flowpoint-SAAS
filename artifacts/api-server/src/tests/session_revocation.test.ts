/**
 * Certification — Commit 2: session revocation is awaited on member removal
 *
 * Validates:
 * 1. Static source: team.ts now uses await + try/catch instead of fire-and-forget .catch()
 * 2. Static source: the security error path logs at logger.error level (not warn)
 */

import fs from "fs";
import path from "path";
import assert from "assert";

async function testSessionRevocationIsAwaited() {
  const src = fs.readFileSync(
    path.resolve(process.cwd(), "src/routes/team.ts"),
    "utf8"
  );

  // 1. Must have "await invalidateAllSessions"
  assert.ok(
    src.includes("await invalidateAllSessions("),
    "team.ts must await invalidateAllSessions — found fire-and-forget pattern"
  );
  console.log("✅ Test 1: invalidateAllSessions is awaited");

  // 2. Must NOT have the old fire-and-forget pattern
  assert.ok(
    !src.includes("invalidateAllSessions(memberEmail).catch("),
    "team.ts still has fire-and-forget .catch() on invalidateAllSessions"
  );
  console.log("✅ Test 2: old fire-and-forget .catch() pattern is gone");

  // 3. Error must be logged at error level, not just warn
  // Check that the catch block after await invalidateAllSessions uses logger.error
  const awaitIdx = src.indexOf("await invalidateAllSessions(");
  assert.ok(awaitIdx >= 0, "No await invalidateAllSessions found");
  const catchRegion = src.slice(awaitIdx, awaitIdx + 400);
  assert.ok(
    catchRegion.includes("logger.error"),
    `catch block after invalidateAllSessions must log at error level (SECURITY)\nFound region: ${catchRegion}`
  );
  console.log("✅ Test 3: catch block logs at logger.error (security severity)");

  // 4. The catch block must not silently swallow errors
  assert.ok(
    catchRegion.includes("try {") || src.slice(Math.max(0, awaitIdx - 200), awaitIdx).includes("try {"),
    "invalidateAllSessions must be inside a try/catch"
  );
  console.log("✅ Test 4: invalidateAllSessions is inside a try/catch block");
}

async function main() {
  console.log("=== Session revocation certification ===\n");
  try {
    await testSessionRevocationIsAwaited();
    console.log("\n✅ ALL SESSION REVOCATION TESTS PASSED");
  } catch (err) {
    console.error("\n❌ TEST FAILED:", (err as Error).message);
    process.exit(1);
  }
}

main();
